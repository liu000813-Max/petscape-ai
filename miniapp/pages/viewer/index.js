const { webBaseUrl } = require('../../utils/config');

Page({
  data: { url: '' },

  onLoad(options) {
    const projectId = options.projectId || '';
    const url = `${webBaseUrl}/workbench?project=${encodeURIComponent(projectId)}&source=miniapp`;
    this.setData({ url });
  },
});
