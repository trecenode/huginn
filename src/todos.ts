import * as vscode from 'vscode';
import { lineAfterRemoval, parseTodo, toLines } from './anchor';
import { NoteStorageRegistry } from './storage';

const INCLUDE =
  '**/*.{ts,tsx,js,jsx,mjs,cjs,vue,svelte,php,py,rb,go,rs,java,kt,cs,swift,c,h,cpp,css,scss,less,html,twig,sql,sh,yml,yaml}';
const EXCLUDE =
  '**/{node_modules,vendor,dist,build,out,bin,obj,.git,.next,.nuxt,coverage,__pycache__,storage}/**';
const MAX_FILES = 3000;

const KEEP_COMMENTS = 'Keep the comments in the source';
const REMOVE_COMMENTS = 'Remove the comments from the source';

interface Found {
  uri: vscode.Uri;
  line: number;
  keyword: string;
  text: string;
  markerStart: number;
  wholeLine: boolean;
}

export async function importTodos(storages: NoteStorageRegistry): Promise<void> {
  const found = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Huginn: scanning for TODOs…' },
    () => scan()
  );

  if (found.length === 0) {
    vscode.window.showInformationMessage('Huginn: no TODO, FIXME, HACK or XXX comment found.');
    return;
  }

  const picked = await vscode.window.showQuickPick(
    found.map((hit) => ({
      label: `${hit.keyword}: ${hit.text || '(no text)'}`,
      description: `${vscode.workspace.asRelativePath(hit.uri)}:${hit.line}`,
      picked: true,
      hit,
    })),
    {
      canPickMany: true,
      title: `${found.length} comment(s) found — pick the ones to import`,
      placeHolder: 'Every one is selected; unpick what should stay a comment',
    }
  );
  if (!picked?.length) return;

  const answer = await vscode.window.showQuickPick([KEEP_COMMENTS, REMOVE_COMMENTS], {
    title: 'The note keeps the text. What happens to the comment it came from?',
  });
  if (!answer) return;

  const remove = answer === REMOVE_COMMENTS;
  const hits = picked.map((item) => item.hit);
  if (remove && !(await removeComments(hits))) return;

  const created = await createNotes(storages, hits, remove);

  vscode.window.showInformationMessage(
    `📝 Huginn: ${created} note(s) imported.` +
      (remove ? ' The edited files are left unsaved — review them before saving.' : '')
  );
}

async function scan(): Promise<Found[]> {
  const files = await vscode.workspace.findFiles(INCLUDE, EXCLUDE, MAX_FILES);
  const found: Found[] = [];

  for (const uri of files) {
    let content: string;
    try {
      content = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
    } catch {
      continue;
    }
    if (content.includes('\0')) continue;

    toLines(content).forEach((text, index) => {
      const hit = parseTodo(text);
      if (hit) found.push({ uri, line: index + 1, ...hit });
    });
  }

  return found;
}

async function removeComments(hits: Found[]): Promise<boolean> {
  const edit = new vscode.WorkspaceEdit();

  for (const [key, fileHits] of groupByFile(hits)) {
    const uri = fileHits[0].uri;
    let document: vscode.TextDocument;
    try {
      document = await vscode.workspace.openTextDocument(uri);
    } catch {
      vscode.window.showWarningMessage(`Huginn: could not open ${key}, its comments were kept.`);
      continue;
    }

    for (const hit of fileHits) {
      const index = hit.line - 1;
      if (index >= document.lineCount) continue;
      const line = document.lineAt(index);

      if (hit.wholeLine) {
        const hasLineBelow = index + 1 < document.lineCount;
        edit.delete(
          uri,
          hasLineBelow ? new vscode.Range(index, 0, index + 1, 0) : line.rangeIncludingLineBreak
        );
      } else {
        const codeEnd = line.text.slice(0, hit.markerStart).replace(/\s+$/, '').length;
        edit.delete(uri, new vscode.Range(index, codeEnd, index, line.text.length));
      }
    }
  }

  const applied = await vscode.workspace.applyEdit(edit);
  if (!applied) {
    vscode.window.showErrorMessage('Huginn: the source could not be edited, nothing was imported.');
  }
  return applied;
}

async function createNotes(
  storages: NoteStorageRegistry,
  hits: Found[],
  commentsWereRemoved: boolean
): Promise<number> {
  let created = 0;

  for (const [, fileHits] of groupByFile(hits)) {
    const uri = fileHits[0].uri;
    const storage = storages.forUri(uri);
    if (!storage) continue;

    let document: vscode.TextDocument;
    try {
      document = await vscode.workspace.openTextDocument(uri);
    } catch {
      continue;
    }

    const ordered = [...fileHits].sort((a, b) => a.line - b.line);
    let removedBefore = 0;

    for (const hit of ordered) {
      const line = commentsWereRemoved
        ? lineAfterRemoval(hit.line, removedBefore, document.lineCount)
        : Math.min(hit.line, document.lineCount);
      if (commentsWereRemoved && hit.wholeLine) removedBefore++;

      await storage.addNote(
        uri.fsPath,
        line,
        hit.text || hit.keyword,
        [hit.keyword.toLowerCase()],
        document.lineAt(line - 1).text
      );
      created++;
    }
  }

  return created;
}

function groupByFile(hits: Found[]): Map<string, Found[]> {
  const byFile = new Map<string, Found[]>();
  for (const hit of hits) {
    const key = hit.uri.toString();
    if (!byFile.has(key)) byFile.set(key, []);
    byFile.get(key)!.push(hit);
  }
  return byFile;
}
