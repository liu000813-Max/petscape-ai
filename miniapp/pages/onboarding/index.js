const onboarding = require('../../utils/onboarding');

Page({
  data: { current: 0, leaving: false },
  onChange(event) {
    const current = event.detail.current;
    if (!this.data.leaving && Number.isInteger(current) && current >= 0 && current < 3) this.setData({ current });
  },
  next() {
    if (this.data.leaving) return;
    if (this.data.current < 2) this.setData({ current: this.data.current + 1 });
    else this.finish();
  },
  finish() {
    if (this.data.leaving) return;
    this.setData({ leaving: true });
    wx.switchTab({ url: '/pages/home/index',
      success: () => onboarding.complete(),
      fail: () => {
        this.setData({ leaving: false });
        wx.showToast({ title: '首页未打开，请重试', icon: 'none' });
      },
    });
  },
});
