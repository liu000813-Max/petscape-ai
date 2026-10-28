# 小程序独立后端发布（2026-10-28）

状态：独立后端已上线；微信真机登录、体验版上传和审核仍未完成。

## 范围

用户要求后端上线。既有官网的镜像版本和数据库历史无法从当前仓库完整重建，因此本轮采用独立 API 容器和 `petscape_miniapp` 数据区，复用现有 ECS/RDS。官网 Web/Worker、public 数据区和既有入口不切换。小程序账号与宠物数据从独立数据区开始，不声称已与官网账号合并。

数据库 schema 是逻辑分区：当前数据库用户能创建 schema、不能创建数据库或新角色；本轮复用该账号已有权限，不把 search_path 描述为数据库权限隔离。后续取得托管数据库管理权限后应为小程序配置独立受限账号。

## 发布门禁

1. main 精确 SHA 的 push CI 成功；发布工作流检查精确 SHA 对应 push 事件的聚合 `ci-gate`。发布隔离的小程序 Route Handler 与数据区；CI 的静态检查、单元测试、真实 PostgreSQL、Prisma、web 构建和 worker 镜像，加上独立 PostgreSQL 集成测试、备份恢复证明和线上 HTTP 验收覆盖本发布范围。官网 3D Viewer 浏览器分片属于另一部署，不作为此隔离后端的发布门禁。
2. GitHub 构建 API 镜像及带 PostgreSQL 16 工具的迁移镜像，推送既有 ACR。
3. prepare 阶段只备份，不执行迁移或变更入口。
4. 下载备份，在本机隔离 PostgreSQL 16 实际恢复，核对备份校验和和 public 迁移历史；将绑定目标 SHA 的恢复证明送回私有运行目录。
5. release 阶段核验恢复证明，迁移小程序数据区，检查 public 历史未变，启动独立容器并验收公开/鉴权接口，再验证和 reload Nginx。

容器绑定 `127.0.0.1:3011`，内存上限 256 MiB，连接池 2；公网仅在既有 HTTPS 域名的 `/miniapp-api/` 下暴露受限 API 路径。业务 API 的原路径和数据契约保持不变。服务端环境文件保存在 ECS 的私有目录，不进入 Git。

## 已有验证

数据库隔离集成测试已在本机 PostgreSQL 16 真跑：新 schema 的全部迁移、Prisma 读写和原生 SQL 使用同一数据区，public 的用户行与迁移历史未改变。迁移历史门禁也使用同一 schema，无 public 回退。

线上验收通过：独立容器在 `127.0.0.1:3011` 运行，`https://petscape3d.com/miniapp-api/api/healthz` 返回 200；知识、社区、服务目录公开接口返回 200；未授权宠物接口返回 401；官网 `/api/healthz` 仍返回 200。RDS public 区保留 35 项迁移，小程序 schema 为 16 项，备份恢复证明和 SHA 校验均通过。后端入口不是微信小程序体验码；真实 `wx.login`、手机真机、体验版上传和正式审核仍分别验收。
