// infra/mail/directmail.ts —— 阿里云 DirectMail（邮件推送）SingleSendMail 适配器（WP-A3-2）。
// spec: docs/plans/p0-batch-1-execution-plan.md WP-A3-2 § S2 a（照抄 infra/sms/pnvs.ts 模式）。
//
// 账号凭证（ALIBABA_CLOUD_ACCESS_KEY_ID/SECRET）与发信配置（发信地址/显示名/端点）
// 由调用方（sendOtpEmail）从已校验的 WebConfig 取出显式传入——本文件不读 process.env
// （lint 边界：process.env 只准在 infra/config）。
//
// 外部前置（S1 已实测）：DirectMail 已开通（华东1），发信域名 mail.petscape3d.com
// 真实发信地址由 MAIL_FROM_ADDRESS 注入；仓库不携带环境专属域名。
//
// SDK 说明：@alicloud/dm20151123 的 Client extends @alicloud/openapi-core 的 OpenApi，
// 构造函数吃 $OpenApiUtil.Config（accessKeyId/accessKeySecret/endpoint）。
// SingleSendMail 成功返回 body 带 requestId/envId；失败由 SDK 抛异常。
import Dm, { SingleSendMailRequest } from '@alicloud/dm20151123';
import { $OpenApiUtil } from '@alicloud/openapi-core';
import type { SendMailResult } from './types.ts';

export interface DirectMailCredentials {
  accessKeyId: string;
  accessKeySecret: string;
}

export interface DirectMailConfig {
  /** 已在 DirectMail 控制台配置并验证的发信地址。 */
  fromAddress: string;
  /** 发信显示名，如 "PetScape"。 */
  fromAlias: string;
  /** DirectMail 服务端点，默认华东1 dm.aliyuncs.com。 */
  endpoint?: string;
}

function makeClient(credentials: DirectMailCredentials, endpoint: string): Dm {
  const config = new $OpenApiUtil.Config({
    accessKeyId: credentials.accessKeyId,
    accessKeySecret: credentials.accessKeySecret,
    endpoint,
  });
  return new Dm(config);
}

/**
 * 经 DirectMail SingleSendMail 发送 OTP 验证码邮件。验证码真相源始终是 Better Auth，
 * 本模块只作为投递通道（同 infra/sms/pnvs.ts 对 PNVS 的定位）。
 */
export async function sendDirectMailOtp(
  to: string,
  code: string,
  credentials: DirectMailCredentials,
  mailConfig: DirectMailConfig,
): Promise<SendMailResult> {
  const endpoint = mailConfig.endpoint ?? 'dm.aliyuncs.com';
  const client = makeClient(credentials, endpoint);

  const req = new SingleSendMailRequest({
    accountName: mailConfig.fromAddress,
    addressType: 1, // 1 = 使用已配置的发信地址
    replyToAddress: false,
    toAddress: to,
    fromAlias: mailConfig.fromAlias,
    subject: 'PetScape 登录验证码',
    htmlBody: renderOtpHtml(code),
    textBody: renderOtpText(code),
  });

  try {
    const resp = await client.singleSendMail(req);
    const body = resp?.body;
    const ok = !!(body?.requestId || body?.envId);
    return {
      ok,
      channel: 'directmail',
      detail: JSON.stringify({ requestId: body?.requestId, envId: body?.envId, statusCode: resp?.statusCode }),
    };
  } catch (err) {
    // 通道抛错：ok=false，节流层据此回滚记账（不计入上限）。
    return {
      ok: false,
      channel: 'directmail',
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

/** 一句话中文邮件正文模板（HTML）。验证码 5 分钟有效。 */
function renderOtpHtml(code: string): string {
  return `<p>你的 PetScape 登录验证码是 <strong style="font-size:18px;letter-spacing:2px">${code}</strong>，5 分钟内有效，请勿泄露给他人。</p>`;
}

function renderOtpText(code: string): string {
  return `你的 PetScape 登录验证码是 ${code}，5 分钟内有效，请勿泄露给他人。`;
}
