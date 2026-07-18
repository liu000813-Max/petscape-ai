// infra/sms/ —— OTP 短信发送通道分发（WP-3.1）。
// spec: docs/plans/phase-b-execution-plan.md WP-3.1；收编自 tracer/auth-tracer/app/lib/sms.ts。
//
// 通道选择由调用方（infra/auth 的 betterAuth sendOTP 回调）传入已校验的
// WebConfig 字段，本模块不读 process.env。
// - "log"：不发真短信，只把验证码写入进程标准输出，供集成测试/本地开发从日志提取
//   （测试沿用 tracer 的 login-loop.mjs 做法：正则匹配 "[SMS:log] OTP for ... => code"）。
// - "pnvs"：调用阿里云 PNVS SendSmsVerifyCode 真实发送。
import type { PnvsCredentials, PnvsTemplateConfig } from './pnvs.ts';
import type { SendOtpResult } from './types.ts';

export type { SendOtpResult } from './types.ts';
export { sendPnvsVerifyCode } from './pnvs.ts';
export type { PnvsCredentials, PnvsTemplateConfig } from './pnvs.ts';

export interface SendOtpSmsOptions {
  channel: 'log' | 'pnvs';
  pnvsCredentials?: PnvsCredentials;
  pnvsTemplate?: PnvsTemplateConfig;
}

export async function sendOtpSms(
  phoneNumber: string,
  code: string,
  options: SendOtpSmsOptions,
): Promise<SendOtpResult> {
  if (options.channel !== 'pnvs') {
    // 唯一目的即打印验证码供 log 通道读取（集成测试/本地开发从 stdout 提取）。
    console.log(`[SMS:log] OTP for ${phoneNumber} => ${code}`);
    return { ok: true, channel: 'log', detail: `logged code for ${phoneNumber}` };
  }

  if (!options.pnvsCredentials) {
    throw new Error('SMS_CHANNEL=pnvs 但缺少阿里云凭证（ALIBABA_CLOUD_ACCESS_KEY_ID/SECRET）');
  }

  const { sendPnvsVerifyCode } = await import('./pnvs.ts');
  return sendPnvsVerifyCode(phoneNumber, code, options.pnvsCredentials, options.pnvsTemplate ?? {});
}
