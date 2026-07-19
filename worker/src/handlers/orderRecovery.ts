// WP-C4-1 — durable repair for a succeeded payment whose immediate Order insert was interrupted.
import { processOrderRecoveryJob } from '@petscape/server/worker-api';
import type { JobHandler } from './types.ts';
import { NeedsAttentionError, RetryableError } from './types.ts';

export const orderRecoveryHandler: JobHandler = async (job, ctx) => {
  try {
    return await processOrderRecoveryJob({
      prisma: ctx.server.prisma,
      ownerUserId: job.ownerUserId,
      input: job.input,
    });
  } catch (error) {
    if (error instanceof Error && /serialize|deadlock|connection|timeout|temporar/i.test(error.message)) {
      throw new RetryableError(`订单补单暂时失败: ${error.message}`);
    }
    throw new NeedsAttentionError(`订单补单需要检查: ${error instanceof Error ? error.message : String(error)}`);
  }
};
