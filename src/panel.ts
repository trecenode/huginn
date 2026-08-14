import * as vscode from 'vscode';
import * as path from 'path';
import { NoteStorageRegistry, DevNote, RootedNote } from './storage';
import { applySetup, renderSetup, setupStyles } from './setup/panel';
import {
  applyMarks,
  clearNonBasicAscii,
  marksStyles,
  renderMarks,
  setUnicodeHighlight,
} from './marks/panel';
import { MarksReport, scanWorkspace } from './marks/scan';

type Tab = 'notes' | 'setup' | 'marks';

const TABS: Tab[] = ['notes', 'setup', 'marks'];

function toTab(value: unknown): Tab {
  return TABS.includes(value as Tab) ? (value as Tab) : 'notes';
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export class HuginnPanel {
  static currentPanel: HuginnPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];
  private marksReport: MarksReport | undefined;
  private marksScope = '';
  private marksScanning = false;
  private marksCancellation: vscode.CancellationTokenSource | undefined;

  static createOrShow(
    storages: NoteStorageRegistry,
    extensionUri: vscode.Uri,
    root: string,
    tab: Tab = 'notes'
  ): void {
    const column = vscode.window.activeTextEditor
      ? vscode.ViewColumn.Beside
      : vscode.ViewColumn.One;

    if (HuginnPanel.currentPanel) {
      HuginnPanel.currentPanel.tab = tab;
      HuginnPanel.currentPanel.root = root;
      HuginnPanel.currentPanel.panel.reveal(column);
      HuginnPanel.currentPanel.update();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'huginn.panel',
      'Huginn',
      column,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
      }
    );

    HuginnPanel.currentPanel = new HuginnPanel(panel, storages, root, tab, extensionUri);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    private storages: NoteStorageRegistry,
    private root: string,
    private tab: Tab,
    private extensionUri: vscode.Uri
  ) {
    this.panel = panel;
    this.update();

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    this.panel.webview.onDidReceiveMessage(
      async (msg) => {
        switch (msg.command) {
          case 'delete':
            storages.deleteNote(msg.id);
            this.update();
            break;
          case 'update':
            storages.updateNote(msg.id, msg.comment, msg.tags);
            this.update();
            break;
          case 'navigate':
            await this.navigateTo(msg.id);
            break;
          case 'done':
            storages.setDone(msg.id, !!msg.done);
            this.update();
            break;
          case 'relink':
            await this.relink(msg.id);
            break;
          case 'tab':
            this.tab = toTab(msg.tab);
            break;
          case 'apply':
            await applySetup(this.root, msg.ids ?? []);
            this.update();
            break;
          case 'scanMarks':
            await this.scanMarks(msg.scope ?? '');
            break;
          case 'stopScan':
            this.marksCancellation?.cancel();
            break;
          case 'applyMarks':
            if (this.marksReport) await applyMarks(this.marksReport, msg.paths ?? []);
            await this.scanMarks(this.marksScope);
            break;
          case 'setHighlight':
            await setUnicodeHighlight(!!msg.enabled);
            this.update();
            break;
          case 'clearNonBasicAscii':
            await clearNonBasicAscii();
            this.update();
            break;
          case 'refresh':
            this.update();
            break;
          case 'importTodos':
            await vscode.commands.executeCommand('huginn.notes.importTodos');
            break;
        }
      },
      null,
      this.disposables
    );

    storages.onDidChange(() => this.update(), null, this.disposables);
  }

  private async scanMarks(scope: string): Promise<void> {
    if (this.marksScanning) return;

    this.marksScope = scope;
    this.marksScanning = true;
    this.marksCancellation = new vscode.CancellationTokenSource();
    const token = this.marksCancellation.token;
    this.update();

    try {
      this.marksReport = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Huginn: scanning ${scope.trim() || 'the workspace'} for AI marks…`,
          cancellable: true,
        },
        (progress, progressToken) => {
          progressToken.onCancellationRequested(() => this.marksCancellation?.cancel());
          return scanWorkspace({
            scope,
            token,
            onProgress: (done, total) => progress.report({ message: `${done} / ${total}` }),
          });
        }
      );
    } finally {
      this.marksScanning = false;
      this.marksCancellation.dispose();
      this.marksCancellation = undefined;
      this.update();
    }
  }

  private async navigateTo(id: string): Promise<void> {
    const note = this.storages.find(id);
    if (!note) return;
    const doc = await vscode.workspace.openTextDocument(path.join(note.root, note.file));
    const editor = await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
    const position = new vscode.Position(note.line - 1, 0);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(
      new vscode.Range(position, position),
      vscode.TextEditorRevealType.InCenter
    );
  }

  private async relink(id: string): Promise<void> {
    const note = this.storages.find(id);
    if (!note) return;

    const absolutePath = path.join(note.root, note.file);
    const editor = vscode.window.visibleTextEditors.find(
      (e) => e.document.uri.fsPath === absolutePath
    );

    if (!editor) {
      const doc = await vscode.workspace.openTextDocument(absolutePath);
      await vscode.window.showTextDocument(doc, vscode.ViewColumn.One, true);
      vscode.window.showInformationMessage(
        'Huginn: put the cursor on the line this note belongs to, then click ⤿ again.'
      );
      return;
    }

    const line = editor.selection.active.line + 1;
    this.storages.relink(id, line, editor.document.lineAt(line - 1).text);
    vscode.window.showInformationMessage(`Huginn: note re-anchored to line ${line}.`);
  }

  update(): void {
    this.panel.webview.html = this.getHtml(this.storages.getAll());
  }

  private getHtml(notes: RootedNote[]): string {
    const grouped = notes.reduce((acc, n) => {
      const key = `${this.storages.label(n.root)}${n.file}`;
      if (!acc[key]) acc[key] = [];
      acc[key].push(n);
      return acc;
    }, {} as Record<string, DevNote[]>);

    const noteCount = notes.length;
    const fileCount = Object.keys(grouped).length;
    const stale = this.storages.staleIds();

    const years = [...new Set(notes.map((n) => new Date(n.createdAt).getFullYear()))].sort(
      (a, b) => b - a
    );

    const tags = [...new Map(notes.flatMap((n) => n.tags ?? []).map((t) => [t.toLowerCase(), t]))]
      .map(([, t]) => t)
      .sort((a, b) => a.localeCompare(b));

    const filesHtml = Object.entries(grouped)
      .map(([displayPath, fileNotes]) =>
        renderFileGroup(displayPath, fileNotes, stale)
      )
      .join('');

    const logoUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'icon.png')
    );

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Huginn · Notes</title>
<style>
  :root {
    --bg: var(--vscode-editor-background);
    --surface: var(--vscode-sideBar-background);
    --border: var(--vscode-panel-border);
    --text: var(--vscode-editor-foreground);
    --muted: var(--vscode-descriptionForeground);
    --accent: var(--vscode-textLink-foreground);
    --danger: var(--vscode-errorForeground);
    --warning: var(--vscode-editorWarning-foreground);
    --tag-bg: var(--vscode-badge-background);
    --tag-fg: var(--vscode-badge-foreground);
    --input-bg: var(--vscode-input-background);
    --input-border: var(--vscode-input-border);
    --btn-bg: var(--vscode-button-background);
    --btn-fg: var(--vscode-button-foreground);
    --radius: 6px;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    background: var(--bg);
    color: var(--text);
    padding: 16px;
    line-height: 1.5;
  }
  .header {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 20px;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--border);
  }
  .header h1 { font-size: 16px; font-weight: 600; }
  .byline { font-size: 10px; color: var(--muted); margin-left: -6px; align-self: flex-end; padding-bottom: 2px; }
  .logo { width: 22px; height: 22px; border-radius: 5px; display: block; }
  .stats {
    display: flex;
    gap: 8px;
    margin-left: auto;
  }
  .stat {
    font-size: 11px;
    color: var(--muted);
    background: var(--surface);
    padding: 2px 8px;
    border-radius: 10px;
    border: 1px solid var(--border);
  }
  .stat.stale { color: var(--warning); border-color: var(--warning); }
  .tabs {
    display: flex;
    gap: 4px;
    margin-bottom: 16px;
    border-bottom: 1px solid var(--border);
  }
  .tab-btn {
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--muted);
    font-family: inherit;
    font-size: 13px;
    padding: 6px 12px;
    cursor: pointer;
  }
  .tab-btn:hover { color: var(--text); }
  .tab-btn.active { color: var(--text); border-bottom-color: var(--accent); }
  .tab-action { margin-left: auto; align-self: center; }
  .toolbar {
    display: flex;
    gap: 8px;
    margin-bottom: 16px;
    flex-wrap: wrap;
  }
  .toolbar input[type="search"] {
    flex: 1;
    min-width: 180px;
    background: var(--input-bg);
    color: var(--text);
    border: 1px solid var(--input-border);
    border-radius: 4px;
    padding: 5px 8px;
    font-family: inherit;
    font-size: 12px;
    outline: none;
  }
  .toolbar input[type="search"]:focus { border-color: var(--accent); }
  .toolbar select {
    background: var(--input-bg);
    color: var(--text);
    border: 1px solid var(--input-border);
    border-radius: 4px;
    padding: 5px 6px;
    font-family: inherit;
    font-size: 12px;
    outline: none;
    cursor: pointer;
  }
  .toolbar button {
    background: none;
    color: var(--muted);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 5px 10px;
    font-family: inherit;
    font-size: 12px;
    cursor: pointer;
  }
  .toolbar button:hover { color: var(--text); background: var(--surface); }
  .empty {
    text-align: center;
    padding: 60px 20px;
    color: var(--muted);
  }
  .empty .icon { font-size: 48px; margin-bottom: 12px; }
  .empty .hint {
    font-size: 12px;
    margin-top: 8px;
    opacity: 0.7;
  }
  .file-group {
    margin-bottom: 16px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    overflow: hidden;
  }
  .file-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
  }
  .file-icon { font-size: 13px; }
  .file-path {
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 12px;
    color: var(--accent);
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .note-count {
    font-size: 11px;
    background: var(--tag-bg);
    color: var(--tag-fg);
    border-radius: 10px;
    padding: 1px 7px;
  }
  .note-card {
    padding: 10px 12px;
    border-bottom: 1px solid var(--border);
  }
  .note-card:last-child { border-bottom: none; }
  .note-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
  }
  .line-btn {
    background: var(--btn-bg);
    color: var(--btn-fg);
    border: none;
    border-radius: 4px;
    padding: 2px 8px;
    font-size: 11px;
    cursor: pointer;
    font-family: monospace;
  }
  .line-btn:hover { opacity: 0.85; }
  .commit-badge {
    font-family: monospace;
    font-size: 11px;
    color: var(--muted);
    background: var(--surface);
    padding: 1px 6px;
    border-radius: 4px;
    border: 1px solid var(--border);
  }
  .date { font-size: 11px; color: var(--muted); margin-left: auto; }
  .delete-btn {
    background: none;
    border: none;
    color: var(--muted);
    cursor: pointer;
    font-size: 13px;
    padding: 2px 4px;
    border-radius: 3px;
    line-height: 1;
  }
  .delete-btn:hover { color: var(--danger); background: var(--surface); }
  .comment-text {
    font-size: 13px;
    cursor: pointer;
    padding: 4px 6px;
    border-radius: 4px;
    border: 1px solid transparent;
    white-space: pre-wrap;
  }
  .comment-text:hover { border-color: var(--input-border); background: var(--input-bg); }
  .comment-edit {
    width: 100%;
    background: var(--input-bg);
    color: var(--text);
    border: 1px solid var(--accent);
    border-radius: 4px;
    padding: 4px 6px;
    font-size: 13px;
    font-family: inherit;
    resize: vertical;
    min-height: 60px;
    outline: none;
  }
  .hidden { display: none; }
  .done-box { margin: 0; cursor: pointer; flex: none; }
  .note-card.done .comment-text { text-decoration: line-through; opacity: .6; }
  .note-card.done .line-btn { opacity: .6; }
  .stale-badge {
    font-size: 11px;
    color: var(--warning);
    border: 1px solid var(--warning);
    border-radius: 4px;
    padding: 0 5px;
    white-space: nowrap;
  }
  .relink-btn {
    background: none;
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--muted);
    cursor: pointer;
    font-size: 12px;
    line-height: 1;
    padding: 2px 5px;
  }
  .relink-btn:hover { color: var(--text); background: var(--surface); }
  .tags { margin-top: 6px; display: flex; flex-wrap: wrap; gap: 4px; }
  .tag {
    font-size: 10px;
    background: var(--tag-bg);
    color: var(--tag-fg);
    padding: 1px 6px;
    border-radius: 10px;
  }
${setupStyles}
${marksStyles}
</style>
</head>
<body>
<div class="header">
  <img class="logo" src="${logoUri}" alt="">
  <h1>Huginn</h1>
  <small class="byline">by 13Node.com</small>
  <div class="stats">
    <span class="stat" id="stat-notes">${noteCount} notes</span>
    <span class="stat" id="stat-files">${fileCount} files</span>
    ${stale.size > 0 ? `<span class="stat stale" title="Notes whose code moved out of reach">${stale.size} stale</span>` : ''}
  </div>
</div>

<div class="tabs">
  <button class="tab-btn" id="btn-notes" onclick="showTab('notes')">📝 Notes</button>
  <button class="tab-btn" id="btn-setup" onclick="showTab('setup')">⚙ Project Setup</button>
  <button class="tab-btn" id="btn-marks" onclick="showTab('marks')">🧹 Clean AI marks</button>
  <button class="tab-btn tab-action" onclick="importTodos()" title="Scan the workspace for TODO / FIXME / HACK / XXX comments and import them as notes">📥 Import TODOs</button>
</div>

<div id="tab-marks">
${renderMarks({ report: this.marksReport, scope: this.marksScope, scanning: this.marksScanning })}
</div>

<div id="tab-setup">
${this.storages.multiRoot
  ? `<div class="setup-stack">Folder: <code>${escapeHtml(path.basename(this.root))}</code> — the folder of the active editor. Open a file in another folder and reopen the panel to set that one up.</div>`
  : ''}
${renderSetup(this.root)}
</div>

<div id="tab-notes">
${notes.length === 0 ? `
<div class="empty">
  <div class="icon">📝</div>
  <div>No notes yet</div>
  <div class="hint">Press Ctrl+Shift+N on any line, or click the + on the editor gutter</div>
</div>
` : `
<div class="toolbar">
  <input type="search" id="q" placeholder="Search notes, tags or paths..." oninput="applyFilters()">
  <select id="month" onchange="applyFilters()">
    <option value="">All months</option>
    ${MONTHS.map((m, i) => `<option value="${String(i + 1).padStart(2, '0')}">${m}</option>`).join('')}
  </select>
  <select id="year" onchange="applyFilters()">
    <option value="">All years</option>
    ${years.map((y) => `<option value="${y}">${y}</option>`).join('')}
  </select>
  <select id="tag" onchange="applyFilters()">
    <option value="">All tags</option>
    ${tags.map((t) => `<option value="${escapeHtml(t.toLowerCase())}">${escapeHtml(t)}</option>`).join('')}
  </select>
  <select id="status" onchange="applyFilters()">
    <option value="">All notes</option>
    <option value="open">Open</option>
    <option value="done">Resolved</option>
    <option value="stale">Stale</option>
  </select>
  <button onclick="clearFilters()" title="Clear filters">Clear</button>
</div>

<div class="empty hidden" id="no-results">
  <div class="icon">🔍</div>
  <div>No note matches the filter</div>
  <div class="hint">Try different text or widen the date range</div>
</div>

${filesHtml}`}
</div>

<script>
  const vscode = acquireVsCodeApi();

  function deleteNote(id) {
    vscode.postMessage({ command: 'delete', id });
  }

  function navigate(id) {
    vscode.postMessage({ command: 'navigate', id });
  }

  function toggleDone(id, done) {
    vscode.postMessage({ command: 'done', id, done });
  }

  function relink(id) {
    vscode.postMessage({ command: 'relink', id });
  }

  const TABS = ${JSON.stringify(TABS)};

  function showTab(name) {
    for (const tab of TABS) {
      document.getElementById('tab-' + tab).classList.toggle('hidden', tab !== name);
      document.getElementById('btn-' + tab).classList.toggle('active', tab === name);
    }
    document.querySelector('.stats').classList.toggle('hidden', name !== 'notes');
    vscode.postMessage({ command: 'tab', tab: name });
  }
  showTab('${this.tab}');

  function scanMarks() {
    const scope = document.getElementById('marks-scope');
    vscode.postMessage({ command: 'scanMarks', scope: scope ? scope.value : '' });
  }

  function stopScan() {
    vscode.postMessage({ command: 'stopScan' });
  }

  function applyMarks() {
    const paths = Array.from(
      document.querySelectorAll('#tab-marks input[type=checkbox]:checked')
    ).map((el) => el.dataset.path);
    if (paths.length) vscode.postMessage({ command: 'applyMarks', paths });
  }

  function setHighlight(enabled) {
    vscode.postMessage({ command: 'setHighlight', enabled });
  }

  function clearNonBasicAscii() {
    vscode.postMessage({ command: 'clearNonBasicAscii' });
  }

  function applySetup() {
    const ids = Array.from(
      document.querySelectorAll('#tab-setup input[type=checkbox]:checked:not(:disabled)')
    ).map((el) => el.dataset.id);
    if (ids.length) vscode.postMessage({ command: 'apply', ids });
  }

  function importTodos() {
    vscode.postMessage({ command: 'importTodos' });
  }

  function refreshPanel() {
    vscode.postMessage({ command: 'refresh' });
  }

  function startEdit(id) {
    document.getElementById('text-' + id).classList.add('hidden');
    const textarea = document.getElementById('edit-' + id);
    textarea.classList.remove('hidden');
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }

  function saveEdit(id) {
    const textarea = document.getElementById('edit-' + id);
    const newText = textarea.value.trim();
    if (!newText) return;
    document.getElementById('text-' + id).textContent = newText;
    document.getElementById('text-' + id).classList.remove('hidden');
    textarea.classList.add('hidden');
    vscode.postMessage({ command: 'update', id, comment: newText });
  }

  function editKeydown(e, id) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      saveEdit(id);
    }
    if (e.key === 'Escape') {
      document.getElementById('text-' + id).classList.remove('hidden');
      document.getElementById('edit-' + id).classList.add('hidden');
    }
  }

  function matchesStatus(card, status) {
    if (!status) return true;
    if (status === 'done') return card.dataset.done === '1';
    if (status === 'open') return card.dataset.done === '0';
    return card.dataset.stale === '1';
  }

  function applyFilters() {
    const q = document.getElementById('q');
    if (!q) return;

    const text = q.value.trim().toLowerCase();
    const month = document.getElementById('month').value;
    const year = document.getElementById('year').value;
    const tag = document.getElementById('tag').value.trim().toLowerCase();
    const status = document.getElementById('status').value;

    let visibleNotes = 0;
    let visibleFiles = 0;

    document.querySelectorAll('.file-group').forEach((group) => {
      let shown = 0;
      group.querySelectorAll('.note-card').forEach((card) => {
        const [cardYear, cardMonth] = card.dataset.ym.split('-');
        const match =
          matchesStatus(card, status) &&
          (!text || card.dataset.search.includes(text)) &&
          (!month || cardMonth === month) &&
          (!year || cardYear === year) &&
          (!tag || card.dataset.tags.includes('|' + tag + '|'));
        card.classList.toggle('hidden', !match);
        if (match) shown++;
      });
      group.classList.toggle('hidden', shown === 0);
      group.querySelector('.note-count').textContent = shown;
      visibleNotes += shown;
      if (shown > 0) visibleFiles++;
    });

    document.getElementById('stat-notes').textContent = visibleNotes + ' notes';
    document.getElementById('stat-files').textContent = visibleFiles + ' files';
    document.getElementById('no-results').classList.toggle('hidden', visibleNotes > 0);

    vscode.setState({ text, month, year, tag, status });
  }

  function clearFilters() {
    document.getElementById('q').value = '';
    document.getElementById('month').value = '';
    document.getElementById('year').value = '';
    document.getElementById('tag').value = '';
    document.getElementById('status').value = '';
    applyFilters();
  }

  (function restoreFilters() {
    const saved = vscode.getState();
    if (!saved || !document.getElementById('q')) return;
    document.getElementById('q').value = saved.text || '';
    document.getElementById('month').value = saved.month || '';
    document.getElementById('year').value = saved.year || '';
    document.getElementById('tag').value = saved.tag || '';
    document.getElementById('status').value = saved.status || '';
    applyFilters();
  })();
</script>
</body>
</html>`;
  }

  dispose(): void {
    HuginnPanel.currentPanel = undefined;
    this.panel.dispose();
    this.disposables.forEach((d) => d.dispose());
  }
}

