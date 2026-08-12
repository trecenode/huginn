import * as vscode from 'vscode';
import { Recipe, Stack, applyRecipes, buildRecipes, detectStack } from './recipes';

const TERMINAL_NAME = 'Huginn';

export const setupStyles = `
  .setup-stack { color: var(--muted); margin-bottom: 16px; }
  .setup-chip {
    display: inline-block;
    background: var(--tag-bg);
    color: var(--tag-fg);
    border-radius: 3px;
    padding: 0 .45rem;
    margin-right: .3rem;
    font-size: 11px;
  }
  .setup-row {
    display: flex;
    gap: .75rem;
    align-items: flex-start;
    padding: .75rem 0;
    border-top: 1px solid var(--border);
  }
  .setup-row.done { opacity: .55; }
  .setup-row input { margin-top: .3rem; }
  .setup-label { font-weight: 600; }
  .setup-hint, .setup-files { color: var(--muted); font-size: 12px; }
  .setup-files code {
    font-family: var(--vscode-editor-font-family, monospace);
    background: var(--vscode-textCodeBlock-background);
    padding: .05rem .3rem;
    border-radius: 3px;
  }
  .setup-badge { font-size: 11px; margin-left: .5rem; }
  .setup-badge.exists { color: var(--vscode-editorWarning-foreground); }
  .setup-badge.configured { color: var(--muted); }
  .setup-actions {
    margin-top: 20px;
    padding-top: 14px;
    border-top: 1px solid var(--border);
  }
  .setup-actions button {
    background: var(--btn-bg);
    color: var(--btn-fg);
    border: none;
    padding: .45rem 1.1rem;
    border-radius: 3px;
    cursor: pointer;
    font-family: inherit;
    font-size: 12px;
  }
  .setup-actions button.secondary {
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--border);
    margin-left: .5rem;
  }
`;

export function renderSetup(root: string): string {
  const stack = detectStack(root);
  const recipes = buildRecipes(root, stack);

  const detected = Object.entries(stack)
    .filter(([, v]) => v)
    .map(([k]) => STACK_LABELS[k] ?? k);

  return `
  <div class="setup-stack">
    ${detected.length
      ? detected.map((d) => `<span class="setup-chip">${escapeHtml(d)}</span>`).join('')
      : 'No stack detected — generic recipes only.'}
  </div>

  ${recipes.map(renderRow).join('\n')}

  <div class="setup-actions">
    <button onclick="applySetup()">Apply selected</button>
    <button class="secondary" onclick="refreshPanel()">Reload</button>
  </div>`;
}

export async function applySetup(root: string, ids: string[]): Promise<void> {
  const stack = detectStack(root);
  const selected = buildRecipes(root, stack).filter(
    (r) => ids.includes(r.id) && r.status !== 'configured'
  );
  if (selected.length === 0) return;

  const overwrites = selected
    .filter((r) => r.status === 'exists')
    .flatMap((r) => r.files.map((f) => f.path));

  if (overwrites.length > 0) {
    const confirm = await vscode.window.showWarningMessage(
      `${overwrites.length} existing file(s) will be overwritten:\n\n${overwrites.join('\n')}`,
      { modal: true },
      'Overwrite'
    );
    if (confirm !== 'Overwrite') return;
  }

  const result = applyRecipes(root, selected);

  const commands = selected.flatMap((r) => r.commands);
  if (commands.length > 0) {
    const terminal =
      vscode.window.terminals.find((t) => t.name === TERMINAL_NAME) ??
      vscode.window.createTerminal({ name: TERMINAL_NAME, cwd: root });
    terminal.show();
    for (const cmd of commands) terminal.sendText(cmd);
  }

  if (result.failed.length > 0) {
    vscode.window.showErrorMessage(
      `Huginn: could not write ${result.failed.map((f) => f.path).join(', ')} · ${result.failed[0].error}`
    );
    return;
  }

  const parts = [`${result.written.length} file(s) written`];
  if (commands.length > 0) parts.push(`${commands.length} command(s) launched in the terminal`);
  vscode.window.showInformationMessage(`✓ Huginn Setup: ${parts.join(' · ')}.`);
}

function renderRow(r: Recipe): string {
  const configured = r.status === 'configured';
  const exists = r.status === 'exists';

  const badge = configured
    ? '<span class="setup-badge configured">already configured</span>'
    : exists
      ? '<span class="setup-badge exists">⚠ exists — will overwrite</span>'
      : '';

  const files = r.files
    .map((f) => `<code>${escapeHtml(f.path)}</code>${f.mode === 'append' ? ' (appended at the end)' : ''}`)
    .join(' · ');
  const commands = r.commands.map((c) => `<code>${escapeHtml(c)}</code>`).join(' · ');

  return `<div class="setup-row${configured ? ' done' : ''}">
      <input type="checkbox" data-id="${escapeHtml(r.id)}"${r.status === 'pending' && !r.optIn ? ' checked' : ''}${configured ? ' disabled' : ''}>
      <div>
        <div class="setup-label">${escapeHtml(r.label)}${badge}</div>
        <div class="setup-hint">${escapeHtml(r.hint)}</div>
        <div class="setup-files">${files}${commands ? ` · ${commands}` : ''}</div>
      </div>
    </div>`;
}

const STACK_LABELS: Record<string, string> = {
  laravel: 'Laravel',
  php: 'PHP',
  python: 'Python',
  node: 'Node',
  vue: 'Vue',
  reactNative: 'React Native',
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
