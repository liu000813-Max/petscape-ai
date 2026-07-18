// application/auth.ts —— 登录用例薄封装（WP-3.1）。
// spec: docs/plans/phase-b-execution-plan.md WP-3.1。
//
// 装配 infra/auth 的 Better Auth 实例（DB 连接 + 已校验的 WebConfig 身份相关字段），
// 供 Web Route Handler 消费。本层不直接读 process.env（由调用方传入 WebConfig）；
// 也不暴露 Prisma/Better Auth 内部类型细节以外的框架耦合给 web 之外的调用方。
import { createPrismaClient, type PrismaClient } from '../infra/db/index.ts';
import { createAuth, type Auth } from '../infra/auth/index.ts';
import type { WebConfig } from '../infra/config/index.ts';

export interface GetAuthOptions {
  config: WebConfig;
  /** 复用已存在的 PrismaClient（如 Web 进程单例），未提供时新建一个。 */
  prisma?: PrismaClient;
}

let cached: { auth: Auth; prisma: PrismaClient } | undefined;

/**
 * 返回本进程唯一的 Better Auth 实例（懒初始化 + 缓存，避免每个请求重建 adapter）。
 * Web 进程的 Route Handler 应调用本函数，而不是直接 import infra/auth。
 */
export function getAuth({ config, prisma }: GetAuthOptions): Auth {
  if (cached) return cached.auth;

  const client =
    prisma ?? createPrismaClient({ connectionString: mustDatabaseUrl(config), poolMax: config.WEB_DB_POOL_MAX });

  const auth = createAuth({
    prisma: client,
    secret: config.BETTER_AUTH_SECRET,
    baseURL: config.BETTER_AUTH_URL,
    smsChannel: config.SMS_CHANNEL,
    pnvsCredentials:
      config.ALIBABA_CLOUD_ACCESS_KEY_ID && config.ALIBABA_CLOUD_ACCESS_KEY_SECRET
        ? {
            accessKeyId: config.ALIBABA_CLOUD_ACCESS_KEY_ID,
            accessKeySecret: config.ALIBABA_CLOUD_ACCESS_KEY_SECRET,
          }
        : undefined,
    pnvsTemplate: {
      signName: config.PNVS_SIGN_NAME,
      templateCode: config.PNVS_TEMPLATE_CODE,
      schemeName: config.PNVS_SCHEME_NAME,
    },
  });

  cached = { auth, prisma: client };
  return auth;
}

function mustDatabaseUrl(config: WebConfig): string {
  if (!config.DATABASE_URL) {
    throw new Error('getAuth() 需要 DATABASE_URL：身份模块依赖 Postgres 上的 Better Auth 四表。');
  }
  return config.DATABASE_URL;
}
