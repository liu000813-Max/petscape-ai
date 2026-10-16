const { createCommunityPost } = require('../../utils/request');
const { track } = require('../../utils/analytics');

Page({
  data: { topics: ['求助', '晒栖境', '经验', '同城服务'], topicIndex: 0, title: '', body: '', submitting: false },

  onTitleInput(event) { this.setData({ title: event.detail.value }); },
  onBodyInput(event) { this.setData({ body: event.detail.value }); },
  onTopicChange(event) { this.setData({ topicIndex: Number(event.detail.value) }); },

  async submit() {
    if (this.data.submitting) return;
    const { title, body, topics, topicIndex } = this.data;
    if (!title.trim() || !body.trim()) { wx.showToast({ title: '请补充标题和内容', icon: 'none' }); return; }
    this.setData({ submitting: true });
    try {
      await createCommunityPost({ title: title.trim(), body: body.trim(), topic: topics[topicIndex] });
      track('community.submit');
      wx.showToast({ title: '已提交审核', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 500);
    } catch (error) {
      this.setData({ submitting: false });
      wx.showToast({ title: error.statusCode === 401 ? '请先登录' : '提交失败', icon: 'none' });
    }
  },
});
