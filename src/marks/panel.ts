import * as path from 'path';
import * as vscode from 'vscode';
import { Confidence } from './containers';
import { stripImage } from './images';
import { MarksReport, ScannedFile, cleanContent, kindFor } from './scan';

const UNICODE_HIGHLIGHT_KEYS = [
  'editor.unicodeHighlight.invisibleCharacters',
  'editor.unicodeHighlight.ambiguousCharacters',
];

const NON_BASIC_ASCII_KEY = 'editor.unicodeHighlight.nonBasicASCII';

export const marksStyles = `
  .marks-intro { color: var(--muted); margin-bottom: 16px; }
  .marks-scope {
    display: flex;
    gap: 8px;
    margin-bottom: 16px;
  }
  .marks-scope input {
    flex: 1;
    min-width: 160px;
    background: var(--input-bg);
    color: var(--text);
    border: 1px solid var(--input-border);
    border-radius: 4px;
    padding: 5px 8px;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 12px;
    outline: none;
  }
  .marks-scope input:focus { border-color: var(--accent); }
  .marks-scope input:disabled { opacity: .6; }
  .marks-scope button {
    background: var(--btn-bg);
    color: var(--btn-fg);
    border: none;
    padding: .35rem 1.1rem;
    border-radius: 3px;
    cursor: pointer;
    font-family: inherit;
    font-size: 12px;
  }
  .marks-scope button.danger {
    background: var(--surface);
    color: var(--danger);
    border: 1px solid var(--danger);
  }
  .marks-summary { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px; }
  .marks-file {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    margin-bottom: 12px;
    overflow: hidden;
  }
  .marks-file-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
  }
  .marks-file-path {
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 12px;
    color: var(--accent);
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .marks-kind {
    font-size: 10px;
    background: var(--tag-bg);
    color: var(--tag-fg);
    border-radius: 10px;
    padding: 1px 7px;
  }
  .marks-finding {
    display: flex;
    gap: 8px;
    align-items: baseline;
    padding: 5px 12px;
    font-size: 12px;
    font-family: var(--vscode-editor-font-family, monospace);
    border-bottom: 1px solid var(--border);
  }
  .marks-finding:last-child { border-bottom: none; }
  .marks-confidence {
    font-size: 10px;
    border: 1px solid var(--border);
    border-radius: 3px;
    padding: 0 5px;
    white-space: nowrap;
    font-family: var(--vscode-font-family);
  }
  .marks-confidence.confirmed { color: var(--danger); border-color: var(--danger); }
  .marks-confidence.probable { color: var(--warning); border-color: var(--warning); }
  .marks-confidence.informational { color: var(--muted); }
  .marks-confidence.likely_false_positive { color: var(--muted); opacity: .7; }
  .marks-actions {
    margin-top: 20px;
    padding-top: 14px;
    border-top: 1px solid var(--border);
  }
  .marks-actions button {
    background: var(--btn-bg);
    color: var(--btn-fg);
    border: none;
    padding: .45rem 1.1rem;
    border-radius: 3px;
    cursor: pointer;
    font-family: inherit;
    font-size: 12px;
  }
  .marks-actions button.secondary {
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--border);
    margin-left: .5rem;
  }
  .marks-native {
    margin-top: 20px;
    padding-top: 14px;
    border-top: 1px solid var(--border);
    color: var(--muted);
    font-size: 12px;
  }
  .marks-toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--text);
    cursor: pointer;
  }
  .marks-toggle input { margin: 0; cursor: pointer; }
  .marks-hint { margin: 6px 0 0 24px; }
  .marks-noise {
    margin: 10px 0 0 24px;
    padding: 8px 10px;
    border: 1px solid var(--warning);
    border-radius: var(--radius);
    color: var(--text);
  }
  .marks-noise button {
    display: block;
    margin-top: 8px;
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 3px;
    padding: .3rem .9rem;
    font-family: inherit;
    font-size: 12px;
    cursor: pointer;
  }
`;

const CONFIDENCE_ORDER: Confidence[] = [
  'confirmed',
  'probable',
  'informational',
  'likely_false_positive',
];

export interface MarksView {
  report: MarksReport | undefined;
  scope: string;
  scanning: boolean;
}

