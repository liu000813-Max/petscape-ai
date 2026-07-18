# WP-A4-1 宠物档案行为验收（2026-07-19）

本轮在 production build（`next start`）、一次性本地 PostgreSQL（执行最新 migration）和真实私有 OSS `petscape-prod` 下，用实际浏览器完成手机号 OTP 登录后的 A4 主流程。测试数据与本轮真实上传的 OSS 对象已精确清理。

- `01-created-with-cover.png`：创建完整宠物档案并通过签名 URL 直传一张真实封面；列表展示名称、物种/品种、体型和封面。
- `02-edited.png`：服务重启后档案仍在；编辑名称与行为标签后列表立即更新。
- `03-cross-account-isolation.png`：第二个已验证账户打开同一 `/pets`，只看到自己的空态，看不到第一账户档案。
- `04-deleted-empty-state.png`：原账户确认删除后回到空态；服务日志记录 DELETE 200，随后列表 GET 200。

自动化补充：contracts/application 在真实 PostgreSQL 上 11/11；HTTP contracts 与跨账户隔离 2/2；server 全量 62/62（含真实 PostgreSQL/OSS）。浏览器发现的 OSS CORS 与 V4 PUT header 问题已修复并完成真实上传复验；CORS 资源事实记录在 `docs/operations/phase-b-step-0-cloud-resources.md`。

验证边界：本轮覆盖本地 production runtime + 真实 OSS，不把合并后的 ECS 部署冒充为已验证；部署实例须在 migration 先行、应用发布后再做一次 `/pets` 冒烟。
