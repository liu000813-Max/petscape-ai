const { getCommunityPost, listCommunityComments, createCommunityComment } = require('../../utils/request');
const { topicLabel } = require('../../utils/community-topics');
const { communityPhotoUrl } = require('../../utils/community-photos');
Page({
  data: { post: null, photos: [], photoIndex: 0, comments: [], body: '', loading: true, submitting: false, error: '' },
  onLoad(options) { this.postId = options.id; return this.loadPost(); },
  async loadPost() {
    this.setData({ loading: true, error: '' });
    try {
      const [post, result] = await Promise.all([getCommunityPost(this.postId), listCommunityComments(this.postId)]);
      const photos = (post.photoAssetIds || []).map(id => communityPhotoUrl(post.id, id));
      this.setData({ post: { ...post, topicLabel: topicLabel(post.topic) }, photos, photoIndex: 0, comments: result.comments || [], loading: false });
    } catch (error) { this.setData({ loading: false, error: error.statusCode === 404 ? '这条动态已下架或不存在' : '动态读取失败，请重试' }); }
  },
  onPhotoChange(event) { this.setData({ photoIndex: event.detail.current }); },
  previewPhoto(event) {
    const { photos } = this.data;
    const current = photos[Number(event.currentTarget.dataset.index)];
    if (current) wx.previewImage({ current, urls: photos });
  },
  onBodyInput(event) { this.setData({ body: event.detail.value }); },
  async submitComment() {
    if (this.data.submitting || !this.data.body.trim()) return;
    this.setData({ submitting: true });
    try {
      await createCommunityComment(this.postId, { body: this.data.body.trim() });
      this.setData({ body: '' }); wx.showToast({ title: '评论已提交审核', icon: 'success' });
    } catch (error) { wx.showToast({ title: error.statusCode === 401 ? '请先登录' : '评论提交失败', icon: 'none' }); }
    finally { this.setData({ submitting: false }); }
  },
});
