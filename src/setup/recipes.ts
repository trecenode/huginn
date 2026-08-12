import * as fs from 'fs';
import * as path from 'path';

export interface Stack {
  laravel: boolean;
  php: boolean;
  python: boolean;
  node: boolean;
  vue: boolean;
  reactNative: boolean;
}

export type RecipeStatus = 'pending' | 'exists' | 'configured';

export interface RecipeFile {
  path: string;
  content: string;
  mode: 'write' | 'append';
}

export interface Recipe {
  id: string;
  label: string;
  hint: string;
  files: RecipeFile[];
  commands: string[];
  status: RecipeStatus;
  optIn?: boolean;
}

function readJson(file: string): any {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

function hasRootFileWithExt(root: string, ext: string): boolean {
  try {
    return fs.readdirSync(root).some((f) => f.toLowerCase().endsWith(ext));
  } catch {
    return false;
  }
}

export function detectStack(root: string): Stack {
  const has = (rel: string) => fs.existsSync(path.join(root, rel));

  const composer = has('composer.json') ? readJson(path.join(root, 'composer.json')) : undefined;
  const composerDeps = {
    ...(composer?.require ?? {}),
    ...(composer?.['require-dev'] ?? {}),
  };

  const pkg = has('package.json') ? readJson(path.join(root, 'package.json')) : undefined;
  const npmDeps = {
    ...(pkg?.dependencies ?? {}),
    ...(pkg?.devDependencies ?? {}),
  };

  const php = has('composer.json') || hasRootFileWithExt(root, '.php');

  return {
    laravel: has('artisan') || 'laravel/framework' in composerDeps,
    php,
    python:
      has('pyproject.toml') ||
      has('requirements.txt') ||
      has('setup.py') ||
      hasRootFileWithExt(root, '.py'),
    node: !!pkg,
    vue: 'vue' in npmDeps,
    reactNative: 'react-native' in npmDeps,
  };
}

const EDITORCONFIG = `root = true

[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true
trim_trailing_whitespace = true
indent_style = space
indent_size = 2

[*.{php,py}]
indent_size = 4
`;

const PINT_JSON = `${JSON.stringify(
  {
    preset: 'laravel',
    rules: {
      single_quote: true,
      concat_space: { spacing: 'one' },
      ordered_imports: { sort_algorithm: 'alpha' },
      no_unused_imports: true,
      not_operator_with_successor_space: true,
    },
  },
  null,
  2
)}\n`;

const PHPSTAN_NEON = `includes:
    - vendor/larastan/larastan/extension.neon

parameters:
    paths:
        - app

    level: 5
`;

const RUFF_TOML = `[tool.ruff]
line-length = 100
target-version = 'py312'

[tool.ruff.lint]
select = ['E', 'F', 'I', 'N', 'UP', 'B', 'SIM']

[tool.ruff.format]
quote-style = 'single'
`;

const PRETTIERRC = `${JSON.stringify(
  {
    semi: true,
    singleQuote: true,
    printWidth: 100,
    tabWidth: 2,
    trailingComma: 'es5',
  },
  null,
  2
)}\n`;

function eslintConfig(vue: boolean): string {
  if (vue) {
    return `import js from '@eslint/js';
import vue from 'eslint-plugin-vue';
import prettier from 'eslint-config-prettier';

export default [
  js.configs.recommended,
  ...vue.configs['flat/recommended'],
  prettier,
  {
    rules: {
      'no-unused-vars': 'warn',
      'vue/multi-word-component-names': 'off'
    }
  }
];
`;
  }
  return `import js from '@eslint/js';
import prettier from 'eslint-config-prettier';

export default [
  js.configs.recommended,
  prettier,
  {
    rules: {
      'no-unused-vars': 'warn'
    }
  }
];
`;
}

function lefthookYml(stack: Stack): string {
  let yml = `pre-commit:
  parallel: true
  commands:
`;

  if (stack.php || stack.laravel) {
    yml += `    pint:
      glob: '*.php'
      run: vendor/bin/pint {staged_files}
      stage_fixed: true
`;
  }

  if (stack.laravel) {
    yml += `#    phpstan:
#      glob: '*.php'
#      run: vendor/bin/phpstan analyse --memory-limit=1G
`;
  }

  if (stack.python) {
    yml += `    ruff-lint:
      glob: '*.py'
      run: ruff check --fix {staged_files}
      stage_fixed: true
    ruff-format:
      glob: '*.py'
      run: ruff format {staged_files}
      stage_fixed: true
`;
  }

  if (stack.node) {
    yml += `    prettier:
      glob: '*.{js,ts,jsx,tsx,vue,css,scss,json,md}'
      run: npx prettier --write {staged_files}
      stage_fixed: true
    eslint:
      glob: '*.{js,ts,jsx,tsx${stack.vue ? ',vue' : ''}}'
      run: npx eslint --fix {staged_files}
      stage_fixed: true
`;
  }

  return yml;
}

function ciWorkflow(stack: Stack): string {
  let yml = `name: Lint

on:
  push:
  pull_request:

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
`;

  if (stack.php || stack.laravel) {
    yml += `
      - uses: shivammathur/setup-php@v2
        with:
          php-version: '8.3'
          coverage: none
      - run: composer install --no-interaction --prefer-dist --no-progress
      - run: vendor/bin/pint --test
`;
    if (stack.laravel) {
      yml += `      - run: vendor/bin/phpstan analyse --memory-limit=1G --no-progress
`;
    }
  }

  if (stack.python) {
    yml += `
      - uses: actions/setup-python@v5
        with:
          python-version: '3.12'
      - run: pip install ruff
      - run: ruff check .
      - run: ruff format --check .
`;
  }

  if (stack.node) {
    yml += `
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npx prettier --check .
      - run: npx eslint .
`;
  }

  return yml;
}

function lefthookCommands(stack: Stack): string[] {
  if (stack.node) return ['npm i -D lefthook', 'npx lefthook install'];
  if (stack.php || stack.laravel) {
    return ['composer require --dev lefthook', './vendor/bin/lefthook install'];
  }
  return ['pip install lefthook', 'lefthook install'];
}

function agentInstructions(stack: Stack): string {
  let md = `# Project instructions

Style rules for any code written here — yours, a teammate's or AI-generated.
The formatter only polishes what is left; code should be born this way.

## General

- No inline comments. If the code needs an explanation, the name is wrong.
- Single quotes whenever the language allows it.
- No speculative abstractions: no interface with a single implementation,
  no factory for a single product, no config for a value that never changes.
`;

  if (stack.laravel || stack.php) {
    md += `
## PHP / Laravel

- Formatting: Pint with the \`laravel\` preset plus the deviations in \`pint.json\`.
- Static analysis: Larastan (\`vendor/bin/phpstan analyse\`).
- Follow the Laravel architecture patterns already present in the project:
  do not introduce a new layer unless an equivalent case already exists.
`;
  }

  if (stack.php) {
    md += `
## WordPress / WPBakery

- Use native WPBakery \`vc_\` elements. Do not invent custom shortcodes
  when a native equivalent exists.
- Scoped, prefixed CSS classes. Never loose global styles.
- Hand-written JSON-LD, not plugin-generated.
`;
  }

  if (stack.python) {
    md += `
## Python

- Ruff handles both lint and format (\`ruff check --fix\` + \`ruff format\`).
- Single quotes, \`line-length\` 100.
`;
  }

  if (stack.node) {
    md += `
## JS / ${stack.vue ? 'Vue' : stack.reactNative ? 'React Native' : 'Frontend'}

- Prettier for formatting, ESLint for logic. \`eslint-config-prettier\` turns off the clashes.
- Single quotes, \`printWidth\` 100, \`trailingComma: es5\`.
- Scoped, prefixed CSS classes.
`;
  }

  return md;
}

const AGENT_FILES: { id: string; label: string; path: string; tool: string; prefix?: string }[] = [
  { id: 'claudemd', label: 'CLAUDE.md', path: 'CLAUDE.md', tool: 'Claude Code' },
  {
    id: 'agentsmd',
    label: 'AGENTS.md',
    path: 'AGENTS.md',
    tool: 'Codex, Cursor, Zed, Jules — the cross-tool convention',
  },
  {
    id: 'cursorrules',
    label: 'Cursor rule',
    path: '.cursor/rules/project.mdc',
    tool: 'Cursor, always applied',
    prefix: '---\nalwaysApply: true\n---\n\n',
  },
  {
    id: 'copilotmd',
    label: 'Copilot instructions',
    path: '.github/copilot-instructions.md',
    tool: 'GitHub Copilot',
  },
  { id: 'geminimd', label: 'GEMINI.md', path: 'GEMINI.md', tool: 'Gemini CLI' },
  { id: 'windsurfrules', label: 'Windsurf rules', path: '.windsurf/rules/project.md', tool: 'Windsurf' },
];

function pyprojectHasRuff(root: string): boolean {
  const file = path.join(root, 'pyproject.toml');
  if (!fs.existsSync(file)) return false;
  try {
    return /^\s*\[tool\.ruff/m.test(fs.readFileSync(file, 'utf8'));
  } catch {
    return false;
  }
}

function statusFor(root: string, files: RecipeFile[]): RecipeStatus {
  return files.some((f) => fs.existsSync(path.join(root, f.path))) ? 'exists' : 'pending';
}

function write(p: string, content: string): RecipeFile {
  return { path: p, content, mode: 'write' };
}

export function buildRecipes(root: string, stack: Stack): Recipe[] {
  const recipes: Recipe[] = [];

  const add = (r: Omit<Recipe, 'status'>, status?: RecipeStatus) =>
    recipes.push({ ...r, status: status ?? statusFor(root, r.files) });

  add({
    id: 'editorconfig',
    label: '.editorconfig',
    hint: 'Charset, line endings and indentation for any editor.',
    files: [write('.editorconfig', EDITORCONFIG)],
    commands: [],
  });

  if (stack.php || stack.laravel) {
    add({
      id: 'pint',
      label: 'Laravel Pint',
      hint: 'PHP formatter. Laravel preset plus your deviations.',
      files: [write('pint.json', PINT_JSON)],
      commands: ['composer require laravel/pint --dev'],
    });
  }

  if (stack.laravel) {
    add({
      id: 'larastan',
      label: 'Larastan',
      hint: 'Static analysis on top of PHPStan, Laravel-aware.',
      files: [write('phpstan.neon', PHPSTAN_NEON)],
      commands: ['composer require larastan/larastan --dev'],
    });
  }

  if (stack.python) {
    const exists = fs.existsSync(path.join(root, 'pyproject.toml'));
    const configured = pyprojectHasRuff(root);
    add(
      {
        id: 'ruff',
        label: 'Ruff',
        hint: configured
          ? 'pyproject.toml already has [tool.ruff].'
          : exists
            ? 'Appends the [tool.ruff] block at the end of pyproject.toml.'
            : 'Python linter + formatter in a single tool.',
        files: [
          {
            path: 'pyproject.toml',
            content: exists ? `\n${RUFF_TOML}` : RUFF_TOML,
            mode: exists ? 'append' : 'write',
          },
        ],
        commands: [],
      },
      configured ? 'configured' : 'pending'
    );
  }

  if (stack.node) {
    add({
      id: 'prettier',
      label: 'Prettier',
      hint: 'Formatting for JS/TS/Vue/CSS/JSON.',
      files: [write('.prettierrc.json', PRETTIERRC)],
      commands: ['npm i -D prettier'],
    });

    add({
      id: 'eslint',
      label: `ESLint${stack.vue ? ' + Vue plugin' : ''}`,
      hint: 'Logic linter. eslint-config-prettier turns off what clashes with Prettier.',
      files: [write('eslint.config.js', eslintConfig(stack.vue))],
      commands: [
        `npm i -D eslint eslint-config-prettier @eslint/js${stack.vue ? ' eslint-plugin-vue' : ''}`,
      ],
    });
  }

  if (stack.php || stack.laravel || stack.python || stack.node) {
    add({
      id: 'lefthook',
      label: 'Lefthook',
      hint: 'Runs the formatters above on staged files before each commit.',
      files: [write('lefthook.yml', lefthookYml(stack))],
      commands: lefthookCommands(stack),
    });
  }

  if (stack.php || stack.laravel || stack.python || stack.node) {
    add({
      id: 'ci',
      label: 'GitHub Actions — lint',
      hint: 'Runs the same formatters in CI, in check mode, so --no-verify cannot slip past them.',
      files: [write('.github/workflows/lint.yml', ciWorkflow(stack))],
      commands: [],
      optIn: true,
    });
  }

  const body = agentInstructions(stack);
  for (const agent of AGENT_FILES) {
    add({
      id: agent.id,
      label: agent.label,
      hint: `${agent.tool} — your style rules in plain language, so AI writes the way you do.`,
      files: [write(agent.path, (agent.prefix ?? '') + body)],
      commands: [],
      optIn: agent.id !== 'claudemd',
    });
  }

  return recipes;
}

export interface ApplyResult {
  written: string[];
  failed: { path: string; error: string }[];
}

export function applyRecipes(root: string, recipes: Recipe[]): ApplyResult {
  const result: ApplyResult = { written: [], failed: [] };

  for (const recipe of recipes) {
    if (recipe.status === 'configured') continue;

    for (const file of recipe.files) {
      const target = path.join(root, file.path);
      try {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        if (file.mode === 'append') {
          fs.appendFileSync(target, file.content, 'utf8');
        } else {
          fs.writeFileSync(target, file.content, 'utf8');
        }
        result.written.push(file.path);
      } catch (e: any) {
        result.failed.push({ path: file.path, error: e?.message ?? String(e) });
      }
    }
  }

  return result;
}
