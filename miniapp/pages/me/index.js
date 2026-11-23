const { listPets } = require('../../utils/request');
const { getSpeciesMeta } = require('../../utils/species');
const { lifeStageLabel } = require('../../utils/life-stages');
const { describeError } = require('../../utils/errors');
const { syncTabBar } = require('../../utils/navigation');

Page({
  data: { pets: [], loading: true, loaded: false, loadError: '', loadErrorTitle: '', loadErrorDetail: '' },
  onShow() { syncTabBar(this); return this.loadPets(); },
  onUnload() { this.readSequence = (this.readSequence || 0) + 1; },

  async loadPets() {
    const sequence = (this.readSequence || 0) + 1; this.readSequence = sequence;
    this.setData({ pets: [], loading: true, loaded: false, loadError: '', loadErrorTitle: '', loadErrorDetail: '' });
    try {
      const result = await listPets();
      if (sequence !== this.readSequence) return;
      const pets = (result.pets || []).map((pet) => {
        const species = getSpeciesMeta(pet.speciesCode);
        return { ...pet, avatarUrl: pet.coverUrl || species.image, fallbackImage: species.image,
          speciesLabel: pet.speciesCode === 'other' && pet.customSpeciesName ? pet.customSpeciesName : species.label,
          lifeStageLabel: lifeStageLabel(pet.lifeStage) };
      });
      this.setData({ pets, loading: false, loaded: true });
    } catch (error) {
      if (sequence !== this.readSequence) return;
      this.setData({ loading: false, ...describeError(error) });
    }
  },

  onAvatarError(event) {
    const index = this.data.pets.findIndex((pet) => pet.id === event.currentTarget.dataset.id);
    if (index < 0) return;
    const pet = this.data.pets[index];
    this.setData({ [`pets[${index}].avatarUrl`]: pet.avatarUrl === pet.fallbackImage ? '' : pet.fallbackImage });
  },
  editPet(event) {
    const id = event.currentTarget.dataset.id;
    if (!this.data.pets.some((pet) => pet.id === id)) return;
    wx.navigateTo({ url: `/pages/pet-edit/index?id=${encodeURIComponent(id)}` });
  },
  addPet() { wx.navigateTo({ url: '/pages/pet-edit/index' }); },
  openPets() { wx.switchTab({ url: '/pages/pet/index' }); },
  openSettings() { wx.navigateTo({ url: '/pages/settings/index' }); },
  openCare() { wx.navigateTo({ url: '/pages/care-log/index' }); },
  openHabitat() { wx.navigateTo({ url: '/pages/design/index' }); },
  openKnowledge() { wx.switchTab({ url: '/pages/knowledge/index' }); },
});
