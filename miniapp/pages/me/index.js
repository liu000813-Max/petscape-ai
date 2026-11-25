const { listPets, getProfile } = require('../../utils/request');
const { getSpeciesMeta } = require('../../utils/species');
const { lifeStageLabel } = require('../../utils/life-stages');
const { describeError } = require('../../utils/errors');
const { syncTabBar, openOfficialPosts } = require('../../utils/navigation');

Page({
  data: { pets: [], loading: true, loaded: false, loadError: '', loadErrorTitle: '', loadErrorDetail: '', ownerName: '养宠人', ownerAvatar: '', ownerNotice: '' },
  onShow() { syncTabBar(this); return Promise.all([this.loadPets(), this.loadOwner()]); },
  onUnload() { this.readSequence = (this.readSequence || 0) + 1; this.ownerSequence = (this.ownerSequence || 0) + 1; },

  async loadOwner() {
    const sequence = (this.ownerSequence || 0) + 1; this.ownerSequence = sequence;
    this.setData({ ownerName: '养宠人', ownerAvatar: '', ownerNotice: '正在读取资料…' });
    try {
      const profile = await getProfile();
      if (sequence !== this.ownerSequence) return;
      this.setData({ ownerName: profile.nickname || '养宠人', ownerAvatar: profile.avatarUrl || '', ownerNotice: '点击编辑个人资料' });
    } catch (_) {
      if (sequence === this.ownerSequence) this.setData({ ownerNotice: '资料暂未读取 · 点击重试或编辑' });
    }
  },
  onOwnerAvatarError() { this.setData({ ownerAvatar: '' }); },
  openProfile() { wx.navigateTo({ url: '/pages/profile-edit/index' }); },

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
  openPetDetail(event) {
    const id = event.currentTarget.dataset.id;
    if (!this.data.pets.some((pet) => pet.id === id)) return;
    wx.navigateTo({ url: `/pages/pet-detail/index?id=${encodeURIComponent(id)}` });
  },
  addPet() { wx.navigateTo({ url: '/pages/pet-edit/index' }); },
  openPets() { wx.switchTab({ url: '/pages/pet/index' }); },
  openSettings() { wx.navigateTo({ url: '/pages/settings/index' }); },
  openCare() { wx.navigateTo({ url: '/pages/care-log/index' }); },
  openHabitat() { wx.navigateTo({ url: '/pages/design/index' }); },
  openKnowledge() { openOfficialPosts(); },
});
