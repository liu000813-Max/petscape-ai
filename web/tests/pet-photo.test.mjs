import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readBoundedBody, BodyTooLargeError } from '../app/lib/bounded-body.ts';
const require = createRequire(import.meta.url);
const { choosePetPhoto, MAX_BYTES } = require('../../miniapp/utils/pet-photo.js');

test('photo picker cancel preserves the draft; invalid formats and sizes are rejected', async () => {
  globalThis.wx = { chooseMedia: ({ fail }) => fail({ errMsg: 'chooseMedia:fail cancel' }) };
  assert.equal(await choosePetPhoto(), null);
  wx.chooseMedia = ({ success }) => success({ tempFiles: [{ tempFilePath: '/photo', size: MAX_BYTES + 1 }] });
  await assert.rejects(choosePetPhoto(), /10 MB/);
  wx.chooseMedia = ({ success }) => success({ tempFiles: [{ tempFilePath: '/photo', size: 8 }] });
  wx.getFileSystemManager = () => ({ readFile: ({ success }) => success({ data: new ArrayBuffer(8) }) });
  await assert.rejects(choosePetPhoto(), /JPG/);
  const bytes = new Uint8Array([255, 216, 255, 0]).buffer;
  wx.getFileSystemManager = () => ({ readFile: ({ success }) => success({ data: bytes }) });
  assert.deepEqual(await choosePetPhoto(), { path: '/photo', bytes, mime: 'image/jpeg' });
});

test('upload body limits count streamed bytes even without content length', async () => {
  const request = new Request('https://example.test', { method: 'POST', body: new Uint8Array(11) });
  await assert.rejects(readBoundedBody(request, 10), BodyTooLargeError);
  assert.equal((await readBoundedBody(new Request('https://example.test', { method: 'POST', body: new Uint8Array(10) }), 10)).length, 10);
});
