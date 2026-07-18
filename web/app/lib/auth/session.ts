// web/app/lib/auth/session.ts —— Server Component 侧的会话读取薄封装（WP-A2）。
//
// 与 lib/auth/index.ts 同一分层角色：只做装配与读取，不含身份业务逻辑。
// (app) 受保护布局与其中的页面都调用 getSessionUser()；React cache() 保证
// 同一次请求内 layout 与 page 只触发一次真实读取。
import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import { getWebAuth } from './index';

export interface SessionUser {
  id: string;
  /** E.164 或裸手机号；展示层用 maskPhone() 脱敏。手机号未绑定时为 null。 */
  phoneNumber: string | null;
  /**
   * 已验证的真实邮箱；未绑定或仍是占位域（`@phone.petscape.local`）时为 null
   * ——占位邮箱只是 Better Auth 手机号注册的内部占位，不对用户展示（WP-A3-2）。
   */
  email: string | null;
}

/** Better Auth 默认会话 cookie 名包含该子串（含 __Secure- 前缀变体）。 */
const SESSION_COOKIE_MARKER = 'session_token';

/** 手机号注册的合成占位邮箱域，不对用户展示。 */
const PLACEHOLDER_EMAIL_DOMAIN = '@phone.petscape.local';

function realEmailOrNull(email: string | null | undefined, emailVerified: boolean | undefined): string | null {
  if (!email) return null;
  if (email.toLowerCase().endsWith(PLACEHOLDER_EMAIL_DOMAIN)) return null;
  return emailVerified ? email : null;
}

export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const cookieStore = await cookies();

  // 快路径：没有会话 cookie 就不触碰数据库（getAuth 依赖 DATABASE_URL，
  // 未登录请求不应因 DB 不可达而 500，302 判定也因此对 DB 依赖免疫）。
  const hasSessionCookie = cookieStore
    .getAll()
    .some((c) => c.name.includes(SESSION_COOKIE_MARKER) && c.value !== '');
  if (!hasSessionCookie) return null;

  try {
    const session = await getWebAuth().api.getSession({ headers: await headers() });
    if (!session) return null;
    const u = session.user as {
      phoneNumber?: string | null;
      email?: string | null;
      emailVerified?: boolean;
    };
    return {
      id: session.user.id,
      phoneNumber: u.phoneNumber ?? null,
      email: realEmailOrNull(u.email, u.emailVerified),
    };
  } catch {
    // 会话校验失败（含 DB 不可达）按未登录处理：受保护区宁可退回登录页，
    // 也不把基础设施错误直接抛给用户。
    return null;
  }
});

/** 138****5678 式脱敏；非 11 位大陆手机号原样返回兜底。 */
export function maskPhone(phone: string | null): string {
  if (!phone) return '未绑定';
  const bare = phone.replace(/^\+86/, '');
  const m = /^(\d{3})\d{4}(\d{4})$/.exec(bare);
  return m ? `${m[1]}****${m[2]}` : bare;
}

/** a***b@example.com 式脱敏：保留 local 首尾字符与完整域名，中间以 * 遮蔽。 */
export function maskEmail(email: string | null): string {
  if (!email) return '未绑定';
  const at = email.indexOf('@');
  if (at <= 0) return email;
  const local = email.slice(0, at);
  const domain = email.slice(at);
  if (local.length <= 2) return `${local[0] ?? ''}*${domain}`;
  return `${local[0]}${'*'.repeat(Math.max(1, local.length - 2))}${local[local.length - 1]}${domain}`;
}
