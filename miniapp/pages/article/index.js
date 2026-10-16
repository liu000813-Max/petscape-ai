const { getArticle } = require('../../utils/request');
Page({
  data: { article: null, loading: true, error: '' },
  onLoad(options) { this.articleId = options.id; return this.loadArticle(); },
  async loadArticle() {
    this.setData({ loading: true, error: '' });
    try { this.setData({ article: await getArticle(this.articleId), loading: false }); }
    catch (error) { this.setData({ loading: false, error: error.statusCode === 404 ? '这篇文章已下架或不存在' : '文章读取失败，请重试' }); }
  },
});
