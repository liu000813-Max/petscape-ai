# PETSCAPE 宠境原生小程序

这是 `petscape-ai` 仓库中的原生微信小程序。当前按个人主体准备，优先完成宠物档案、养护知识、日常记录和站内提醒；社区和服务目录的开放范围等待注册后的实际类目核对。

## 已接入的仓库能力

- `GET/POST /api/v1/pets`：宠物档案。
- `GET/POST /api/v1/projects`：栖境项目列表和创建。
- `GET /api/v1/commerce/orders`：订单与进度。
- 知识文章列表和详情、社区发帖/评论/点赞、养护记录与站内到期提醒、同城服务筛选。
- Web 运营台 `/admin/content`：新增文章/服务商、审核发布/拒绝/下架、七日事件与错误汇总。
- `pages/viewer`：个人版显示原生说明与养护/档案入口；个人主体不支持内嵌网页。组织版候选路径需另外完成业务域名和真实登录验证。

## PETSCAPE 产品层

- 首页：宠物档案、养护知识、日常养护入口。
- 知识：按花枝鼠、守宫、蛇类、鹦鹉、蜘蛛和空间设计组织内容。
- 社区：求助、晒栖境、经验、同城服务四类主题。
- 宠物：官网五类异宠加“其他异宠”；其他异宠须填写具体物种，编辑时可清空选填资料。
- 栖境想法：保存项目名称；个人版说明 3D 预览和定制制作尚未开放。
- 订单：保留已有展示实现，不代表个人版已开放报价、支付或履约。

## 本地预览

1. 使用微信开发者工具打开本目录。
2. 当前 `miniapp/utils/config.js` 默认使用 mock 数据，便于直接评审 PETSCAPE 界面和物种分类。
3. 接入正式 AppID、服务端会话和线上接口后，将 `mockMode` 改为 `false`。
4. 个人版保留 `accountType: 'personal'`、`webViewEnabled: false`。演示内容不能作为线上真实服务。

## 必须补的接入工作

- 服务端已增加 `wx.login` -> `code2Session` -> Prisma Session 会话桥；生产环境需要配置 `WECHAT_MINIPROGRAM_APP_ID` 与 `WECHAT_MINIPROGRAM_APP_SECRET`。
- 小程序请求通过 `X-PetScape-Session` 发送票据，AppSecret 不进入小程序代码。
- 在微信公众平台配置 request 合法域名；个人版不配置或承诺 web-view。
- 本机空库迁移、重复迁移、旧库升级及真实数据库/HTTP 验收已通过；正式环境迁移、真实微信登录及设备验收分别完成。
- 将 `touristappid` 替换为正式 AppID，不把 AppSecret 放进小程序代码。
- 现有 Web 的 Job/Worker 与个人小程序能力分别验收；个人版原生 3D 尚未实现。

账号未建立时按 [账号准备指引](../docs/runbooks/miniapp-account-setup.md)由本人注册，不需要提前提供 AppSecret。配置后运行 Node 24 的 `node scripts/check-miniapp-ready.mjs`，仅检查本机客户端配置、根 `.env` 和进程环境变量；`--json` 输出脱敏报告，`--check` 在存在缺项时退出 1。它不会验证微信后台、密钥有效性、线上 API 或发布资格，也不写入配置。

## P1/P2 验收

本轮范围与接口见 [小程序内容规范](../docs/specs/miniapp-content.md)，最新表单与个人能力调整见 [个人版验收](../docs/operations/miniapp-personal-2026-10-16.md)。数据库及 HTTP 入口见 [运行手册](../docs/runbooks/miniapp-local-postgres.md)。

使用 Node 24 执行 `node --test web/tests/miniapp.test.mjs` 可验证原生页面配置、事件绑定、表单合同、mock 交互、登录合并与错误上报。配置诊断测试为 `node --test scripts/tests/check-miniapp-ready.test.mjs`。真实微信预览码需要登录开发者工具并配置正式 AppID；浏览器链接不能替代。
