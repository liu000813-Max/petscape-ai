# PETSCAPE 微信小程序账号准备

用户没有营业执照，计划先以个人主体注册。2026-10-16 登录后台后，页面明确显示“小程序测试号”；测试号 AppID 已接入项目，正式个人小程序仍未注册完成。AppID 可以理解为该小程序的身份证号；AppSecret 是服务端用的密码，两者用途不同。测试号和正式账号不能只靠 AppID 的格式区分。

## 用户本人完成

1. 打开 [官方小程序注册表](https://mp.weixin.qq.com/wxopen/waregister?action=step1&source=mpregister)，也可从 [微信公众平台](https://mp.weixin.qq.com/)依次点击“立即注册 → 小程序 → 前往注册”。
2. 本人填写可用邮箱、邮件验证码并设置密码。2026-10-16 实际注册页面说明邮箱须未被公众平台、开放平台注册且未绑定个人微信；每个邮箱仅申请一个小程序。密码、验证码及协议由本人处理。
3. 信息登记时按已选方案选择个人主体，按平台页面完成资料和本人微信验证。个人账号的可选类目、收费、认证和审核要求以办理时页面为准，不承诺全部社区或交易能力可用。
4. 注册后在小程序后台查找“AppID（小程序 ID）”，将这一项提供给开发者；不要发送 AppSecret、验证码或登录密码。

[腾讯云官方指引](https://intl.cloud.tencent.com/document/product/1254/73282?lang=en)在“Obtain the developer ID”中说明登录小程序后台查看 AppID 的方式。其后续 AI 应用绑定步骤与本项目无关，不照搬。

官方注册表截图（未填写个人资料）：

![微信官方小程序注册表](../evidence/miniapp-http-20261016/account-registration.png)

## 个人主体对当前方案的影响

2026-10-16 直接核对 [微信官方 web-view 文档](https://developers.weixin.qq.com/miniprogram/dev/component/web-view.html)：个人类型小程序暂不支持 web-view。因此，现有“内嵌官网 3D 工作台”方案不能作为个人版的上线承诺；后续若需要小程序内 3D，应另行评估原生渲染方案，不能将普通网页链接冒充小程序能力。

宠物档案、养护和站内提醒继续进行现有技术联调；社区发布/评论和服务内容是否可面向用户开放，须对照个人账号后台实际可选类目与审核结果。当前客户端已配置微信测试号，仍使用 mock，尚未提交个人版审核；本次没有修改成伪装类目或隐藏功能的提审包。

客户端已按这个边界调整：首页进入日常养护；“栖境想法”保存项目名称；个人版预览入口显示原生说明，并可回到档案或养护。`accountType: 'personal'` 时即使误开网页开关，也不会加载内嵌工作台。社区和服务目录继续保留现有实现，注册后的开放范围仍须核对。

## 开发侧继续完成

- 当前 `miniapp/project.config.json` 已配置后台测试号，`utils/config.js` 标记 `accountMode: 'test'`。正式注册后替换 AppID 并核对注册状态，再改为 `registered`。
- 经用户授权读取的测试号 AppSecret 已保存在本机项目根 `.env`，该文件被 Git 忽略且仅当前 Windows 用户可读写；客户端与 Git 不保存它。
- 登录微信开发者工具并核对该账号开发权限；再进行真实微信登录、域名配置、真机验收、上传及体验成员设置。
- 每轮交付区分本地、GitHub、后端和小程序版本；成功上传并验证后才提供最新微信体验二维码。

在仓库根用 Node 24 运行 `node scripts/check-miniapp-ready.mjs`，可只读检查 AppID 格式、声明的账号注册状态、客户端/本机服务端一致性、AppSecret 格式、mock、HTTPS 地址、域名校验及个人网页能力开关。它只读取客户端配置、根 `.env` 和当前进程环境变量；不显示密钥、不修改配置、不验证微信后台或线上配置。`--json` 适合保存脱敏结果，`--check` 可作为本地严格检查。测试号或注册状态未知时严格检查失败；CI 只运行诊断器自身的测试，不以尚未完成的发布配置阻止其他开发。

## 微信预览入口

在仓库根 PowerShell 执行 `./scripts/preview-miniapp.ps1`，可用 `-DevtoolsCli` 指定实际安装的官方 `cli.bat`。入口不复制登录数据、不关闭令牌验证、不修改开发者工具安全配置。每轮在 `G:/Max麦麦/codex/petscape-dev-runtime/wechat-previews` 新建私有目录，保存官方输出、预览 PNG 和脱敏 receipt；不会把失败调用或旧二维码当作本轮成功。手机扫码仍须单独验证，测试号预览不称为正式体验版。

已完成的本机数据库和 HTTP 验收见 [运行手册](miniapp-local-postgres.md)与 [HTTP 记录](../operations/miniapp-http-2026-10-16.md)。目前没有可供手机扫码进入的 PETSCAPE 微信体验版。
