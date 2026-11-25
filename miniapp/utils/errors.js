// Only fixed categories and validated request IDs may reach the page or telemetry.
const MESSAGES = {
  WX_LOGIN_TIMEOUT: ['微信登录超时', '请确认微信网络正常后重试。'],
  WX_LOGIN_FAILED: ['微信登录未完成', '请确认当前微信可正常使用，再重试登录。'],
  WX_LOGIN_CODE_MISSING: ['微信登录未完成', '微信未返回登录凭证，请重试。'],
  DOMAIN_NOT_ALLOWED: ['请求域名未获微信许可', '请联系管理员核对小程序的 request 合法域名。'],
  REQUEST_TIMEOUT: ['网络连接超时', '请检查网络，稍后重试。'],
  TLS_FAILED: ['连接安全校验未通过', '请检查手机时间；若仍失败，请联系管理员检查 HTTPS 证书。'],
  DNS_FAILED: ['域名解析失败', '请切换网络后重试。'],
  NETWORK_FAILED: ['暂时无法连接网络', '请检查微信联网权限或切换网络后重试。'],
  LOGIN_NOT_CONFIGURED: ['微信登录服务尚未配置', '请联系管理员完成服务端微信配置。'],
  WECHAT_REJECTED: ['微信身份校验未通过', '请重试；若仍失败，请联系管理员核对微信账号配置。'],
  SESSION_INVALID: ['微信登录未完成', '服务端未返回有效会话，请联系管理员。'],
  SESSION_EXPIRED: ['登录状态已失效', '自动恢复未成功，请重试登录。'],
  ACCESS_DENIED: ['暂无访问权限', '请确认当前账号有权访问此内容。'],
  SERVICE_UNAVAILABLE: ['服务暂时不可用', '请稍后重试，或将诊断编号提供给管理员。'],
  GROWTH_REQUIRES_CONNECTION: ['成长记录需要连接服务', '请在联网版本中查看和保存成长记录。'],
  REQUEST_FAILED: ['宠物档案暂未加载', '读取失败，请重试；若仍失败，请提供诊断编号。'],
};

const STAGES = { 'wx-login': '微信登录', 'session-exchange': '建立会话', api: '读取接口' };

function safeRequestId(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value) ? value : '';
}

function normalizeError(error, stage = 'api') {
  const source = error || {};
  const message = typeof source.errMsg === 'string' ? source.errMsg : '';
  let code;
  if (source.stage === stage && Object.prototype.hasOwnProperty.call(MESSAGES, source.code)) code = source.code;
  else if (stage === 'wx-login') code = /timeout|timed out/i.test(message) ? 'WX_LOGIN_TIMEOUT' : 'WX_LOGIN_FAILED';
  else if (/not in (?:the )?domain list|不在.*合法域名/i.test(message)) code = 'DOMAIN_NOT_ALLOWED';
  else if (/timeout|timed out/i.test(message)) code = 'REQUEST_TIMEOUT';
  else if (/ssl|tls|certificate|cert_|证书/i.test(message)) code = 'TLS_FAILED';
  else if (/name_not_resolved|dns|resolve host|域名解析/i.test(message)) code = 'DNS_FAILED';
  else if (message) code = 'NETWORK_FAILED';
  else if (source.data && source.data.error === 'wechat_login_not_configured') code = 'LOGIN_NOT_CONFIGURED';
  else if (source.data && source.data.error === 'wechat_login_failed') code = 'WECHAT_REJECTED';
  else if (source.statusCode === 401) code = 'SESSION_EXPIRED';
  else if (source.statusCode === 403) code = 'ACCESS_DENIED';
  else if (source.statusCode >= 500) code = 'SERVICE_UNAVAILABLE';
  else code = 'REQUEST_FAILED';
  return { ...source, code, stage };
}

function describeError(error) {
  const stage = error && Object.prototype.hasOwnProperty.call(STAGES, error.stage) ? error.stage : 'api';
  const normalized = normalizeError(error, stage);
  const [title, message] = MESSAGES[normalized.code];
  const requestId = safeRequestId(normalized.requestId);
  return {
    loadErrorTitle: title,
    loadError: message,
    loadErrorDetail: `诊断：${normalized.code} · ${STAGES[stage]}${requestId ? ` · 请求编号 ${requestId}` : ''}`,
  };
}

module.exports = { normalizeError, describeError, safeRequestId };
