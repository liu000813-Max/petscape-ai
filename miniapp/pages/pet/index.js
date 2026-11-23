const { listPets } = require('../../utils/request');
const { getSpeciesMeta } = require('../../utils/species');
const { describeError } = require('../../utils/errors');
const { lifeStageLabel } = require('../../utils/life-stages');

Page({
  data: { pets: [], loading: true, loadError: '', loadErrorTitle: '', loadErrorDetail: '' },

  onShow() {
    return this.loadPets();
  },

  async loadPets() {
    this.setData({ pets: [], loading: true, loadError: '', loadErrorTitle: '', loadErrorDetail: '' });
    try {
      const result = await listPets();
      const pets = (result.pets || []).map((pet) => ({
        ...pet,
        speciesLabel: pet.speciesCode === 'other' && pet.customSpeciesName ? pet.customSpeciesName : getSpeciesMeta(pet.speciesCode).label,
        speciesEmoji: getSpeciesMeta(pet.speciesCode).emoji,
        speciesImage: pet.coverUrl || getSpeciesMeta(pet.speciesCode).image,
        lifeStageLabel: lifeStageLabel(pet.lifeStage),
      }));
      this.setData({ pets, loading: false });
    } catch (error) {
      this.setData({
        loading: false,
        ...describeError(error),
      });
    }
  },

  addPet() {
    wx.navigateTo({ url: '/pages/pet-edit/index' });
  },

  onAvatarError(event) {
    const index = this.data.pets.findIndex((pet) => pet.id === event.currentTarget.dataset.id);
    if (index < 0) return;
    const pet = this.data.pets[index]; const fallback = getSpeciesMeta(pet.speciesCode).image;
    this.setData({ [`pets[${index}].speciesImage`]: pet.speciesImage === fallback ? '' : fallback });
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
