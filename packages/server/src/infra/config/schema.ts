// infra/config/schema.ts —— common/web/worker 三个进程级配置 zod schema（WP-2.2）。
// spec: docs/plans/phase-b-execution-plan.md WP-2.2。
//
// 键归属判断（消费方视角，ARCHITECTURE.md §3.3 "Web 与 Worker 使用同一数据库与对象存储"）：
// - common：跨进程共享——运行环境标识、数据库连接、对象存储（Web 签发签名 URL 也要用 OSS 凭证/终端节点，
//   Worker 落地产物也要用同一套）、阿里云通用账号凭证（ALIBABA_CLOUD_ACCESS_KEY_*、REGION 等）。
// - web：目前仅 Web 专属的键，本阶段实际集合很小（Better Auth 等身份配置留待 WP-3.1 落地时再加健壮 required 校验）。
// - worker：仅 Worker 消费——生成类供应商 key（FAL/TRIPO/MESHY，Phase C 前 Worker 尚未接管生成，
//   但按 spec 明确指示归 worker 域）+ 本地切片工具链路径（UV_BIN/PRUSASLICER_BIN）。
//
// 现阶段仅骨架消费这些配置：除 NODE_ENV 外，多数键标 optional，required 收紧留给后续 WP
// 各自接管时做（例如 DATABASE_URL 在 WP-2.3 才真正被使用，本包不应因为它缺失就拒绝启动）。

import { z } from 'zod';

/** 跨进程共享键：Web 与 Worker 都会用到。 */
export const commonSchema = z.object({
  // 唯一 required 键（spec 明确指示"除 NODE_ENV 外多数键对进程启动是 optional+warn"）。
  // Next.js 在 dev/build/start 时会自动注入；worker 是裸 node 进程，不会被自动注入，
  // 因此 worker/package.json 的启动脚本显式设置 NODE_ENV，避免此处的 required 校验
  // 把本地 worker 开发启动搞挂（约定见 worker/package.json 与本文件顶部注释）。
  NODE_ENV: z.enum(['development', 'test', 'production']),

  // WP-2.3 才接 RDS；本包只做骨架校验，先设为 optional，避免 dev 环境启动被卡死。
  DATABASE_URL: z.string().min(1).optional(),

  // 连接预算（WP-2.3 验收 4）：web pool max + worker pool max + migration 预留
  // 需小于实例 SHOW max_connections 实测值（420，见 docs/operations/wp-2-3-report.md）。
  // 两个键都设默认值，任何一端未显式配置也能跑（数值来自该报告的算式，不是任意拍板）。
  WEB_DB_POOL_MAX: z.coerce.number().int().positive().default(20),
  WORKER_DB_POOL_MAX: z.coerce.number().int().positive().default(10),

  // 阿里云通用账号与区域（OSS 与 RDS 共用同一账号凭证，Web 侧签发 OSS 签名 URL、
  // Worker 侧落地产物与查询 DB 都需要）。
  ALIBABA_CLOUD_REGION: z.string().min(1).optional(),
  ALIBABA_CLOUD_ACCESS_KEY_ID: z.string().min(1).optional(),
  ALIBABA_CLOUD_ACCESS_KEY_SECRET: z.string().min(1).optional(),

  // 对象存储：Web 签发签名 URL、Worker 上传产物，二者共用同一 bucket/endpoint。
  ALIBABA_CLOUD_OSS_BUCKET: z.string().min(1).optional(),
  ALIBABA_CLOUD_OSS_ENDPOINT: z.string().min(1).optional(),
  ALIBABA_CLOUD_OSS_INTERNAL_ENDPOINT: z.string().min(1).optional(),

  // RDS 连接细节（DATABASE_URL 是最终连接串，这些是 WP-2.3/演练脚本用来拼接或核对的原始字段）。
  ALIBABA_CLOUD_RDS_INSTANCE_ID: z.string().min(1).optional(),
  ALIBABA_CLOUD_RDS_HOST: z.string().min(1).optional(),
  ALIBABA_CLOUD_RDS_PORT: z.string().min(1).optional(),
  ALIBABA_CLOUD_RDS_DATABASE: z.string().min(1).optional(),
  ALIBABA_CLOUD_RDS_USERNAME: z.string().min(1).optional(),
  ALIBABA_CLOUD_RDS_PASSWORD: z.string().min(1).optional(),

  // 网络与部署相关的 VPC/ECS 字段（Step 0 云资源产出，供部署脚本/tracer 消费；
  // 两个进程都可能需要读取以做自检或日志标注，非 Web/Worker 专属，故归 common）。
  ALIBABA_CLOUD_VPC_ID: z.string().min(1).optional(),
  ALIBABA_CLOUD_VSWITCH_ID: z.string().min(1).optional(),
  ALIBABA_CLOUD_ECS_INSTANCE_ID: z.string().min(1).optional(),
  ALIBABA_CLOUD_ECS_PRIVATE_IP: z.string().min(1).optional(),
  ALIBABA_CLOUD_ECS_PUBLIC_IP: z.string().min(1).optional(),
});

