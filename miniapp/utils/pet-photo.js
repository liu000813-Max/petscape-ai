const MAX_BYTES = 10 * 1024 * 1024;

function imageMime(buffer) {
  const b = new Uint8Array(buffer);
  if (b[0] === 255 && b[1] === 216 && b[2] === 255) return 'image/jpeg';
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((value, i) => b[i] === value)) return 'image/png';
  if (String.fromCharCode(...b.slice(0, 4)) === 'RIFF' && String.fromCharCode(...b.slice(8, 12)) === 'WEBP') return 'image/webp';
  return '';
}

function readPhoto(filePath) {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().readFile({ filePath,
      success({ data }) {
        if (Object.prototype.toString.call(data) !== '[object ArrayBuffer]' || !data.byteLength || data.byteLength > MAX_BYTES) {
          reject(new Error('请选择不超过 10 MB 的图片')); return;
        }
        const bytes = data instanceof ArrayBuffer ? data : new Uint8Array(data).buffer;
        const mime = imageMime(bytes);
        if (!mime) { reject(new Error('请选择 JPG、PNG 或 WebP 图片')); return; }
        resolve({ path: filePath, bytes, mime });
      },
      fail() { reject(new Error('图片读取失败，请重新选择')); },
    });
  });
}

async function cropPetPhoto(photo) {
  if (typeof wx.cropImage !== 'function') throw new Error('当前微信不支持头像裁切，请更新微信后重试');
  const sourcePath = photo.sourcePath || photo.path;
  const croppedPath = await new Promise((resolve, reject) => {
    wx.cropImage({ src: sourcePath, cropScale: '1:1',
      success(result) {
        if (!result.tempFilePath) { reject(new Error('裁切结果未生成，请重试')); return; }
        resolve(result.tempFilePath);
      },
      fail(error) {
        if (error && /cancel/i.test(error.errMsg || '')) resolve(null);
        else reject(new Error('图片裁切失败，请重试'));
      },
    });
  });
  if (!croppedPath) return null;
  return { ...await readPhoto(croppedPath), sourcePath };
}

async function choosePetPhoto() {
  const file = await new Promise((resolve, reject) => {
    wx.chooseMedia({ count: 1, mediaType: ['image'], sourceType: ['album', 'camera'], sizeType: ['compressed'],
      success(result) {
        const file = result.tempFiles && result.tempFiles[0];
        if (!file) { resolve(null); return; }
        if (file.size > MAX_BYTES) { reject(new Error('请选择不超过 10 MB 的图片')); return; }
        resolve(file);
      },
      fail(error) {
        if (error && /cancel/i.test(error.errMsg || '')) resolve(null);
        else reject(new Error('无法打开相册或相机，请检查权限'));
      },
    });
  });
  if (!file) return null;
  const source = await readPhoto(file.tempFilePath);
  return cropPetPhoto(source);
}

module.exports = { choosePetPhoto, cropPetPhoto, readPhoto, imageMime, MAX_BYTES };
