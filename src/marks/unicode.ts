export const STRIP_CODEPOINTS: ReadonlySet<number> = new Set([
  0x00ad, 0x034f, 0x061c, 0x115f, 0x1160, 0x17b4, 0x17b5,
  0x180b, 0x180c, 0x180d, 0x180e,
  0x200b, 0x200c, 0x200d, 0x200e, 0x200f,
  0x202a, 0x202b, 0x202c, 0x202d, 0x202e,
  0x2060, 0x2061, 0x2062, 0x2063, 0x2064,
  0x2066, 0x2067, 0x2068, 0x2069,
  0x206a, 0x206b, 0x206c, 0x206d, 0x206e, 0x206f,
  0xfeff,
  0xfe00, 0xfe01, 0xfe02, 0xfe03, 0xfe04, 0xfe05, 0xfe06, 0xfe07,
  0xfe08, 0xfe09, 0xfe0a, 0xfe0b, 0xfe0c, 0xfe0d, 0xfe0e, 0xfe0f,
  0xfff9, 0xfffa, 0xfffb,
]);

export const SPACE_HOMOGLYPHS: ReadonlyMap<number, string> = new Map([
  [0x00a0, ' '], [0x1680, ' '],
  [0x2000, ' '], [0x2001, ' '], [0x2002, ' '], [0x2003, ' '], [0x2004, ' '],
  [0x2005, ' '], [0x2006, ' '], [0x2007, ' '], [0x2008, ' '], [0x2009, ' '],
  [0x200a, ' '], [0x202f, ' '], [0x205f, ' '], [0x3000, ' '],
]);

const CYRILLIC_CONFUSABLES: [number, string][] = [
  [0x0410, 'A'], [0x0412, 'B'], [0x0415, 'E'], [0x041a, 'K'], [0x041c, 'M'],
  [0x041d, 'H'], [0x041e, 'O'], [0x0420, 'P'], [0x0421, 'C'], [0x0422, 'T'],
  [0x0425, 'X'], [0x0430, 'a'], [0x0435, 'e'], [0x043e, 'o'], [0x0440, 'p'],
  [0x0441, 'c'], [0x0443, 'y'], [0x0445, 'x'], [0x0456, 'i'],
];

const UPPERCASE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LOWERCASE = 'abcdefghijklmnopqrstuvwxyz';

export const LATIN_CONFUSABLES: ReadonlyMap<number, string> = new Map([
  ...CYRILLIC_CONFUSABLES,
  ...[...UPPERCASE].map((c, i): [number, string] => [0xff21 + i, c]),
  ...[...LOWERCASE].map((c, i): [number, string] => [0xff41 + i, c]),
]);

const BIDI_CODEPOINTS: ReadonlySet<number> = new Set([
  0x061c, 0x200e, 0x200f,
  0x202a, 0x202b, 0x202c, 0x202d, 0x202e,
  0x2066, 0x2067, 0x2068, 0x2069,
]);

const ZERO_WIDTH_FAMILY: ReadonlySet<number> = new Set([
  0x200b, 0x200c, 0x200d, 0x2060, 0xfeff, 0x180e,
]);

export const EMOJI_GLUE_CODEPOINTS: ReadonlySet<number> = new Set([0x200d, 0xfe0e, 0xfe0f]);

const SCRIPT_JOINERS: ReadonlySet<number> = new Set([0x200c, 0x200d]);

const ORTHOGRAPHIC_FORMAT: ReadonlySet<number> = new Set([
  0x0600, 0x0601, 0x0602, 0x0603, 0x0604, 0x0605,
  0x06dd, 0x070f, 0x08e2, 0x110bd, 0x110cd,
]);

const FORMAT_CATEGORY = /\p{Cf}/u;
const LETTER_OR_MARK = /[\p{L}\p{M}]/u;

function isVariationSelectorSupplement(cp: number): boolean {
  return cp >= 0xe0100 && cp <= 0xe01ef;
}

