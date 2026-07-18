// infra/mail/ —— OTP 邮件发送通道分发（WP-A3-2）。
// spec: docs/plans/p0-batch-1-execution-plan.md WP-A3-2 § S2 a（照抄 infra/sms 模式）。
//
// 通道选择由调用方（infra/auth 的 betterAuth emailOTP sendVerificationOTP 回调）传入
// 已校验的 WebConfig 字段，本模块不读 process.env。
// - "log"：不发真邮件，只把验证码写入进程标准输出，供集成/e2e 测试从日志提取
//   （行格式 "[MAIL:log] OTP for <email> => <code>"，与 infra/sms 的 [SMS:log] 对齐）。
// - "directmail"：调用阿里云 DirectMail SingleSendMail 真实发送。
import type { DirectMailCredentials, DirectMailConfig } from './directmail.ts';
import type { SendMailResult } from './types.ts';

export type { SendMailResult } from './types.ts';
export { sendDirectMailOtp } from './directmail.ts';
export type { DirectMailCredentials, DirectMailConfig } from './directmail.ts';

export interface SendOtpEmailOptions {
  channel: 'log' | 'directmail';
  directMailCredentials?: DirectMailCredentials;
  directMailConfig?: DirectMailConfig;
}

export async function sendOtpEmail(
  email: string,
  code: string,
  options: SendOtpEmailOptions,
): Promise<SendMailResult> {
  if (options.channel !== 'directmail') {
    // 唯一目的即打印验证码供 log 通道读取（集成/e2e 测试从 stdout 提取）。
    console.log(`[MAIL:log] OTP for ${email} => ${code}`);
    return { ok: true, channel: 'log', detail: `logged code for ${email}` };
  }

  if (!options.directMailCredentials || !options.directMailConfig) {
    throw new Error('MAIL_CHANNEL=directmail 但缺少 DirectMail 凭证或发信配置');
  }

  const { sendDirectMailOtp } = await import('./directmail.ts');
  return sendDirectMailOtp(email, code, options.directMailCredentials, options.directMailConfig);
}
