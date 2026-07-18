// packages/server/prisma.config.ts
// spec: docs/plans/phase-b-execution-plan.md WP-2.3。
//
// Prisma CLI（migrate/generate/validate）专用连接配置。这个 datasource.url 只被
// CLI 消费（migrate deploy 等），应用运行时不经过这里——运行时 client 显式构造
// @prisma/adapter-pg 实例（见 src/infra/db/client.ts），与 CLI 侧配置解耦。
//
// 参考：tracer/build-tracer/worker-probe/packages/probe-worker/prisma.config.mjs
// （WP-2.0 实测过的 Prisma 7 + adapter-pg 配置形态）。
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
