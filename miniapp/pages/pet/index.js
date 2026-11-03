const { listPets } = require('../../utils/request');
const { getSpeciesMeta } = require('../../utils/species');

Page({
  data: { pets: [], loading: true, loadError: '' },

  onShow() {
    return this.loadPets();
  },

  async loadPets() {
    this.setData({ pets: [], loading: true, loadError: '' });
    try {
      const result = await listPets();
      const pets = (result.pets || []).map((pet) => ({
        ...pet,
        speciesLabel: pet.speciesCode === 'other' && pet.customSpeciesName ? pet.customSpeciesName : getSpeciesMeta(pet.speciesCode).label,
        speciesEmoji: getSpeciesMeta(pet.speciesCode).emoji,
        speciesImage: getSpeciesMeta(pet.speciesCode).image,
      }));
      this.setData({ pets, loading: false });
    } catch (error) {
      this.setData({
        loading: false,
        loadError: error && error.statusCode === 401 ? '微信登录未完成，请重试' : '暂时无法读取宠物档案，请检查网络后重试',
      });
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
