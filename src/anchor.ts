export interface LineChange {
  startLine: number;
  endLine: number;
  startCharacter: number;
  newLineCount: number;
  insertion: boolean;
}

export function shiftLine(line: number, change: LineChange): number {
  const { startLine, endLine, startCharacter, newLineCount, insertion } = change;
  const delta = startLine + newLineCount - endLine;
  if (delta === 0) return line;

  const index = line - 1;
  if (index < startLine) return line;
  if (index === startLine) {
    const pushedDown = insertion && startCharacter === 0;
    return pushedDown ? line + newLineCount : line;
  }
  if (index > endLine) return index + delta + 1;
  return Math.min(index, startLine + newLineCount) + 1;
}

export const MAX_ANCHOR = 300;

export function makeAnchor(lineText: string): string {
  return lineText.trim().slice(0, MAX_ANCHOR);
}

export function findAnchor(
  lines: string[],
  line: number,
  anchor: string,
  radius = 40
): number | undefined {
  const target = anchor.trim();
  if (!target) return undefined;

  const index = line - 1;
  if (lines[index] !== undefined && makeAnchor(lines[index]) === target) return line;

  for (let distance = 1; distance <= radius; distance++) {
    for (const candidate of [index - distance, index + distance]) {
      if (candidate < 0 || candidate >= lines.length) continue;
      if (makeAnchor(lines[candidate]) === target) return candidate + 1;
    }
  }
  return undefined;
}

export interface Anchored {
  line: number;
  anchor?: string;
}

export function isStale(lines: string[] | undefined, note: Anchored): boolean {
  if (!lines) return true;
  if (note.line < 1 || note.line > lines.length) return true;
  if (!note.anchor) return false;
  return findAnchor(lines, note.line, note.anchor) === undefined;
}

const IDENTIFIER = /[A-Za-z_$][\w$]{2,}/g;

export function similarLine(anchor: string, lineText: string): boolean {
  const before = anchor.trim();
  const after = lineText.trim();
  if (!before || !after) return false;
  if (before === after || before.includes(after) || after.includes(before)) return true;

  const known = new Set((before.match(IDENTIFIER) ?? []).map((token) => token.toLowerCase()));
  if (known.size === 0) return false;
  return (after.match(IDENTIFIER) ?? []).some((token) => known.has(token.toLowerCase()));
}

export function toLines(content: string): string[] {
  return content.split(/\r?\n/);
}

export interface TodoHit {
  keyword: string;
  text: string;
  markerStart: number;
  wholeLine: boolean;
}

const TODO_RE = /(\/\/+|#+|\/\*+|\*|<!--|--)\s*(TODO|FIXME|HACK|XXX)\b[:\-\s]*(.*)$/i;
const COMMENT_TERMINATOR = /\s*(\*\/|-->)\s*$/;

export function parseTodo(line: string): TodoHit | undefined {
  const match = line.match(TODO_RE);
  if (!match || match.index === undefined) return undefined;

  return {
    keyword: match[2].toUpperCase(),
    text: match[3].replace(COMMENT_TERMINATOR, '').trim(),
    markerStart: match.index,
    wholeLine: line.slice(0, match.index).trim() === '',
  };
}

export function lineAfterRemoval(
  line: number,
  removedLinesBefore: number,
  lineCount: number
): number {
  return Math.min(Math.max(line - removedLinesBefore, 1), Math.max(lineCount, 1));
}
