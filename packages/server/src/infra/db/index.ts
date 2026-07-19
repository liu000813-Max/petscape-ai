// infra/db/ —— Prisma client 封装 + repositories 占位导出。
// Prisma 只准出现在本目录（lint 边界规则见根 eslint 配置）。
// schema/client 已在 WP-2.3 落地（探针表 + Better Auth 四表）；
// 正式业务 repositories 从 WP-3.1 起逐包添加。
export { createPrismaClient } from './client.ts';
export type { CreatePrismaClientOptions, PrismaClient, PrismaInputJsonValue } from './client.ts';