export function renderMarks(view: MarksView): string {
  const intro = `<div class="marks-intro">
    Invisible Unicode, space homoglyphs and AI provenance metadata left behind by pasted
    output. Cleaning leaves the files open and unsaved so you can read the diff first.
  </div>`;

  const scopeRow = renderScopeRow(view);
  const { report, scanning } = view;

  if (scanning) {
    return `${intro}${scopeRow}
    <div class="empty">
      <div class="icon">⏳</div>
      <div>Scanning…</div>
      <div class="hint">Large workspaces take a moment. Stopping keeps whatever was found so far.</div>
    </div>
    ${nativeHighlightRow()}`;
  }

  if (!report) {
    return `${intro}${scopeRow}${nativeHighlightRow()}`;
  }

  if (report.files.length === 0) {
    return `${intro}${scopeRow}
    <div class="empty">
      <div class="icon">🧹</div>
      <div>${report.cancelled ? 'Stopped' : 'Nothing found'} after ${report.scanned} file(s)</div>
      <div class="hint">No invisible carriers and no AI metadata${report.cancelled ? ' in what was scanned' : ''}.</div>
    </div>
    ${nativeHighlightRow()}`;
  }

  const counts = CONFIDENCE_ORDER.filter((c) => report.byConfidence[c] > 0)
    .map((c) => `<span class="stat">${report.byConfidence[c]} ${c.replace(/_/g, ' ')}</span>`)
    .join('');

  return `${intro}${scopeRow}
  <div class="marks-summary">
    <span class="stat">${report.scanned} of ${report.total} scanned</span>
    <span class="stat">${report.files.length} with findings</span>
    ${report.skipped > 0 ? `<span class="stat">${report.skipped} skipped</span>` : ''}
    ${report.cancelled ? '<span class="stat stale">stopped early</span>' : ''}
    ${counts}
  </div>

  ${report.files.map(renderFile).join('\n')}

  <div class="marks-actions">
    <button onclick="applyMarks()">Clean selected</button>
  </div>
  ${nativeHighlightRow()}`;
}

function renderScopeRow(view: MarksView): string {
  const button = view.scanning
    ? '<button class="danger" onclick="stopScan()">Stop</button>'
    : `<button onclick="scanMarks()">${view.report ? 'Scan again' : 'Scan'}</button>`;

  return `<div class="marks-scope">
    <input
      type="text"
      id="marks-scope"
      value="${escapeHtml(view.scope)}"
      placeholder="Whole workspace — or a folder, e.g. src/ or resources/views"
      title="Folder to scan, relative to the workspace. A glob works too: app/**/*.php"
      ${view.scanning ? 'disabled' : ''}
      onkeydown="if (event.key === 'Enter') scanMarks()">
    ${button}
  </div>`;
}

function renderFile(file: ScannedFile): string {
  const findings = file.findings
    .map(
      (finding) => `<div class="marks-finding">
        <span class="marks-confidence ${finding.confidence}">${finding.confidence.replace(/_/g, ' ')}</span>
        <span>${escapeHtml(finding.message)}</span>
      </div>`
    )
    .join('');

  const target = file.kind === 'image' ? cleanedName(file.relativePath) : 'in place, unsaved';

  return `<div class="marks-file">
    <div class="marks-file-header">
      <input type="checkbox" data-path="${escapeHtml(file.relativePath)}"${file.actionable ? ' checked' : ''}>
      <span class="marks-file-path" title="→ ${escapeHtml(target)}">${escapeHtml(file.relativePath)}</span>
      <span class="marks-kind">${file.kind}</span>
    </div>
    ${findings}
  </div>`;
}

export function highlightEnabled(): boolean {
  const config = vscode.workspace.getConfiguration();
  return UNICODE_HIGHLIGHT_KEYS.every((key) => config.get<boolean>(key) !== false);
}

function nonBasicAsciiOverridden(): boolean {
  return (
    vscode.workspace.getConfiguration().inspect(NON_BASIC_ASCII_KEY)?.workspaceValue !== undefined
  );
}

