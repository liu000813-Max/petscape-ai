const { listPets } = require('../../utils/request');
const { getSpeciesMeta } = require('../../utils/species');

Page({
  data: { pets: [], loading: true },

  onShow() {
    this.loadPets();
  },

  async loadPets() {
    this.setData({ loading: true });
    try {
      const result = await listPets();
      const pets = (result.pets || []).map((pet) => ({
        ...pet,
        speciesLabel: getSpeciesMeta(pet.speciesCode).label,
        speciesEmoji: getSpeciesMeta(pet.speciesCode).emoji,
        speciesImage: getSpeciesMeta(pet.speciesCode).image,
      }));
      this.setData({ pets, loading: false });
    } catch (error) {
      this.setData({ loading: false });
      wx.showToast({ title: error.statusCode === 401 ? '登录后管理档案' : '读取失败', icon: 'none' });
    }
  },

  addPet() {
    wx.navigateTo({ url: '/pages/pet-edit/index' });
  },

  editPet(event) {
    const id = event.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/pet-edit/index?id=${id}` });
  },

  openDesign() {
    wx.navigateTo({ url: '/pages/design/index' });
  },

  openCareLog() { wx.navigateTo({ url: '/pages/care-log/index' }); },
});
