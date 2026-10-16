const mockPets = [
  {
    id: 'mock-pet-1',
    name: '米粒',
    speciesCode: 'rat',
    breed: '花枝鼠',
    sizeLevel: 2,
    lifeStage: 'adult',
    behaviorTraits: ['好奇', '爱探索', '喜欢互动'],
    environmentNotes: '喜欢有活动空间、可替换材质和藏身处的环境。',
    specialNeeds: null,
    coverUrl: null,
  },
];

const mockProjects = [
  {
    id: 'mock-project-1',
    title: '米粒的探索栖境',
    status: 'editable',
    updatedAt: '2026-10-15T08:00:00.000Z',
  },
];

const mockOrders = [
  {
    id: 'mock-order-1',
    status: 'design_confirmed',
    amountCent: 39900,
    currency: 'CNY',
    productCode: 'PETG-HABITAT-MVP',
    createdAt: '2026-10-12T08:00:00.000Z',
  },
];

const mockArticles = [
  { id: 'mock-article-1', category: '花枝鼠', title: '花枝鼠的栖境，先从活动和啃咬开始', summary: '给足活动空间、可替换材质和藏身处，让日常照料更稳定。', body: '记录活动、啃咬和清洁频率，找到适合它的日常节奏。', coverUrl: null },
  { id: 'mock-article-2', category: '空间设计', title: '一处好栖境，至少要解决三个问题', summary: '安全、活动和清洁，是不同宠物共享的空间设计起点。', body: '从安全边界、活动路线和清洁动线开始规划。', coverUrl: null },
  { id: 'mock-article-3', category: '蛇类', title: '喂食前后需要观察哪些状态', summary: '记录体重、进食和排泄，帮助你发现变化。', body: '用固定时间记录体重、进食和排泄，异常时及时咨询专业人士。', coverUrl: null },
  { id: 'mock-article-4', category: '鹦鹉', title: '鹦鹉活动区如何兼顾安全和互动', summary: '从站立、啃咬到清洁，搭出适合日常互动的区域。', body: '准备不同高度的站立点和可替换啃咬材质。', coverUrl: null },
  { id: 'mock-article-5', category: '守宫', title: '守宫的温度梯度怎么搭', summary: '从热区、冷区到躲避屋，先把环境基础做好。', body: '让热区、冷区和躲避屋形成稳定梯度。', coverUrl: null },
  { id: 'mock-article-6', category: '蜘蛛', title: '湿度不是越高越好', summary: '按物种和蜕皮阶段建立自己的养护记录。', body: '根据物种和阶段调整湿度，避免长期过湿。', coverUrl: null },
];

const mockPosts = [
  { id: 'mock-post-1', tag: '求助', topic: '求助', title: '花枝鼠最近总啃咬围栏，栖境要怎么调整？', body: '想听听大家的调整经验。', author: '小满', authorName: '小满', time: '12 分钟前', likeCount: 18, likes: 18, commentCount: 6, comments: 6 },
  { id: 'mock-post-2', tag: '晒栖境', topic: '晒栖境', title: '把旧木箱改成了一个小小的雨林角落', body: '分享我的改造过程。', author: '阿葵', authorName: '阿葵', time: '1 小时前', likeCount: 42, likes: 42, commentCount: 9, comments: 9 },
  { id: 'mock-post-3', tag: '经验', topic: '经验', title: '记录我的第一只鹦鹉：从互动到作息', body: '把每天的互动和作息记录下来。', author: '北窗', authorName: '北窗', time: '昨天', likeCount: 31, likes: 31, commentCount: 4, comments: 4 },
  { id: 'mock-post-4', tag: '同城服务', topic: '同城服务', title: '深圳有没有靠谱的异宠寄养？', body: '想找同城寄养服务。', author: '椰椰', authorName: '椰椰', time: '昨天', likeCount: 12, likes: 12, commentCount: 8, comments: 8 },
];

const mockCareLogs = [
  { id: 'mock-log-1', petId: 'mock-pet-1', kind: '观察', note: '今天活动量正常', value: '', recordedAt: '2026-10-16T08:00:00.000Z', createdAt: '2026-10-16T08:00:00.000Z' },
];

const mockProviders = [
  { id: 'mock-provider-1', name: '示例寄养服务', serviceType: '寄养', city: '深圳', description: '演示数据，用于预览服务目录；不代表已入驻商家。', contactUrl: '' },
  { id: 'mock-provider-2', name: '示例护理服务', serviceType: '护理', city: '广州', description: '演示数据，用于预览城市和服务类型筛选。', contactUrl: '' },
];
const mockComments = [];
const mockReminders = [];

module.exports = { mockPets, mockProjects, mockOrders, mockArticles, mockPosts, mockCareLogs, mockProviders, mockComments, mockReminders };
