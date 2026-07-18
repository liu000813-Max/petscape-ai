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
};

/** 把 AuthApiError 转成表单内联可读文案；非本模块抛出的错误按未知网络错误兜底。 */
export function describeAuthError(err: unknown): string {
  if (err instanceof AuthApiError) {
    if (err.code && ERROR_CODE_MESSAGES[err.code]) return ERROR_CODE_MESSAGES[err.code];
    return err.message || '操作失败，请稍后重试。';
  }
  return '网络异常，请稍后重试。';
}
