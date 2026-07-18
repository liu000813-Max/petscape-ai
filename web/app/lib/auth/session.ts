// web/app/lib/auth/session.ts —— Server Component 侧的会话读取薄封装（WP-A1）。
//
// 与 lib/auth/index.ts 同一分层角色：只做装配与读取，不含身份业务逻辑。
// (app) 受保护布局与其中的页面都调用 getSessionUser()；React cache() 保证
// 同一次请求内 layout 与 page 只触发一次真实读取。
import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import { loadWebConfig } from '@petscape/server/infra/config';
import { getWebAuth } from './index';

export interface SessionUser {
  id: string;
  /** E.164 或裸手机号；展示层用 maskPhone() 脱敏。 */
  phoneNumber: string | null;
  /** dev-only 预览桩用户标记（见下方 preview 分支）。 */
  isPreview: boolean;
}

/** Better Auth 默认会话 cookie 名包含该子串（含 __Secure- 前缀变体）。 */
const SESSION_COOKIE_MARKER = 'session_token';

/** dev-only 预览 cookie（由 /api/dev/preview 设置）。 */
const PREVIEW_COOKIE = 'psx-preview';

export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const cookieStore = await cookies();

  // TODO(WP-A2 接线时移除)：dev-only 预览桩——非 production 下访问 /api/dev/preview
  // 种下 cookie 后，(app) 布局以桩用户渲染，用于在 OTP 未接线前验收登录后 UI。
  // 配置加载失败（本地 dev 未注入根 .env）时按 production 处理：预览关闭，
  // 未登录判定继续走下方 cookie 快路径——公开页不因配置缺失而 500。
  if (safeNodeEnv() !== 'production' && cookieStore.get(PREVIEW_COOKIE)?.value === '1') {
    return { id: 'preview-user', phoneNumber: '13800005678', isPreview: true };
  }

  // 快路径：没有会话 cookie 就不触碰数据库（getAuth 依赖 DATABASE_URL，
  // 未登录请求不应因 DB 不可达而 500，302 判定也因此对 DB 依赖免疫）。
  const hasSessionCookie = cookieStore
    .getAll()
    .some((c) => c.name.includes(SESSION_COOKIE_MARKER) && c.value !== '');
  if (!hasSessionCookie) return null;

  try {
    const session = await getWebAuth().api.getSession({ headers: await headers() });
    if (!session) return null;
    const phone = (session.user as { phoneNumber?: string | null }).phoneNumber ?? null;
    return { id: session.user.id, phoneNumber: phone, isPreview: false };
  } catch {
    // 会话校验失败（含 DB 不可达）按未登录处理：受保护区宁可退回登录页，
    // 也不把基础设施错误直接抛给用户。接线包（WP-A2）复核此策略。
    return null;
  }
});

function safeNodeEnv(): 'development' | 'test' | 'production' {
  try {
    return loadWebConfig().NODE_ENV;
  } catch {
    return 'production';
  }
}

/** 138****5678 式脱敏；非 11 位大陆手机号原样返回兜底。 */
export function maskPhone(phone: string | null): string {
  if (!phone) return '未绑定';
  const bare = phone.replace(/^\+86/, '');
  const m = /^(\d{3})\d{4}(\d{4})$/.exec(bare);
  return m ? `${m[1]}****${m[2]}` : bare;
}
