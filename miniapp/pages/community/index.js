const { listArticles, getArticle, listCommunityPosts, listMyCommunityPosts, toggleCommunityPostLike } = require('../../utils/request');
const { track } = require('../../utils/analytics');
const { syncTabBar } = require('../../utils/navigation');
const { POST_TOPICS, topicLabel } = require('../../utils/community-topics');
const { readBookmarks, toggleBookmark } = require('../../utils/official-bookmarks');
const { formatDateTime } = require('../../utils/format');

const SECTIONS = [{ id: 'community', label: '社区动态' }, { id: 'official', label: '官方帖' }, { id: 'saved', label: '已收藏' }, { id: 'mine', label: '我的投稿' }];
const CATEGORIES = ['全部', '花枝鼠', '守宫', '蛇类', '鹦鹉', '蜘蛛', '其他异宠', '空间设计'];
const SUBMISSION_STATUS = { pending: '待审核', published: '已发布', rejected: '未通过', archived: '已下架' };

async function readSavedArticles(ids) {
  const articles = [];
  for (let offset = 0; offset < ids.length; offset += 6) {
    const batch = await Promise.all(ids.slice(offset, offset + 6).map(async (id) => {
      try { return await getArticle(id); }
      catch (error) { if (error.statusCode === 404) return null; throw error; }
    }));
    articles.push(...batch.filter(Boolean));
  }
  return articles;
}

