const config = require('./config');

// Account capability, not authorization. Business APIs still verify their sessions.
function canUseEmbeddedWorkbench(settings = config) {
  return settings.accountType === 'organization' && settings.webViewEnabled === true;
}

module.exports = { canUseEmbeddedWorkbench };
