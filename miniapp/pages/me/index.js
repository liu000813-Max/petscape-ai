const { listPets, getProfile } = require('../../utils/request');
const { getSpeciesMeta } = require('../../utils/species');
const { lifeStageLabel } = require('../../utils/life-stages');
const { describeError } = require('../../utils/errors');
const { syncTabBar, openOfficialPosts } = require('../../utils/navigation');
const { slideDistance, animatePetTrack } = require('../../utils/pet-slide');

function petSelection(pets, index) {
  const previous = index > 0 ? index - 1 : pets.length > 2 ? pets.length - 1 : -1;
  return { petIndex: index, previousPetIndex: previous, selectedPetId: pets[index]?.id || '' };
}

Page({
  data: { pets: [], ...petSelection([], 0), petPreviewMargin: 150, petSlideDuration: 280,
    petSliding: false, petSlideTransform: '', loading: true, loaded: false,
    loadError: '', loadErrorTitle: '', loadErrorDetail: '', ownerName: '养宠人', ownerAvatar: '', ownerNotice: '' },
  onShow() { this.openingPet = false; syncTabBar(this); return Promise.all([this.loadPets(), this.loadOwner()]); },
  onHide() { this.finishPetSlide(false); },
  onUnload() {
    clearTimeout(this.petSlideTimer);
    this.readSequence = (this.readSequence || 0) + 1;
    this.ownerSequence = (this.ownerSequence || 0) + 1;
  },

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
    this.finishPetSlide(false);
    this.setData({ loading: true, loadError: '', loadErrorTitle: '', loadErrorDetail: '' });
    try {
      const result = await listPets();
      if (sequence !== this.readSequence) return;
      const pets = (result.pets || []).map((pet) => {
        const species = getSpeciesMeta(pet.speciesCode);
        return { ...pet, avatarUrl: pet.coverUrl || species.image, fallbackImage: species.image,
          speciesLabel: pet.speciesCode === 'other' && pet.customSpeciesName ? pet.customSpeciesName : species.label,
          lifeStageLabel: lifeStageLabel(pet.lifeStage) };
      });
      const index = Math.max(0, pets.findIndex(pet => pet.id === this.data.selectedPetId));
      this.setData({ pets, ...petSelection(pets, index), loading: false, loaded: true });
    } catch (error) {
      if (sequence !== this.readSequence) return;
      this.setData({ pets: [], loading: false, loaded: false, ...describeError(error) });
    }
  },

  onAvatarError(event) {
    const { id, src } = event.currentTarget.dataset;
    const index = this.data.pets.findIndex(pet => pet.id === id && pet.avatarUrl === src);
    if (index < 0) return;
    const pet = this.data.pets[index];
    this.setData({ [`pets[${index}].avatarUrl`]: pet.avatarUrl === pet.fallbackImage ? '' : pet.fallbackImage });
  },
  onPetSwipe({ detail: { current, source } }) {
    if (source !== 'touch' || this.data.loading || this.data.petSliding || !this.data.pets[current]) return;
    this.setData(petSelection(this.data.pets, current));
  },
  openPetDetail(event) {
    const { loading, petSliding, pets, petIndex } = this.data;
    if (loading || petSliding || this.openingPet) return;
    const id = event.currentTarget.dataset.id;
    const index = pets.findIndex(pet => pet.id === id);
    if (index < 0) return;
    if (index !== petIndex) {
      this.pendingPetId = id;
      return animatePetTrack(this, slideDistance(petIndex, index, pets.length));
    }
    this.openingPet = true;
    wx.navigateTo({ url: `/pages/pet-detail/index?id=${encodeURIComponent(id)}`, fail: () => {
      this.openingPet = false;
      wx.showToast({ title: '档案未打开，请重试', icon: 'none' });
    } });
  },
  finishPetSlide(select = true) {
    if (!this.data.petSliding) return;
    clearTimeout(this.petSlideTimer);
    const index = select ? this.data.pets.findIndex(pet => pet.id === this.pendingPetId) : -1;
    this.pendingPetId = null;
    this.setData({ petSliding: false, petSlideTransform: '', ...(index < 0 ? {} : petSelection(this.data.pets, index)) });
  },
  addPet() { wx.navigateTo({ url: '/pages/pet-edit/index' }); },
  openPets() { wx.switchTab({ url: '/pages/pet/index' }); },
  openSettings() { wx.navigateTo({ url: '/pages/settings/index' }); },
  openCare() { wx.navigateTo({ url: '/pages/care-log/index' }); },
  openHabitat() { wx.navigateTo({ url: '/pages/design/index' }); },
  openKnowledge() { openOfficialPosts(); },
});
