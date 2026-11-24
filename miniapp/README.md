# PETSCAPE 宠境原生小程序

“我的”和设置最初随五栏导航接入，历史验证见 [2026-11-23 记录](../docs/operations/miniapp-me-navigation-2026-11-23.md)。当前底栏为首页／宠物／社区／我的。

主人头像、微信昵称填写及资料保存见 [主人资料规范](../docs/specs/miniapp-owner-profile.md) 与 [验收](../docs/operations/miniapp-owner-profile-2026-11-23.md)。

首页点宠物头像进入 [单宠详情](../docs/operations/miniapp-pet-detail-2026-11-23.md)，在详情页也可编辑档案或查看该宠物的养护记录。

首次普通首页入口提供三页使用引导，动物素材采用纯白背景；跳过或完成后在本机记住，也可从“我的 → 设置 → 使用引导”重看。分享和扫码直达保留原目标。实现与验收见 [首次使用引导记录](../docs/operations/miniapp-onboarding-2026-11-24.md)。

最近实现与核验见 [登录恢复和发布记录](../docs/operations/miniapp-login-recovery-2026-11-16.md)：错误可按阶段诊断，过期会话最多恢复一次；微信正式账号及体验版仍需后台事实验证。历史 HTTPS 与微信数据证据见 [2026-11-03 记录](../docs/operations/miniapp-device-2026-11-03.md)。

这是 `petscape-ai` 仓库中的原生微信小程序。当前按个人主体准备，优先完成宠物档案、养护知识、日常记录和站内提醒；社区和服务目录的开放范围等待注册后的实际类目核对。

## 已接入的仓库能力

- `GET/POST /api/v1/pets`：宠物档案。
- `GET/POST /api/v1/projects`：宠境项目列表和创建。
- `GET /api/v1/commerce/orders`：订单与进度。
- 知识文章列表和详情、社区发帖/评论/点赞、养护记录与站内到期提醒、同城服务筛选。
- Web 运营台 `/admin/content`：新增文章/服务商、审核发布/拒绝/下架、七日事件与错误汇总。
- `pages/viewer`：个人版显示原生说明与养护/档案入口；个人主体不支持内嵌网页。组织版候选路径需另外完成业务域名和真实登录验证。

## PETSCAPE 产品层

- 首页：宠物档案、官方帖、体重与喂食克数、日常养护入口。体重和喂食可分别切换柱状图和折线图。
- 社区：社区动态按求助、晒宠境、经验、同城服务浏览。已发布养护知识显示为官方帖，保留物种和空间设计筛选；点星标后从同设备的“已收藏”找回。
- 宠物：官网五类异宠加“其他异宠”；其他异宠须填写具体物种，编辑时可清空选填资料。
- 我的：默认养宠人身份、本人宠物横滑卡、养护和宠境入口、知识建议；不冒充已授权微信昵称或用户头像。
- 设置：点击打开微信权限、刷新宠物资料、数据使用说明与实际版本信息。
- 宠境想法：保存项目名称；个人版说明 3D 预览和定制制作尚未开放。
- 订单：保留已有展示实现，不代表个人版已开放报价、支付或履约。

养护页按宠物 ID 保持当前选择，未保存草稿在页面内按宠物分别暂存。保存期间锁定相关输入与切换；读取失败清空旧列表并支持重试。同城服务筛选避免旧请求覆盖新结果，见 [交互验收](../docs/operations/miniapp-care-2026-10-16.md)。

## 本地预览

1. 使用微信开发者工具打开本目录。
2. 当前 `miniapp/utils/config.js` 使用 `/miniapp-api` 独立 API 前缀，默认发起真实请求；需要纯界面演示时可在本机显式开启 mock。
   当前 AppID 已接入微信后台提供的测试号，`accountMode: 'test'`；它不代表正式注册或上传体验版完成。
3. 正式发布前核对正式 AppID、服务端会话、request 合法域名和真机行为；`mockMode: false` 本身不证明这些工作已经完成。
4. 个人版保留 `accountType: 'personal'`、`webViewEnabled: false`。演示内容不能作为线上真实服务。

## 必须补的接入工作

- 服务端已增加 `wx.login` -> `code2Session` -> Prisma Session 会话桥；生产环境需要配置 `WECHAT_MINIPROGRAM_APP_ID` 与 `WECHAT_MINIPROGRAM_APP_SECRET`。
- 小程序请求通过 `X-PetScape-Session` 发送票据，AppSecret 不进入小程序代码。
- 在微信公众平台配置 request 合法域名；个人版不配置或承诺 web-view。
- 本机空库迁移、重复迁移、旧库升级及真实数据库/HTTP 验收已通过；正式环境迁移、真实微信登录及设备验收分别完成。
- 正式注册后替换当前测试号 AppID，并核对 `accountMode: 'registered'`；AppID 格式本身不能证明账号注册状态。不把 AppSecret 放进小程序代码。
- 现有 Web 的 Job/Worker 与个人小程序能力分别验收；个人版原生 3D 尚未实现。

账号未建立时按 [账号准备指引](../docs/runbooks/miniapp-account-setup.md)由本人注册，不需要提前提供 AppSecret。配置后运行 Node 24 的 `node scripts/check-miniapp-ready.mjs`，仅检查本机客户端配置、根 `.env` 和进程环境变量；`--json` 输出脱敏报告，`--check` 在存在缺项时退出 1。它不会验证微信后台、密钥有效性、线上 API 或发布资格，也不写入配置。

## P1/P2 验收

本轮范围与接口见 [小程序内容规范](../docs/specs/miniapp-content.md)，最新表单与个人能力调整见 [个人版验收](../docs/operations/miniapp-personal-2026-10-16.md)。数据库及 HTTP 入口见 [运行手册](../docs/runbooks/miniapp-local-postgres.md)。

使用 Node 24 执行 `node --test web/tests/miniapp.test.mjs` 可验证原生页面配置、事件绑定、表单合同、mock 交互、登录合并与错误上报。配置诊断测试为 `node --test scripts/tests/check-miniapp-ready.test.mjs`。

PowerShell 运行 `./scripts/preview-miniapp.ps1` 调用官方工具生成当前项目的微信预览码，要求工具登录、服务端口可连接和当前 AppID 具备预览权限。产物留在仓库外的独立运行目录；失败不复用旧二维码。部分官方 Windows CLI 出错仍返回 0，入口同时检查错误信息与本轮新图的实际 PNG/JPEG 格式；JPEG 使用 `.jpg` 扩展名，receipt 保存格式和 SHA-256。预览码、真机验收与正式体验版上传分别记录；浏览器链接不能替代。

Windows 下用 Node 24 执行 `node --test scripts/tests/preview-miniapp.test.mjs scripts/tests/check-miniapp-ready.test.mjs`，覆盖预览成功、格式差异、CLI 误报成功和旧图隔离等情况。2026-10-16 的测试号预览使用 mock，见 [恢复记录](../docs/operations/miniapp-test-account-2026-10-16.md)；独立真实后端的最新状态见 [发布记录](../docs/operations/miniapp-backend-2026-10-28.md)。手机扫码和正式体验版上传分别验收。
