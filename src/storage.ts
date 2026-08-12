import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import {
  findAnchor,
  isStale,
  LineChange,
  makeAnchor,
  shiftLine,
  similarLine,
  toLines,
} from './anchor';

export interface DevNote {
  id: string;
  file: string;
  line: number;
  commit: string;
  branch: string;
  comment: string;
  createdAt: string;
  updatedAt: string;
  tags?: string[];
  anchor?: string;
  done?: boolean;
}

export interface NotesStore {
  version: number;
  notes: DevNote[];
}

export interface NoteFilter {
  since?: string;
  until?: string;
  commits?: Set<string>;
  includeDone?: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const SAVE_DEBOUNCE_MS = 500;

export function filterNotes(notes: DevNote[], scope?: string, filter?: NoteFilter): DevNote[] {
  const since = filter?.since ? new Date(filter.since).getTime() : undefined;
  const untilEndOfDay = filter?.until ? new Date(filter.until).getTime() + DAY_MS : undefined;
  const commits = filter?.commits;

  return notes.filter((n) => {
    if (n.done && !filter?.includeDone) return false;
    if (scope && !n.file.startsWith(scope)) return false;

    const created = new Date(n.createdAt).getTime();
    if (since !== undefined && created < since) return false;
    if (untilEndOfDay !== undefined && created >= untilEndOfDay) return false;

    if (commits && ![...commits].some((c) => c.startsWith(n.commit))) return false;

    return true;
  });
}

function emptyStore(): NotesStore {
  return { version: 1, notes: [] };
}

function readLines(
  absolutePath: string,
  openDocuments: Map<string, vscode.TextDocument>
): string[] | undefined {
  const open = openDocuments.get(absolutePath);
  if (open) return toLines(open.getText());

  try {
    return toLines(fs.readFileSync(absolutePath, 'utf8'));
  } catch {
    return undefined;
  }
}

export function isValidCommitRange(range: string): boolean {
  const side = '[A-Za-z0-9._/^~@{}][A-Za-z0-9._/^~@{}-]*';
  return new RegExp(`^${side}(\\.\\.\\.?${side})?$`).test(range);
}

export class NoteStorage {
  private storePath: string;
  private store: NotesStore;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  constructor(private workspaceRoot: string) {
    this.storePath = path.join(workspaceRoot, '.vscode', 'huginn-notes.json');
    this.store = this.load();
    this.ensureGitignore();
  }

  private load(): NotesStore {
    try {
      if (!fs.existsSync(this.storePath)) return emptyStore();
      return JSON.parse(fs.readFileSync(this.storePath, 'utf8'));
    } catch {
      return emptyStore();
    }
  }

  private save(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = undefined;
    }

    const dir = path.dirname(this.storePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.storePath, JSON.stringify(this.store, null, 2), 'utf8');
    this._onDidChange.fire();
  }

