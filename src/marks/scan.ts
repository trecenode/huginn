import * as vscode from 'vscode';
import {
  Confidence,
  Finding,
  cleanHtml,
  cleanMarkdown,
  cleanSvg,
  inspectHtml,
  inspectMarkdown,
  inspectSvg,
} from './containers';
import { cleanText, inspectText } from './unicode';
import { inspectImage } from './images';

const TEXT_EXTENSIONS =
  'ts,tsx,js,jsx,mjs,cjs,vue,svelte,php,py,rb,go,rs,java,kt,cs,swift,c,h,cpp,css,scss,less,twig,sql,sh,yml,yaml,json,txt';
const CONTAINER_EXTENSIONS = 'md,markdown,mdx,html,htm,svg';
const IMAGE_EXTENSIONS = 'png,jpg,jpeg';

export const INCLUDE = `**/*.{${TEXT_EXTENSIONS},${CONTAINER_EXTENSIONS},${IMAGE_EXTENSIONS}}`;
export const EXCLUDE =
  '**/{node_modules,vendor,dist,build,out,bin,obj,.git,.next,.nuxt,coverage,__pycache__,storage}/**';

const MAX_FILES = 3000;
const MAX_BYTES = 8 * 1024 * 1024;

export type FileKind = 'text' | 'markdown' | 'html' | 'svg' | 'image';
export type TextKind = Exclude<FileKind, 'image'>;

export interface ScannedFile {
  uri: vscode.Uri;
  relativePath: string;
  kind: FileKind;
  findings: Finding[];
  actionable: boolean;
}

export interface MarksReport {
  files: ScannedFile[];
  scanned: number;
  skipped: number;
  total: number;
  cancelled: boolean;
  byConfidence: Record<Confidence, number>;
}

export function includeFor(scope: string): string {
  const cleaned = scope.trim().replace(/\\/g, '/').replace(/^[./]+|\/+$/g, '');
  if (!cleaned) return INCLUDE;
  if (cleaned.includes('*')) return cleaned;
  return `${cleaned}/${INCLUDE}`;
}

export function kindFor(uri: vscode.Uri): FileKind {
  const extension = uri.path.slice(uri.path.lastIndexOf('.') + 1).toLowerCase();
  if (IMAGE_EXTENSIONS.split(',').includes(extension)) return 'image';
  if (['md', 'markdown', 'mdx'].includes(extension)) return 'markdown';
  if (['html', 'htm'].includes(extension)) return 'html';
  if (extension === 'svg') return 'svg';
  return 'text';
}

function layerAFindings(text: string): Finding[] {
  return inspectText(text).hits.map((hit) => ({
    message: `layer-a [${hit.kind}] ${hit.label} x${hit.count}`,
    confidence: hit.confidence as Confidence,
  }));
}

function containerFindings(kind: TextKind, text: string): Finding[] {
  if (kind === 'markdown') return inspectMarkdown(text);
  if (kind === 'html') return inspectHtml(text);
  if (kind === 'svg') return inspectSvg(text);
  return [];
}

export function cleanContent(kind: TextKind, text: string): { text: string; actions: string[] } {
  let out = text;
  const actions: string[] = [];

  if (kind === 'markdown') {
    const result = cleanMarkdown(out);
    out = result.text;
    actions.push(...result.actions);
  } else if (kind === 'html') {
    const result = cleanHtml(out);
    out = result.text;
    actions.push(...result.actions);
  } else if (kind === 'svg') {
    const result = cleanSvg(out);
    out = result.text;
    actions.push(...result.actions);
  }

  const layerA = cleanText(out);
  if (layerA.stats.removedCount > 0 || layerA.stats.replacedCount > 0) {
    out = layerA.text;
    actions.push(
      `layer A: removed ${layerA.stats.removedCount}, replaced ${layerA.stats.replacedCount}`
    );
  }

  return { text: out, actions };
}

function isActionable(findings: Finding[]): boolean {
  return findings.some((f) => f.confidence === 'confirmed' || f.confidence === 'probable');
}

export function inspectContent(kind: FileKind, data: Buffer): Finding[] | undefined {
  if (kind === 'image') return inspectImage(data);

  const text = data.toString('utf8');
  if (text.includes('\0')) return undefined;

  return [...containerFindings(kind, text), ...layerAFindings(text)];
}

export interface ScanOptions {
  scope?: string;
  token?: vscode.CancellationToken;
  onProgress?: (done: number, total: number) => void;
}

export async function scanWorkspace(options: ScanOptions = {}): Promise<MarksReport> {
  const { scope = '', token, onProgress } = options;

  const uris = await vscode.workspace.findFiles(
    includeFor(scope),
    EXCLUDE,
    MAX_FILES,
    token
  );

  const files: ScannedFile[] = [];
  let scanned = 0;
  let skipped = 0;
  let done = 0;
  let cancelled = false;

  for (const uri of uris) {
    if (token?.isCancellationRequested) {
      cancelled = true;
      break;
    }

    done++;
    if (done % 50 === 0) onProgress?.(done, uris.length);

    let data: Buffer;
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      if (stat.size > MAX_BYTES) {
        skipped++;
        continue;
      }
      data = Buffer.from(await vscode.workspace.fs.readFile(uri));
    } catch {
      skipped++;
      continue;
    }

    const kind = kindFor(uri);
    const findings = inspectContent(kind, data);
    if (findings === undefined) {
      skipped++;
      continue;
    }

    scanned++;
    if (findings.length === 0) continue;

    files.push({
      uri,
      relativePath: vscode.workspace.asRelativePath(uri),
      kind,
      findings,
      actionable: isActionable(findings),
    });
  }

  files.sort((a, b) => Number(b.actionable) - Number(a.actionable) || a.relativePath.localeCompare(b.relativePath));

  const byConfidence: Record<Confidence, number> = {
    confirmed: 0,
    probable: 0,
    informational: 0,
    likely_false_positive: 0,
  };
  for (const file of files) {
    for (const finding of file.findings) byConfidence[finding.confidence]++;
  }

  return { files, scanned, skipped, total: uris.length, cancelled, byConfidence };
}
