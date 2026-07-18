// domain/credentials.ts —— 凭证（邮箱/手机号）领域规则（WP-A3-2）。
// spec: docs/plans/p0-batch-1-execution-plan.md WP-A3-2 § 账户语义（codex 审查增补）。
//
// 框架无关（不 import Prisma/next/better-auth）：只做纯字符串规范化与占位域判定。
// application/infra 层在发码/注册/绑定/changeEmail 全部入口先调用本模块规范化，
// 再落库/查找，保证 `Foo@X.com` 与 `foo@x.com` 命中同一账户，且占位域被服务端拦截。

/**
 * 手机号 OTP 首次验证时，Better Auth phone-number 插件会用 getTempEmail 合成一个
 * 占位邮箱 `<phone>@phone.petscape.local` 写入 User.email（见 infra/auth）。该占位域
 * 不是真实可投递邮箱，必须在所有邮箱入口（发码/注册/绑定/changeEmail）拦截：
 * 不可发码、不可作为注册/登录邮箱、不可作为绑定目标。判定在规范化之后进行，
 * 因此大小写与前后空白变体都会被覆盖。
 */
export const PLACEHOLDER_EMAIL_DOMAIN = 'phone.petscape.local';

/** 邮箱规范化：trim + toLowerCase。落库/查找前统一走这里。 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** 规范化后是否为占位域邮箱（`@phone.petscape.local`）。 */
export function isPlaceholderEmail(email: string): boolean {
  return normalizeEmail(email).endsWith(`@${PLACEHOLDER_EMAIL_DOMAIN}`);
}

/** 抛错句柄：占位域邮箱被拒。调用方（send 回调 / 绑定用例）捕获后映射为拒绝响应。 */
export class PlaceholderEmailRejected extends Error {
  constructor(email: string) {
    super(`占位域邮箱不可用于发码/注册/绑定：${email}`);
    this.name = 'PlaceholderEmailRejected';
  }
}

/** 规范化 + 占位域校验；返回规范化后的邮箱，占位域则抛 PlaceholderEmailRejected。 */
export function assertRealEmail(email: string): string {
  const normalized = normalizeEmail(email);
  if (normalized.endsWith(`@${PLACEHOLDER_EMAIL_DOMAIN}`)) {
    throw new PlaceholderEmailRejected(normalized);
  }
  return normalized;
}
