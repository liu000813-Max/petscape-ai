const { trackEvent } = require('./request');

function track(eventName, properties = {}) {
  const pages = getCurrentPages();
  const current = pages.length ? pages[pages.length - 1] : null;
  return trackEvent({
    eventName,
    path: current && current.route ? `/${current.route}` : null,
    properties,
  }).catch(() => undefined);
}

module.exports = { track };
