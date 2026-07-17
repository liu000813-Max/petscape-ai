// PNVS SMS channel. Layer 1 = console-log only. Layer 2 = real Aliyun PNVS.
// Toggle with SMS_CHANNEL env: "log" (default) or "pnvs".

export type SendResult = {
  ok: boolean;
  channel: string;
  detail: string;
};

export async function sendOtpSms(phoneNumber: string, code: string): Promise<SendResult> {
  const channel = process.env.SMS_CHANNEL ?? "log";

  if (channel !== "pnvs") {
    // Layer 1: never send a real SMS, just print the code server-side.
    console.log(`[SMS:log] OTP for ${phoneNumber} => ${code}`);
    return { ok: true, channel: "log", detail: `logged code for ${phoneNumber}` };
  }

  // Layer 2: real Aliyun PNVS SendSmsVerifyCode.
  // Better Auth generates/validates the OTP itself; PNVS here is instructed to
  // send the SAME code Better Auth produced so the login loop stays authoritative
  // on our side. PNVS can also generate its own code, but we keep BA as source of truth.
  const { sendPnvsVerifyCode } = await import("./pnvs");
  return sendPnvsVerifyCode(phoneNumber, code);
}
