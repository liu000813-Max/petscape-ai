const { listPets, listProjects } = require('../../utils/request');
const { getSpeciesMeta } = require('../../utils/species');

Page({
  data: {
    pet: null,
    project: null,
    loading: true,
    quickActions: [
      { title: '创建专属栖境', note: '从宠物照片开始', path: '/pages/design/index', tone: 'dark' },
      { title: '查看养护知识', note: '按物种快速查找', path: '/pages/knowledge/index', tone: 'light' },
    ],
    highlights: [
      { tag: '今日养护', title: '温度、湿度和躲避空间', note: '把知识变成每天能执行的小动作。' },
      { tag: '设计灵感', title: '让宠物的生活空间更像它自己', note: 'AI 生成方案，3D 预览后再决定制作。' },
    ],
  },

  onShow() {
    this.loadSummary();
  },

  async loadSummary() {
    this.setData({ loading: true });
    try {
      const [pets, projects] = await Promise.all([listPets(), listProjects()]);
      const pet = pets.pets && pets.pets[0] ? pets.pets[0] : null;
      this.setData({
        pet: pet ? { ...pet, speciesLabel: getSpeciesMeta(pet.speciesCode).label, speciesEmoji: getSpeciesMeta(pet.speciesCode).emoji } : null,
        project: projects.projects && projects.projects[0] ? projects.projects[0] : null,
        loading: false,
      });
    } catch (error) {
      this.setData({ loading: false });
      if (error && error.statusCode === 401) {
        wx.showToast({ title: '登录后同步档案', icon: 'none' });
      }
    }
  },

  openAction(event) {
    wx.navigateTo({ url: event.currentTarget.dataset.path });
  },

  openPet() {
    wx.switchTab({ url: '/pages/pet/index' });
  },

  openProject() {
    wx.navigateTo({ url: '/pages/design/index' });
  },
});
