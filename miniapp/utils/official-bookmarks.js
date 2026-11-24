function storageKey() {
  return getApp().globalData.mockMode ? 'petscape_official_bookmarks_mock' : 'petscape_official_bookmarks';
}

function readBookmarks(strict = false) {
  try { return storedBookmarks(); }
  catch (error) { if (strict) throw error; return []; }
}

function storedBookmarks() {
  const saved = wx.getStorageSync(storageKey());
  return Array.isArray(saved) ? [...new Set(saved.filter((id) => typeof id === 'string' && id))] : [];
}

function toggleBookmark(id) {
  const bookmarks = storedBookmarks();
  const updated = bookmarks.includes(id) ? bookmarks.filter((item) => item !== id) : [id, ...bookmarks];
  wx.setStorageSync(storageKey(), updated);
  return updated;
}

module.exports = { readBookmarks, toggleBookmark };
