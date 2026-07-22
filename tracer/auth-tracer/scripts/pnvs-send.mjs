// Standalone Aliyun PNVS SendSmsVerifyCode probe.
// Reads ALIBABA_CLOUD_ACCESS_KEY_ID/SECRET from the MAIN REPO .env at runtime.
// Never prints credential values. Prints only the API response code/message.
//
// Usage:
//   node scripts/pnvs-send.mjs <phone> [signName] [templateCode]
// Env overrides: PNVS_SIGN_NAME, PNVS_TEMPLATE_CODE
import { readFileSync } from "node:fs";
import DypnsapiPkg, { SendSmsVerifyCodeRequest } from "@alicloud/dypnsapi20170525";
import OpenApiPkg from "@alicloud/openapi-client";

// Node ESM interop: CJS default lands the namespace object; the client class and
// Config are one level deeper under `.default` / named.
const Dypnsapi =
  typeof DypnsapiPkg === "function" ? DypnsapiPkg : DypnsapiPkg.default;
const Config = OpenApiPkg.Config ?? OpenApiPkg.default?.Config ?? OpenApiPkg.default;

const MAIN_ENV = new URL('../../../.env', import.meta.url);

function loadMainEnvCreds() {
  const txt = readFileSync(MAIN_ENV, "utf8");
  const get = (k) => {
    const m = txt.match(new RegExp(`^${k}=(.*)$`, "m"));
    return m ? m[1].trim().replace(/^["']|["']$/g, "") : "";
  };
  return {
    id: get("ALIBABA_CLOUD_ACCESS_KEY_ID"),
    secret: get("ALIBABA_CLOUD_ACCESS_KEY_SECRET"),
  };
}

const phone = process.argv[2];
if (!phone) {
  console.error('usage: node scripts/pnvs-send.mjs <test-phone> [signName] [templateCode]');
  process.exit(2);
}
const signName = process.argv[3] ?? process.env.PNVS_SIGN_NAME ?? "";
const templateCode = process.argv[4] ?? process.env.PNVS_TEMPLATE_CODE ?? "";

const { id, secret } = loadMainEnvCreds();
if (!id || !secret) {
  console.error("PNVS-FAIL creds missing in main .env");
  process.exit(2);
}
console.log(
  `creds loaded: id.len=${id.length} secret.len=${secret.length} (values not printed)`,
);
console.log(`target phone=${phone} signName=${signName || "(none)"} templateCode=${templateCode || "(none)"}`);

const config = new Config({
  accessKeyId: id,
  accessKeySecret: secret,
  endpoint: "dypnsapi.aliyuncs.com",
});
const client = new Dypnsapi(config);

const reqFields = {
  phoneNumber: phone,
  countryCode: "86",
  validTime: 300,
  // Let PNVS generate the code (returnVerifyCode) so we don't need BA here.
  returnVerifyCode: false,
};
if (signName) reqFields.signName = signName;
if (templateCode) {
  reqFields.templateCode = templateCode;
  reqFields.templateParam = JSON.stringify({ code: "##code##", min: "5" });
}

const req = new SendSmsVerifyCodeRequest(reqFields);

try {
  const resp = await client.sendSmsVerifyCode(req);
  const body = resp?.body ?? {};
  const code = body.code;
  const msg = body.message;
  console.log(`PNVS-RESP code=${code} message=${JSON.stringify(msg)} requestId=${body.requestId}`);
  if (code === "OK") {
    console.log("PNVS-OK sms accepted by channel");
    process.exit(0);
  }
  // Classify service-not-opened style errors for retry decision.
  const notOpened = /not.*open|未开通|BUSINESS_LIMIT_CONTROL_FORBIDDEN|ProductUnsubscribe|Unsubscribed|not.*subscrib/i.test(
    `${code} ${msg}`,
  );
  console.log(notOpened ? "PNVS-NOT-OPENED" : "PNVS-REJECTED");
  process.exit(notOpened ? 3 : 1);
} catch (e) {
  const data = e?.data ?? {};
  const code = data.Code ?? e.code ?? "";
  const msg = data.Message ?? e.message ?? "";
  console.log(`PNVS-ERR code=${code} message=${JSON.stringify(msg)}`);
  const notOpened = /not.*open|未开通|Unsubscribe|not.*subscrib|Forbidden.*RAM|NoPermission|InvalidAction|does not exist/i.test(
    `${code} ${msg}`,
  );
  console.log(notOpened ? "PNVS-NOT-OPENED" : "PNVS-REJECTED");
  process.exit(notOpened ? 3 : 1);
}
