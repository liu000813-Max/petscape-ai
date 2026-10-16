const { listArticles } = require('../../utils/request');
const { track } = require('../../utils/analytics');

Page({
  data: {
    active: '全部',
    categories: ['全部', '花枝鼠', '守宫', '蛇类', '鹦鹉', '蜘蛛', '其他异宠', '空间设计'],
    articles: [],
    loading: true,
    error: '',
  },

  onShow() { return this.loadArticles(); },

  async loadArticles() {
    const sequence = (this.sequence || 0) + 1; this.sequence = sequence;
    this.setData({ loading: true, error: '' });
    try {
      const result = await listArticles(this.data.active === '全部' ? {} : { category: this.data.active });
      if (sequence !== this.sequence) return;
      this.setData({ articles: (result.articles || []).map((item) => ({ ...item, read: '知识卡片' })), loading: false });
    } catch (error) {
      if (sequence === this.sequence) this.setData({ loading: false, error: '知识读取失败，请重试' });
    }
  },

  selectCategory(event) {
    this.setData({ active: event.currentTarget.dataset.category });
    track('knowledge.filter', { category: event.currentTarget.dataset.category });
    return this.loadArticles();
  },

  openArticle(event) {
    const article = this.data.articles.find((item) => item.title === event.currentTarget.dataset.title);
    track('knowledge.open', { articleId: article && article.id });
    if (article) wx.navigateTo({ url: `/pages/article/index?id=${article.id}` });
  },
});
