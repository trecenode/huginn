const assert = require('assert');
const os = require('os');
const path = require('path');
const esbuild = require('esbuild');

const out = path.join(os.tmpdir(), 'huginn-unicode.test.js');
esbuild.buildSync({
  entryPoints: [path.join(__dirname, '..', 'src', 'marks', 'unicode.ts')],
  outfile: out,
  bundle: true,
  format: 'cjs',
  platform: 'node',
  external: ['vscode'],
});

const { inspectText, cleanText, charLabel } = require(out);

const ZWSP = '​';
const NBSP = ' ';
const BOM = '﻿';
const RLO = '‮';
const ZWJ = '‍';
const TAG_A = '\u{E0061}';

// Zero-width and BOM disappear, the visible text survives.
{
  const { text, stats } = cleanText(`he${ZWSP}llo${BOM}`);
  assert.strictEqual(text, 'hello');
  assert.strictEqual(stats.removedCount, 2);
  assert.strictEqual(stats.replacedCount, 0);
}

// Exotic spaces become U+0020 instead of vanishing.
{
  const { text, stats } = cleanText(`a${NBSP}b c`);
  assert.strictEqual(text, 'a b c');
  assert.strictEqual(stats.replacedCount, 2);
  assert.strictEqual(stats.removedCount, 0);
}

// --no-normalize-spaces equivalent keeps them untouched.
{
  const { text } = cleanText(`a${NBSP}b`, { normalizeSpaces: false });
  assert.strictEqual(text, `a${NBSP}b`);
}

// Bidi overrides are stripped and reported under their own kind.
{
  const report = inspectText(`safe${RLO}txt`);
  assert.strictEqual(report.suspiciousTotal, 1);
  assert.strictEqual(report.hits[0].kind, 'bidi');
  assert.strictEqual(report.hits[0].confidence, 'probable');
  assert.strictEqual(report.hits[0].label, 'U+202E');
}

// Space homoglyphs are context, not evidence.
{
  const report = inspectText(`a${NBSP}b`);
  assert.strictEqual(report.hits[0].kind, 'space');
  assert.strictEqual(report.hits[0].confidence, 'informational');
}

// Confusables only under the aggressive flag.
{
  assert.strictEqual(cleanText('аdmin').text, 'аdmin');
  assert.strictEqual(cleanText('аdmin', { aggressiveHomoglyphs: true }).text, 'admin');
  assert.strictEqual(cleanText('ａｂ', { aggressiveHomoglyphs: true }).text, 'ab');
}

// Load-bearing invisibles survive: emoji ZWJ sequences, flags, script joiners.
{
  const loadBearing = ['❤️‍\u{1F525}', `\u{1F3F4}${TAG_A}`, 'م‌ی', 'क्‍ष'];
  for (const sample of loadBearing) {
    assert.strictEqual(cleanText(sample).text, sample, `mangled ${JSON.stringify(sample)}`);
    assert.strictEqual(inspectText(sample).suspiciousTotal, 0);
  }
}

// Paranoid mode strips them anyway.
{
  const { text } = cleanText('❤️‍\u{1F525}', { stripEmojiGlue: true });
  assert.strictEqual(text, '❤\u{1F525}');
}

// A free-floating ZWJ with no emoji base before it is a carrier, not glue.
{
  const report = inspectText(`word${ZWJ}word`);
  assert.strictEqual(report.suspiciousTotal, 1);
  assert.strictEqual(report.hits[0].kind, 'zwj_family');
}

// Tag chars without an emoji base are stego carriers.
{
  const report = inspectText(`plain${TAG_A}`);
  assert.strictEqual(report.suspiciousTotal, 1);
  assert.strictEqual(report.hits[0].kind, 'tag_chars');
  assert.strictEqual(cleanText(`plain${TAG_A}`).text, 'plain');
}

// Offsets are UTF-16 indices, so document.positionAt() lands on the character.
{
  const text = `\u{1F600}${ZWSP}x`;
  const report = inspectText(text);
  assert.strictEqual(report.hits[0].offsets[0], 2);
  assert.strictEqual(text.slice(2, 3), ZWSP);
}

// Repeated carriers group into one hit and cap their samples at ten.
{
  const report = inspectText(ZWSP.repeat(15));
  assert.strictEqual(report.hits.length, 1);
  assert.strictEqual(report.hits[0].count, 15);
  assert.strictEqual(report.hits[0].offsets.length, 10);
}

// Clean text is a fixed point: nothing to remove, nothing to replace.
{
  const source = 'const total = items.length;\n';
  const { text, stats } = cleanText(source);
  assert.strictEqual(text, source);
  assert.strictEqual(stats.removedCount, 0);
  assert.strictEqual(stats.replacedCount, 0);
  assert.strictEqual(inspectText(source).suspiciousTotal, 0);
}

// NFKC is opt-in and folds compatibility forms.
{
  assert.strictEqual(cleanText('ﬁn').text, 'ﬁn');
  assert.strictEqual(cleanText('ﬁn', { nfkc: true }).text, 'fin');
}

// Labels are the codepoint, padded to at least four digits.
{
  assert.strictEqual(charLabel(ZWSP), 'U+200B');
  assert.strictEqual(charLabel('­'), 'U+00AD');
  assert.strictEqual(charLabel(TAG_A), 'U+E0061');
}

console.log('unicode tests passed');
