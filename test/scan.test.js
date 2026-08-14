const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const esbuild = require('esbuild');

const stub = path.join(os.tmpdir(), 'huginn-vscode-stub.js');
fs.writeFileSync(stub, 'module.exports = {};\n');

const out = path.join(os.tmpdir(), 'huginn-scan.test.js');
esbuild.buildSync({
  entryPoints: [path.join(__dirname, '..', 'src', 'marks', 'scan.ts')],
  outfile: out,
  bundle: true,
  format: 'cjs',
  platform: 'node',
  alias: { vscode: stub },
});

const { INCLUDE, includeFor, kindFor, cleanContent } = require(out);

// No scope means the whole workspace.
{
  assert.strictEqual(includeFor(''), INCLUDE);
  assert.strictEqual(includeFor('   '), INCLUDE);
  assert.strictEqual(includeFor('.'), INCLUDE);
  assert.strictEqual(includeFor('./'), INCLUDE);
}

// A folder is prefixed, however the user typed the separators.
{
  const expected = `src/${INCLUDE}`;
  for (const scope of ['src', 'src/', './src', 'src\\', '  src  ', '/src/']) {
    assert.strictEqual(includeFor(scope), expected, `scope ${JSON.stringify(scope)}`);
  }
  assert.strictEqual(includeFor('resources\\views'), `resources/views/${INCLUDE}`);
}

// A glob is passed through untouched — the user knows what they want.
{
  assert.strictEqual(includeFor('app/**/*.php'), 'app/**/*.php');
  assert.strictEqual(includeFor('**/*.md'), '**/*.md');
}

// Extensions route to the right cleaner.
{
  const uri = (p) => ({ path: p });
  assert.strictEqual(kindFor(uri('/a/b/notes.md')), 'markdown');
  assert.strictEqual(kindFor(uri('/a/b/page.HTML')), 'html');
  assert.strictEqual(kindFor(uri('/a/b/logo.svg')), 'svg');
  assert.strictEqual(kindFor(uri('/a/b/shot.PNG')), 'image');
  assert.strictEqual(kindFor(uri('/a/b/index.ts')), 'text');
}

// Container cleaning runs before layer A, and both report their own actions.
{
  const source = '---\ngenerator: Claude\n---\nbody with a zero​width space\n';
  const { text, actions } = cleanContent('markdown', source);
  assert.strictEqual(text, 'body with a zerowidth space\n');
  assert.strictEqual(actions.length, 3);
  assert.ok(actions[0].startsWith('drop frontmatter key'));
  assert.ok(actions[2].startsWith('layer A:'));
}

// Plain code only gets layer A.
{
  const { text, actions } = cleanContent('text', 'const a = 1;​\n');
  assert.strictEqual(text, 'const a = 1;\n');
  assert.deepStrictEqual(actions, ['layer A: removed 1, replaced 0']);
}

// Clean input produces no actions at all, so nothing is offered for cleaning.
{
  assert.deepStrictEqual(cleanContent('text', 'const a = 1;\n').actions, []);
}

console.log('scan tests passed');
