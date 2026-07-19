import { createHash } from 'node:crypto';
import pg from 'pg';

if (process.env.NODE_ENV !== 'test') {
  throw new Error('sandbox payment trust bootstrap 仅允许 NODE_ENV=test');
}

const databaseUrl = process.env.DATABASE_URL;
const secret = process.env.SANDBOX_PAYMENT_SECRET;
if (!databaseUrl || !secret || secret.length < 32) {
  throw new Error('DATABASE_URL 与至少 32 字符的 SANDBOX_PAYMENT_SECRET 必填');
}

const parsed = new URL(databaseUrl);
if (!['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname)) {
  throw new Error('sandbox payment trust bootstrap 只允许本机一次性 PostgreSQL');
}
const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
if (!/(^|_)(ci|test|c3)(_|$)/i.test(databaseName)) {
  throw new Error('sandbox payment trust bootstrap 只允许命名明确的 CI/C3 测试数据库');
}

const verificationKeyHash = createHash('sha256').update(secret).digest('hex');
const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
try {
  await client.query('BEGIN');
  await client.query('LOCK TABLE "payment_intent" IN ACCESS EXCLUSIVE MODE');
  const intents = await client.query('SELECT count(*)::integer AS count FROM "payment_intent"');
  if (intents.rows[0]?.count !== 0) throw new Error('已有 PaymentIntent，禁止旋转 sandbox trust');
  await client.query('LOCK TABLE "payment_provider_trust" IN ACCESS EXCLUSIVE MODE');
  await client.query('ALTER TABLE "payment_provider_trust" DISABLE TRIGGER payment_provider_trust_history_guard');
  const result = await client.query(
    'UPDATE "payment_provider_trust" SET "verificationKeyHash"=$1 WHERE "provider"=$2 AND "sandboxOnly"=TRUE',
    [verificationKeyHash, 'sandbox'],
  );
  if (result.rowCount !== 1) throw new Error('sandbox trusted provider seed 缺失');
  await client.query('ALTER TABLE "payment_provider_trust" ENABLE TRIGGER payment_provider_trust_history_guard');
  await client.query('COMMIT');
  console.log('sandbox payment test trust configured for ephemeral local PostgreSQL');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  await client.end();
}
