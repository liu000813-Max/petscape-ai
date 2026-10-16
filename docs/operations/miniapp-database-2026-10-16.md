# PETSCAPE 小程序真实数据库验收

日期：2026-10-16。本轮执行用户批准的本机 PostgreSQL 方案；状态：**本机数据库验收完成**。不代表微信真机、线上数据库、GitHub CI 或发布通过。

## 环境

- 仓库 `petscape-ai`，基于本地 `b5a8193`，本轮增加联调脚本和测试修正，未更改公开 API、业务 schema 或既有 migration。
- Node `v24.19.0`；EDB Windows x64 PostgreSQL `16.15`；绑定 `127.0.0.1:55432`；UTF-8、SCRAM 认证、随机密码，无系统服务。
- 所有运行数据位于 `G:/Max麦麦/codex/petscape-dev-runtime/postgres16`。凭据在该目录受本机 ACL 保护，不进入仓库、测试输出或公开文档。
- ZIP 来源为 [EDB 官方二进制页](https://www.enterprisedb.com/download-postgresql-binaries)的 Windows x64 链接；本次下载 SHA-256 为 `43bb45f173a6f08cf1d29a97a6d8deb119e8e8093a24c00d2d1001a0ccaa8281`，仅作为本次复现校验值。

## 已完成的验收

| 项目 | 实际结果 |
|---|---|
| 空库迁移 | 全部 16 个 migration 成功应用 |
| 再次迁移 | 无 pending migration；迁移历史所有字段保持不变 |
| 数据库结构 | 8 张内容域新表、11 条外键、4 项状态 check constraint 存在 |
| 实际 SQL 拒绝 | 重复点赞唯一键、悬空外键、文章/帖子/评论/服务商非法状态共 6 个反例全部拒绝 |
| 旧库升级 | 先应用旧 15 个迁移并写入 User/Account/Session/Pet，再应用本轮迁移；旧数据逐字段不变 |
| 内容与宠物集成测试 | 14 通过、0 失败、0 跳过 |
| 同库重复运行 | 再次 14 通过、0 跳过，覆盖已有 admin 的授权分支 |
| 生命周期 | 正常停止、冷启动、重复 start；开发库探针数据保持不变，仍仅监听 loopback |
| 启动保护 | 已占用端口不接管；运行目录设到 Git checkout 内时，在写入前拒绝 |
| 前端单元回归 | 仓库规定入口 39 通过、0 跳过 |
| 静态与构建 | Server/Web/Worker TypeScript、本轮修改文件 lint、Prisma validate、Web 生产构建通过 |
| 微信原生编译 | 官方 wcc 编译 13 个 WXML、wcsc 编译 14 个 WXSS，通过 |

本轮成功运行编号 `20261016084509765_53933b`。结构化摘要见 [验收证据](../evidence/miniapp-db-20261016/receipt.json)；完整 Prisma 日志、TAP 和保留的测试库位于运行目录 `runs/<编号>/`。

## 发现与修正

1. Windows 中文安装路径使 EDB initdb 在 post-bootstrap 阶段报 UTF-8 编码错误。使用临时盘符指向同一物理目录，确认目录身份后再启动；不移动数据，不更改系统编码。
2. Windows pg_ctl 后台进程可保留父进程的输出管道，导致 Node 等待。启动时单独观察 pg_ctl 的退出并将服务日志写文件，避免继承管道阻塞。
3. 原有内容集成测试直接插入 admin，被既有数据库角色保护触发器拒绝。改为普通用户创建后经 `bootstrapFirstAdmin` / `changeUserRole` 授权；清理保留 admin 与不可删除的角色审计，不削弱数据库保护。
4. Web 单元测试入口使用 PATH 的 `node`，本机子进程落到 Node 22，无法执行 TypeScript。改为 `process.execPath`，与调用者选定的 Node 24 保持一致，39 项回归随后通过。

首次回归命令误将 `web/tests/*.test.mjs` 中需要浏览器及 Web 服务的 E2E 纳入无环境测试而失败；已改用仓库规定的 `run-unit-tests.mjs` 入口。该失败不算已验收的浏览器 E2E，也未通过跳过伪装成功。

## 重复执行与边界

- [本机运行手册](../runbooks/miniapp-local-postgres.md)包含 install/start/test/status/stop 入口、Node 选择、凭据位置和保留规则；重复测试新建隔离库，不覆盖旧数据。
- 固定开发库 `petscape_miniapp_dev` 已应用全部迁移，可供后续配置 Web API 后联调。本轮结束正常停止数据库，数据保留，按手册 start 即可恢复。
- 本轮验证的是应用层 + 真实 PostgreSQL；没有冒充真实 HTTP 端到端、微信 code2Session、OSS 上传或真机验收。共享 Web 服务上下文仍需要完整 OSS 配置；微信还需要正式 AppID/AppSecret、合法域名和开发者工具登录。
- Web build 保留既有 `next.config.ts` 文件追踪范围 warning；构建返回成功，不将该 warning 隐藏为已修复。
- 文档校验使用真实 Git 暂存 blob 检查，避免 Windows checkout 已有 CRLF 转换影响；未批量重写无关文档。
- GitHub 凭据、远端 CI、线上部署和体验码尚未在本轮执行。本次不提供网页地址冒充小程序体验入口。

下一步：补齐微信及 Web 服务配置 → 真机关闭 mock 验收 → 推送 GitHub 并通过 CI → 后端部署 → 上传小程序体验版并交付二维码。