function renderFileGroup(
  displayPath: string,
  fileNotes: DevNote[],
  stale: Set<string>
): string {
  const notesHtml = fileNotes
    .sort((a, b) => a.line - b.line)
    .map((n) => renderNoteCard(n, displayPath, stale.has(n.id)))
    .join('');

  return `
    <div class="file-group">
      <div class="file-header">
        <span class="file-icon">📄</span>
        <span class="file-path">${escapeHtml(displayPath)}</span>
        <span class="note-count">${fileNotes.length}</span>
      </div>
      ${notesHtml}
    </div>`;
}

function renderNoteCard(n: DevNote, displayPath: string, stale: boolean): string {
  const tagsHtml = n.tags?.length
    ? `<div class="tags">${n.tags.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>`
    : '';

  const date = new Date(n.createdAt).toLocaleDateString('en-US', {
    day: '2-digit', month: 'short', year: 'numeric',
  });

  const { ym, haystack } = noteFilterData({ ...n, file: displayPath });

  const staleHtml = stale
    ? `<span class="stale-badge" title="The annotated code is gone — click ⤿ to re-anchor the note to the cursor line">⚠ stale</span>
       <button class="relink-btn" onclick="relink(${jsArg(n.id)})" title="Re-anchor to the cursor line">⤿</button>`
    : '';

  return `
    <div class="note-card${n.done ? ' done' : ''}" data-id="${escapeHtml(n.id)}" data-ym="${ym}" data-search="${escapeHtml(haystack)}" data-tags="${escapeHtml(tagKey(n.tags))}" data-done="${n.done ? '1' : '0'}" data-stale="${stale ? '1' : '0'}">
      <div class="note-header">
        <input type="checkbox" class="done-box" title="Mark as resolved — resolved notes stay out of the AI export"${n.done ? ' checked' : ''} onchange="toggleDone(${jsArg(n.id)}, this.checked)">
        <button class="line-btn" onclick="navigate(${jsArg(n.id)})">
          Line ${Number(n.line)}
        </button>
        <span class="commit-badge">${escapeHtml(n.commit)} · ${escapeHtml(n.branch)}</span>
        ${staleHtml}
        <span class="date">${date}</span>
        <button class="delete-btn" onclick="deleteNote(${jsArg(n.id)})" title="Delete note">✕</button>
      </div>
      <div class="note-body">
        <div class="comment-text" id="text-${escapeHtml(n.id)}" onclick="startEdit(${jsArg(n.id)})">${escapeHtml(n.comment)}</div>
        <textarea class="comment-edit hidden" id="edit-${escapeHtml(n.id)}" onblur="saveEdit(${jsArg(n.id)})" onkeydown="editKeydown(event, ${jsArg(n.id)})">${escapeHtml(n.comment)}</textarea>
      </div>
      ${tagsHtml}
    </div>`;
}

export function noteFilterData(n: DevNote): { ym: string; haystack: string } {
  const created = new Date(n.createdAt);
  const ym = `${created.getFullYear()}-${String(created.getMonth() + 1).padStart(2, '0')}`;
  const haystack = [n.comment, ...(n.tags ?? []), n.file].join(' ').toLowerCase();
  return { ym, haystack };
}

export function tagKey(tags?: string[]): string {
  if (!tags?.length) return '';
  return `|${tags.map((t) => t.trim().toLowerCase()).join('|')}|`;
}

export function jsArg(value: string): string {
  return escapeHtml(JSON.stringify(String(value)));
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
