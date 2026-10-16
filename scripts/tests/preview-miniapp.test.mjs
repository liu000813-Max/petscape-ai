import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const script = fileURLToPath(new URL('../preview-miniapp.ps1', import.meta.url));
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6CFsAAAAASUVORK5CYII=', 'base64');
// Synthetic white 2x2 JPEG; no real preview or login token is stored in fixtures.
const jpeg = Buffer.from('/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAACAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AKpAB//Z', 'base64');

for (const fixture of [
  { name: 'PNG preview', image: png, format: 'png' },
  { name: 'official CLI JPEG named png', image: jpeg, format: 'jpeg', extension: 'jpg' },
  { name: 'CLI error with exit zero', image: png, error: true },
  { name: 'old image cannot satisfy a new invocation' },
  { name: 'invalid image', image: Buffer.from('invalid image') },
  { name: 'truncated JPEG', image: jpeg.subarray(0, -2) },
]) {
  test(fixture.name, { skip: process.platform !== 'win32' && 'Windows official CLI wrapper' }, () => {
    const root = mkdtempSync(path.join(tmpdir(), 'petscape-preview-test-'));
    const cli = path.join(root, 'fixture.cmd');
    if (fixture.image) writeFileSync(path.join(root, 'fixture.image'), fixture.image);
    writeFileSync(cli, [
      '@echo off',
      fixture.image ? 'copy /y "%~dp0fixture.image" "%~7" >nul' : 'rem no new image',
      fixture.error ? 'echo [error] initialize error' : 'echo preview complete',
      'exit /b 0',
    ].join('\r\n'));
    const outputs = path.join(root, 'outputs');
    mkdirSync(path.join(outputs, 'old-run'), { recursive: true });
    writeFileSync(path.join(outputs, 'old-run', 'preview.png'), png);
    const result = spawnSync('pwsh.exe', ['-NoProfile', '-File', script, '-DevtoolsCli', cli, '-OutputRoot', outputs], {
      encoding: 'utf8', windowsHide: true, timeout: 90000,
    });
    assert.ifError(result.error);
    const runs = readdirSync(outputs).filter((name) => name !== 'old-run');
    assert.equal(runs.length, 1);
    const run = path.join(outputs, runs[0]);
    const receipt = JSON.parse(readFileSync(path.join(run, 'receipt.json'), 'utf8').replace(/^\uFEFF/, ''));
    const expectedSuccess = Boolean(fixture.format);
    assert.equal(result.status === 0, expectedSuccess, result.stderr);
    assert.equal(receipt.status, expectedSuccess ? 'preview-generated' : 'failed');
    assert.equal(receipt.phoneVerified, false);
    if (expectedSuccess) {
      const imagePath = path.join(run, `preview.${fixture.extension || fixture.format}`);
      assert.equal(existsSync(imagePath), true, 'Delivered extension must match the actual format');
      assert.equal(receipt.qrFormat, fixture.format);
      assert.equal(receipt.qrSha256, createHash('sha256').update(readFileSync(imagePath)).digest('hex'));
    } else {
      assert.equal(receipt.qrSha256, null);
    }
  });
}
