const { listCommunityPosts, toggleCommunityPostLike } = require('../../utils/request');
const { track } = require('../../utils/analytics');

Page({
  data: {
    topics: ['全部', '求助', '晒栖境', '经验', '同城服务'],
    active: '全部',
    posts: [],
    loading: true,
    error: '',
  },

  onShow() { return this.loadPosts(); },

  async loadPosts() {
    const sequence = (this.sequence || 0) + 1; this.sequence = sequence;
    this.setData({ loading: true, error: '' });
    try {
      const result = await listCommunityPosts(this.data.active === '全部' ? {} : { topic: this.data.active });
      if (sequence !== this.sequence) return;
      this.setData({ posts: (result.posts || []).map((item) => ({ ...item, tag: item.topic, author: item.authorName || 'PETSCAPE 用户', likes: item.likeCount || 0, comments: item.commentCount || 0, time: '最近' })), loading: false });
    } catch (error) {
      if (sequence === this.sequence) this.setData({ loading: false, error: '社区读取失败，请重试' });
    }
  },

  selectTopic(event) {
    this.setData({ active: event.currentTarget.dataset.topic });
    track('community.filter', { topic: event.currentTarget.dataset.topic });
    return this.loadPosts();
  },

  createPost() {
    wx.navigateTo({ url: '/pages/community-edit/index' });
  },

  openPost(event) {
    const id = event.currentTarget.dataset.id;
    track('community.open', { postId: id });
    wx.navigateTo({ url: `/pages/community-detail/index?id=${id}` });
  },

  async likePost(event) {
    const id = event.currentTarget.dataset.id;
    if (this.likePending) return;
    const post = this.data.posts.find((item) => item.id === id);
    if (!post) return;
    this.likePending = true;
    try {
      const result = await toggleCommunityPostLike(id, !post.liked);
      const posts = this.data.posts.map((item) => item.id === id ? { ...item, likes: result.likeCount, liked: result.liked } : item);
      this.setData({ posts });
      track('community.like', { postId: id, liked: result.liked });
    } catch (error) {
      wx.showToast({ title: '请登录后点赞', icon: 'none' });
    } finally { this.likePending = false; }
  },

  openServices() {
    wx.navigateTo({ url: '/pages/services/index' });
  },
});
