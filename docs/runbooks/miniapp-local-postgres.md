# 原生小程序本机 PostgreSQL 联调

适用：Windows、本仓库 P1/P2 内容与宠物档案验收。仅管理独立测试运行目录；不读取外部 `DATABASE_URL`，不连接生产库，不注册 Windows 服务。

## 环境与来源

- Node >=24.7，项目依赖已按 lockfile 安装。PowerShell 入口优先检查指定 Node、PATH 和本机 Codex runtime，不修改全局 PATH。
- PostgreSQL 16，与 CI 的主版本一致。Windows x64 ZIP 从 [PostgreSQL 官方入口](https://www.postgresql.org/download/windows/)指向的 [EDB 二进制页](https://www.enterprisedb.com/download-postgresql-binaries)取得。
- 本次固定为 `16.15-5`，下载 URL 和 SHA-256 在 [生命周期脚本](../../scripts/local-postgres.mjs)固定；SHA-256 是本次下载后的复现校验值，不冒充厂商签名证明。
- 默认运行目录：`G:/Max麦麦/codex/petscape-dev-runtime/postgres16`。程序、数据、日志、凭据均留在仓库外；可通过 `PETSCAPE_PG_RUNTIME_DIR` 选择另一独立目录。
- PostgreSQL 仅监听 `127.0.0.1:55432`，使用随机密码和 SCRAM 认证。脚本收紧运行目录 ACL，凭据保存在 `local-credentials.json`，不要上传或粘贴该文件。
- 中文安装路径会触发 EDB bootstrap 编码错误。脚本用空闲临时盘符映射同一物理目录，校验映射身份；停止数据库后移除映射。数据不移动。

## 重复执行入口

在仓库根 PowerShell 执行：

```powershell
.\scripts\local-postgres.ps1 install
.\scripts\local-postgres.ps1 start
.\scripts\local-postgres.ps1 test
.\scripts\local-postgres.ps1 status
.\scripts\local-postgres.ps1 stop
```

如果当前机器的 Node 不在默认位置，附加 `-NodePath '你的 Node 24 node.exe 绝对路径'`。也可以直接用 Node 24 执行 `scripts/local-postgres.mjs` 和相同动作。

- `install`：校验固定 ZIP 后提取服务器运行文件，不覆盖已有文件。
- `start`：仅在未初始化时创建数据目录；已启动时复用同一实例。端口被别的进程占用时失败，不接管其他实例。
- `test`：每轮新建独立 fresh/upgrade 库，执行迁移验收与两份真实集成测试；任何失败或跳过均不算通过。通过后迁移固定开发库 `petscape_miniapp_dev`。
- `status`：报告本项目数据库进程状态。
- `stop`：正常停止数据库，保留数据和密码；可以重复调用。

测试不会 reset、truncate 或删除既有数据库。每轮测试库与证据保留供排查，脚本没有自动清理功能。旧库升级的临时迁移目录也留在本轮证据目录内，不改写仓库迁移历史。

## 验收内容

1. 空库部署全部迁移；再次 deploy，迁移历史逐行保持不变。
2. 核对八张内容表、十一条外键、四项状态约束；实际拒绝重复点赞、悬空外键和四种非法内容状态。
3. 独立库只部署 P1 以前的十五个迁移，写入用户、微信 Account、Session 和中文宠物数据；再部署本轮迁移，逐字段比较旧数据。
4. 运行 `community-content.integration.test.mjs` 和 `pets.integration.test.mjs`，验证公开内容边界、管理员授权、所有权、软删除、并发幂等、服务筛选和七日统计。
5. 输出 `runs/<本轮编号>/receipt.json`、Prisma 日志及 `integration.tap`。失败测试写入 `integration-failed.log`，不会生成成功 receipt。

完整命令逻辑见 [迁移验收器](../../scripts/verify-local-migrations.mjs)。新增迁移后须更新其中的升级基线，不能悄悄把最新迁移当作本轮已验收对象。

## 微信联调衔接

开发库只供后续本地联调，不包含真实微信账户。真实 HTTP API 还需要 Web 服务运行配置；共享服务上下文当前要求 OSS 配置，不用虚假云凭据绕过。

微信 AppID/AppSecret、合法域名和开发者工具登录仍按 [整合说明](../miniapp-integration.md)完成。保持小程序默认 mock 配置，待真实环境具备后再切换；数据库通过不等于微信登录或真机验收通过。
