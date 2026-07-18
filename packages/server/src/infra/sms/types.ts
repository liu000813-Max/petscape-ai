// infra/sms/types.ts —— OTP 短信发送通道的公共返回类型。
export interface SendOtpResult {
  ok: boolean;
  channel: string;
  detail: string;
}
