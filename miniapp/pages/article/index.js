const { getArticle } = require('../../utils/request');
const { readBookmarks, toggleBookmark } = require('../../utils/official-bookmarks');
Page({
  data: { article: null, loading: true, error: '', starred: false },
  onLoad(options) { this.articleId = options.id; return this.loadArticle(); },
  async loadArticle() {
    this.setData({ loading: true, error: '' });
    try {
      const article = await getArticle(this.articleId);
      this.setData({ article, loading: false, starred: readBookmarks().includes(article.id) });
    }
    catch (error) { this.setData({ loading: false, error: error.statusCode === 404 ? '这篇文章已下架或不存在' : '文章读取失败，请重试' }); }
  },
  starArticle() {
    const { article, loading, error } = this.data;
    if (!article || loading || error) return;
    try { this.setData({ starred: toggleBookmark(article.id).includes(article.id) }); }
    catch (error) { wx.showToast({ title: '星标保存失败，请重试', icon: 'none' }); }
  },
});
