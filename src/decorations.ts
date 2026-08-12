import * as vscode from 'vscode';
import { isStale, toLines } from './anchor';
import { DevNote, NoteStorageRegistry } from './storage';

const PREVIEW_LENGTH = 60;

export class DecorationProvider implements vscode.Disposable {
  private gutterDecoration: vscode.TextEditorDecorationType;
  private inlineDecoration: vscode.TextEditorDecorationType;
  private disposables: vscode.Disposable[] = [];

  constructor(
    private storages: NoteStorageRegistry,
    extensionUri: vscode.Uri
  ) {
    this.gutterDecoration = vscode.window.createTextEditorDecorationType({
      gutterIconPath: vscode.Uri.joinPath(extensionUri, 'media', 'note-gutter.svg'),
      gutterIconSize: 'contain',
    });

    this.inlineDecoration = vscode.window.createTextEditorDecorationType({
      after: {
        margin: '0 0 0 2em',
        color: new vscode.ThemeColor('editorCodeLens.foreground'),
        fontStyle: 'italic',
      },
    });

    this.disposables.push(
      storages.onDidChange(() => this.decorateAll()),
      vscode.window.onDidChangeActiveTextEditor(() => this.decorateAll()),
      vscode.workspace.onDidOpenTextDocument(() => this.decorateAll()),
      vscode.workspace.onDidSaveTextDocument(() => this.decorateAll())
    );

    this.decorateAll();
  }

  decorateAll(): void {
    for (const editor of vscode.window.visibleTextEditors) {
      this.decorate(editor);
    }
  }

  private decorate(editor: vscode.TextEditor): void {
    const config = vscode.workspace.getConfiguration('huginn');
    const showGutter = config.get('showGutterIcons', true);
    const showInline = config.get('showInlinePreview', true);

    const notes = this.storages.forUri(editor.document.uri)?.getForFile(editor.document.uri.fsPath) ?? [];
    if (notes.length === 0) {
      editor.setDecorations(this.gutterDecoration, []);
      editor.setDecorations(this.inlineDecoration, []);
      return;
    }

    const lines = toLines(editor.document.getText());

    const gutterRanges: vscode.DecorationOptions[] = [];
    const inlineRanges: vscode.DecorationOptions[] = [];

    for (const note of notes) {
      const lineIndex = note.line - 1;
      if (lineIndex < 0 || lineIndex >= editor.document.lineCount) continue;

      const line = editor.document.lineAt(lineIndex);
      const range = new vscode.Range(line.range.start, line.range.end);
      const stale = isStale(lines, note);

      if (showGutter) {
        gutterRanges.push({ range, hoverMessage: hoverFor(note, stale) });
      }

      if (showInline) {
        inlineRanges.push({
          range,
          renderOptions: {
            after: {
              contentText: `${markerFor(note, stale)} ${preview(note.comment)}`,
              textDecoration: note.done ? 'line-through; opacity: 0.6' : undefined,
            },
          },
        });
      }
    }

    editor.setDecorations(this.gutterDecoration, gutterRanges);
    editor.setDecorations(this.inlineDecoration, inlineRanges);
  }

  dispose(): void {
    this.gutterDecoration.dispose();
    this.inlineDecoration.dispose();
    this.disposables.forEach((d) => d.dispose());
  }
}

function markerFor(note: DevNote, stale: boolean): string {
  if (note.done) return '✓';
  return stale ? '⚠' : '📝';
}

function preview(comment: string): string {
  return comment.length > PREVIEW_LENGTH
    ? `${comment.slice(0, PREVIEW_LENGTH - 3)}…`
    : comment;
}

function hoverFor(note: DevNote, stale: boolean): vscode.MarkdownString {
  const parts = [`**📝 DevNote** *(${note.commit} · ${note.branch})*\n\n${note.comment}`];
  if (note.tags?.length) parts.push(`🏷 ${note.tags.join(', ')}`);
  if (note.done) parts.push('✓ *resolved*');
  if (stale) parts.push('⚠ *stale — the annotated code is gone, re-anchor it from the panel*');
  parts.push(`*${new Date(note.createdAt).toLocaleDateString()}*`);
  return new vscode.MarkdownString(parts.join('\n\n'));
}
