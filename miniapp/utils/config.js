module.exports = {
  // 微信后台当前提供的是测试号，正式注册后核对并改为 registered。
  accountMode: 'test',
  // 当前用户选择个人主体；个人类型不支持 web-view。
  accountType: 'personal',
  // 仅在组织主体具备网页能力并完成业务域名验证后开启。
  webViewEnabled: false,
  // 改为已备案的 HTTPS API 域名后，再提交微信小程序审核。
  apiBaseUrl: 'https://petscape3d.com',
  webBaseUrl: 'https://petscape3d.com',
  // 当前后端尚未部署小程序接口，测试号预览继续使用演示数据。
  mockMode: true,
};
