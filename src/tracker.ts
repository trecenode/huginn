import * as vscode from 'vscode';
import { LineChange, toLines } from './anchor';
import { NoteStorageRegistry } from './storage';

export class NoteTracker implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];

  constructor(private storages: NoteStorageRegistry) {
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((e) => this.onChange(e)),
      vscode.workspace.onDidOpenTextDocument((doc) => this.sync(doc, false)),
      vscode.workspace.onDidSaveTextDocument((doc) => this.sync(doc, true)),
      vscode.workspace.onDidRenameFiles((e) => this.onRename(e))
    );

    for (const editor of vscode.window.visibleTextEditors) this.sync(editor.document, false);
  }

  private onChange(e: vscode.TextDocumentChangeEvent): void {
    const doc = e.document;
    if (doc.uri.scheme !== 'file' || e.contentChanges.length === 0) return;

    const storage = this.storages.forUri(doc.uri);
    if (!storage) return;

    const relativePath = storage.toRelative(doc.uri.fsPath);

    if (isWholeDocumentReplacement(e)) {
      storage.reanchor(relativePath, toLines(doc.getText()));
      return;
    }

    const changes: LineChange[] = e.contentChanges.map((change) => ({
      startLine: change.range.start.line,
      endLine: change.range.end.line,
      startCharacter: change.range.start.character,
      newLineCount: countNewlines(change.text),
      insertion: change.range.isEmpty,
    }));

    storage.shiftLines(relativePath, changes);
  }

  private sync(doc: vscode.TextDocument, everyEditWasTracked: boolean): void {
    if (doc.uri.scheme !== 'file') return;
    const storage = this.storages.forUri(doc.uri);
    if (!storage) return;
    storage.reanchor(
      storage.toRelative(doc.uri.fsPath),
      toLines(doc.getText()),
      everyEditWasTracked
    );
  }

  private onRename(e: vscode.FileRenameEvent): void {
    for (const { oldUri, newUri } of e.files) {
      const storage = this.storages.forUri(oldUri);
      if (!storage || this.storages.forUri(newUri) !== storage) continue;
      storage.renamePath(storage.toRelative(oldUri.fsPath), storage.toRelative(newUri.fsPath));
    }
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
  }
}

function isWholeDocumentReplacement(e: vscode.TextDocumentChangeEvent): boolean {
  if (e.contentChanges.length !== 1) return false;
  const [change] = e.contentChanges;
  return (
    change.range.start.line === 0 &&
    change.range.start.character === 0 &&
    change.text === e.document.getText()
  );
}

function countNewlines(text: string): number {
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') count++;
  }
  return count;
}
