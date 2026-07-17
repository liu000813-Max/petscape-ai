// Aliyun PNVS (号码认证服务) SendSmsVerifyCode adapter.
// Credentials are read from process.env at runtime (injected by the runner script
// from the main repo .env). This module never hardcodes or logs credential values.
import Dypnsapi, { SendSmsVerifyCodeRequest } from "@alicloud/dypnsapi20170525";
import { Config } from "@alicloud/openapi-client";
import type { SendResult } from "./sms";

function makeClient(): InstanceType<typeof Dypnsapi> {
  const accessKeyId = process.env.ALIBABA_CLOUD_ACCESS_KEY_ID;
  const accessKeySecret = process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET;
  if (!accessKeyId || !accessKeySecret) {
    throw new Error("missing ALIBABA_CLOUD_ACCESS_KEY_ID/SECRET in env");
  }
  const config = new Config({
    accessKeyId,
    accessKeySecret,
    endpoint: "dypnsapi.aliyuncs.com",
  });
  return new Dypnsapi(config);
}

export async function sendPnvsVerifyCode(
  phoneNumber: string,
  code: string,
): Promise<SendResult> {
  const client = makeClient();
  const signName = process.env.PNVS_SIGN_NAME || undefined;
  const templateCode = process.env.PNVS_TEMPLATE_CODE || undefined;
  const schemeName = process.env.PNVS_SCHEME_NAME || undefined;

  const req = new SendSmsVerifyCodeRequest({
    phoneNumber,
    signName,
    templateCode,
    schemeName,
    // Send Better Auth's own code so BA stays source of truth.
    templateParam: JSON.stringify({ code }),
    countryCode: "86",
    validTime: 300,
  });

  const resp = await client.sendSmsVerifyCode(req);
  const body = resp?.body;
  const success = body?.code === "OK" || body?.success === true;
  const detail = JSON.stringify({
    code: body?.code,
    message: body?.message,
    success: body?.success,
    requestId: body?.requestId,
  });
  return { ok: !!success, channel: "pnvs", detail };
}
