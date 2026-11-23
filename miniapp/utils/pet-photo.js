const MAX_BYTES = 10 * 1024 * 1024;

function imageMime(buffer) {
  const b = new Uint8Array(buffer);
  if (b[0] === 255 && b[1] === 216 && b[2] === 255) return 'image/jpeg';
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((value, i) => b[i] === value)) return 'image/png';
  if (String.fromCharCode(...b.slice(0, 4)) === 'RIFF' && String.fromCharCode(...b.slice(8, 12)) === 'WEBP') return 'image/webp';
  return '';
}

function choosePetPhoto() {
  return new Promise((resolve, reject) => {
    wx.chooseMedia({ count: 1, mediaType: ['image'], sourceType: ['album', 'camera'], sizeType: ['compressed'],
      success(result) {
        const file = result.tempFiles && result.tempFiles[0];
        if (!file) { resolve(null); return; }
        if (file.size > MAX_BYTES) { reject(new Error('请选择不超过 10 MB 的图片')); return; }
        wx.getFileSystemManager().readFile({ filePath: file.tempFilePath,
          success({ data }) {
            if (!(data instanceof ArrayBuffer) || !data.byteLength || data.byteLength > MAX_BYTES) {
              reject(new Error('请选择不超过 10 MB 的图片')); return;
            }
            const mime = imageMime(data);
            if (!mime) { reject(new Error('请选择 JPG、PNG 或 WebP 图片')); return; }
            resolve({ path: file.tempFilePath, bytes: data, mime });
          },
          fail() { reject(new Error('图片读取失败，请重新选择')); },
        });
      },
      fail(error) {
        if (error && /cancel/i.test(error.errMsg || '')) resolve(null);
        else reject(new Error('无法打开相册或相机，请检查权限'));
      },
    });
  });
}

module.exports = { choosePetPhoto, imageMime, MAX_BYTES };
