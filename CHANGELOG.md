# Changelog

All notable changes to Huginn are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## 1.1.0

### Added

- **Line tracking.** Notes follow their code. Every edit shifts the notes below it, every open and save re-attaches them by the text of the annotated line, and renaming a file or folder rewrites the paths. Notes written before this release adopt their current line as an anchor the first time the file is opened.
- **Stale notes.** A note whose code was deleted is flagged `⚠ stale` in the panel and in the gutter hover instead of silently pointing at whatever moved into its line. The `⤿` button re-anchors it to the cursor line, and the status filter lists the stale ones on their own.
- **Resolved notes.** A checkbox per note. Resolved notes stay in the file, drop out of the status-bar count and out of the AI export unless the export range explicitly asks for them.
- **Note navigation.** `Ctrl+Alt+N` / `Ctrl+Alt+P` walk the notes of the current file, wrapping around, with the note text shown in the status bar.
- **Notes from the review box.** Every line of a workspace file now offers the `+` in the gutter, and existing review boxes accept replies, so notes can be written without leaving the editor. Each box also carries resolve and delete buttons.
- **`Huginn: Import TODO / FIXME comments as notes`.** Scans the workspace for `TODO`, `FIXME`, `HACK` and `XXX` comments, imports the picked ones as tagged notes and optionally cuts the comments out of the source.
- **GitHub Actions recipe.** Project Setup can write `.github/workflows/lint.yml` running the same formatters as the pre-commit hook in check mode. Opt-in.

### Changed

- The status bar counts open notes only.
- The AI export range picker distinguishes open notes from open plus resolved.
- Line tracking reads the column an edit starts at, so pressing `Enter` at the start of an annotated line pushes its note down with the code instead of leaving it on the new blank line until the next save.
- Git metadata is read with `execFile` and an argument array rather than a shell string.
- The source carries no comments. The extension argues that context belongs in notes rather than in the code everyone has to read, so the codebase holds itself to it.

## 1.0.0

First public release.

### Notes

- Private per-line annotations stored in `.vscode/huginn-notes.json`, never in the source code.
- Multi-root workspaces: one store per workspace folder, so notes travel with the repository they annotate. Panel, status bar and AI export span every folder and prefix paths with the folder name; folders added or closed mid-session are picked up without a reload. Project Setup and the commit-range filter act on the folder of the active editor.
- Each note records file, line, git commit and branch at the moment it was written.
- Pull-request style review boxes rendered under the annotated line through the Comments API.
- Gutter icon and faded inline preview on annotated lines, both optional.
- Automatic `.gitignore` entry so notes never reach the repository.

### Panel

- Single webview with two tabs: **Notes** and **Project Setup**, opened from the status bar, `Ctrl+Shift+M`, the editor context menu or the Command Palette.
- Notes grouped by file, with free-text search across note, tags and path, plus month, year and tag filters.
- Inline editing, deletion, and click-to-jump to the annotated line.

### AI export

- `Huginn: Export AI context to file` writes structured Markdown to `.vscode/huginn-ai-context.md`, optionally scoped by path, by date range or by commit range (resolved with `git rev-list`).
- `Huginn: Copy AI context to clipboard` copies the same Markdown, optionally scoped to the current file.
- The export carries metadata and comments only — never source code.
- `Huginn: Ask Claude about my notes` sends the export plus a question to the Claude API (`claude-opus-5`, streamed, `fallbacks: "default"`) and opens the answer as Markdown. The notes sit behind a prompt-cache breakpoint so follow-up questions re-read the cached prefix.
- The Anthropic API key is stored in the OS keychain through VS Code SecretStorage, never in settings. A rejected key is dropped automatically; `Huginn: Forget Claude API key` removes a working one.

### Project Setup

- Stack detection for Laravel, PHP, Python, Node, Vue and React Native.
- Recipes for `.editorconfig`, Laravel Pint, Larastan, Ruff, Prettier, ESLint (with `eslint-plugin-vue` when Vue is detected), Lefthook and the AI instruction files.
- The generated instructions are offered as one checkbox per assistant — `CLAUDE.md`, `AGENTS.md`, `.cursor/rules/project.mdc` (with `alwaysApply: true`), `.github/copilot-instructions.md`, `GEMINI.md`, `.windsurf/rules/project.md` — all sharing the same body. Only `CLAUDE.md` is checked by default.
- The Lefthook recipe writes a `lefthook.yml` pre-commit hook that runs only the formatters of the detected stack, on staged files, restaging what they fix. Offered only when at least one tool was detected.
- Existing files are flagged, unchecked by default, and require modal confirmation before being overwritten.
- `pyproject.toml` is never overwritten: the `[tool.ruff]` block is appended, and the recipe is disabled when the file already declares one.
- Install commands run in a dedicated `Huginn` integrated terminal, one per line.
