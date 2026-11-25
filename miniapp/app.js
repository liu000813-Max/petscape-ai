const config = require('./utils/config');
const { track } = require('./utils/analytics');
const onboarding = require('./utils/onboarding');

App({
  globalData: {
    apiBaseUrl: config.apiBaseUrl,
    webBaseUrl: config.webBaseUrl,
    mockMode: config.mockMode,
    user: null,
  },

  onLaunch(options) {
    this.onboardingPending = onboarding.isHomeEntry(options) && !onboarding.hasCompleted();
    track('app.launch');
  },

  onShow(options) {
    if (!onboarding.isHomeEntry(options)) this.onboardingPending = false;
  },

  openOnboarding(onFailure) {
    if (!this.onboardingPending) return false;
    this.onboardingPending = false;
    wx.navigateTo({ url: '/pages/onboarding/index?entry=first', fail: () => {
      if (typeof onFailure === 'function') onFailure();
    } });
    return true;
  },

  onError() { track('client.error', { code: 'runtime' }); },
  onUnhandledRejection() { track('client.error', { code: 'unhandled_rejection' }); },
});