function nativeHighlightRow(): string {
  const noise = nonBasicAsciiOverridden()
    ? `<div class="marks-noise">
        This workspace also flags <strong>every</strong> non-ASCII character, so an em dash,
        an arrow or an emoji lights up like a carrier does. That setting is not about AI marks.
        <button class="secondary" onclick="clearNonBasicAscii()">Stop flagging all non-ASCII</button>
      </div>`
    : '';

  return `<div class="marks-native">
    <label class="marks-toggle">
      <input type="checkbox"${highlightEnabled() ? ' checked' : ''} onchange="setHighlight(this.checked)">
      Highlight invisible and ambiguous characters in the editor
    </label>
    <div class="marks-hint">
      VSCode marks them as you type, so a pasted carrier shows up before any scan.
      It flags anything unusual; this tab lists only what it can actually clean, and it
      keeps emoji sequences and script joiners on purpose — so the editor warning and an
      empty scan can both be right.
    </div>
    ${noise}
  </div>`;
}

export async function setUnicodeHighlight(enabled: boolean): Promise<void> {
  const config = vscode.workspace.getConfiguration();
  for (const key of UNICODE_HIGHLIGHT_KEYS) {
    await config.update(key, enabled, vscode.ConfigurationTarget.Workspace);
  }
}

export async function clearNonBasicAscii(): Promise<void> {
  await vscode.workspace
    .getConfiguration()
    .update(NON_BASIC_ASCII_KEY, undefined, vscode.ConfigurationTarget.Workspace);
  vscode.window.showInformationMessage(
    '✓ Huginn: em dashes, arrows and emoji are no longer flagged as unusual.'
  );
}

export async function applyMarks(report: MarksReport, selected: string[]): Promise<void> {
  const files = report.files.filter((file) => selected.includes(file.relativePath));
  if (files.length === 0) return;

  const edit = new vscode.WorkspaceEdit();
  const edited: string[] = [];
  const written: string[] = [];
  const failed: string[] = [];

  for (const file of files) {
    if (file.kind === 'image') {
      try {
        const data = Buffer.from(await vscode.workspace.fs.readFile(file.uri));
        const stripped = stripImage(data);
        if (stripped.actions.length === 0) continue;
        const destination = file.uri.with({ path: cleanedName(file.uri.path) });
        await vscode.workspace.fs.writeFile(destination, stripped.data);
        written.push(vscode.workspace.asRelativePath(destination));
      } catch {
        failed.push(file.relativePath);
      }
      continue;
    }

    let document: vscode.TextDocument;
    try {
      document = await vscode.workspace.openTextDocument(file.uri);
    } catch {
      failed.push(file.relativePath);
      continue;
    }

    const source = document.getText();
    const cleaned = cleanContent(file.kind, source);
    if (cleaned.text === source) continue;

    const whole = new vscode.Range(document.positionAt(0), document.positionAt(source.length));
    edit.replace(file.uri, whole, cleaned.text);
    edited.push(file.relativePath);
  }

  if (edited.length > 0 && !(await vscode.workspace.applyEdit(edit))) {
    vscode.window.showErrorMessage('Huginn: the files could not be edited, nothing was cleaned.');
    return;
  }

  if (failed.length > 0) {
    vscode.window.showWarningMessage(`Huginn: could not clean ${failed.join(', ')}.`);
  }

  const parts: string[] = [];
  if (edited.length > 0) parts.push(`${edited.length} file(s) cleaned, left unsaved for review`);
  if (written.length > 0) parts.push(`${written.length} image(s) written as ${written.join(', ')}`);
  if (parts.length === 0) parts.push('nothing left to clean');

  vscode.window.showInformationMessage(`🧹 Huginn: ${parts.join(' · ')}.`);
}

export async function cleanActiveFile(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showInformationMessage('Huginn: open a file first.');
    return;
  }

  const kind = kindFor(editor.document.uri);
  if (kind === 'image') {
    vscode.window.showInformationMessage(
      'Huginn: images are cleaned from the panel, into a .cleaned copy.'
    );
    return;
  }

  const source = editor.document.getText();
  const cleaned = cleanContent(kind, source);

  if (cleaned.text === source) {
    vscode.window.showInformationMessage('🧹 Huginn: no AI marks in this file.');
    return;
  }

  const whole = new vscode.Range(
    editor.document.positionAt(0),
    editor.document.positionAt(source.length)
  );
  await editor.edit((builder) => builder.replace(whole, cleaned.text));

  vscode.window.showInformationMessage(
    `🧹 Huginn: ${cleaned.actions.join(' · ')}. The file is left unsaved — review it before saving.`
  );
}

function cleanedName(filePath: string): string {
  const extension = path.extname(filePath);
  return `${filePath.slice(0, filePath.length - extension.length)}.cleaned${extension}`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
