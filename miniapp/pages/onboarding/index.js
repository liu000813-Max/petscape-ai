const onboarding = require('../../utils/onboarding');
const { listPets } = require('../../utils/request');

Page({
  data: { current: 0, leaving: false, canCreateFirstPet: false },
  async onLoad(options) {
    if (options?.entry !== 'first') return;
    try {
      const { pets } = await listPets();
      if (!this.closed && Array.isArray(pets)) this.setData({ canCreateFirstPet: pets.length === 0 });
    } catch (_) { /* A failed profile read still allows the guide to finish at home. */ }
  },
  onUnload() { this.closed = true; },
  onChange(event) {
    const current = event.detail.current;
    if (!this.data.leaving && Number.isInteger(current) && current >= 0 && current < 3) this.setData({ current });
  },
  next() {
    if (this.data.leaving) return;
    if (this.data.current < 2) this.setData({ current: this.data.current + 1 });
    else this.finish(this.data.canCreateFirstPet);
  },
  skip() { this.finish(false); },
  finish(createPet = false) {
    if (this.data.leaving) return;
    this.setData({ leaving: true });
    const options = { url: createPet ? '/pages/pet-edit/index' : '/pages/home/index',
      success: () => onboarding.complete(),
      fail: () => {
        this.setData({ leaving: false });
        wx.showToast({ title: '页面未打开，请重试', icon: 'none' });
      },
    };
    if (createPet) wx.redirectTo(options);
    else wx.switchTab(options);
  },
});
