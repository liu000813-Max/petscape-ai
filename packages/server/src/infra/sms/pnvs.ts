// infra/sms/pnvs.ts —— 阿里云 PNVS（号码认证服务）SendSmsVerifyCode 适配器。
// spec: docs/plans/phase-b-execution-plan.md WP-3.1；收编自 tracer/auth-tracer/app/lib/pnvs.ts。
//
// 账号凭证（ALIBABA_CLOUD_ACCESS_KEY_ID/SECRET）与签名/模板（PNVS_SIGN_NAME/
// PNVS_TEMPLATE_CODE/PNVS_SCHEME_NAME）均由调用方（sendOtpSms）从已校验的
// WebConfig 中取出并显式传入本模块——本文件不读 process.env（lint 边界：
// process.env 只准在 infra/config 中出现）。
import DypnsapiPkg, { SendSmsVerifyCodeRequest } from '@alicloud/dypnsapi20170525';
import OpenApiPkg, { Config as ConfigNamed } from '@alicloud/openapi-client';
import type { SendOtpResult } from './types.ts';

// ESM/CJS interop 坑（收编自 tracer/auth-tracer README 踩坑 3）：webpack/tsc 打包
// 路径（Next.js production build）下 esModuleInterop 会直接给出类；但裸 Node ESM
// 直跑（无打包步骤，例如本地一次性探针脚本）会把 default import 落到 CJS 命名空间
// 对象，真正的类在 `.default` 一层。两种运行形态都需要兼容，故做防御式解包。
//
// 类型层坑（2026-07-18 merge 后在 tsconfig.build.json 的 nodenext 解析模式下暴露，
// bundler 模式下不触发）：nodenext 对该 CJS 包的 typeof 推断落在 module namespace
// 而非可构造的类类型，`InstanceType<typeof DypnsapiPkg>` / `new Dypnsapi(...)` 均会
// 被判定为 not constructable。运行时解包逻辑本身正确，此处只声明一个最小客户端接口
// （仅覆盖本文件用到的 sendSmsVerifyCode 方法）绕开该推断坑，不改变任何运行时行为。
interface DypnsapiClient {
  sendSmsVerifyCode(req: SendSmsVerifyCodeRequest): Promise<{ body?: Record<string, unknown> }>;
}
type DypnsapiCtor = new (config: unknown) => DypnsapiClient;
const Dypnsapi = ((typeof DypnsapiPkg === 'function'
  ? DypnsapiPkg
  : (DypnsapiPkg as unknown as { default: typeof DypnsapiPkg }).default) ??
  DypnsapiPkg) as unknown as DypnsapiCtor;
const Config =
  ConfigNamed ??
  ((OpenApiPkg as unknown as { Config: typeof ConfigNamed }).Config ??
    (OpenApiPkg as unknown as { default: { Config: typeof ConfigNamed } }).default?.Config);

export interface PnvsCredentials {
  accessKeyId: string;
  accessKeySecret: string;
}

export interface PnvsTemplateConfig {
  signName?: string;
  templateCode?: string;
  schemeName?: string;
}

function makeClient(credentials: PnvsCredentials): DypnsapiClient {
  const config = new Config({
    accessKeyId: credentials.accessKeyId,
    accessKeySecret: credentials.accessKeySecret,
    endpoint: 'dypnsapi.aliyuncs.com',
  });
  return new Dypnsapi(config);
}

/**
 * 调 PNVS SendSmsVerifyCode，把 Better Auth 已生成的验证码原样透传给短信模板
 * （PNVS 只作为发送通道，验证码真相源始终是 Better Auth，见 ADR-0004）。
 * 模板 100001 要求 templateParam 同时含 code 与 min 两个参数。
 */
export async function sendPnvsVerifyCode(
  phoneNumber: string,
  code: string,
  credentials: PnvsCredentials,
  template: PnvsTemplateConfig,
): Promise<SendOtpResult> {
  const client = makeClient(credentials);

  const req = new SendSmsVerifyCodeRequest({
    phoneNumber,
    signName: template.signName,
    templateCode: template.templateCode,
    schemeName: template.schemeName,
    templateParam: JSON.stringify({ code, min: '5' }),
    countryCode: '86',
    validTime: 300,
  });

  const resp = await client.sendSmsVerifyCode(req);
  const body = resp?.body;
  const success = body?.code === 'OK' || body?.success === true;
  const detail = JSON.stringify({
    code: body?.code,
    message: body?.message,
    success: body?.success,
    requestId: body?.requestId,
  });
  return { ok: !!success, channel: 'pnvs', detail };
}
