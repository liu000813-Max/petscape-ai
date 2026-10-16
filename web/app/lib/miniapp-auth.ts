import { getWebAuth } from './auth';
import { getWebServerContext } from './server-context';

/**
 * Web 端继续使用 Better Auth Cookie；原生小程序使用显式的 session token。
 * 两种会话在 Route Handler 层收敛成同一个最小 session 形状，避免把小程序
 * 的身份逻辑散落到每个业务路由里。
 */
export async function getMiniappAwareSession(req: Request) {
  const miniappToken = req.headers.get('x-petscape-session')?.trim();
  if (miniappToken) {
    const { prisma } = getWebServerContext();
    const session = await prisma.session.findUnique({
      where: { token: miniappToken },
      include: { user: true },
    });
    if (!session || session.expiresAt <= new Date()) return null;
    return { user: session.user };
  }

  return getWebAuth().api.getSession({ headers: req.headers });
}
