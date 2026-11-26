function communityPhotoUrl(postId, assetId) {
  const base = getApp().globalData.apiBaseUrl.replace(/\/$/, '');
  return `${base}/api/v1/community/posts/${encodeURIComponent(postId)}/photos/${encodeURIComponent(assetId)}`;
}

module.exports = { communityPhotoUrl };