Page({
  data: {
    sections: SECTIONS,
    section: 'community',
    categories: CATEGORIES,
    category: '全部',
    articles: [],
    articlesLoading: false,
    articlesError: '',
    topics: ['全部', ...POST_TOPICS],
    topicLabels: ['全部', ...POST_TOPICS.map(topicLabel)],
    active: '全部',
    posts: [],
    loading: true,
    error: '',
    myPosts: [],
    myPostsLoading: false,
    myPostsError: '',
    nextPostOffset: null,
    expandedPostId: '',
  },

  onShow() {
    syncTabBar(this);
    const app = getApp();
    if (app.officialPostsEntry) {
      delete app.officialPostsEntry;
      this.setData({ section: 'official', category: '全部' });
    }
    return this.loadSection();
  },

  onHide() {
    if (this.data.section !== 'mine') return;
    this.sequence = (this.sequence || 0) + 1;
    this.setData({ myPosts: [], myPostsLoading: true, myPostsError: '', nextPostOffset: null, expandedPostId: '' });
  },

  onUnload() { this.sequence = (this.sequence || 0) + 1; },

  selectSection(event) {
    const section = event.currentTarget.dataset.section;
    if (!SECTIONS.some((item) => item.id === section) || section === this.data.section) return;
    this.setData({ section });
    return this.loadSection();
  },

  loadSection() {
    const sequence = (this.sequence || 0) + 1;
    this.sequence = sequence;
    if (this.data.section === 'mine') return this.loadMyPosts(sequence, 0);
    if (this.data.myPosts.length) this.setData({ myPosts: [], nextPostOffset: null, expandedPostId: '' });
    if (this.data.section === 'community') return this.loadPosts(sequence);
    return this.loadArticles(sequence);
  },

  async loadMyPosts(sequence, offset) {
    this.setData({ myPostsLoading: true, myPostsError: '',
      ...(offset === 0 ? { myPosts: [], nextPostOffset: null, expandedPostId: '' } : {}) });
    try {
      const { posts, nextOffset } = await listMyCommunityPosts(offset ? { offset } : {});
      if (sequence !== this.sequence) return;
      const seen = new Set(this.data.myPosts.map(post => post.id));
      const more = posts.filter(post => !seen.has(post.id)).map(post => ({
        ...post, statusLabel: SUBMISSION_STATUS[post.status], topicLabel: topicLabel(post.topic), dateLabel: formatDateTime(post.createdAt),
      }));
      this.setData({ myPosts: this.data.myPosts.concat(more), nextPostOffset: nextOffset, myPostsLoading: false });
    } catch (error) {
      if (sequence !== this.sequence) return;
      const authFailed = error.statusCode === 401 || error.statusCode === 403 || error.stage === 'wx-login' || error.stage === 'session-exchange';
      this.setData({ myPostsLoading: false, myPostsError: authFailed ? '登录状态未恢复，请重试。' : '投稿读取失败，请重试。',
        ...(authFailed ? { myPosts: [], nextPostOffset: null, expandedPostId: '' } : {}) });
    }
  },

  refreshMyPosts() {
    if (this.data.section !== 'mine' || this.data.myPostsLoading) return;
    return this.loadSection();
  },

  loadMoreMyPosts() {
    const { section, nextPostOffset, myPostsLoading } = this.data;
    if (section !== 'mine' || myPostsLoading || nextPostOffset === null) return;
    return this.loadMyPosts(this.sequence, nextPostOffset);
  },

  toggleSubmission(event) {
    const id = event.currentTarget.dataset.id;
    if (this.data.myPosts.some(post => post.id === id)) {
      this.setData({ expandedPostId: id === this.data.expandedPostId ? '' : id });
    }
  },

  selectCategory(event) {
    const category = event.currentTarget.dataset.category;
    if (this.data.section !== 'official' || !CATEGORIES.includes(category) || category === this.data.category) return;
    this.setData({ category });
    track('knowledge.filter', { category });
    return this.loadSection();
  },

  async loadArticles(sequence) {
    const { section, category } = this.data;
    this.setData({ articlesLoading: true, articlesError: '', articles: [] });
    try {
      const bookmarks = readBookmarks(section === 'saved');
      const articles = section === 'saved'
        ? await readSavedArticles(bookmarks)
        : (await listArticles(category === '全部' ? {} : { category })).articles;
      if (sequence !== this.sequence) return;
      this.setData({ articles: articles.map((article) => ({ ...article, starred: bookmarks.includes(article.id) })), articlesLoading: false });
    } catch (error) {
      if (sequence === this.sequence) this.setData({ articlesLoading: false, articlesError: '读取失败，请重试' });
    }
  },

  starArticle(event) {
    const id = event.currentTarget.dataset.id;
    if (!this.data.articles.some((article) => article.id === id)) return;
    try {
      const starred = toggleBookmark(id).includes(id);
      const articles = this.data.section === 'saved' && !starred
        ? this.data.articles.filter((article) => article.id !== id)
        : this.data.articles.map((article) => article.id === id ? { ...article, starred } : article);
      this.setData({ articles });
    } catch (error) {
      wx.showToast({ title: '星标保存失败，请重试', icon: 'none' });
    }
  },

  openArticle(event) {
    const id = event.currentTarget.dataset.id;
    if (!this.data.articles.some((article) => article.id === id)) return;
    track('knowledge.open', { articleId: id });
    wx.navigateTo({ url: `/pages/article/index?id=${encodeURIComponent(id)}` });
  },

  async loadPosts(sequence) {
    this.setData({ loading: true, error: '' });
    try {
      const result = await listCommunityPosts(this.data.active === '全部' ? {} : { topic: this.data.active });
      if (sequence !== this.sequence) return;
      this.setData({ posts: (result.posts || []).map((item) => ({ ...item, tag: item.topic, topicLabel: topicLabel(item.topic), author: item.authorName || 'PETSCAPE 用户', likes: item.likeCount || 0, comments: item.commentCount || 0, time: '最近' })), loading: false });
    } catch (error) {
      if (sequence === this.sequence) this.setData({ loading: false, error: '社区读取失败，请重试' });
    }
  },

  selectTopic(event) {
    this.setData({ active: event.currentTarget.dataset.topic });
    track('community.filter', { topic: event.currentTarget.dataset.topic });
    return this.loadSection();
  },

  createPost() {
    wx.navigateTo({ url: '/pages/community-edit/index', events: {
      communityPostSubmitted: () => this.setData({ section: 'mine' }),
    } });
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