function isTagChar(cp: number): boolean {
  return cp >= 0xe0001 && cp <= 0xe007f;
}

function isFlagTagChar(cp: number): boolean {
  return cp >= 0xe0020 && cp < 0xe0080;
}

function isStripCodepoint(cp: number): boolean {
  return STRIP_CODEPOINTS.has(cp) || isVariationSelectorSupplement(cp) || isTagChar(cp);
}

export type HitKind =
  | 'strip'
  | 'bidi'
  | 'tag_chars'
  | 'variation_selector'
  | 'zwj_family'
  | 'space'
  | 'confusable'
  | 'other_cf';

export type Confidence = 'informational' | 'probable';

function stripKind(cp: number): HitKind {
  if (isTagChar(cp)) return 'tag_chars';
  if (isVariationSelectorSupplement(cp)) return 'variation_selector';
  if (cp >= 0xfe00 && cp <= 0xfe0f) return 'variation_selector';
  if (cp >= 0x180b && cp <= 0x180d) return 'variation_selector';
  if (BIDI_CODEPOINTS.has(cp)) return 'bidi';
  if (ZERO_WIDTH_FAMILY.has(cp)) return 'zwj_family';
  return 'strip';
}

export function hitConfidence(kind: HitKind): Confidence {
  return kind === 'space' ? 'informational' : 'probable';
}

function isEmojiBase(cp: number): boolean {
  if (cp >= 0x1f000 && cp <= 0x1faff) return true;
  if (cp >= 0x2600 && cp <= 0x27bf) return true;
  if (cp >= 0x2b00 && cp <= 0x2bff) return true;
  if ([0x00a9, 0x00ae, 0x2122, 0x3030, 0x303d, 0x3297, 0x3299].includes(cp)) return true;
  if (cp === 0x0023 || cp === 0x002a) return true;
  return cp >= 0x0030 && cp <= 0x0039;
}

function isJoiningLetter(cp: number): boolean {
  return cp > 0x7f && LETTER_OR_MARK.test(String.fromCodePoint(cp));
}

function isGlue(cp: number): boolean {
  return EMOJI_GLUE_CODEPOINTS.has(cp) || SCRIPT_JOINERS.has(cp) || isFlagTagChar(cp);
}

export interface CleanOptions {
  nfkc?: boolean;
  aggressiveHomoglyphs?: boolean;
  normalizeSpaces?: boolean;
  stripEmojiGlue?: boolean;
}

type Action = 'keep' | 'strip' | 'replace';

interface Decision {
  action: Action;
  out: string;
  kind?: HitKind;
}

function decide(
  ch: string,
  previousKept: string | undefined,
  normalizeSpaces: boolean,
  treatConfusables: boolean,
  stripEmojiGlue: boolean
): Decision {
  const cp = ch.codePointAt(0)!;

  if (!stripEmojiGlue) {
    const previous = previousKept === undefined ? undefined : previousKept.codePointAt(0)!;
    if (EMOJI_GLUE_CODEPOINTS.has(cp) && previous !== undefined && isEmojiBase(previous)) {
      return { action: 'keep', out: ch };
    }
    if (SCRIPT_JOINERS.has(cp) && previous !== undefined && isJoiningLetter(previous)) {
      return { action: 'keep', out: ch };
    }
    if (isFlagTagChar(cp) && previous !== undefined && isEmojiBase(previous)) {
      return { action: 'keep', out: ch };
    }
    if (ORTHOGRAPHIC_FORMAT.has(cp)) return { action: 'keep', out: ch };
  }

  if (isStripCodepoint(cp)) return { action: 'strip', out: '', kind: stripKind(cp) };

  if (normalizeSpaces && SPACE_HOMOGLYPHS.has(cp)) {
    return { action: 'replace', out: SPACE_HOMOGLYPHS.get(cp)!, kind: 'space' };
  }

  if (treatConfusables && LATIN_CONFUSABLES.has(cp)) {
    return { action: 'replace', out: LATIN_CONFUSABLES.get(cp)!, kind: 'confusable' };
  }

  if (!SPACE_HOMOGLYPHS.has(cp) && FORMAT_CATEGORY.test(ch)) {
    return { action: 'strip', out: '', kind: 'other_cf' };
  }

  return { action: 'keep', out: ch };
}

