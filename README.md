# Huginn

**Private per-line notes that never touch your source code, plus one-click project setup.**

A VS Code extension in three parts, sharing one panel:

1. **Notes** — annotate any line with private context that stays out of the repository and exports cleanly to an AI assistant.
2. **Project Setup** — detect the stack of the workspace and generate the style/lint config files it needs.
3. **Clean AI marks** — find and remove the invisible characters and provenance metadata that pasted AI output leaves in the repo.

---

## 1. Notes

Annotate any line of code with private comments that:

- **Never live in the source** — they are stored in `.vscode/huginn-notes.json`
- **Stay out of git** — the file is added to `.gitignore` automatically
- **Keep full context** — file, line, commit and branch at the time the note was written
- **Follow the code** — they move with it as you edit, and say so when it is gone
- **Are readable by AI** — structured Markdown export for Claude or any other LLM, or a direct question to the Claude API

### Notes that follow the code

A note is written against a line, and lines move. Huginn tracks them on three fronts:

- **While you type** — every edit shifts the notes below it by the lines it added or removed.
- **On open and on save** — each note stores the text of its line as an anchor and is re-attached to wherever that text ended up, which covers the changes made outside the editor: a `git checkout`, a rebase, a codemod.
- **On rename** — moving a file or a folder rewrites the paths of its notes.

Notes written before version 1.1 have no anchor; each adopts its current line the first time its file is opened.

### Stale notes

When the annotated code is gone for good — the line deleted, the file removed — the note is flagged rather than left pointing at whatever moved into its place:

- `⚠ stale` on the card in the panel, a counter in the header and a **Stale** entry in the status filter
- `⚠` instead of `📝` in the inline preview, with the reason in the gutter hover
- the `⤿` button on the card re-anchors the note: put the cursor where the code went, click it

Editing an annotated line does not make its note stale — a rewritten line is recognised as the same line.

### Resolved notes

Each note has a checkbox. A resolved note stays in the file and in the panel, struck through, but drops out of the status-bar count and out of the AI export — an assistant reading solved problems as open context is worse than no context. Export **Open notes + resolved ones** to include them.

### Multi-root workspaces

Each workspace folder keeps its own `.vscode/huginn-notes.json`, so notes travel with the repository they annotate. The panel, the status-bar count and the AI export cover every folder at once and prefix each path with its folder name, so two files called `src/index.ts` never merge into one. Folders added or closed mid-session are picked up without a reload. Two commands need a single folder and use the one holding the active editor: **Project Setup** (which writes config files) and the commit-range filter (which asks one git repository).

### Pull-request style review boxes

Every annotated line gets a native review box rendered under the code through the VS Code Comments API: exact date, git branch and short commit. Long Markdown notes stay readable, and the line itself stays clean — no collision with the GitLens blame annotation.

The boxes are writable, so notes go in where they are read: hover the gutter of any line for the `+`, or reply to an existing box to add a second note on the same line. Each note in a box carries a ✓ to resolve it and a 🗑 to delete it.

### Importing the TODOs already in the code

`Huginn: Import TODO / FIXME comments as notes` scans the workspace for `TODO`, `FIXME`, `HACK` and `XXX` comments, shows them all in one list to pick from, and imports the chosen ones as notes tagged with their keyword. It then offers to cut the comments out of the source, which is the whole point: the context stays next to the code without living in it.

Only single-line comments are recognised (`//`, `#`, `/* … */` on one line, `<!-- … -->`, `--`). Edited files are left unsaved so the removals can be reviewed before they are committed to disk.

### Gutter and inline hints

A gutter icon marks annotated lines, and a faded inline preview shows the first 60 characters of the note. Both can be turned off in settings.

---

## 2. Project Setup

The **Project Setup** tab of the Huginn panel detects the workspace stack and offers to generate the style and lint configuration, plus the commands that install the tooling.

