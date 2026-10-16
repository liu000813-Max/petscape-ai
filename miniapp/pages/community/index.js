Page({
  data: {
    topics: ['全部', '求助', '晒栖境', '经验', '同城服务'],
    active: '全部',
    posts: [
      { tag: '求助', title: '花枝鼠最近总啃咬围栏，栖境要怎么调整？', author: '小满', time: '12 分钟前', likes: 18, comments: 6 },
      { tag: '晒栖境', title: '把旧木箱改成了一个小小的雨林角落', author: '阿葵', time: '1 小时前', likes: 42, comments: 9 },
      { tag: '经验', title: '记录我的第一只鹦鹉：从互动到作息', author: '北窗', time: '昨天', likes: 31, comments: 4 },
      { tag: '同城服务', title: '深圳有没有靠谱的异宠寄养？', author: '椰椰', time: '昨天', likes: 12, comments: 8 },
    ],
  },

  selectTopic(event) {
    this.setData({ active: event.currentTarget.dataset.topic });
  },

  createPost() {
    wx.showModal({
      title: '发布新动态',
      content: '发帖编辑器和内容审核接入后台后开放。先保留社区入口和主题结构。',
      showCancel: false,
    });
  },

  openPost(event) {
    wx.showModal({ title: event.currentTarget.dataset.title, content: '帖子详情页将在社区 API 接入后开放。', showCancel: false });
  },
});
