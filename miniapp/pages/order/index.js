const { listOrders } = require('../../utils/request');

Page({
  data: { orders: [], loading: true },

  onShow() {
    this.loadOrders();
  },

  async loadOrders() {
    this.setData({ loading: true });
    try {
      const result = await listOrders();
      const orders = (result.orders || []).map((order) => ({
        ...order,
        amountYuan: (Number(order.amountCent || 0) / 100).toFixed(2),
      }));
      this.setData({ orders, loading: false });
    } catch (error) {
      this.setData({ loading: false });
      wx.showToast({ title: error.statusCode === 401 ? '登录后查看订单' : '读取订单失败', icon: 'none' });
    }
  },

  openOrder(event) {
    wx.showModal({ title: '订单进度', content: `订单 ${event.currentTarget.dataset.id} 的详情页将在物流接口接入后开放。`, showCancel: false });
  },
});
