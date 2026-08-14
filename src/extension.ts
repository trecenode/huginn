import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { isValidCommitRange, NoteFilter, NoteStorageRegistry } from './storage';
import { DecorationProvider } from './decorations';
import { HuginnPanel } from './panel';
import { CommentsProvider } from './comments';
import { askClaude, forgetApiKey } from './claude';
import { NoteTracker } from './tracker';
import { importTodos } from './todos';
import { cleanActiveFile } from './marks/panel';

export function activate(context: vscode.ExtensionContext): void {
  if (!vscode.workspace.workspaceFolders?.length) return;

  const storages = new NoteStorageRegistry();
  const decorations = new DecorationProvider(storages, context.extensionUri);
  const commentsProvider = new CommentsProvider(storages);
  const tracker = new NoteTracker(storages);

  const addNote = vscode.commands.registerCommand('huginn.notes.add', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const storage = storages.forUri(editor.document.uri);
    if (!storage) {
      vscode.window.showWarningMessage('Huginn: this file is not inside a workspace folder.');
      return;
    }

    const line = editor.selection.active.line + 1;
    const filePath = editor.document.uri.fsPath;

    const comment = await vscode.window.showInputBox({
      prompt: `📝 Note · ${path.basename(filePath)} · Line ${line}`,
      placeHolder: 'Write your private annotation...',
      ignoreFocusOut: true,
    });
    if (!comment?.trim()) return;

    const tagInput = await vscode.window.showInputBox({
      prompt: 'Tags (optional, comma-separated)',
      placeHolder: 'bug, workaround, refactor...',
      ignoreFocusOut: true,
    });
    const tags = tagInput
      ? tagInput.split(',').map((t) => t.trim()).filter(Boolean)
      : undefined;

    await storage.addNote(
      filePath,
      line,
      comment.trim(),
      tags,
      editor.document.lineAt(line - 1).text
    );
    decorations.decorateAll();

    vscode.window.showInformationMessage(`📝 Note added on line ${line}`);
  });

  const deleteNote = vscode.commands.registerCommand('huginn.notes.delete', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const storage = storages.forUri(editor.document.uri);
    if (!storage) return;

    const line = editor.selection.active.line + 1;
    const notesOnLine = storage.getForLine(editor.document.uri.fsPath, line);

    if (notesOnLine.length === 0) {
      vscode.window.showInformationMessage('No notes on this line.');
      return;
    }

    const note = notesOnLine[0];
    const confirm = await vscode.window.showQuickPick(['Yes, delete', 'Cancel'], {
      placeHolder: `Delete note: "${note.comment.slice(0, 50)}..."?`,
    });
    if (confirm !== 'Yes, delete') return;

    storage.deleteNote(note.id);
    decorations.decorateAll();
    vscode.window.showInformationMessage('Note deleted.');
  });

  const gotoNote = (forward: boolean) => () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const notes = storages
      .forUri(editor.document.uri)
      ?.getForFile(editor.document.uri.fsPath)
      .filter((n) => n.line >= 1 && n.line <= editor.document.lineCount)
      .sort((a, b) => a.line - b.line);

    if (!notes?.length) {
      vscode.window.showInformationMessage('Huginn: no note in this file.');
      return;
    }

    const currentLine = editor.selection.active.line + 1;
    const target = forward
      ? notes.find((n) => n.line > currentLine) ?? notes[0]
      : [...notes].reverse().find((n) => n.line < currentLine) ?? notes[notes.length - 1];

    const position = new vscode.Position(target.line - 1, 0);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(
      new vscode.Range(position, position),
      vscode.TextEditorRevealType.InCenter
    );
    vscode.window.setStatusBarMessage(`📝 ${target.comment.slice(0, 80)}`, 4000);
  };

  const nextNote = vscode.commands.registerCommand('huginn.notes.next', gotoNote(true));
  const prevNote = vscode.commands.registerCommand('huginn.notes.prev', gotoNote(false));

  const importTodoComments = vscode.commands.registerCommand('huginn.notes.importTodos', () =>
    importTodos(storages)
  );

  const showPanel = vscode.commands.registerCommand('huginn.notes.panel', () => {
    const root = storages.activeRoot();
    if (root) HuginnPanel.createOrShow(storages, context.extensionUri, root, 'notes');
  });

  const exportForAI = vscode.commands.registerCommand('huginn.notes.exportAI', async () => {
    const root = storages.activeRoot();
    if (!root) return;

    const scope = await vscode.window.showInputBox({
      prompt: 'Filter by path (leave empty = all files)',
      placeHolder: 'src/controllers/ · or empty for everything',
    });

    const filter = await askRangeFilter(storages);
    if (filter === CANCELLED) return;

    const markdown = storages.exportForAI(scope?.trim() || undefined, filter);
    const outPath = path.join(root, '.vscode', 'huginn-ai-context.md');
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, markdown, 'utf8');

    const doc = await vscode.workspace.openTextDocument(outPath);
    vscode.window.showTextDocument(doc);
    vscode.window.showInformationMessage(
      `📤 Context exported → .vscode/huginn-ai-context.md`
    );
  });

  const copyAIContext = vscode.commands.registerCommand('huginn.notes.copyAI', async () => {
    const editor = vscode.window.activeTextEditor;
    const storage = editor && storages.forUri(editor.document.uri);
    let scope: string | undefined;

    if (editor && storage) {
      const relativePath = storage.toRelative(editor.document.uri.fsPath);
      const choice = await vscode.window.showQuickPick(
        [`Only this file (${relativePath})`, 'All files'],
        { placeHolder: 'Which notes should go to the clipboard?' }
      );
      if (!choice) return;
      if (choice.startsWith('Only')) scope = relativePath;
    }

    await vscode.env.clipboard.writeText(storages.exportForAI(scope));
    vscode.window.showInformationMessage('📋 AI context copied to the clipboard. Paste it into Claude!');
  });

  const openSetup = vscode.commands.registerCommand('huginn.setup.open', () => {
    const root = storages.activeRoot();
    if (root) HuginnPanel.createOrShow(storages, context.extensionUri, root, 'setup');
  });

  const openMarks = vscode.commands.registerCommand('huginn.marks.open', () => {
    const root = storages.activeRoot();
    if (root) HuginnPanel.createOrShow(storages, context.extensionUri, root, 'marks');
  });

  const cleanFile = vscode.commands.registerCommand('huginn.marks.cleanFile', cleanActiveFile);

  const askAI = vscode.commands.registerCommand('huginn.ai.ask', async () => {
    const filter = await askRangeFilter(storages);
    if (filter === CANCELLED) return;
    await askClaude(storages, context.secrets, filter);
  });

  const forgetKey = vscode.commands.registerCommand('huginn.ai.forgetKey', () =>
    forgetApiKey(context.secrets)
  );

  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.command = 'huginn.notes.panel';

  const updateStatusBar = () => {
    const openCount = storages.getAll().filter((n) => !n.done).length;
    statusBar.text = openCount > 0 ? `$(note) ${openCount} notes` : `$(note) Huginn`;
    statusBar.tooltip = 'Huginn – click to open the panel (notes + setup)';
    statusBar.show();
  };

  storages.onDidChange(updateStatusBar);
  updateStatusBar();

  vscode.window.onDidChangeActiveTextEditor(() => {
    decorations.decorateAll();
  }, null, context.subscriptions);

  context.subscriptions.push(
    addNote,
    deleteNote,
    nextNote,
    prevNote,
    importTodoComments,
    showPanel,
    exportForAI,
    copyAIContext,
    openSetup,
    openMarks,
    cleanFile,
    askAI,
    forgetKey,
    decorations,
    commentsProvider,
    tracker,
    storages,
    statusBar
  );
}

