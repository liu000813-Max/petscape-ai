const { TABS, currentTab } = require('../utils/navigation');

Component({
  data: { tabs: TABS, selected: '', hidden: false },
  lifetimes: { attached() { this.sync(); } },
  pageLifetimes: { show() { this.sync(); } },
  methods: {
    sync() {
      const pages = getCurrentPages();
      const page = pages[pages.length - 1];
      this.setData({ selected: currentTab(), hidden: Boolean(page?.data?.activeModal || page?.data?.brandLaunching) });
    },
    switchTab(event) {
      const path = event.currentTarget.dataset.path;
      if (this.data.hidden || this.navigating || !TABS.some((tab) => tab.pagePath === path) || path === currentTab()) return;
      this.navigating = true;
      wx.switchTab({
        url: '/' + path,
        success: () => {
          if (typeof wx.vibrateShort === 'function') wx.vibrateShort({ type: 'light', fail() {} });
        },
        fail: () => wx.showToast({ title: '切换未完成，请重试', icon: 'none' }),
        complete: () => { this.navigating = false; this.sync(); },
      });
    },
  },
});
