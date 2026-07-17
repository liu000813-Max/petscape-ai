import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';

const webRoot = fileURLToPath(new URL('../', import.meta.url));
const baseline = JSON.parse(
  await readFile(new URL('../lint-baseline.json', import.meta.url), 'utf8'),
);

const eslint = new ESLint({ cwd: webRoot });
const results = await eslint.lintFiles(['.']);
const actualErrors = new Map();
let errorCount = 0;
let warningCount = 0;

for (const result of results) {
  const relativePath = result.filePath.slice(webRoot.length);
  for (const message of result.messages) {
    if (message.severity === 1) {
      warningCount += 1;
      continue;
    }
    if (message.severity !== 2) continue;

    errorCount += 1;
    const ruleId = message.ruleId ?? '<fatal>';
    const key = `${relativePath}\0${ruleId}`;
    actualErrors.set(key, (actualErrors.get(key) ?? 0) + 1);
  }
}

const regressions = [];
for (const [key, count] of actualErrors) {
  const [relativePath, ruleId] = key.split('\0');
  const allowed = baseline.allowedErrors[relativePath]?.[ruleId] ?? 0;
  if (count > allowed) {
    regressions.push(`${relativePath} :: ${ruleId}: ${count} error(s), allowed ${allowed}`);
  }
}

if (errorCount > baseline.maxErrors) {
  regressions.push(`total: ${errorCount} error(s), allowed ${baseline.maxErrors}`);
}

if (regressions.length > 0) {
  console.error('Lint baseline regression detected:');
  for (const regression of regressions) console.error(`- ${regression}`);
  process.exitCode = 1;
} else {
  console.log(
    `Lint baseline accepted: ${errorCount}/${baseline.maxErrors} errors, ${warningCount} warnings.`,
  );
}