export function deactivate(): void {}

const CANCELLED = Symbol('cancelled');

async function askRangeFilter(
  storages: NoteStorageRegistry
): Promise<NoteFilter | undefined | typeof CANCELLED> {
  const OPEN = 'Open notes';
  const WITH_DONE = 'Open notes + resolved ones';
  const DATES = 'Date range...';
  const COMMITS = 'Commit range...';

  const choice = await vscode.window.showQuickPick([OPEN, WITH_DONE, DATES, COMMITS], {
    placeHolder: 'Limit the export to a period or a set of commits?',
  });
  if (!choice) return CANCELLED;
  if (choice === OPEN) return undefined;
  if (choice === WITH_DONE) return { includeDone: true };

  if (choice === DATES) {
    const raw = await vscode.window.showInputBox({
      prompt: 'Date range, either side optional',
      placeHolder: '2026-01-01..2026-03-31 · ..2026-03-31 · 2026-01-01..',
      validateInput: (v) =>
        v.includes('..') ? undefined : 'Use from..to, for example 2026-01-01..2026-03-31',
    });
    if (raw === undefined) return CANCELLED;
    const [since, until] = raw.split('..').map((s) => s.trim());
    return { since: since || undefined, until: until || undefined };
  }

  const range = await vscode.window.showInputBox({
    prompt: 'Commit range, as git understands it',
    placeHolder: 'main..HEAD · v1.0.0..HEAD · abc1234..def5678',
    validateInput: (v) =>
      isValidCommitRange(v.trim()) ? undefined : 'Not a git revision range, for example main..HEAD',
  });
  if (range === undefined) return CANCELLED;

  const commits = await storages.activeStorage()?.resolveCommitRange(range.trim());
  if (!commits) {
    vscode.window.showWarningMessage(`Huginn: git returned no commits for "${range.trim()}".`);
    return CANCELLED;
  }
  return { commits };
}
