const { getCommunityPost, listCommunityComments, createCommunityComment } = require('../../utils/request');
Page({
  data: { post: null, comments: [], body: '', loading: true, submitting: false, error: '' },
  onLoad(options) { this.postId = options.id; return this.loadPost(); },
  async loadPost() {
    this.setData({ loading: true, error: '' });
    try {
      const [post, result] = await Promise.all([getCommunityPost(this.postId), listCommunityComments(this.postId)]);
      this.setData({ post, comments: result.comments || [], loading: false });
    } catch (error) { this.setData({ loading: false, error: error.statusCode === 404 ? '这条动态已下架或不存在' : '动态读取失败，请重试' }); }
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
