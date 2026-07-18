import 'server-only';

// @petscape/server — 共享服务端包（application / domain / infra）的唯一入口。
// `server-only` 防线：任何 Client Component 尝试引入本包都会在构建期报错，
// 防止服务端专属依赖（Prisma、OSS、短信、供应商 SDK）被打进浏览器 bundle。
//
// WP-2.1 阶段本包只是骨架，正式导出在后续工作包（WP-2.2 起）逐步添加。
export {};
