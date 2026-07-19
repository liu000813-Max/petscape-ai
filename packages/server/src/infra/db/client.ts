// infra/db/client.ts —— Prisma Client 封装（WP-2.3）。
// spec: docs/plans/phase-b-execution-plan.md WP-2.3。
//
// Prisma 7 + @prisma/adapter-pg driver adapter 路径（ADR-0002）：schema 的
// datasource 不设 url，运行时连接串在这里显式构造传给 PrismaPg adapter——
// 参考 tracer/build-tracer/worker-probe 的 WP-2.0 实测配置形态。
//
// 连接池上限由调用方传入（见 infra/config 的 *_DB_POOL_MAX 键，WP-2.3 验收 4：
// web pool max + worker pool max + migration 预留 < 实例 max_connections 实测值）。
// 本模块不读 process.env——按 lint 边界规则，配置只应从 infra/config 消费。
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, type Prisma } from '../../generated/prisma/client.js';

export interface CreatePrismaClientOptions {
  /** 已校验的数据库连接串（来自 infra/config 的 DATABASE_URL）。 */
  connectionString: string;
  /**
   * 本进程侧连接池上限（node-postgres Pool `max`）。web/worker 各自传入
   * 自己的预算键，两者之和加 migration 预留应小于实例 max_connections
   * 实测值，见 docs/operations/wp-2-3-report.md 的算式。
   */
  poolMax?: number;
}

/**
 * 构造一个使用 @prisma/adapter-pg（Prisma 7 WASM 查询引擎路径）的 PrismaClient。
 * Web 与 Worker 各自调用一次，持有独立连接池实例（ADR-0002：连接池按进程管理）。
 */
export function createPrismaClient({
  connectionString,
  poolMax,
}: CreatePrismaClientOptions): PrismaClient {
  const adapter = new PrismaPg({
    connectionString,
    ...(poolMax !== undefined ? { max: poolMax } : {}),
  });
  return new PrismaClient({ adapter });
}

export type { PrismaClient } from '../../generated/prisma/client.js';
export type PrismaInputJsonValue = Prisma.InputJsonValue;
