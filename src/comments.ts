import * as vscode from 'vscode';
import { NoteStorageRegistry, DevNote } from './storage';

export class DevNoteComment implements vscode.Comment {
  public id: string;
  public author: vscode.CommentAuthorInformation;
  public body: vscode.MarkdownString;
  public mode: vscode.CommentMode;
  public contextValue: string;

  constructor(
    public note: DevNote,
    public parentThread: vscode.CommentThread
  ) {
    this.id = note.id;
    this.author = { name: `Note · ${note.branch}` };
    this.mode = vscode.CommentMode.Preview;
    this.contextValue = 'huginn-note';

    const created = new Date(note.createdAt);
    let markdown = `**${note.commit}** · *${created.toLocaleDateString()} ${created.toLocaleTimeString()}*\n\n`;
    markdown += note.done ? `~~${note.comment}~~` : note.comment;

    if (note.tags && note.tags.length > 0) {
      markdown += `\n\n\`${note.tags.join('` `')}\``;
    }

    this.body = new vscode.MarkdownString(markdown);
  }
}

export class CommentsProvider implements vscode.Disposable {
  private controller: vscode.CommentController;
  private disposables: vscode.Disposable[] = [];
  private threadsByUri: Map<string, vscode.CommentThread[]> = new Map();

  constructor(private storages: NoteStorageRegistry) {
    this.controller = vscode.comments.createCommentController('huginn.comments', 'Huginn');

    this.controller.commentingRangeProvider = {
      provideCommentingRanges: (document) => {
        if (document.uri.scheme !== 'file' || !this.storages.forUri(document.uri)) return [];
        return [new vscode.Range(0, 0, Math.max(document.lineCount - 1, 0), 0)];
      },
    };

    this.disposables.push(
      this.controller,
      vscode.commands.registerCommand('huginn.notes.reply', (reply: vscode.CommentReply) =>
        this.addFromThread(reply)
      ),
      vscode.commands.registerCommand('huginn.notes.deleteComment', (comment: DevNoteComment) =>
        this.storages.deleteNote(comment.note.id)
      ),
      vscode.commands.registerCommand('huginn.notes.toggleDoneComment', (comment: DevNoteComment) =>
        this.storages.setDone(comment.note.id, !comment.note.done)
      ),
      storages.onDidChange(() => this.syncAll()),
      vscode.window.onDidChangeActiveTextEditor(() => this.syncAll()),
      vscode.workspace.onDidOpenTextDocument(() => this.syncAll())
    );

    this.syncAll();
  }

  private async addFromThread(reply: vscode.CommentReply): Promise<void> {
    const thread = reply.thread;
    const comment = reply.text.trim();
    if (!comment || !thread.range) return;

    const storage = this.storages.forUri(thread.uri);
    if (!storage) {
      vscode.window.showWarningMessage('Huginn: this file is not inside a workspace folder.');
      return;
    }

    const line = thread.range.start.line + 1;
    const document = await vscode.workspace.openTextDocument(thread.uri);
    await storage.addNote(
      thread.uri.fsPath,
      line,
      comment,
      undefined,
      document.lineAt(line - 1).text
    );

    thread.dispose();
  }

  private syncAll(): void {
    for (const threads of this.threadsByUri.values()) {
      threads.forEach((thread) => thread.dispose());
    }
    this.threadsByUri.clear();

    for (const editor of vscode.window.visibleTextEditors) {
      const uri = editor.document.uri;
      const notes = this.storages.forUri(uri)?.getForFile(uri.fsPath) ?? [];

      const threads: vscode.CommentThread[] = [];
      const notesByLine = new Map<number, DevNote[]>();

      for (const note of notes) {
        if (!notesByLine.has(note.line)) notesByLine.set(note.line, []);
        notesByLine.get(note.line)!.push(note);
      }

      for (const [line, lineNotes] of notesByLine) {
        const lineIndex = line - 1;
        if (lineIndex < 0 || lineIndex >= editor.document.lineCount) continue;

        const range = new vscode.Range(lineIndex, 0, lineIndex, 0);
        const thread = this.controller.createCommentThread(uri, range, []);

        thread.canReply = true;
        thread.collapsibleState = vscode.CommentThreadCollapsibleState.Collapsed;
        thread.comments = lineNotes.map((note) => new DevNoteComment(note, thread));

        threads.push(thread);
      }

      this.threadsByUri.set(uri.toString(), threads);
    }
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
  }
}
