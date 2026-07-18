import 'server-only';

// @petscape/server — 共享服务端包（application / domain / infra）的唯一入口。
// `server-only` 防线：任何 Client Component 尝试引入本包都会在构建期报错，
// 防止服务端专属依赖（Prisma、OSS、短信、供应商 SDK）被打进浏览器 bundle。
//
// WP-2.1 阶段本包只是骨架，正式导出在后续工作包逐步添加。
// WP-2.2：统一配置入口已落地在 src/infra/config/，但不从本主入口重新导出——
// 主入口经由 `server-only` 防线，在纯 Node（非 Next/webpack）进程下 import
// 会直接抛错（server-only 的 exports 条件在裸 Node ESM 下不生效）。因此 Worker
// 等非 Next 进程改为经独立子路径 `@petscape/server/infra/config` 导入配置，
// 见 packages/server/package.json 的 exports 字段与 worker/src/main.ts。
export {};