export type CommonConfig = z.infer<typeof commonSchema>;

/**
 * Web 进程专属键。身份模块（Better Auth、PNVS 短信）在 WP-3.1 落地——
 * 认证只发生在 Web 进程（Route Handler 挂载 Better Auth handler），
 * 因此 Better Auth 与 PNVS 短信通道的键都归 web，不归 common/worker。
 */
export const webSchema = z.object({
  // Better Auth 核心配置。secret 对 Web 进程是 required（fail-fast，不允许生产环境
  // 用弱/缺省 secret 签发 Session）；baseURL 允许缺省，Better Auth 自身默认回落到
  // localhost:3000（本地开发场景，见 infra/auth）。
  BETTER_AUTH_SECRET: z.string().min(1),
  BETTER_AUTH_URL: z.string().min(1).optional(),

  // 部署版本标识（WP-4.2）：构建期由 deploy/web.Dockerfile 的 ARG GIT_SHA 注入
  // 同名 ENV，healthz 返回它用于回滚演练的版本可观察性。本地/未注入时缺省。
  GIT_SHA: z.string().min(1).optional(),

  // OTP 短信发送通道分发（"log" = 控制台打印，不发真短信；"pnvs" = 真实阿里云
  // 号码认证服务）。默认 "log"，避免测试/本地环境意外发出真实短信。
  SMS_CHANNEL: z.enum(['log', 'pnvs']).default('log'),

  // 阿里云 PNVS SendSmsVerifyCode 所需的签名/模板（控制台既有资源，非账号凭证——
  // 账号凭证 ALIBABA_CLOUD_ACCESS_KEY_* 已在 common 中）。仅 SMS_CHANNEL=pnvs 时使用，
  // 故均为 optional；真正调用 pnvs 通道且缺失时由 infra/sms 在运行时报错，不在此处
  // 提前拒绝启动（log 通道场景下这些键本就不需要）。
  PNVS_SIGN_NAME: z.string().min(1).optional(),
  PNVS_TEMPLATE_CODE: z.string().min(1).optional(),
  PNVS_SCHEME_NAME: z.string().min(1).optional(),

  // WP-A3-2：OTP 邮件发送通道分发（"log" = 控制台打印，不发真邮件；"directmail" = 真实
  // 阿里云邮件推送 DirectMail SingleSendMail）。默认 "log"，避免测试/本地环境意外真发。
  MAIL_CHANNEL: z.enum(['log', 'directmail']).default('log'),

  // DirectMail 发信配置（控制台既有资源，非账号凭证——账号凭证 ALIBABA_CLOUD_ACCESS_KEY_*
  // 已在 common）。仅 MAIL_CHANNEL=directmail 时使用，故 from-address 给已验证发信地址默认值、
  // 显示名默认 "PetScape"、端点默认华东1；真正调用 directmail 通道且发信地址缺失时由
  // infra/mail 在运行时报错，不在此处提前拒绝启动（log 通道场景下不需要）。
  MAIL_FROM_ADDRESS: z.string().min(1).default('no-reply@mail.petscape3d.com'),
  MAIL_FROM_ALIAS: z.string().min(1).default('PetScape'),
  MAIL_DIRECTMAIL_ENDPOINT: z.string().min(1).default('dm.aliyuncs.com'),
});

export type WebOnlyConfig = z.infer<typeof webSchema>;

/**
 * Worker 进程专属键：生成类供应商 key（Phase C 才被业务代码消费，但本阶段先在配置层建模）
 * + 本地切片工具链路径（沿用现有原型的可覆盖默认值约定，参见 CLAUDE.md 对 avatarJob.ts 的记录）。
 */
export const workerSchema = z.object({
  FAL_KEY: z.string().min(1).optional(),
  MESHY_API_KEY: z.string().min(1).optional(),
  TRIPO_API_KEY: z.string().min(1).optional(),
  TRIPO_API_KEY_2: z.string().min(1).optional(),

  UV_BIN: z.string().min(1).optional(),
  PRUSASLICER_BIN: z.string().min(1).optional(),

  // WP-3.4：worker 正式循环参数。逗号分隔的 job type 列表（认领候选集合）、
  // 轮询间隔（无可认领任务时的睡眠时长）、租约时长（claimNextJob 的 leaseSeconds，
  // 心跳节奏按 leaseSeconds/3 触发，见 worker/src/main.ts）、孤儿恢复扫描周期。
  // 全部给合理默认值，本地/演练无需显式配置也能跑。
  WORKER_JOB_TYPES: z.string().min(1).default('sample.echo'),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(2000),
  WORKER_LEASE_SECONDS: z.coerce.number().int().positive().default(30),
  WORKER_RECOVER_ORPHANS_INTERVAL_MS: z.coerce.number().int().positive().default(15000),
});

export type WorkerOnlyConfig = z.infer<typeof workerSchema>;

export const webConfigSchema = commonSchema.merge(webSchema);
export const workerConfigSchema = commonSchema.merge(workerSchema);

export type WebConfig = z.infer<typeof webConfigSchema>;
export type WorkerConfig = z.infer<typeof workerConfigSchema>;
