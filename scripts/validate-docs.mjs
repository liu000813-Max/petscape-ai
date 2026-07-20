import { execFile } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const root = process.cwd();
const { stdout } = await execFileAsync('git', ['ls-files', '-z', '*.md'], { cwd: root, encoding: 'utf8' });
const files = stdout.split('\0').filter(Boolean).filter((file) => !file.startsWith('archive/'));
const failures = [];

function normalizeTarget(raw) {
  const trimmed = raw.trim();
  const unwrapped = trimmed.startsWith('<') && trimmed.includes('>')
    ? trimmed.slice(1, trimmed.indexOf('>'))
    : trimmed.split(/\s+["']/u, 1)[0];
  return unwrapped.replace(/[?#].*$/u, '');
}

function relativeTargets(markdown) {
  const targets = [];
  for (const match of markdown.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/gu)) targets.push(match[1]);
  for (const match of markdown.matchAll(/^\s*\[[^\]]+\]:\s*(\S+)/gmu)) targets.push(match[1]);
  return targets;
}

for (const file of files) {
  const absolute = path.join(root, file);
  const markdown = await readFile(absolute, 'utf8');
  const lines = markdown.split('\n');
  lines.forEach((line, index) => {
    if (/\r$/u.test(line)) failures.push(`${file}:${index + 1}: CRLF`);
    if (/[\t ]+$/u.test(line)) failures.push(`${file}:${index + 1}: trailing whitespace`);
  });
  for (const rawTarget of relativeTargets(markdown)) {
    const target = normalizeTarget(rawTarget);
    if (!target || target.startsWith('#') || target.startsWith('/') || /^[a-z][a-z0-9+.-]*:/iu.test(target)) continue;
    let decoded;
    try { decoded = decodeURIComponent(target); }
    catch { failures.push(`${file}: invalid URL encoding in ${rawTarget}`); continue; }
    const resolved = path.resolve(path.dirname(absolute), decoded);
    if (!resolved.startsWith(`${root}${path.sep}`) && resolved !== root) {
      failures.push(`${file}: relative link escapes repository: ${rawTarget}`);
      continue;
    }
    try { await stat(resolved); }
    catch { failures.push(`${file}: missing relative link target: ${rawTarget}`); }
  }
}

if (failures.length > 0) {
  process.stderr.write(`validate:docs failed (${failures.length})\n${failures.join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`validate:docs PASS (${files.length} active Markdown files)\n`);
}
