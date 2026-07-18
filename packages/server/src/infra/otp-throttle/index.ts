// infra/otp-throttle/ —— OTP 发送节流（WP-A3-2）。
// spec: docs/plans/p0-batch-1-execution-plan.md WP-A3-2 § S2 codex 审查增补（增补 d）。
//
// 归属 infra：本模块是 DB 持久化 + 副作用编排（记账 + 触发发送），被 infra/auth 的
// Better Auth send 回调直接调用（infra→infra，不跨层向上依赖 application）。
// 事务内原子判定「60s 冷却 + 滚动 24h 10 次上限」+ 成功后记账语义。
//
// 不直接 import @prisma/client（lint 边界）：PrismaClient 类型经 infra/db 转发，
// 实例由调用方（infra/auth 的 send 回调）传入。
import type { PrismaClient } from '../db/index.ts';

export type OtpChannel = 'sms' | 'email';

/** 节流窗口/上限常量（spec：60s 冷却 + 滚动 24h 10 次上限）。 */
export const COOLDOWN_MS = 60_000;
export const ROLLING_WINDOW_MS = 24 * 60 * 60 * 1000;
export const ROLLING_MAX_SENDS = 10;

/** 节流拒绝原因。前端据此渲染内联提示。 */
export type ThrottleReason = 'cooldown' | 'daily_cap';

export class OtpThrottledError extends Error {
  readonly reason: ThrottleReason;
  constructor(reason: ThrottleReason, message: string) {
    super(message);
    this.name = 'OtpThrottledError';
    this.reason = reason;
  }
}

export interface SendThroughThrottleOptions {
  prisma: PrismaClient;
  /** 规范化后的目标：邮箱=trim+lowercase，手机号=E.164。 */
  target: string;
  channel: OtpChannel;
  /** 真正的发送动作。节流通过后调用；抛错则回滚记账（不计入上限）。 */
  send: () => Promise<void>;
}

/**
 * 事务内原子判定节流 + 预留记账 → 执行 send → 成功保留记账 / 失败回滚记账。
 * 节流不通过抛 OtpThrottledError；send 失败原样抛出（记账已回滚）。
 *
 * 并发正确性：判定 + 插入在同一 Serializable 事务内完成，因此对同一 target 的并发发码，
 * 第一个提交的事务插入记账后，后续并发事务在冷却窗判定处看到该记录（或因序列化冲突重试后
 * 看到）→ 抛冷却拒绝，保证"并发同目标发码仅一次通过"。序列化冲突（PG 40001）按冷却拒绝处理
 * （竞态输家语义等价于冷却期内重复发码）。
 *
 * "发送成功后才记账"：记账行在事务内先插入（作为并发闸门），send 失败时立即删除该行，
 * 因此计入滚动 24h 上限的都是真实发出的验证码；通道抛错不占用预算。
 */
/**
 * 只读预检：不插入记账，仅判定当前是否处于冷却窗内或已达 24h 上限。
 * 供 Better Auth before-hook 在端点执行前调用——因为 emailOTP 的
 * sendVerificationOTP / phoneNumber 的 sendOTP 回调被 runInBackgroundOrAwait
 * 吞掉异常（catch+log，见 create-context.mjs），回调内抛出的节流拒绝无法回到
 * HTTP 响应。before-hook 抛出的 APIError 则能正确变成 4xx。
 *
 * 预检通过 ≠ 保证记账成功：真正的原子预留 + 成功后记账仍在回调里的
 * sendThroughThrottle 完成（唯一真相源）。预检与回调之间的窄竞态可接受
 * （最坏是极端并发下回调 reserve 失败被静默吞掉、用户偶发收不到码，重试即可），
 * 不影响"计入上限的都是真实发出的验证码"这一核心不变量。
 */
export async function peekThrottle(
  prisma: SendThroughThrottleOptions['prisma'],
  target: string,
): Promise<void> {
  const now = Date.now();
  const recentCount = await prisma.otpSendRecord.count({
    where: { target, sentAt: { gte: new Date(now - COOLDOWN_MS) } },
  });
  if (recentCount > 0) {
    throw new OtpThrottledError('cooldown', `${target} 处于 60s 发送冷却窗内`);
  }
  const windowCount = await prisma.otpSendRecord.count({
    where: { target, sentAt: { gte: new Date(now - ROLLING_WINDOW_MS) } },
  });
  if (windowCount >= ROLLING_MAX_SENDS) {
    throw new OtpThrottledError('daily_cap', `${target} 24 小时内发送已达 ${ROLLING_MAX_SENDS} 次上限`);
  }
}

export async function sendThroughThrottle(options: SendThroughThrottleOptions): Promise<void> {
  const { prisma, target, channel, send } = options;

  // 1) 事务内原子判定 + 预留记账。
  const recordId = await reserveSlot(prisma, target, channel);

  // 2) 事务外执行真正的发送（阿里云 API 调用不应占用 DB 事务时长）。
  try {
    await send();
  } catch (err) {
    // 3) 发送失败：回滚记账（不计入上限），原样抛出通道错误。
    await prisma.otpSendRecord.delete({ where: { id: recordId } }).catch(() => {});
    throw err;
  }
}

async function reserveSlot(
  prisma: SendThroughThrottleOptions['prisma'],
  target: string,
  channel: OtpChannel,
): Promise<string> {
  try {
    return await prisma.$transaction(
      async (tx: Parameters<Parameters<PrismaClient['$transaction']>[0]>[0]) => {
        const now = Date.now();
        const cooldownSince = new Date(now - COOLDOWN_MS);
        const windowSince = new Date(now - ROLLING_WINDOW_MS);

        // 冷却：60s 内已有任一次发送（不分通道，按 target 聚合）→ 拒绝。
        const recentCount = await tx.otpSendRecord.count({
          where: { target, sentAt: { gte: cooldownSince } },
        });
        if (recentCount > 0) {
          throw new OtpThrottledError('cooldown', `${target} 处于 60s 发送冷却窗内`);
        }

        // 滚动 24h：窗内已达上限 → 拒绝。
        const windowCount = await tx.otpSendRecord.count({
          where: { target, sentAt: { gte: windowSince } },
        });
        if (windowCount >= ROLLING_MAX_SENDS) {
          throw new OtpThrottledError('daily_cap', `${target} 24 小时内发送已达 ${ROLLING_MAX_SENDS} 次上限`);
        }

        const created = await tx.otpSendRecord.create({ data: { target, channel } });
        return created.id;
      },
      { isolationLevel: 'Serializable' },
    );
  } catch (err) {
    // 序列化冲突（并发同目标抢发）：语义等价于冷却期内重复，按冷却拒绝，不泄露内部错误。
    if (isSerializationFailure(err)) {
      throw new OtpThrottledError('cooldown', `${target} 并发发码被节流`);
    }
    throw err;
  }
}

/** PG 序列化失败：SQLSTATE 40001（或 Prisma 包装后的等价标识）。 */
function isSerializationFailure(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = (err as { code?: unknown }).code;
  const message = (err as { message?: unknown }).message;
  if (code === '40001' || code === 'P2034') return true;
  return typeof message === 'string' && /serial|40001|write conflict|deadlock/i.test(message);
}
