module.exports = {
  // 当前用户选择个人主体；个人类型不支持 web-view。
  accountType: 'personal',
  // 仅在组织主体具备网页能力并完成业务域名验证后开启。
  webViewEnabled: false,
  // 改为已备案的 HTTPS API 域名后，再提交微信小程序审核。
  apiBaseUrl: 'https://petscape3d.com',
  webBaseUrl: 'https://petscape3d.com',
  // 本地视觉评审默认使用 mock；接入正式 AppID 与服务端后改为 false。
  mockMode: true,
};