  private saveDebounced(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), SAVE_DEBOUNCE_MS);
  }

  private ensureGitignore(): void {
    const config = vscode.workspace.getConfiguration('huginn');
    if (!config.get('autoGitignore')) return;

    const gitignorePath = path.join(this.workspaceRoot, '.gitignore');
    const entry = '.vscode/huginn-notes.json';

    try {
      if (fs.existsSync(gitignorePath)) {
        const content = fs.readFileSync(gitignorePath, 'utf8');
        if (content.includes(entry)) return;
      }
      fs.appendFileSync(gitignorePath, `\n# Huginn\n${entry}\n`, 'utf8');
    } catch {
      return;
    }
  }

  async getCurrentGitInfo(filePath: string): Promise<{ commit: string; branch: string }> {
    try {
      const { execFile } = require('child_process');
      const cwd = this.workspaceRoot;

      const git = (args: string[]): Promise<string> =>
        new Promise((resolve) => {
          execFile('git', args, { cwd }, (_err: any, stdout: string) => {
            resolve((stdout ?? '').trim());
          });
        });

      const [commit, branch] = await Promise.all([
        git(['rev-parse', '--short', 'HEAD']),
        git(['rev-parse', '--abbrev-ref', 'HEAD']),
      ]);

      return {
        commit: commit || 'uncommitted',
        branch: branch || 'unknown',
      };
    } catch {
      return { commit: 'uncommitted', branch: 'unknown' };
    }
  }

  toRelative(absolutePath: string): string {
    return path.relative(this.workspaceRoot, absolutePath).replace(/\\/g, '/');
  }

  async addNote(
    absoluteFilePath: string,
    line: number,
    comment: string,
    tags?: string[],
    lineText?: string
  ): Promise<DevNote> {
    const { commit, branch } = await this.getCurrentGitInfo(absoluteFilePath);
    const now = new Date().toISOString();

    const note: DevNote = {
      id: crypto.randomUUID(),
      file: this.toRelative(absoluteFilePath),
      line,
      commit,
      branch,
      comment,
      createdAt: now,
      updatedAt: now,
      tags,
      anchor: lineText === undefined ? undefined : makeAnchor(lineText),
    };

    this.store.notes.push(note);
    this.save();
    return note;
  }

  updateNote(id: string, comment: string, tags?: string[]): boolean {
    const note = this.store.notes.find((n) => n.id === id);
    if (!note) return false;
    note.comment = comment;
    note.updatedAt = new Date().toISOString();
    if (tags !== undefined) note.tags = tags;
    this.save();
    return true;
  }

  deleteNote(id: string): boolean {
    const index = this.store.notes.findIndex((n) => n.id === id);
    if (index === -1) return false;
    this.store.notes.splice(index, 1);
    this.save();
    return true;
  }

  setDone(id: string, done: boolean): boolean {
    const note = this.store.notes.find((n) => n.id === id);
    if (!note) return false;
    note.done = done || undefined;
    note.updatedAt = new Date().toISOString();
    this.save();
    return true;
  }

  relink(id: string, line: number, lineText: string): boolean {
    const note = this.store.notes.find((n) => n.id === id);
    if (!note) return false;
    note.line = line;
    note.anchor = makeAnchor(lineText);
    note.updatedAt = new Date().toISOString();
    this.save();
    return true;
  }

  shiftLines(relativeFile: string, changes: LineChange[]): boolean {
    let moved = false;

    for (const note of this.store.notes) {
      if (note.file !== relativeFile) continue;
      const line = changes.reduce((current, change) => shiftLine(current, change), note.line);
      if (line !== note.line) {
        note.line = line;
        moved = true;
      }
    }

    if (moved) this.saveDebounced();
    return moved;
  }

  reanchor(relativeFile: string, lines: string[], everyEditWasTracked = false): boolean {
    let changed = false;

    for (const note of this.store.notes) {
      if (note.file !== relativeFile) continue;

      const currentText = lines[note.line - 1];

      if (!note.anchor) {
        if (currentText === undefined) continue;
        note.anchor = makeAnchor(currentText);
        changed = true;
        continue;
      }

      const found = findAnchor(lines, note.line, note.anchor);
      if (found !== undefined) {
        if (found !== note.line) {
          note.line = found;
          changed = true;
        }
        continue;
      }

      const wasRewrittenInPlace =
        everyEditWasTracked && currentText !== undefined && similarLine(note.anchor, currentText);
      if (wasRewrittenInPlace) {
        note.anchor = makeAnchor(currentText);
        changed = true;
      }
    }

    if (changed) this.saveDebounced();
    return changed;
  }

  renamePath(oldRelativePath: string, newRelativePath: string): boolean {
    let changed = false;

    for (const note of this.store.notes) {
      if (note.file === oldRelativePath) {
        note.file = newRelativePath;
        changed = true;
      } else if (note.file.startsWith(`${oldRelativePath}/`)) {
        note.file = newRelativePath + note.file.slice(oldRelativePath.length);
        changed = true;
      }
    }

    if (changed) this.save();
    return changed;
  }

  getAll(): DevNote[] {
    return [...this.store.notes];
  }

  getForFile(absoluteFilePath: string): DevNote[] {
    const relativePath = this.toRelative(absoluteFilePath);
    return this.store.notes.filter((n) => n.file === relativePath);
  }

  getForLine(absoluteFilePath: string, line: number): DevNote[] {
    const relativePath = this.toRelative(absoluteFilePath);
    return this.store.notes.filter((n) => n.file === relativePath && n.line === line);
  }

  async resolveCommitRange(range: string): Promise<Set<string> | undefined> {
    if (!isValidCommitRange(range)) return undefined;

    const { execFile } = require('child_process');
    const out: string = await new Promise((resolve) => {
      execFile(
        'git',
        ['rev-list', '--end-of-options', range],
        { cwd: this.workspaceRoot },
        (_err: any, stdout: string) => resolve(stdout ?? '')
      );
    });
    const commits = out.trim().split(/\s+/).filter(Boolean);
    return commits.length ? new Set(commits) : undefined;
  }

  exportForAI(scope?: string, filter?: NoteFilter): string {
    return renderExport(filterNotes(this.store.notes, scope, filter));
  }
}

