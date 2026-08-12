const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const esbuild = require('esbuild');

const out = path.join(os.tmpdir(), 'huginn-recipes.test.js');
esbuild.buildSync({
  entryPoints: [path.join(__dirname, '..', 'src', 'setup', 'recipes.ts')],
  outfile: out,
  bundle: true,
  format: 'cjs',
  platform: 'node',
  external: ['vscode'],
});

const { detectStack, buildRecipes, applyRecipes } = require(out);

let dirs = 0;
function tmpProject(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `huginn-setup-${dirs++}-`));
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content, 'utf8');
  }
  return root;
}

const ids = (recipes) => recipes.map((r) => r.id);
const byId = (recipes, id) => recipes.find((r) => r.id === id);

const laravel = tmpProject({
  artisan: '#!/usr/bin/env php',
  'composer.json': JSON.stringify({ require: { 'laravel/framework': '^11.0' } }),
});
const laravelStack = detectStack(laravel);
assert.strictEqual(laravelStack.laravel, true, 'laravel detected');
assert.strictEqual(laravelStack.php, true, 'php implied by composer.json');
assert.strictEqual(laravelStack.python, false, 'no python');
assert.strictEqual(laravelStack.node, false, 'no node');

const laravelRecipes = buildRecipes(laravel, laravelStack);
assert.ok(ids(laravelRecipes).includes('pint'), 'pint offered');
assert.ok(ids(laravelRecipes).includes('larastan'), 'larastan offered');
assert.ok(!ids(laravelRecipes).includes('ruff'), 'ruff not offered without python');
assert.ok(!ids(laravelRecipes).includes('eslint'), 'eslint not offered without package.json');
assert.ok(ids(laravelRecipes).includes('editorconfig'), 'editorconfig always offered');
assert.ok(ids(laravelRecipes).includes('claudemd'), 'CLAUDE.md always offered');

const plainPhp = tmpProject({ 'composer.json': JSON.stringify({ require: {} }) });
const plainRecipes = buildRecipes(plainPhp, detectStack(plainPhp));
assert.ok(ids(plainRecipes).includes('pint'), 'pint on plain php');
assert.ok(!ids(plainRecipes).includes('larastan'), 'larastan is laravel-only');

const vueProject = tmpProject({
  'package.json': JSON.stringify({ dependencies: { vue: '^3.4.0' } }),
});
const vueStack = detectStack(vueProject);
assert.strictEqual(vueStack.vue, true, 'vue detected');
const eslint = byId(buildRecipes(vueProject, vueStack), 'eslint');
assert.ok(eslint.files[0].content.includes('eslint-plugin-vue'), 'vue plugin in config');
assert.ok(eslint.commands[0].includes('eslint-plugin-vue'), 'vue plugin installed');

const nodeOnly = tmpProject({ 'package.json': JSON.stringify({ dependencies: {} }) });
const plainEslint = byId(buildRecipes(nodeOnly, detectStack(nodeOnly)), 'eslint');
assert.ok(!plainEslint.files[0].content.includes('eslint-plugin-vue'), 'no vue plugin without vue');

const dirty = tmpProject({ '.editorconfig': 'root = true\n' });
assert.strictEqual(byId(buildRecipes(dirty, detectStack(dirty)), 'editorconfig').status, 'exists');
assert.strictEqual(byId(buildRecipes(dirty, detectStack(dirty)), 'claudemd').status, 'pending');

const configured = tmpProject({
  'pyproject.toml': '[project]\nname = "x"\n\n[tool.ruff]\nline-length = 88\n',
});
const configuredRuff = byId(buildRecipes(configured, detectStack(configured)), 'ruff');
assert.strictEqual(configuredRuff.status, 'configured', 'existing [tool.ruff] -> configured');
const beforeContent = fs.readFileSync(path.join(configured, 'pyproject.toml'), 'utf8');
applyRecipes(configured, [configuredRuff]);
assert.strictEqual(
  fs.readFileSync(path.join(configured, 'pyproject.toml'), 'utf8'),
  beforeContent,
  'configured recipe never touches the file'
);

const partial = tmpProject({ 'pyproject.toml': '[project]\nname = "keepme"\n' });
const partialRuff = byId(buildRecipes(partial, detectStack(partial)), 'ruff');
assert.strictEqual(partialRuff.status, 'pending', 'append is not a destructive overwrite');
assert.strictEqual(partialRuff.files[0].mode, 'append', 'append mode');
applyRecipes(partial, [partialRuff]);
const merged = fs.readFileSync(path.join(partial, 'pyproject.toml'), 'utf8');
assert.ok(merged.includes('name = "keepme"'), 'existing content preserved');
assert.ok(merged.includes('[tool.ruff]'), 'ruff block added');
assert.ok(merged.includes("quote-style = 'single'"), 'formatter section added');

const bare = tmpProject({ 'main.py': 'print(1)\n' });
const bareStack = detectStack(bare);
assert.strictEqual(bareStack.python, true, 'a root .py file is enough');
const bareRuff = byId(buildRecipes(bare, bareStack), 'ruff');
assert.strictEqual(bareRuff.files[0].mode, 'write', 'write mode when absent');
applyRecipes(bare, [bareRuff]);
assert.ok(
  fs.readFileSync(path.join(bare, 'pyproject.toml'), 'utf8').startsWith('[tool.ruff]'),
  'pyproject.toml created'
);