export function charLabel(ch: string): string {
  const cp = ch.codePointAt(0)!;
  return `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;
}

export interface CharHit {
  codepoint: number;
  label: string;
  count: number;
  kind: HitKind;
  confidence: Confidence;
  offsets: number[];
}

export interface TextInspectReport {
  length: number;
  suspiciousTotal: number;
  hits: CharHit[];
}

const MAX_SAMPLES = 10;

export function inspectText(text: string, options: CleanOptions = {}): TextInspectReport {
  const stripEmojiGlue = options.stripEmojiGlue ?? false;
  const treatConfusables = options.aggressiveHomoglyphs ?? false;

  const buckets = new Map<string, CharHit>();
  let previousKept: string | undefined;
  let offset = 0;
  let suspiciousTotal = 0;

  for (const ch of text) {
    const { action, out, kind } = decide(ch, previousKept, true, treatConfusables, stripEmojiGlue);

    if (kind === undefined) {
      if (!isGlue(ch.codePointAt(0)!)) previousKept = out;
    } else {
      const cp = ch.codePointAt(0)!;
      const key = `${cp}:${kind}`;
      let hit = buckets.get(key);
      if (!hit) {
        hit = {
          codepoint: cp,
          label: charLabel(ch),
          count: 0,
          kind,
          confidence: hitConfidence(kind),
          offsets: [],
        };
        buckets.set(key, hit);
      }
      hit.count++;
      suspiciousTotal++;
      if (hit.offsets.length < MAX_SAMPLES) hit.offsets.push(offset);
      if (action === 'replace') previousKept = out;
    }

    offset += ch.length;
  }

  const hits = [...buckets.values()].sort(
    (a, b) => b.count - a.count || a.codepoint - b.codepoint
  );

  return { length: text.length, suspiciousTotal, hits };
}

export interface CleanStats {
  inputLength: number;
  outputLength: number;
  removedCount: number;
  replacedCount: number;
  removed: Record<string, number>;
  replaced: Record<string, number>;
}

export interface CleanResult {
  text: string;
  stats: CleanStats;
}

export function cleanText(text: string, options: CleanOptions = {}): CleanResult {
  const normalizeSpaces = options.normalizeSpaces ?? true;
  const treatConfusables = options.aggressiveHomoglyphs ?? false;
  const stripEmojiGlue = options.stripEmojiGlue ?? false;

  const removed: Record<string, number> = {};
  const replaced: Record<string, number> = {};
  const pieces: string[] = [];
  let previousKept: string | undefined;

  for (const ch of text) {
    const { action, out } = decide(
      ch,
      previousKept,
      normalizeSpaces,
      treatConfusables,
      stripEmojiGlue
    );

    if (action === 'keep') {
      pieces.push(out);
      if (!isGlue(ch.codePointAt(0)!)) previousKept = out;
    } else if (action === 'replace') {
      pieces.push(out);
      const label = charLabel(ch);
      replaced[label] = (replaced[label] ?? 0) + 1;
      previousKept = out;
    } else {
      const label = charLabel(ch);
      removed[label] = (removed[label] ?? 0) + 1;
    }
  }

  let result = pieces.join('');
  const replacedCount = Object.values(replaced).reduce((a, b) => a + b, 0);

  if (options.nfkc) {
    const before = result;
    result = result.normalize('NFKC');
    if (result !== before) replaced.NFKC_normalize = Math.abs(before.length - result.length) || 1;
  }

  return {
    text: result,
    stats: {
      inputLength: text.length,
      outputLength: result.length,
      removedCount: Object.values(removed).reduce((a, b) => a + b, 0),
      replacedCount,
      removed,
      replaced,
    },
  };
}
