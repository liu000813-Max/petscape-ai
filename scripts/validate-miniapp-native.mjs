import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const compilerDir = process.argv[2];
if (!compilerDir) throw new Error('Usage: node scripts/validate-miniapp-native.mjs <WeChat devtools wcc-exec directory>');
const root = fileURLToPath(new URL('../miniapp/', import.meta.url));
const config = JSON.parse(readFileSync(path.join(root, 'app.json'), 'utf8'));
const pages = [...config.pages, ...(config.tabBar.custom ? ['custom-tab-bar/index'] : [])];
const templates = readdirSync(path.join(root, 'templates')).map(name => 'templates/' + name);
const outputDir = mkdtempSync(path.join(tmpdir(), 'petscape-native-'));
for (const [compiler, extension, sources] of [
  ['wcc', 'wxml', pages.map((page) => page + '.wxml')],
  ['wcsc', 'wxss', ['app.wxss', ...pages.map((page) => page + '.wxss')]],
]) {
  const binary = path.join(compilerDir, compiler + (process.platform === 'win32' ? '.exe' : ''));
  const inputs = [...sources, ...templates.filter(file => file.endsWith('.' + extension))];
  const result = spawnSync(binary, ['-o', path.join(outputDir, compiler + '.js'), ...inputs], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 30000 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${extension} compiler failed (${result.status}):\n${result.stderr}\n${result.stdout}`);
  console.log(`${compiler}: compiled ${inputs.length} ${extension} files`);
  if (result.stderr.trim()) console.log(result.stderr.trim());
}
console.log(`Native compiler artifacts: ${outputDir}`);
