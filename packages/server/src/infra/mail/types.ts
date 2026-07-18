// infra/mail/types.ts —— OTP 邮件发送通道的公共返回类型（WP-A3-2）。
export interface SendMailResult {
  ok: boolean;
  channel: string;
  detail: string;
}
