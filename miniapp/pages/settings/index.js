const { listPets } = require('../../utils/request');
const { describeError } = require('../../utils/errors');
const { accountMode } = require('../../utils/config');

Page({
  data: { refreshing: false, refreshNotice: '', loadError: '', loadErrorTitle: '', loadErrorDetail: '',
    versionLabel: '版本信息暂不可用', accountLabel: accountMode === 'test' ? '小程序测试号' : 'PETSCAPE 小程序' },
  onLoad() {
    if (typeof wx.getAccountInfoSync !== 'function') return;
    try {
      const info = wx.getAccountInfoSync().miniProgram || {};
      const labels = { develop: '开发预览', trial: '体验版', release: '正式版' };
      this.setData({ versionLabel: (labels[info.envVersion] || '版本信息暂不可用') + (info.version ? ` · ${info.version}` : '') });
    } catch (_) { /* Version information is optional; settings remain usable. */ }
  },
  openPermissions() {
    if (typeof wx.openSetting !== 'function') { wx.showToast({ title: '当前微信不支持权限设置入口', icon: 'none' }); return; }
    wx.openSetting({ fail: () => wx.showToast({ title: '权限设置未打开，请重试', icon: 'none' }) });
  },
  async refreshData() {
    if (this.data.refreshing) return;
    this.setData({ refreshing: true, refreshNotice: '', loadError: '', loadErrorTitle: '', loadErrorDetail: '' });
    try {
      const result = await listPets();
      this.setData({ refreshNotice: `已读取最新资料，共 ${(result.pets || []).length} 份宠物档案。返回后页面会重新读取。` });
    } catch (error) {
      this.setData(describeError(error));
    } finally { this.setData({ refreshing: false }); }
  },
  showDataInfo() {
    wx.showModal({ title: '数据与隐私说明', showCancel: false, confirmText: '知道了',
      content: '宠物档案、照片、养护记录和提醒通过当前微信会话读取与保存。请勿上传含证件、住址等敏感信息的照片。\n\n刷新不会删除云端档案；登录过期时会尝试重新登录。相册等权限可在“微信权限”中调整。' });
  },
  showAbout() {
    wx.showModal({ title: '关于 PETSCAPE', showCancel: false, confirmText: '知道了',
      content: `给每一只宠物，一处合适的栖境。\n\n记录宠物档案，查看养护知识，留下每天的照料。\n\n${this.data.accountLabel} · ${this.data.versionLabel}` });
  },
});
