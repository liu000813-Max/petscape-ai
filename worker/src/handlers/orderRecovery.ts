// WP-C4-1 — durable repair for a succeeded payment whose immediate Order insert was interrupted.
import { processOrderRecoveryJob } from '@petscape/server/worker-api';
import type { JobHandler } from './types.ts';
import { NeedsAttentionError, RetryableError } from './types.ts';

const RETRYABLE_CODES = new Set([
  'P1000', 'P1001', 'P1002', 'P1008', 'P1017', 'P2024', 'P2034',
  '40001', '40P01', '57P01', '57P02', '57P03',
  'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN', 'ENETUNREACH',
]);

export function isRetryableOrderRecoveryError(error: unknown): boolean {
  for (let current: unknown = error, depth = 0; current && depth < 4; depth += 1) {
    if (typeof current !== 'object') return false;
    const value = current as { code?: unknown; cause?: unknown };
    if (typeof value.code === 'string' && (RETRYABLE_CODES.has(value.code) || /^08[0-9A-Z]{3}$/.test(value.code))) {
      return true;
    }
    current = value.cause;
  }
  return false;
}

export const orderRecoveryHandler: JobHandler = async (job, ctx) => {
  try {
    return await processOrderRecoveryJob({
      prisma: ctx.server.prisma,
      ownerUserId: job.ownerUserId,
      input: job.input,
    });
  } catch (error) {
    if (isRetryableOrderRecoveryError(error)) {
      throw new RetryableError(`订单补单暂时失败: ${error instanceof Error ? error.message : String(error)}`);
    }
    throw new NeedsAttentionError(`订单补单需要检查: ${error instanceof Error ? error.message : String(error)}`);
  }
};
