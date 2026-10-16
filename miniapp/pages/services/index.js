const { listServiceProviders } = require('../../utils/request');
const { track } = require('../../utils/analytics');

Page({
  data: { providers: [], loading: true, city: '', types: ['全部', '寄养', '护理', '环境检查'], typeIndex: 0, error: '' },
  onShow() { return this.loadProviders(); },
  async loadProviders() {
    const sequence = (this.sequence || 0) + 1; this.sequence = sequence;
    this.setData({ loading: true, error: '' });
    const query = { ...(this.data.city.trim() ? { city: this.data.city.trim() } : {}), ...(this.data.typeIndex ? { serviceType: this.data.types[this.data.typeIndex] } : {}) };
    try {
      const result = await listServiceProviders(query);
      if (sequence === this.sequence) this.setData({ providers: result.providers || [], loading: false });
    } catch (error) {
      if (sequence === this.sequence) this.setData({ providers: [], loading: false, error: '服务读取失败，请重试' });
    }
  },
  onCityInput(event) { this.setData({ city: event.detail.value }); },
  onTypeChange(event) {
    const typeIndex = Number(event.detail.value);
    if (!Number.isInteger(typeIndex) || !this.data.types[typeIndex]) return;
    this.setData({ typeIndex }); return this.loadProviders();
  },
  contact(event) { const url = event.currentTarget.dataset.url; track('service.open', { providerId: event.currentTarget.dataset.id }); if (url) wx.setClipboardData({ data: url, success: () => wx.showToast({ title: '联系方式已复制', icon: 'success' }) }); },
});
