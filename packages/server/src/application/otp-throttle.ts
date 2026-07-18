// application/otp-throttle.ts —— OTP 发送节流用例（WP-A3-2）。
// spec: docs/plans/p0-batch-1-execution-plan.md WP-A3-2 § S2 codex 审查增补（增补 d）。
//
// 【测试先行占位】本文件当前仅签名占位（throw NOT_IMPLEMENTED），供
// otp-credentials.integration.test.mjs 的节流用例先跑红。实现阶段填充事务内
// 原子判定「60s 冷却 + 滚动 24h 10 次上限」+ 成功后记账语义。
//
// 不直接 import @prisma/client（lint 边界）：PrismaClient 类型经 infra/db 转发，
// 实例由调用方（infra/auth 的 send 回调）传入。
import type { PrismaClient } from '../infra/db/index.ts';

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
 */
export async function sendThroughThrottle(_options: SendThroughThrottleOptions): Promise<void> {
  throw new Error('NOT_IMPLEMENTED: application/otp-throttle.sendThroughThrottle');
}
