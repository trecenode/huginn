const assert = require('assert');
const os = require('os');
const path = require('path');
const esbuild = require('esbuild');

const out = path.join(os.tmpdir(), 'huginn-anchor.test.js');
esbuild.buildSync({
  entryPoints: [path.join(__dirname, '..', 'src', 'anchor.ts')],
  outfile: out,
  bundle: true,
  format: 'cjs',
  platform: 'node',
  external: ['vscode'],
});

const {
  shiftLine,
  findAnchor,
  isStale,
  similarLine,
  parseTodo,
  lineAfterRemoval,
  makeAnchor,
  toLines,
} = require(out);

const insertAt = (line, character, newLineCount) => ({
  startLine: line,
  endLine: line,
  startCharacter: character,
  newLineCount,
  insertion: true,
});
const replaceLines = (from, to, newLineCount = 0) => ({
  startLine: from,
  endLine: to,
  startCharacter: 0,
  newLineCount,
  insertion: false,
});

assert.strictEqual(shiftLine(10, insertAt(2, 0, 3)), 13, '3 lines inserted above -> 3 down');
assert.strictEqual(shiftLine(10, insertAt(2, 0, 0)), 10, 'an edit adding no line moves nothing');
assert.strictEqual(shiftLine(10, insertAt(40, 0, 5)), 10, 'edits below do not move a note');

assert.strictEqual(shiftLine(10, replaceLines(1, 4)), 7, '3 lines deleted above -> 3 up');
assert.strictEqual(shiftLine(5, replaceLines(2, 8)), 3, 'a note inside the cut lands on the cut');
assert.ok(shiftLine(5, replaceLines(2, 8)) >= 1, 'never lands before the first line');
assert.strictEqual(shiftLine(10, replaceLines(3, 3, 2)), 12, 'splitting a line pushes below down');

assert.strictEqual(shiftLine(10, insertAt(9, 0, 1)), 11, 'Enter at column 0 pushes the note down');
assert.strictEqual(shiftLine(10, insertAt(9, 17, 1)), 10, 'Enter mid-line leaves the note put');
assert.strictEqual(
  shiftLine(10, { startLine: 9, endLine: 9, startCharacter: 0, newLineCount: 3, insertion: true }),
  13,
  'a block pasted at the start of the annotated line takes it all the way down'
);

const wholeEvent = [insertAt(50, 0, 2), insertAt(2, 0, 3)];
assert.strictEqual(
  wholeEvent.reduce((line, change) => shiftLine(line, change), 10),
  13,
  'folding one event bottom-first counts only the edit above'
);

const lines = ['a', 'b', 'target()', 'c', 'd'];
assert.strictEqual(findAnchor(lines, 3, 'target()'), 3, 'unmoved code is found where it was');
assert.strictEqual(findAnchor(lines, 1, 'target()'), 3, 'code that moved down is found');
assert.strictEqual(findAnchor(lines, 5, 'target()'), 3, 'code that moved up is found');
assert.strictEqual(findAnchor(lines, 3, 'gone()'), undefined, 'deleted code is not invented');
assert.strictEqual(findAnchor(['x', 'dup', 'y', 'dup'], 3, 'dup'), 2, 'ties go to the line above');
assert.strictEqual(findAnchor(lines, 1, 'target()', 1), undefined, 'the search radius is honoured');
assert.strictEqual(findAnchor(lines, 3, '   '), undefined, 'a blank anchor matches nothing');
assert.strictEqual(findAnchor(['a', '    target()'], 1, 'target()'), 2, 'anchors are trimmed');

assert.strictEqual(isStale(undefined, { line: 3, anchor: 'x' }), true, 'deleted file -> stale');
assert.strictEqual(isStale(lines, { line: 99, anchor: 'x' }), true, 'line past the end -> stale');
assert.strictEqual(isStale(lines, { line: 3, anchor: 'target()' }), false, 'code found -> fresh');
assert.strictEqual(isStale(lines, { line: 3, anchor: 'gone()' }), true, 'code gone -> stale');
assert.strictEqual(isStale(lines, { line: 3 }), false, 'a note with no anchor cannot be judged');

assert.ok(similarLine('const total = price * 2;', 'const total = price * 3;'), 'edited in place');
assert.ok(similarLine('foo()', 'foo(bar)'), 'a call that gained an argument');
assert.ok(similarLine('}', '}'), 'punctuation-only lines compare by equality');
assert.ok(!similarLine('const total = price;', 'return renderWidget();'), 'different code');
assert.ok(!similarLine('const total = price;', ''), 'an emptied line is not the same line');

assert.strictEqual(makeAnchor(' '.repeat(4) + 'x'.repeat(500)).length, 300, 'anchor capped at 300');
assert.ok(!makeAnchor('   spaced   ').startsWith(' '), 'anchor trimmed');
const long = 'y'.repeat(400);
assert.strictEqual(findAnchor([long], 1, makeAnchor(long)), 1, 'a capped anchor still matches');

assert.deepStrictEqual(toLines('a\r\nb\nc'), ['a', 'b', 'c'], 'CRLF and LF both split');

const php = parseTodo('    // TODO: refactor this into a service');
assert.strictEqual(php.keyword, 'TODO', 'keyword uppercased');
assert.strictEqual(php.text, 'refactor this into a service', 'text without the marker');
assert.strictEqual(php.wholeLine, true, 'a comment on its own line');
assert.strictEqual(parseTodo('$x = 1; // FIXME broken').wholeLine, false, 'trailing comment');
assert.strictEqual(parseTodo('# HACK: temporary').keyword, 'HACK', 'hash comments');
assert.strictEqual(parseTodo('<!-- TODO: alt text -->').text, 'alt text', 'html terminator dropped');
assert.strictEqual(parseTodo('/* XXX: leaks memory */').text, 'leaks memory', 'block terminator');
assert.strictEqual(parseTodo('-- TODO: add an index').keyword, 'TODO', 'sql comments');
assert.strictEqual(parseTodo('const todoList = [];'), undefined, 'a variable named todo is code');
assert.strictEqual(parseTodo('return x;'), undefined, 'plain code has no todo');

const trailing = parseTodo('$x = 1; // FIXME broken');
assert.strictEqual(
  '$x = 1; // FIXME broken'.slice(trailing.markerStart),
  '// FIXME broken',
  'the cut point is the comment marker, not the keyword'
);

assert.strictEqual(lineAfterRemoval(10, 3, 100), 7, 'three comments removed above');
assert.strictEqual(lineAfterRemoval(1, 5, 100), 1, 'never before the first line');
assert.strictEqual(lineAfterRemoval(10, 0, 4), 4, 'never past the last line');

console.log('anchor: ok');
