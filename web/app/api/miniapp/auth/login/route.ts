import { randomBytes, randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { loadWebConfig } from '@petscape/server/infra/config';
import { getWebServerContext } from '../../../../lib/server-context';

const WECHAT_PROVIDER_ID = 'wechat-miniprogram';
const SESSION_TTL_DAYS = 30;

interface WechatCode2SessionResponse {
  openid?: string;
  unionid?: string;
  session_key?: string;
  errcode?: number;
  errmsg?: string;
}

/** wx.login code -> 微信身份 -> PetScape Session。AppSecret 永远只在服务端读取。 */
export async function POST(req: Request) {
  let body: { code?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const code = typeof body.code === 'string' ? body.code.trim() : '';
  if (!code) return NextResponse.json({ error: 'missing_code' }, { status: 400 });

  const config = loadWebConfig();
  const appId = config.WECHAT_MINIPROGRAM_APP_ID;
  const appSecret = config.WECHAT_MINIPROGRAM_APP_SECRET;
  if (!appId || !appSecret) {
    return NextResponse.json({ error: 'wechat_login_not_configured' }, { status: 503 });
  }

  const query = new URLSearchParams({
    appid: appId,
    secret: appSecret,
    js_code: code,
    grant_type: 'authorization_code',
  });
  const wechatResponse = await fetch(
    `https://api.weixin.qq.com/sns/jscode2session?${query.toString()}`,
    { cache: 'no-store' },
  );
  if (!wechatResponse.ok) {
    return NextResponse.json({ error: 'wechat_identity_unavailable' }, { status: 502 });
  }

  const wechat = (await wechatResponse.json()) as WechatCode2SessionResponse;
  if (!wechat.openid || wechat.errcode) {
    return NextResponse.json(
      { error: 'wechat_login_failed', detail: wechat.errmsg || '微信身份校验失败' },
      { status: 401 },
    );
  }

  const openid = wechat.openid;

  const { prisma } = getWebServerContext();
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  const sessionToken = randomBytes(32).toString('hex');
  const session = await prisma.$transaction(async (tx) => {
    const account = await tx.account.findFirst({
      where: { providerId: WECHAT_PROVIDER_ID, accountId: openid },
      include: { user: true },
    });

    const user =
      account?.user ??
      (await tx.user.create({
        data: {
          id: randomUUID(),
          name: '微信用户',
        },
      }));

    if (!account) {
      await tx.account.create({
        data: {
          id: randomUUID(),
          accountId: openid,
          providerId: WECHAT_PROVIDER_ID,
          userId: user.id,
        },
      });
    }

    return tx.session.create({
      data: {
        id: randomUUID(),
        token: sessionToken,
        userId: user.id,
        expiresAt,
      },
      select: { token: true, expiresAt: true, userId: true },
    });
  });

  return NextResponse.json({
    sessionToken: session.token,
    expiresAt: session.expiresAt,
    userId: session.userId,
  });
}