const laravelClaude = byId(buildRecipes(laravel, laravelStack), 'claudemd').files[0].content;
assert.ok(laravelClaude.includes('## PHP / Laravel'), 'laravel section present');
assert.ok(!laravelClaude.includes('## Python'), 'python section absent');
const vueClaude = byId(buildRecipes(vueProject, vueStack), 'claudemd').files[0].content;
assert.ok(vueClaude.includes('## JS / Vue'), 'vue section present');
assert.ok(!vueClaude.includes('## PHP'), 'php section absent');

const empty = tmpProject({});
assert.deepStrictEqual(
  ids(buildRecipes(empty, detectStack(empty))),
  ['editorconfig', 'claudemd', 'agentsmd', 'cursorrules', 'copilotmd', 'geminimd', 'windsurfrules'],
  'no stack -> generic only'
);

assert.ok(!ids(buildRecipes(empty, detectStack(empty))).includes('lefthook'), 'no tools -> no hook');

const laravelHook = byId(buildRecipes(laravel, laravelStack), 'lefthook');
assert.strictEqual(laravelHook.files[0].path, 'lefthook.yml');
assert.ok(laravelHook.files[0].content.includes('vendor/bin/pint {staged_files}'), 'pint staged');
assert.ok(laravelHook.files[0].content.includes('#    phpstan:'), 'phpstan left commented out');
assert.ok(!laravelHook.files[0].content.includes('ruff'), 'no python commands');
assert.ok(laravelHook.commands[0].startsWith('composer require'), 'composer on a php-only stack');

const vueHook = byId(buildRecipes(vueProject, vueStack), 'lefthook');
assert.ok(vueHook.files[0].content.includes('npx eslint --fix'), 'eslint hooked');
assert.ok(vueHook.files[0].content.includes(',vue}'), 'vue files linted');
assert.ok(!vueHook.files[0].content.includes('pint'), 'no php commands');
assert.ok(vueHook.commands[0].startsWith('npm i -D'), 'npm when package.json exists');

const hookDirty = tmpProject({ 'package.json': '{}', 'lefthook.yml': 'pre-commit:\n' });
assert.strictEqual(
  byId(buildRecipes(hookDirty, detectStack(hookDirty)), 'lefthook').status,
  'exists',
  'existing lefthook.yml is flagged before overwriting'
);

const agentIds = ['claudemd', 'agentsmd', 'cursorrules', 'copilotmd', 'geminimd', 'windsurfrules'];
const laravelAll = buildRecipes(laravel, laravelStack);
const body = byId(laravelAll, 'claudemd').files[0].content;
assert.ok(!byId(laravelAll, 'claudemd').optIn, 'CLAUDE.md checked by default');
for (const id of agentIds.slice(1)) {
  const recipe = byId(laravelAll, id);
  assert.strictEqual(recipe.optIn, true, `${id} is opt-in`);
  assert.ok(recipe.files[0].content.endsWith(body), `${id} carries the same rules`);
}
const cursor = byId(laravelAll, 'cursorrules');
assert.ok(
  cursor.files[0].content.startsWith('---\nalwaysApply: true\n---'),
  'cursor rule applies without being asked for'
);

const nested = tmpProject({});
applyRecipes(nested, buildRecipes(nested, detectStack(nested)).filter((r) => r.id !== 'editorconfig'));
for (const rel of ['CLAUDE.md', '.cursor/rules/project.mdc', '.github/copilot-instructions.md']) {
  assert.ok(fs.existsSync(path.join(nested, rel)), `${rel} written`);
}

assert.ok(!ids(buildRecipes(empty, detectStack(empty))).includes('ci'), 'no tools -> no workflow');

const laravelCi = byId(buildRecipes(laravel, laravelStack), 'ci');
assert.strictEqual(laravelCi.optIn, true, 'CI is opt-in');
assert.strictEqual(laravelCi.files[0].path, '.github/workflows/lint.yml');
assert.ok(laravelCi.files[0].content.includes('vendor/bin/pint --test'), 'pint checks, never fixes');
assert.ok(laravelCi.files[0].content.includes('phpstan analyse'), 'larastan runs in CI');
assert.ok(!laravelCi.files[0].content.includes('setup-node'), 'no node steps on a php project');

const vueCi = byId(buildRecipes(vueProject, vueStack), 'ci');
assert.ok(vueCi.files[0].content.includes('npx prettier --check .'), 'prettier checks, never writes');
assert.ok(vueCi.files[0].content.includes('npx eslint .'), 'eslint runs in CI');
assert.ok(!vueCi.files[0].content.includes('setup-php'), 'no php steps on a node project');

const pyCi = byId(buildRecipes(bare, bareStack), 'ci');
assert.ok(pyCi.files[0].content.includes('ruff format --check .'), 'ruff checks, never rewrites');

console.log('setup: ok');
