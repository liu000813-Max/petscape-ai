import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

test('Viewer QA reads the SMS test log format it expects', async () => {
  const source = await readFile(new URL('./e2e-viewer-model.test.mjs', import.meta.url), 'utf8');
  const template = source.match(/new RegExp\((`[^`]+`), 'g'\)/)?.[1];
  assert.ok(template, 'Viewer E2E must define a testable OTP log pattern');
  const phone = '13700004315';
  const text = vm.runInNewContext(template, { PHONE: phone });
  const [match, code] = [...`[SMS:log] OTP for +86${phone} => 123456`.matchAll(new RegExp(text, 'g'))][0] ?? [];
  assert.ok(match, 'pattern should match the actual SMS:log output format');
  assert.equal(code, '123456');
});
