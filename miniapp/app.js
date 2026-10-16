const config = require('./utils/config');

App({
  globalData: {
    apiBaseUrl: config.apiBaseUrl,
    webBaseUrl: config.webBaseUrl,
    mockMode: config.mockMode,
    user: null,
  },

  onLaunch() {
    const storedMode = wx.getStorageSync('petscape_mock_mode');
    if (typeof storedMode === 'boolean') {
      this.globalData.mockMode = storedMode;
    }
  },
});
