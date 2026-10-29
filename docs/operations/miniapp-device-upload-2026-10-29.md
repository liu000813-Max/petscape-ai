# PETSCAPE 真机与体验版记录（2026-10-29）

## 当前状态

- 独立后端已上线：`https://petscape3d.com/miniapp-api/`。
- 原生小程序编译通过：13 个 WXML、14 个 WXSS。
- 微信开发者工具服务端口 `50306` 已连通，当前 AppID：`wx86e80d01d33113a9`（测试号）。
- 本轮预览码已生成，真机已打开（由用户确认）。二维码与原始 CLI 输出保存在仓库外的私有运行目录，不提交 Git。
- 开发版本上传成功：版本 `0.1.0`，说明“PETSCAPE 首个真实后端联调版”。还未在微信后台点击“设为体验版”，因此没有可交付的体验版二维码。

## 证据

| 项目 | 结果 |
| --- | --- |
| 预览运行目录 | `G:/Max麦麦/codex/petscape-dev-runtime/wechat-previews/20261029-110633-8ca733da` |
| 预览二维码格式 | JPEG；SHA-256 `310ef92783d5d84d9f413c2124b49b8c06fee24af78868049afa364d8fadd0c` |
| 上传运行目录 | `G:/Max麦麦/codex/petscape-dev-runtime/wechat-uploads/20261029-1110` |
| 上传 CLI | `√ upload`，退出码 0，包体 680000 bytes；仅证明代码已上传到开发版本 |
| 代码提交 | `a4cdd389c7c6bac247f340b3b747d912c277e86a` |

## 尚未确认

真机打开后，服务器最近 30 分钟的 `wechat-miniprogram` 账号数和新 Session 数仍为 0。因此本轮只确认“真机能打开”和“体验版上传成功”，不能把 `wx.login → code2Session` 写成通过。

当前 AppID 是微信测试号，后台没有正式个人小程序的完整服务器域名与版本管理入口。正式个人小程序注册后，在“开发管理 → 开发设置 → 服务器域名”中将 `https://petscape3d.com` 加入 request 合法域名；然后把代码版本设为体验版，重新扫码，在真机点“我的宠物”或“打开养护记录与提醒”，再以新增 Session 和受保护接口 200 作为真实登录证据。
