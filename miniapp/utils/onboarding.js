const COMPLETED_KEY = 'petscape_onboarding_v1';

function isHomeEntry(options) {
  return Boolean(options && (!options.path || options.path === 'pages/home/index')
    && (options.scene === undefined || options.scene === 1001 || options.scene === 1089)
    && !Object.keys(options.query || {}).length && !options.referrerInfo?.appId);
}

function hasCompleted() {
  try { return wx.getStorageSync(COMPLETED_KEY) === true; } catch (_) { return false; }
}

function complete() {
  try { wx.setStorageSync(COMPLETED_KEY, true); } catch (_) { /* This visit still completes when local storage is unavailable. */ }
}

module.exports = { isHomeEntry, hasCompleted, complete };
