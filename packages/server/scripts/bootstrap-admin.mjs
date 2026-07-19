// Operator-only bootstrap for the first admin. No HTTP endpoint is exposed.
import { bootstrapFirstAdmin } from '../src/application/check-runs.ts';
import { createPrismaClient } from '../src/infra/db/index.ts';

const [targetUserId, reason, ...extra] = process.argv.slice(2);
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
if (!targetUserId || !reason || extra.length > 0) {
  throw new Error('Usage: pnpm --filter @petscape/server admin:bootstrap -- <userId> <reason>');
}

const prisma = createPrismaClient({ connectionString: process.env.DATABASE_URL, poolMax: 1 });
try {
  const result = await bootstrapFirstAdmin({ prisma, targetUserId, reason });
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally {
  await prisma.$disconnect();
}
