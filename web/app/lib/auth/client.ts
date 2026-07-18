// web/app/lib/auth/client.ts —— 浏览器侧直调 Better Auth phone-number REST 端点（WP-A2）。
//
// 未用官方 better-auth/client SDK：SDK 的 createAuthClient 是为标准场景设计的通用封装，
// 而本包只需 3 个端点（send-otp / verify / sign-out），直调 REST 更薄、错误信息更可控
// （SDK 的 fetch 封装会吞掉部分 body 细节）。端点路径与请求体形状核对自
// node_modules/better-auth 的 phone-number 插件源码（POST /phone-number/send-otp、
// POST /phone-number/verify、POST /sign-out），与 tracer/auth-tracer/scripts/login-loop.mjs
// 的实测行为一致。同源 fetch 浏览器会自动带 Origin 头，满足 Better Auth 的 CSRF 校验。

const AUTH_BASE = '/api/auth';

export class AuthApiError extends Error {
  readonly code?: string;
  readonly status: number;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'AuthApiError';
    this.status = status;
    this.code = code;
  }
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${AUTH_BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    const code = typeof data?.code === 'string' ? data.code : undefined;
    const message = typeof data?.message === 'string' ? data.message : `请求失败（${res.status}）`;
    throw new AuthApiError(message, res.status, code);
  }

  return data as T;
}

export function sendPhoneOtp(phoneNumber: string): Promise<{ message: string }> {
  return post('/phone-number/send-otp', { phoneNumber });
}

export interface VerifyPhoneOtpResult {
  status: boolean;
  token: string | null;
  user: { id: string; phoneNumber?: string } | null;
}

export function verifyPhoneOtp(phoneNumber: string, code: string): Promise<VerifyPhoneOtpResult> {
  return post('/phone-number/verify', { phoneNumber, code });
}

/**
 * 已登录用户绑定手机号（WP-A3-2）：verifyPhoneNumber + updatePhoneNumber:true。
 * 服务端事务内校验 OTP → 唯一冲突（手机号已被占用）→ 原地更新 phoneNumber，User.id 不变。
 * 目标手机号已被其他账户占用时抛 AuthApiError(code=PHONE_NUMBER_EXIST)。
 */
export function bindPhone(phoneNumber: string, code: string): Promise<VerifyPhoneOtpResult> {
  return post('/phone-number/verify', { phoneNumber, code, updatePhoneNumber: true });
}

// ---- 邮箱 OTP（WP-A3-2） ----

/** 邮箱登录/注册发码（type=sign-in）。占位域邮箱与节流拒绝由服务端返回 4xx。 */
export function sendEmailOtp(email: string): Promise<{ success: boolean }> {
  return post('/email-otp/send-verification-otp', { email, type: 'sign-in' });
}

export interface SignInEmailOtpResult {
  token: string;
  user: { id: string; email?: string };
}

/** 邮箱验证码登录/注册（未注册邮箱首次验证即建号）。 */
export function signInEmailOtp(email: string, otp: string): Promise<SignInEmailOtpResult> {
  return post('/sign-in/email-otp', { email, otp });
}

/**
 * 已登录用户绑定邮箱（WP-A3-2）：changeEmail 流程第一步，向新邮箱发码。
 * 手机号占位邮箱用户借此迁移为真实邮箱（changeEmail.verifyCurrentEmail=false）。
 */
export function requestEmailChange(newEmail: string): Promise<{ success: boolean }> {
  return post('/email-otp/request-email-change', { newEmail });
}

/**
 * 已登录用户绑定邮箱第二步：校验新邮箱 OTP → 原地更新 User.email/emailVerified，User.id 不变。
 * 新邮箱已被其他账户占用时抛 AuthApiError（"Email already in use"）。
 */
export function changeEmail(newEmail: string, otp: string): Promise<{ success: boolean }> {
  return post('/email-otp/change-email', { newEmail, otp });
}

export async function signOut(): Promise<void> {
  await post('/sign-out', {});
}

// better-auth 的 phone-number 插件不公开导出 PHONE_NUMBER_ERROR_CODES（其 barrel
// export 只含 `phoneNumber` 工厂与类型，见 better-auth/dist/plugins/phone-number/index.d.mts）；
// 只能从内部 error-codes.mjs 深路径 import，属实现细节耦合，故这里按插件源码
// （node_modules/better-auth/dist/plugins/phone-number/error-codes.mjs）把已知错误码
// 的 key 字符串直接列出——APIError.from(status, error) 会把 error.code（即该 key）
// 序列化进响应体的 code 字段（见 @better-auth/core error/index.mjs + better-call
// to-response.mjs 的实测行为）。
const ERROR_CODE_MESSAGES: Record<string, string> = {
  OTP_EXPIRED: '验证码已过期，请重新获取。',
  INVALID_OTP: '验证码错误，请重新输入。',
  TOO_MANY_ATTEMPTS: '尝试次数过多，请重新获取验证码。',
  INVALID_PHONE_NUMBER: '手机号格式不正确。',
  OTP_NOT_FOUND: '未找到验证码记录，请重新获取。',
  // WP-A3-2：邮箱 OTP + 双向绑定 + 节流。
  INVALID_EMAIL: '邮箱格式不正确，或该邮箱不可用于登录/绑定。',
  PHONE_NUMBER_EXIST: '该手机号已绑定到其他账户，无法重复绑定。',
  OTP_COOLDOWN: '发送太频繁，请稍后再试。',
  OTP_DAILY_CAP: '今日验证码发送次数已达上限，请明天再试。',
};

/**
 * 冲突/占用类错误（绑定被拒）：目标凭证已被其他账户占用。
 * 服务端 P2002 唯一冲突映射为结构化响应，前端据此内联提示（不退出当前 session）。
 * 邮箱占用（changeEmail 的 "Email already in use"，无独立 code）与手机号占用
 * （PHONE_NUMBER_EXIST）都归此类。
 */
export function isCredentialConflict(err: unknown): boolean {
  if (!(err instanceof AuthApiError)) return false;
  if (err.code === 'PHONE_NUMBER_EXIST') return true;
  return /already in use|已绑定|已被/.test(err.message);
}

/** 把 AuthApiError 转成表单内联可读文案；非本模块抛出的错误按未知网络错误兜底。 */
export function describeAuthError(err: unknown): string {
  if (err instanceof AuthApiError) {
    if (err.code && ERROR_CODE_MESSAGES[err.code]) return ERROR_CODE_MESSAGES[err.code];
    // changeEmail 冲突无独立 code，只有英文 message；映射为中文内联提示。
    if (/already in use/i.test(err.message)) return '该邮箱已绑定到其他账户，无法重复绑定。';
    return err.message || '操作失败，请稍后重试。';
  }
  return '网络异常，请稍后重试。';
}
