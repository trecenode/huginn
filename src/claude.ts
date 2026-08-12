import * as vscode from 'vscode';
import Anthropic from '@anthropic-ai/sdk';
import { NoteFilter, NoteStorageRegistry } from './storage';

const SECRET_KEY = 'huginn.anthropicApiKey';
const MODEL = 'claude-opus-5';

const SYSTEM_PROMPT = `You answer questions about a codebase using the developer's own private
annotations, which are given to you as Markdown. Each note records a file, a line, the git commit
and branch it was written on, and the developer's comment.

You do not have the source code — only the notes. Answer from them, cite the file and line you are
relying on, and say plainly when the notes do not cover the question instead of guessing.`;

export async function askClaude(
  storages: NoteStorageRegistry,
  secrets: vscode.SecretStorage,
  filter?: NoteFilter
): Promise<void> {
  const context = storages.exportForAI(undefined, filter);
  if (context.startsWith('# Huginn – No notes')) {
    vscode.window.showWarningMessage('Huginn: no notes to send. Add one with Ctrl+Shift+N first.');
    return;
  }

  const question = await vscode.window.showInputBox({
    prompt: 'Ask Claude about your notes',
    placeHolder: 'What did I decide about the Stripe workaround?',
    ignoreFocusOut: true,
  });
  if (!question?.trim()) return;

  const apiKey = await getApiKey(secrets);
  if (!apiKey) return;

  const answer = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Huginn: asking Claude…' },
    () => request(apiKey, context, question.trim(), secrets)
  );
  if (!answer) return;

  const doc = await vscode.workspace.openTextDocument({
    language: 'markdown',
    content: `# ${question.trim()}\n\n${answer}\n`,
  });
  vscode.window.showTextDocument(doc);
}

async function request(
  apiKey: string,
  context: string,
  question: string,
  secrets: vscode.SecretStorage
): Promise<string | undefined> {
  const client = new Anthropic({ apiKey });

  try {
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 32000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: [
        { type: 'text', text: SYSTEM_PROMPT },
        { type: 'text', text: context, cache_control: { type: 'ephemeral' } },
      ],
      messages: [{ role: 'user', content: question }],
    });

    const message = await stream.finalMessage();

    if (message.stop_reason === 'refusal') {
      vscode.window.showWarningMessage(
        `Huginn: Claude declined to answer this one${
          message.stop_details?.explanation ? ` — ${message.stop_details.explanation}` : '.'
        }`
      );
      return undefined;
    }

    const text = message.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n');

    return text || 'Claude returned an empty answer.';
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) {
      await secrets.delete(SECRET_KEY);
      vscode.window.showErrorMessage('Huginn: that API key was rejected. Run the command again to enter another.');
    } else if (e instanceof Anthropic.RateLimitError) {
      vscode.window.showErrorMessage('Huginn: Claude API rate limit reached. Try again in a moment.');
    } else if (e instanceof Anthropic.APIError) {
      vscode.window.showErrorMessage(`Huginn: Claude API error (${e.status ?? 'network'}): ${e.message}`);
    } else {
      vscode.window.showErrorMessage(`Huginn: ${e instanceof Error ? e.message : String(e)}`);
    }
    return undefined;
  }
}

async function getApiKey(secrets: vscode.SecretStorage): Promise<string | undefined> {
  const stored = await secrets.get(SECRET_KEY);
  if (stored) return stored;

  const entered = await vscode.window.showInputBox({
    prompt: 'Anthropic API key (stored in the OS keychain, never in settings.json)',
    placeHolder: 'sk-ant-...',
    password: true,
    ignoreFocusOut: true,
  });
  if (!entered?.trim()) return undefined;

  await secrets.store(SECRET_KEY, entered.trim());
  return entered.trim();
}

export async function forgetApiKey(secrets: vscode.SecretStorage): Promise<void> {
  await secrets.delete(SECRET_KEY);
  vscode.window.showInformationMessage('Huginn: Claude API key removed from the keychain.');
}
