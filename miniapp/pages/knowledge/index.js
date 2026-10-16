Page({
  data: {
    active: '全部',
    categories: ['全部', '花枝鼠', '守宫', '蛇类', '鹦鹉', '蜘蛛', '空间设计'],
    articles: [
      { category: '花枝鼠', title: '花枝鼠的栖境，先从活动和啃咬开始', summary: '给足活动空间、可替换材质和藏身处，让日常照料更稳定。', read: '5 分钟阅读' },
      { category: '空间设计', title: '一处好栖境，至少要解决三个问题', summary: '安全、活动和清洁，是不同宠物共享的空间设计起点。', read: '4 分钟阅读' },
      { category: '蛇类', title: '喂食前后需要观察哪些状态', summary: '记录体重、进食和排泄，帮助你发现变化。', read: '6 分钟阅读' },
      { category: '鹦鹉', title: '鹦鹉活动区如何兼顾安全和互动', summary: '从站立、啃咬到清洁，搭出适合日常互动的区域。', read: '4 分钟阅读' },
      { category: '守宫', title: '守宫的温度梯度怎么搭', summary: '从热区、冷区到躲避屋，先把环境基础做好。', read: '5 分钟阅读' },
      { category: '蜘蛛', title: '湿度不是越高越好', summary: '按物种和蜕皮阶段建立自己的养护记录。', read: '3 分钟阅读' },
    ],
  },

  selectCategory(event) {
    this.setData({ active: event.currentTarget.dataset.category });
  },

  openArticle(event) {
    wx.showModal({
      title: event.currentTarget.dataset.title,
      content: '文章详情页接入内容后台后开放。当前版本先完成知识分类和入口验证。',
      showCancel: false,
    });
  },
});