export function renderExport(notes: DevNote[]): string {
  if (notes.length === 0) {
    return '# Huginn – No notes found\n';
  }

  const grouped = notes.reduce((acc, n) => {
    if (!acc[n.file]) acc[n.file] = [];
    acc[n.file].push(n);
    return acc;
  }, {} as Record<string, DevNote[]>);

  let md = `# Huginn – Developer Annotations\n`;
  md += `> Generated: ${new Date().toISOString()}\n`;
  md += `> These are private developer notes. They describe intent, gotchas, and context.\n`;
  md += `> They do NOT contain client code. Use them to understand developer intent.\n\n`;

  for (const [file, fileNotes] of Object.entries(grouped)) {
    md += `## \`${file}\`\n\n`;
    for (const n of fileNotes.sort((a, b) => a.line - b.line)) {
      md += `### Line ${n.line}`;
      if (n.tags?.length) md += ` [${n.tags.join(', ')}]`;
      md += `\n`;
      md += `- **Commit**: \`${n.commit}\` (branch: \`${n.branch}\`)\n`;
      md += `- **Date**: ${n.createdAt}\n`;
      md += `- **Note**: ${n.comment}\n\n`;
    }
  }

  return md;
}

export interface RootedNote extends DevNote {
  root: string;
}

export class NoteStorageRegistry implements vscode.Disposable {
  private byRoot = new Map<string, NoteStorage>();
  private _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;
  private disposables: vscode.Disposable[] = [];

  constructor() {
    this.sync();
    this.disposables.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        this.sync();
        this._onDidChange.fire();
      })
    );
  }

  private sync(): void {
    const roots = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);

    for (const root of roots) {
      if (this.byRoot.has(root)) continue;
      const storage = new NoteStorage(root);
      this.disposables.push(storage.onDidChange(() => this._onDidChange.fire()));
      this.byRoot.set(root, storage);
    }

    for (const root of [...this.byRoot.keys()]) {
      if (!roots.includes(root)) this.byRoot.delete(root);
    }
  }

  get multiRoot(): boolean {
    return this.byRoot.size > 1;
  }

  forUri(uri: vscode.Uri): NoteStorage | undefined {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    return folder && this.byRoot.get(folder.uri.fsPath);
  }

  activeRoot(): string | undefined {
    const uri = vscode.window.activeTextEditor?.document.uri;
    const folder = uri && vscode.workspace.getWorkspaceFolder(uri);
    if (folder && this.byRoot.has(folder.uri.fsPath)) return folder.uri.fsPath;
    return this.byRoot.keys().next().value;
  }

  activeStorage(): NoteStorage | undefined {
    const root = this.activeRoot();
    return root ? this.byRoot.get(root) : undefined;
  }

  getAll(): RootedNote[] {
    return [...this.byRoot].flatMap(([root, storage]) =>
      storage.getAll().map((n) => ({ ...n, root }))
    );
  }

  find(id: string): RootedNote | undefined {
    return this.getAll().find((n) => n.id === id);
  }

  deleteNote(id: string): boolean {
    return [...this.byRoot.values()].some((s) => s.deleteNote(id));
  }

  updateNote(id: string, comment: string, tags?: string[]): boolean {
    return [...this.byRoot.values()].some((s) => s.updateNote(id, comment, tags));
  }

  setDone(id: string, done: boolean): boolean {
    return [...this.byRoot.values()].some((s) => s.setDone(id, done));
  }

  relink(id: string, line: number, lineText: string): boolean {
    return [...this.byRoot.values()].some((s) => s.relink(id, line, lineText));
  }

  staleIds(): Set<string> {
    const stale = new Set<string>();
    const linesByPath = new Map<string, string[] | undefined>();

    const openDocuments = new Map(
      vscode.workspace.textDocuments
        .filter((doc) => doc.uri.scheme === 'file')
        .map((doc) => [doc.uri.fsPath, doc])
    );

    for (const note of this.getAll()) {
      const absolutePath = path.join(note.root, note.file);

      if (!linesByPath.has(absolutePath)) {
        linesByPath.set(absolutePath, readLines(absolutePath, openDocuments));
      }

      if (isStale(linesByPath.get(absolutePath), note)) stale.add(note.id);
    }

    return stale;
  }

  label(root: string): string {
    return this.multiRoot ? `${path.basename(root)}/` : '';
  }

  exportForAI(scope?: string, filter?: NoteFilter): string {
    const notes = [...this.byRoot].flatMap(([root, storage]) =>
      filterNotes(storage.getAll(), scope, filter).map((n) => ({
        ...n,
        file: `${this.label(root)}${n.file}`,
      }))
    );
    return renderExport(notes);
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
    this._onDidChange.dispose();
  }
}