| Recipe | Generates | Runs | Shown when |
|---|---|---|---|
| `.editorconfig` | `.editorconfig` | — | always |
| GitHub Actions | `.github/workflows/lint.yml` | — | any tool detected |
| Laravel Pint | `pint.json` | `composer require laravel/pint --dev` | PHP or Laravel |
| Larastan | `phpstan.neon` | `composer require larastan/larastan --dev` | Laravel |
| Ruff | `[tool.ruff]` block in `pyproject.toml` | — | Python |
| Prettier | `.prettierrc.json` | `npm i -D prettier` | Node |
| ESLint | `eslint.config.js` | `npm i -D eslint eslint-config-prettier @eslint/js` (+ `eslint-plugin-vue`) | Node |
| Lefthook | `lefthook.yml` | `npm i -D lefthook` / `composer require --dev lefthook` / `pip install lefthook`, then `lefthook install` | any tool detected |
| AI instructions | `CLAUDE.md`, `AGENTS.md`, `.cursor/rules/project.mdc`, `.github/copilot-instructions.md`, `GEMINI.md`, `.windsurf/rules/project.md` | — | always |

**Detection**: Laravel (`artisan` or `laravel/framework` in `composer.json`), PHP (`composer.json` or a root `.php` file), Python (`pyproject.toml`, `requirements.txt`, `setup.py` or a root `.py` file), Node (`package.json`), Vue and React Native (dependencies in `package.json`).

**Existing files**:
- Flagged with ⚠ and **unchecked** by default. Applying them asks for modal confirmation before overwriting.
- `pyproject.toml` is the one special case: if it exists, the `[tool.ruff]` block is **appended at the end** and the rest is left untouched; if it already declares `[tool.ruff]`, the recipe is disabled.

**AI instructions**: one checkbox per assistant, all writing the same generated rules — `CLAUDE.md` (Claude Code), `AGENTS.md` (Codex, Cursor, Zed, Jules), `.cursor/rules/project.mdc` (Cursor, with `alwaysApply: true`), `.github/copilot-instructions.md` (Copilot), `GEMINI.md` (Gemini CLI) and `.windsurf/rules/project.md` (Windsurf). Only `CLAUDE.md` is checked by default; tick whichever others your team actually uses.

**Lefthook**: the generated `pre-commit` hook runs in parallel and only lists the tools that were detected — Pint, Ruff, Prettier, ESLint — over the staged files, restaging whatever they fix. Larastan ships commented out: a full `phpstan analyse` on every commit is slow enough that people uninstall the hook instead of waiting for it.

**GitHub Actions**: the same tools on the CI side, in check mode (`pint --test`, `ruff format --check`, `prettier --check`, `eslint`) — the hook can be skipped with `--no-verify`, the workflow cannot. Unchecked by default: a workflow file starts running on the next push, and a repository that was never linted goes red on the first one.

Install commands run in an integrated terminal named `Huginn`, one per line, so the output is visible and the run can be cancelled.

---

## 3. Clean AI marks

Pasting model output into a repository brings characters nobody sees and metadata nobody reads: zero-width spaces that break a `grep`, bidi overrides that make a line render differently from how it executes, no-break spaces that turn into mystery diffs, `generator: Claude` sitting in a frontmatter block, EXIF and Content Credentials riding along in a screenshot.

The third tab scans and lists what it finds, per file. The path box above the button limits the scan — leave it empty for the whole workspace, or type a folder (`src/`, `resources/views`) or a glob (`app/**/*.php`). While a scan runs the button turns into **Stop**; stopping keeps everything found up to that point.

| Layer | What it looks for | Where |
|-------|-------------------|-------|
| Invisible Unicode | Zero-width family, bidi overrides, variation selectors, tag characters, other format characters | Every text file |
| Space homoglyphs | No-break, en/em, thin, ideographic spaces → `U+0020` | Every text file |
| Frontmatter | `generator`, `ai_generated`, `provenance`, `model`… and their nested blocks | `.md`, `.markdown`, `.mdx` |
| HTML metadata | AI `<meta>` tags, provenance JSON-LD, `data-ai*` attributes | `.html`, `.htm` |
| SVG metadata | `<metadata>`, XMP packets, generator attributes, provenance comments | `.svg` |
| Image metadata | PNG `tEXt`/`zTXt`/`iTXt`/`eXIf`/C2PA chunks, JPEG `APP1`–`APP15`, `APP11` JUMBF, `COM` | `.png`, `.jpg`, `.jpeg` |

