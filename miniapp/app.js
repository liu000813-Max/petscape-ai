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
    track('app.launch');
  },

  onError() { track('client.error', { code: 'runtime' }); },
  onUnhandledRejection() { track('client.error', { code: 'unhandled_rejection' }); },
});
