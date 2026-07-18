import { NextResponse } from 'next/server';
import { getWebServerContext } from '../../lib/server-context';
import { logError } from '@petscape/server/infra/logging';

// WP-3.5：在 WP-2.5 的最小活跃度探针基础上加 DB 就绪检查（`SELECT 1`，2s
// 超时）。DB 不可达返回 503 `{ ok: false, db: false }`——注意 Compose
// healthcheck 消费本端点，DB 断则容器被判 unhealthy 属预期语义（spec 明确
// 指示），不是要"即使 DB 挂了也报健康"。
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DB_CHECK_TIMEOUT_MS = 2000;

async function checkDb(): Promise<boolean> {
  const { prisma } = getWebServerContext();
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('healthz DB 检查超时（2s）')), DB_CHECK_TIMEOUT_MS);
  });
  await Promise.race([prisma.$queryRaw`SELECT 1`, timeout]);
  return true;
}

// WP-4.2：回滚演练用可观察版本标识。构建期由 `deploy/web.Dockerfile` 的
// `ARG GIT_SHA` 写入同名 ENV；本地/未注入时该 env 不存在，返回 null（不伪造
// 版本号）。
function getVersion(): string | null {
  const sha = process.env.GIT_SHA;
  return sha && sha.length > 0 ? sha : null;
}

export async function GET() {
  const version = getVersion();
  try {
    await checkDb();
    return NextResponse.json({ ok: true, db: true, version });
  } catch (error) {
    logError('healthz.db_check_failed', { err: error });
    return NextResponse.json({ ok: false, db: false, version }, { status: 503 });
  }
}
