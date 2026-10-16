const { webBaseUrl } = require('../../utils/config');
const { canUseEmbeddedWorkbench } = require('../../utils/capabilities');

Page({
  data: { url: '', projectTitle: '', message: '3D 预览尚未开放，你可以继续完善宠物档案和日常养护。' },

  onLoad(options = {}) {
    this.setData({ url: '', projectTitle: options.title || '' });
    if (!canUseEmbeddedWorkbench()) return;
    const projectId = options.projectId || '';
    if (!projectId) {
      this.setData({ message: '没有找到这个栖境项目，请返回项目列表重新选择。' });
      return;
    }
    const url = `${webBaseUrl}/workbench?project=${encodeURIComponent(projectId)}&source=miniapp`;
    this.setData({ url });
  },

  openPets() { wx.switchTab({ url: '/pages/pet/index' }); },
  openCare() { wx.navigateTo({ url: '/pages/care-log/index' }); },
});
