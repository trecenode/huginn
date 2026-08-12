const assert = require('assert');
const os = require('os');
const path = require('path');
const Module = require('module');
const esbuild = require('esbuild');

const out = path.join(os.tmpdir(), 'huginn-panel.test.js');
esbuild.buildSync({
  entryPoints: [path.join(__dirname, '..', 'src', 'panel.ts')],
  outfile: out,
  bundle: true,
  format: 'cjs',
  platform: 'node',
  external: ['vscode'],
});

const load = Module._load;
Module._load = (req, ...rest) => (req === 'vscode' ? {} : load(req, ...rest));

const storageOut = path.join(os.tmpdir(), 'huginn-storage.test.js');
esbuild.buildSync({
  entryPoints: [path.join(__dirname, '..', 'src', 'storage.ts')],
  outfile: storageOut,
  bundle: true,
  format: 'cjs',
  platform: 'node',
  external: ['vscode'],
});

const { noteFilterData, jsArg, tagKey } = require(out);
const { filterNotes, isValidCommitRange, renderExport } = require(storageOut);

const note = (over) => ({
  id: 'n1',
  file: 'src/Controllers/UserController.php',
  line: 42,
  commit: 'abc1234',
  branch: 'main',
  comment: 'Workaround para el bug de Stripe',
  createdAt: new Date(2026, 2, 9, 12, 0, 0).toISOString(),
  updatedAt: new Date(2026, 2, 9, 12, 0, 0).toISOString(),
  tags: ['bug', 'Stripe'],
});

assert.strictEqual(noteFilterData(note()).ym, '2026-03', 'March -> 2026-03');

const dec = note();
dec.createdAt = new Date(2025, 11, 31, 23, 0, 0).toISOString();
assert.strictEqual(noteFilterData(dec).ym, '2025-12', 'Dec 31 stays in 2025-12');
const jan = note();
jan.createdAt = new Date(2026, 0, 1, 0, 30, 0).toISOString();
assert.strictEqual(noteFilterData(jan).ym, '2026-01', 'Jan 1 -> 2026-01');

const { haystack } = noteFilterData(note());
assert.ok(haystack.includes('workaround'), 'comment searchable');
assert.ok(haystack.includes('stripe'), 'tags searchable, case-insensitive');
assert.ok(haystack.includes('usercontroller.php'), 'file path searchable');
assert.strictEqual(haystack, haystack.toLowerCase(), 'haystack fully lowercased');

const bare = note();
delete bare.tags;
assert.ok(noteFilterData(bare).haystack.includes('workaround'), 'no tags -> still works');

const hostile = jsArg(`x');alert(1);//.ts`);
assert.ok(!hostile.includes("'"), 'single quotes escaped out of the attribute');
assert.ok(!hostile.includes('"'), 'double quotes escaped out of the attribute');
assert.ok(!hostile.includes('<'), 'no tag can be opened');
assert.strictEqual(jsArg('src/a.ts'), '&quot;src/a.ts&quot;', 'plain paths still round-trip');

assert.strictEqual(tagKey(['Bug', ' Stripe ']), '|bug|stripe|', 'trimmed and lowercased');
assert.strictEqual(tagKey(), '', 'no tags -> empty key');
assert.ok(tagKey(['debug']).includes('|debug|'), 'exact tag matches');
assert.ok(!tagKey(['debug']).includes('|bug|'), 'substring of a tag does not match');

const at = (iso, over) => Object.assign(note(), { createdAt: iso, updatedAt: iso }, over);
const notes = [
  at('2026-01-15T10:00:00.000Z', { file: 'src/a.ts', commit: 'aaa1111' }),
  at('2026-02-20T10:00:00.000Z', { file: 'src/b.ts', commit: 'bbb2222' }),
  at('2026-03-25T10:00:00.000Z', { file: 'app/c.php', commit: 'ccc3333' }),
];

assert.strictEqual(filterNotes(notes).length, 3, 'no filter -> everything');
assert.deepStrictEqual(
  filterNotes(notes, 'src/').map((n) => n.file),
  ['src/a.ts', 'src/b.ts'],
  'path scope'
);
assert.deepStrictEqual(
  filterNotes(notes, undefined, { since: '2026-02-01' }).map((n) => n.commit),
  ['bbb2222', 'ccc3333'],
  'since is inclusive'
);
assert.deepStrictEqual(
  filterNotes(notes, undefined, { until: '2026-02-20' }).map((n) => n.commit),
  ['aaa1111', 'bbb2222'],
  'until covers the whole day, not just its midnight'
);
assert.deepStrictEqual(
  filterNotes(notes, undefined, { since: '2026-02-01', until: '2026-02-28' }).map((n) => n.commit),
  ['bbb2222'],
  'both ends'
);
assert.deepStrictEqual(
  filterNotes(notes, undefined, {
    commits: new Set(['ccc3333ffffffffffffffffffffffffffffffff']),
  }).map((n) => n.file),
  ['app/c.php'],
  'commit matched by prefix'
);
assert.strictEqual(
  filterNotes(notes, 'src/', { commits: new Set(['ccc3333ffffffffffffffffffffffffffffffff']) })
    .length,
  0,
  'filters are ANDed'
);

for (const ok of ['HEAD~5..HEAD', 'main..feature/x', 'v1.0.0...v1.1.0', 'abc1234', '@{u}..HEAD']) {
  assert.ok(isValidCommitRange(ok), `${ok} is a legitimate range`);
}
for (const bad of ['--all', '-n1', 'HEAD;rm -rf .', 'HEAD --output=x', '$(whoami)', '`id`', '']) {
  assert.ok(!isValidCommitRange(bad), `${bad} rejected`);
}

const sameName = [
  at('2026-01-15T10:00:00.000Z', { file: 'src/index.ts', line: 1, comment: 'front' }),
  at('2026-01-15T10:00:00.000Z', { file: 'src/index.ts', line: 2, comment: 'back' }),
];
assert.strictEqual(
  (renderExport(sameName).match(/^## /gm) || []).length,
  1,
  'identical paths are one section — this is what the folder prefix has to break'
);
const prefixed = renderExport([
  { ...sameName[0], file: 'frontend/src/index.ts' },
  { ...sameName[1], file: 'backend/src/index.ts' },
]);
assert.strictEqual((prefixed.match(/^## /gm) || []).length, 2, 'prefixed paths stay separate');
assert.ok(prefixed.includes('`frontend/src/index.ts`'), 'folder name in the heading');
assert.ok(prefixed.includes('- **Note**: back'), 'both notes rendered');
assert.strictEqual(renderExport([]), '# Huginn – No notes found\n', 'empty export is detectable');

const mixed = [
  at('2026-01-15T10:00:00.000Z', { file: 'src/a.ts', commit: 'aaa1111' }),
  at('2026-01-16T10:00:00.000Z', { file: 'src/b.ts', commit: 'bbb2222', done: true }),
];
assert.deepStrictEqual(
  filterNotes(mixed).map((n) => n.commit),
  ['aaa1111'],
  'resolved notes are out by default'
);
assert.strictEqual(filterNotes(mixed, undefined, { includeDone: true }).length, 2, 'opt back in');
assert.strictEqual(
  filterNotes(mixed, 'src/', { since: '2026-01-16' }).length,
  0,
  'done is ANDed with the other filters, not an escape hatch'
);

console.log('filter: ok');
