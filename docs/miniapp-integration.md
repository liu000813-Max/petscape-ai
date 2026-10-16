# PETSCAPE 宠境原生小程序整合说明

## 结论

公开 GitHub 仓库 `AlfredGuquan/petscape-ai` 当前只有 `main` 分支，文件树没有现成的微信小程序目录或 `project.config.json`。本次新增 `miniapp/` 作为原生微信小程序壳，直接复用仓库已有的业务 API、数据库模型、持久任务和 3D Web 工作台。

## 产品分工

| 层 | 小程序承担 | 现有 PetScape 承担 |
|---|---|---|
| 用户关系 | 首页、知识、社区、宠物档案、消息入口 | Better Auth 账户基础能力；小程序通过微信会话桥接到同一 User/Session 模型 |
| 设计入口 | 创建项目、展示项目列表、引导用户开始设计 | AI 生图、三视图、图生 3D、模型检查、场景确认 |
| 3D 预览 | 通过 `web-view` 打开项目预览 | Next.js Web 工作台、Three.js/模型查看器 |
| 交易 | 展示报价、订单和制作进度 | Quote、PaymentIntent、Order、Worker 状态机 |
| 内容服务 | 知识、社区、养护、同城服务入口 | 当前仓库尚未实现，需要新增内容域和审核后台 |

## 关键数据流

```mermaid
flowchart LR
  U[微信用户] --> MP[原生小程序]
  MP --> K[PETSCAPE 内容/社区/养护域]
  MP --> API[PetScape API]
  API --> P[Pet 宠物档案]
  API --> PR[Project 栖境项目]
  PR --> JOB[持久 Job + Worker]
  JOB --> GEN[生图/图生3D/模型检查]
  GEN --> WEB[现有 Web 3D 工作台]
  API --> COM[Quote / Payment / Order]
  MP --> WEBVIEW[web-view 3D 预览]
  WEBVIEW --> WEB
```

## 鉴权决策

当前 PetScape API 使用 Better Auth 会话 Cookie；原生小程序改用 `wx.login` + 服务端 `code2Session` 换取 openid，再在 `Account(providerId=wechat-miniprogram)` 与 `Session` 表中创建/复用身份。小程序后续请求通过 `X-PetScape-Session` 发送 30 天票据，业务路由同时兼容 Web Cookie。AppSecret 只能放服务端环境变量。

## 当前边界

`miniapp/utils/request.js` 在本地预览默认走 mock 数据；切换 `miniapp/utils/config.js` 的 `mockMode=false` 后，会在首次真实请求前调用 `wx.login`。宠物档案已经支持新增、编辑、列表读取；项目和订单已接入已有 API。知识/社区 API、微信支付和正式 3D web-view 域名仍需接入。

## 本次联调所需环境变量

```text
WECHAT_MINIPROGRAM_APP_ID=微信小程序 AppID
WECHAT_MINIPROGRAM_APP_SECRET=微信小程序 AppSecret
```

AppSecret 只配置在部署环境的 Web 服务，不能写进 `miniapp/` 目录。微信公众平台还需要把 `https://petscape3d.com` 配置为 request 合法域名。

## 体验链接交付规则

每次代码更新后，交付消息必须同时说明：

1. 当前更新是否已经部署到正式线上地址。
2. 若 Web 预览已启动，提供对应的本地或临时公网 URL，并注明有效期。
3. 若更新内容是原生小程序，提供微信开发者工具导入路径 `miniapp/`；普通浏览器 URL 只能代表 Web 端，不能替代小程序真机体验。

本地 Web 预览默认地址为 `http://127.0.0.1:3100/?mock=1`。正式线上地址为 `https://petscape3d.com`，只有部署完成并完成 HTTP 验证后，才能称为本次更新的线上体验链接。
