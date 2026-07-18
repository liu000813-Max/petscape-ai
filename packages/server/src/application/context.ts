// application/context.ts —— Web 进程共享依赖装配（WP-3.2）。
// spec: docs/plans/phase-b-execution-plan.md WP-3.2。
//
// 复用 WP-3.1 的 getAuth() 同一套模式：调用方（web Route Handler）从
// loadWebConfig() 取已校验配置后传入，本模块负责构造 PrismaClient / OssStorage
// 并缓存为进程内单例，避免每个请求重建连接池/客户端。本层不读 process.env。
import { createPrismaClient, type PrismaClient } from '../infra/db/index.ts';
import { OssStorage } from '../infra/oss/index.ts';
import type { WebConfig } from '../infra/config/index.ts';

export interface ServerContext {
  prisma: PrismaClient;
  oss: OssStorage;
}

let cached: ServerContext | undefined;

/**
 * 返回本进程唯一的 { prisma, oss } 上下文（懒初始化 + 缓存）。
 * 需要完整 OSS 凭证与 bucket/endpoint 配置齐全，缺失时抛出说明性错误
 * （fail-fast，指出具体缺失键——WP-2.2 统一配置入口原则的延续）。
 */
export function getServerContext(config: WebConfig): ServerContext {
  if (cached) return cached;

  if (!config.DATABASE_URL) {
    throw new Error('getServerContext() 需要 DATABASE_URL。');
  }
  const missingOssKeys = (
    [
      ['ALIBABA_CLOUD_ACCESS_KEY_ID', config.ALIBABA_CLOUD_ACCESS_KEY_ID],
      ['ALIBABA_CLOUD_ACCESS_KEY_SECRET', config.ALIBABA_CLOUD_ACCESS_KEY_SECRET],
      ['ALIBABA_CLOUD_OSS_BUCKET', config.ALIBABA_CLOUD_OSS_BUCKET],
      ['ALIBABA_CLOUD_OSS_ENDPOINT', config.ALIBABA_CLOUD_OSS_ENDPOINT],
      // signatureUrlV4 必需 region 推导 signing region（ADR-0005 验证条件 1）。
      ['ALIBABA_CLOUD_REGION', config.ALIBABA_CLOUD_REGION],
    ] as const
  ).filter(([, value]) => !value);
  if (missingOssKeys.length > 0) {
    throw new Error(
      `getServerContext() 需要以下 OSS 配置键：${missingOssKeys.map(([key]) => key).join(', ')}`,
    );
  }

  const prisma = createPrismaClient({
    connectionString: config.DATABASE_URL,
    poolMax: config.WEB_DB_POOL_MAX,
  });

  const oss = new OssStorage({
    accessKeyId: config.ALIBABA_CLOUD_ACCESS_KEY_ID!,
    accessKeySecret: config.ALIBABA_CLOUD_ACCESS_KEY_SECRET!,
    bucket: config.ALIBABA_CLOUD_OSS_BUCKET!,
    endpoint: config.ALIBABA_CLOUD_OSS_ENDPOINT!,
    region: config.ALIBABA_CLOUD_REGION!,
  });

  cached = { prisma, oss };
  return cached;
}