Each finding is graded **confirmed** (a parsed provenance field or a C2PA container), **probable** (an AI marker inside a real metadata structure) or **informational** (context, such as a WordPress `generator` tag — which is left alone). Files with a confirmed or probable finding are pre-ticked; the rest are yours to pick.

**Cleaning never surprises you.** Text files are edited in the editor and left **unsaved**, so the diff is there to read before anything hits disk. Images are never rewritten in place: a stripped copy is written next to the original as `name.cleaned.png`.

What is deliberately preserved: emoji sequences (`❤️‍🔥`), flag tag characters (`🏴󠁧󠁢󠁳󠁣󠁴󠁿`), the joiners that Persian, Devanagari and other complex scripts need, and Arabic/Syriac orthographic marks. They are invisible too, and stripping them changes what the text says.

A checkbox at the bottom of the tab, **on by default**, keeps VS Code's own `editor.unicodeHighlight.invisibleCharacters` and `.ambiguousCharacters` on for the workspace, so a pasted carrier is flagged as it lands instead of only when you remember to scan.

**The editor warning and an empty scan can both be right.** VS Code flags anything it considers unusual; Huginn lists only what it can clean, and it keeps emoji sequences, script joiners and flag tag characters on purpose. A `—`, a `→` or a `🔥` is not an AI mark. If your workspace also has `editor.unicodeHighlight.nonBasicASCII` set — Huginn 1.2.0 wrote it, wrongly — every non-ASCII character in the file lights up; the tab offers a button to clear it.

Out of scope, on purpose: statistical token-sampling watermarks (removing those means rewriting the prose), pixel-domain watermarks such as SynthID, C2PA soft binding, and DOCX/ODT/PDF metadata.

---

## Install

### From the VSIX

```bash
npm install
npm run typecheck && npm test
npx @vscode/vsce package
code --install-extension huginn-1.1.0.vsix
```

*If `npx` fails, install the tool globally with `npm install -g @vscode/vsce` and run `vsce package`.*

Alternatively, in the **Extensions** view (`Ctrl+Shift+X`) open the `...` menu → **Install from VSIX...** and pick the generated file.

---

## Usage

### Keyboard shortcuts

| Action | Windows/Linux | Mac |
|--------|--------------|-----|
| Add note on current line | `Ctrl+Shift+N` | `Cmd+Shift+N` |
| Open the Huginn panel | `Ctrl+Shift+M` | `Cmd+Shift+M` |
| Next note in this file | `Ctrl+Alt+N` | `Cmd+Alt+N` |
| Previous note in this file | `Ctrl+Alt+P` | `Cmd+Alt+P` |

Both jumps wrap around and print the note in the status bar.

### Editor context menu (right click)

- **Huginn: Add note to current line**
- **Huginn: Open panel**
- **Huginn: Export AI context to file**
- **Huginn: Ask Claude about my notes**
- **Huginn: Project Setup**
- **Huginn: Import TODO / FIXME comments as notes**
- **Huginn: Clean AI marks in this file**

### Command Palette (`Ctrl+Shift+P`)

- `Huginn: Add note to current line`
- `Huginn: Delete note`
- `Huginn: Go to next note in this file` / `Huginn: Go to previous note in this file`
- `Huginn: Import TODO / FIXME comments as notes`
- `Huginn: Open panel`
- `Huginn: Export AI context to file` → writes `.vscode/huginn-ai-context.md`
- `Huginn: Copy AI context to clipboard`
- `Huginn: Ask Claude about my notes` → sends the notes to the Claude API and opens the answer
- `Huginn: Forget Claude API key` → removes the key from the OS keychain
- `Huginn: Project Setup`
- `Huginn: Clean AI marks` → opens the panel on the scan tab
- `Huginn: Clean AI marks in this file` → cleans the active editor, leaving it unsaved

### The panel

One webview with three tabs — **Notes**, **Project Setup** and **Clean AI marks**. The status bar item (`📝 3 notes`, open notes only) opens it. The Notes tab groups notes by file and filters them by free text (note, tags, path), month, year, tag and status (open, resolved, stale), all combined with AND. Click a line badge to jump to the code; click the note text to edit it in place.

---

## Note format (`.vscode/huginn-notes.json`, one per workspace folder)

