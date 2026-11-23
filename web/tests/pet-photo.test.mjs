import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { readBoundedBody, BodyTooLargeError } from '../app/lib/bounded-body.ts';
const require = createRequire(import.meta.url);
const { choosePetPhoto, cropPetPhoto, MAX_BYTES } = require('../../miniapp/utils/pet-photo.js');

test('choosing an avatar crops a square first and reads only the confirmed output', async () => {
  const original = new Uint8Array([255, 216, 255, 0]).buffer;
  const cropped = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1]).buffer;
  const reads = [];
  globalThis.wx = {
    chooseMedia: ({ success }) => success({ tempFiles: [{ tempFilePath: '/original.jpg', size: 4 }] }),
    cropImage(options) { assert.equal(options.src, '/original.jpg'); assert.equal(options.cropScale, '1:1'); options.success({ tempFilePath: '/square.png' }); },
    getFileSystemManager: () => ({ readFile({ filePath, success }) { reads.push(filePath); success({ data: filePath === '/square.png' ? cropped : original }); } }),
  };
  const photo = await choosePetPhoto();
  assert.equal(photo.path, '/square.png'); assert.equal(photo.sourcePath, '/original.jpg');
  assert.equal(photo.bytes, cropped); assert.equal(photo.mime, 'image/png');
  assert.equal(reads.at(-1), '/square.png');
});

test('canceling crop or an unsupported client never returns the original uncut image', async () => {
  globalThis.wx = {
    chooseMedia: ({ success }) => success({ tempFiles: [{ tempFilePath: '/original.jpg', size: 4 }] }),
    cropImage: ({ fail }) => fail({ errMsg: 'cropImage:fail cancel' }),
    getFileSystemManager: () => ({ readFile: ({ success }) => success({ data: new Uint8Array([255, 216, 255, 0]).buffer }) }),
  };
  assert.equal(await choosePetPhoto(), null);
  delete wx.cropImage;
  await assert.rejects(choosePetPhoto(), /更新微信/);
});

test('recropping uses the original source and validates the new file before returning a draft', async () => {
  const previous = { path: '/first-crop.png', sourcePath: '/original.jpg', bytes: new ArrayBuffer(4), mime: 'image/png' };
  const originalBytes = previous.bytes;
  globalThis.wx = {
    cropImage: ({ src, fail }) => { assert.equal(src, '/original.jpg'); fail({ errMsg: 'cropImage:fail cancel' }); },
  };
  assert.equal(await cropPetPhoto(previous), null);
  assert.equal(previous.bytes, originalBytes); assert.equal(previous.path, '/first-crop.png');
  wx.cropImage = ({ success }) => success({ tempFilePath: '/second-crop.png' });
  wx.getFileSystemManager = () => ({ readFile: ({ fail }) => fail({}) });
  await assert.rejects(cropPetPhoto(previous), /读取失败/);
  assert.equal(previous.bytes, originalBytes);
});

test('native file buffers from another runtime remain valid cropped image bytes', async () => {
  const nativeBuffer = vm.runInNewContext('new Uint8Array([255,216,255,0]).buffer');
  globalThis.wx = {
    cropImage: ({ success }) => success({ tempFilePath: '/cropped.jpg' }),
    getFileSystemManager: () => ({ readFile: ({ success }) => success({ data: nativeBuffer }) }),
  };
  const photo = await cropPetPhoto({ path: '/source.jpg' });
  assert.equal(photo.mime, 'image/jpeg');
  assert.deepEqual([...new Uint8Array(photo.bytes)], [255,216,255,0]);
});

test('photo picker cancel preserves the draft; invalid formats and sizes are rejected', async () => {
  globalThis.wx = { chooseMedia: ({ fail }) => fail({ errMsg: 'chooseMedia:fail cancel' }) };
  assert.equal(await choosePetPhoto(), null);
  wx.chooseMedia = ({ success }) => success({ tempFiles: [{ tempFilePath: '/photo', size: MAX_BYTES + 1 }] });
  await assert.rejects(choosePetPhoto(), /10 MB/);
  wx.chooseMedia = ({ success }) => success({ tempFiles: [{ tempFilePath: '/photo', size: 8 }] });
  wx.cropImage = ({ src, success }) => success({ tempFilePath: src });
  wx.getFileSystemManager = () => ({ readFile: ({ success }) => success({ data: new ArrayBuffer(8) }) });
  await assert.rejects(choosePetPhoto(), /JPG/);
  const bytes = new Uint8Array([255, 216, 255, 0]).buffer;
  wx.getFileSystemManager = () => ({ readFile: ({ success }) => success({ data: bytes }) });
  assert.deepEqual(await choosePetPhoto(), { path: '/photo', sourcePath: '/photo', bytes, mime: 'image/jpeg' });
});

test('upload body limits count streamed bytes even without content length', async () => {
  const request = new Request('https://example.test', { method: 'POST', body: new Uint8Array(11) });
  await assert.rejects(readBoundedBody(request, 10), BodyTooLargeError);
  assert.equal((await readBoundedBody(new Request('https://example.test', { method: 'POST', body: new Uint8Array(10) }), 10)).length, 10);
});
