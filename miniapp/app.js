const config = require('./utils/config');
const { track } = require('./utils/analytics');

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
    track('app.launch');
  },

  onError() { track('client.error', { code: 'runtime' }); },
  onUnhandledRejection() { track('client.error', { code: 'unhandled_rejection' }); },
});