```json
{
  "version": 1,
  "notes": [
    {
      "id": "uuid-...",
      "file": "src/controllers/auth.ts",
      "line": 87,
      "commit": "a3f9c12",
      "branch": "feature/oauth",
      "comment": "Temporary workaround: the client uses legacy OAuth 1.0, replace in sprint 4",
      "createdAt": "2026-03-10T10:30:00.000Z",
      "updatedAt": "2026-03-10T10:30:00.000Z",
      "tags": ["workaround", "refactor"],
      "anchor": "const client = new LegacyOAuthClient(config);",
      "done": false
    }
  ]
}
```

`anchor` is the text of the annotated line, capped at 300 characters — it is how a note finds its code again after the file changes. `done` marks a resolved note. Both are optional; a file written by version 1.0 loads unchanged.

---

## Using the notes with an AI assistant

### Option 1 — clipboard (fastest)
1. `Ctrl+Shift+P` → `Huginn: Copy AI context to clipboard`
2. Paste it into Claude: *"Here are my dev notes, keep them in mind:"*

### Option 2 — exported file
1. `Ctrl+Shift+P` → `Huginn: Export AI context to file`
2. Optionally filter by path, then pick a range: open notes, open plus resolved, a date range, or a commit range
3. `.vscode/huginn-ai-context.md` is generated and opened
4. Attach it to the conversation

Resolved notes are left out of every range except **Open notes + resolved ones**.

The date range takes `2026-01-01..2026-03-31`, and either side may be left empty (`..2026-03-31`). Both ends are inclusive. The commit range is handed to `git rev-list`, so anything git understands works: `main..HEAD`, `v1.0.0..HEAD`, `abc1234..def5678`.

### Option 3 — ask Claude directly (no copy/paste)
1. `Ctrl+Shift+P` → `Huginn: Ask Claude about my notes`
2. Pick a range (all notes, a date range or a commit range), then type the question
3. The first run asks for an Anthropic API key and stores it in the **OS keychain** (VS Code SecretStorage) — never in `settings.json`
4. The answer opens as an untitled Markdown document

The notes go in the system prompt behind a cache breakpoint and the question in the user turn, so asking several questions about the same notes re-reads the cached prefix instead of paying for it again. Requests run on `claude-opus-5`, streamed, with `fallbacks: "default"` enabled so a request declined by a safety classifier is re-served by Anthropic's recommended fallback model instead of failing. A rejected key is dropped from the keychain so the next run can enter another; use `Huginn: Forget Claude API key` to rotate one that still works.

### Local models (Ollama, LM Studio, …)
The exported file is plain Markdown. Feed it as a system prompt or as extra context.

**Important**: the export never contains source code — only metadata and your own comments.

---

## Settings

```json
// settings.json
{
  "huginn.showGutterIcons": true,     // gutter icon on annotated lines
  "huginn.showInlinePreview": true,   // faded inline preview
  "huginn.autoGitignore": true        // auto-add huginn-notes.json to .gitignore
}
```

---

## Privacy

- `.vscode/huginn-notes.json` → gitignored automatically, one per workspace folder
- `.vscode/huginn-ai-context.md` → add it to `.gitignore` yourself if you keep it around
- Source code is **never** stored — only line numbers and your comments
- The Anthropic API key lives in the OS keychain, never in a settings or project file
- `Ask Claude about my notes` is the one command that leaves your machine: it sends the same metadata-and-comments Markdown as the export — no source code — to the Anthropic API. Everything else is local.
- `Clean AI marks` reads and writes files locally and sends nothing anywhere: the scan and every cleaning layer run inside the extension, with no network call and no external tool.
- Safe to use in client repositories

---

## Development

```bash
npm install
npm run typecheck
npm test
npm run bundle
```

`typecheck` is `tsc --noEmit`, `test` runs the node self-checks under `test/` (no framework), `bundle` produces `out/extension.js` with esbuild.

**There are no comments in this codebase.** That is the argument the extension makes, so it holds itself to it: names and structure carry the *what*, and the *why* — the reasoning, the rejected alternatives, the traps — lives in Huginn notes instead of in the source everybody has to read. If a line here needs an explanation, either the name is wrong or the explanation belongs in a note.

Press `F5` in VS Code to launch an Extension Development Host with the extension loaded.

---

## License

MIT © [13Node](https://13node.com)
