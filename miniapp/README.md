# PETSCAPE 宠境原生小程序

这是 `petscape-ai` 仓库中的原生微信小程序壳，负责承接 PETSCAPE 的宠物内容、社区、宠物空间设计、3D 预览、报价和订单能力。

## 已接入的仓库能力

- `GET/POST /api/v1/pets`：宠物档案。
- `GET/POST /api/v1/projects`：栖境项目列表和创建。
- `GET /api/v1/commerce/orders`：订单与进度。
- `pages/viewer`：把重型 3D 预览交给现有 Web 工作台，避免在小程序内重复实现生成管线。

## PETSCAPE 产品层

- 首页：宠物档案、养护知识、专属 Habitat 入口。
- 知识：按花枝鼠、守宫、蛇类、鹦鹉、蜘蛛和空间设计组织内容。
- 社区：求助、晒栖境、经验、同城服务四类主题。
- 宠物：围绕官网五类异宠、体型、习性和环境需求建立档案。
- 设计：从宠物档案进入 AI 栖境设计和 3D 预览。
- 订单：展示报价、制作、交付状态。

## 本地预览

1. 使用微信开发者工具打开本目录。
2. 当前 `miniapp/utils/config.js` 默认使用 mock 数据，便于直接评审 PETSCAPE 界面和物种分类。
3. 接入正式 AppID、服务端会话和线上接口后，将 `mockMode` 改为 `false`。

## 必须补的接入工作

- 服务端已增加 `wx.login` -> `code2Session` -> Prisma Session 会话桥；生产环境需要配置 `WECHAT_MINIPROGRAM_APP_ID` 与 `WECHAT_MINIPROGRAM_APP_SECRET`。
- 小程序请求通过 `X-PetScape-Session` 发送票据，AppSecret 不进入小程序代码。
- 在微信公众平台配置 request 合法域名和 web-view 业务域名。
- 为社区、知识、养护记录和服务商补充服务端模型与审核后台。
- 将 `touristappid` 替换为正式 AppID，不把 AppSecret 放进小程序代码。
- 3D 任务状态继续复用现有 Job/Worker；小程序只轮询已授权的任务状态。
