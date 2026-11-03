const { listPets } = require('../../utils/request');
const { getSpeciesMeta } = require('../../utils/species');
const { track } = require('../../utils/analytics');

Page({
  data: {
    pet: null,
    loading: true,
    loadError: '',
    mockMode: true,
    quickActions: [
      { title: '完善宠物档案', note: '记录物种与生活习性', path: '/pages/pet/index', tone: 'dark' },
      { title: '查看养护知识', note: '按物种快速查找', path: '/pages/knowledge/index', tone: 'light' },
    ],
    highlights: [
      { tag: '今日养护', title: '温度、湿度和躲避空间', note: '把知识变成每天能执行的小动作。' },
      { tag: '栖境观察', title: '让宠物的生活空间更像它自己', note: '从体型、习性和环境笔记开始了解它。' },
    ],
  },

  onShow() {
    this.setData({ mockMode: getApp().globalData.mockMode });
    track('home.view');
    return this.loadSummary();
  },

  async loadSummary() {
    this.setData({ pet: null, loading: true, loadError: '' });
    try {
      const pets = await listPets();
      const pet = pets.pets && pets.pets[0] ? pets.pets[0] : null;
      this.setData({
        pet: pet ? { ...pet, speciesLabel: pet.speciesCode === 'other' && pet.customSpeciesName ? pet.customSpeciesName : getSpeciesMeta(pet.speciesCode).label, speciesEmoji: getSpeciesMeta(pet.speciesCode).emoji, speciesImage: getSpeciesMeta(pet.speciesCode).image } : null,
        loading: false,
      });
    } catch (error) {
      this.setData({
        loading: false,
        loadError: error && error.statusCode === 401 ? '微信登录未完成，请重试' : '暂时无法读取宠物档案，请检查网络后重试',
      });
    }
  },

  openAction(event) {
    const url = event.currentTarget.dataset.path;
    if (url === '/pages/knowledge/index' || url === '/pages/pet/index') wx.switchTab({ url });
    else wx.navigateTo({ url });
  },

  openPet() {
    wx.switchTab({ url: '/pages/pet/index' });
  },

  openCare() {
    wx.navigateTo({ url: '/pages/care-log/index' });
  },
});
