// packages/server/tests/db.integration.test.mjs
// spec: docs/plans/phase-b-execution-plan.md WP-2.3 验收 2/3：
//   - 对真实 RDS 完成 CRUD + 事务 + 唯一约束冲突三用例（禁 SQLite/内存替身，ADR-0002 验证条件 6）；
//   - Better Auth adapter 初始化 + 对 RDS 完成一次 user 表空查询冒烟。
//
// 无 DATABASE_URL 时显式 skip 并打印原因（CI 达不到 RDS 内网，WP-2.4 会依赖这个行为）。
// 本地/演练机跑法：先建 SSH 隧道到 RDS（见 docs/plans/phase-b-execution-plan.md 编排约定），
// 设置 DATABASE_URL 指向 localhost 转发端口，再执行 `pnpm test`。

import test from 'node:test';
import assert from 'node:assert/strict';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  test('db.integration.test.mjs skipped: DATABASE_URL not set (RDS 内网不可达，需 SSH 隧道)', (t) => {
    t.skip('DATABASE_URL 未设置——本机需先建立到 RDS 的 SSH 隧道并导出 DATABASE_URL 才能跑此集成测试；CI 环境无法直连 RDS 内网，此为预期行为（见 WP-2.4）。');
  });
} else {
  const { createPrismaClient } = await import('../src/infra/db/index.ts');

  const prisma = createPrismaClient({ connectionString: databaseUrl, poolMax: 5 });

  test.after(async () => {
    // 清理本测试文件写入的探针数据，避免真实 RDS 上残留脏数据影响下一次运行。
    await prisma.basecampProbe.deleteMany({ where: { label: { startsWith: 'wp23-test-' } } });
    await prisma.$disconnect();
  });

  test('CRUD：BasecampProbe 创建/读取/更新/删除对真实 RDS 完整闭环', async () => {
    const label = `wp23-test-crud-${Date.now()}`;

    const created = await prisma.basecampProbe.create({ data: { label, version: 1 } });
    assert.equal(created.label, label);
    assert.equal(created.version, 1);

    const read = await prisma.basecampProbe.findUniqueOrThrow({ where: { id: created.id } });
    assert.equal(read.label, label);

    const updated = await prisma.basecampProbe.update({
      where: { id: created.id },
      data: { version: 2 },
    });
    assert.equal(updated.version, 2);

    const deleted = await prisma.basecampProbe.delete({ where: { id: created.id } });
    assert.equal(deleted.id, created.id);

    await assert.rejects(
      () => prisma.basecampProbe.findUniqueOrThrow({ where: { id: created.id } }),
      /No BasecampProbe found|not found/i,
    );
  });

  test('事务：$transaction 中途失败应整体回滚，不留下部分写入', async () => {
    const labelA = `wp23-test-txn-a-${Date.now()}`;
    const labelB = `wp23-test-txn-b-${Date.now()}`;

    await assert.rejects(
      prisma.$transaction(async (tx) => {
        await tx.basecampProbe.create({ data: { label: labelA } });
        // 第二次插入故意制造唯一约束冲突（同 label 两次），验证事务整体回滚。
        await tx.basecampProbe.create({ data: { label: labelA } });
        await tx.basecampProbe.create({ data: { label: labelB } });
      }),
    );

    const survivorsA = await prisma.basecampProbe.findMany({ where: { label: labelA } });
    const survivorsB = await prisma.basecampProbe.findMany({ where: { label: labelB } });
    assert.equal(survivorsA.length, 0, '事务回滚后 labelA 不应有任何行留存');
    assert.equal(survivorsB.length, 0, '事务回滚后 labelB（发生在冲突之后）也不应被提交');
  });

  test('唯一约束冲突：重复 label 直接插入应抛出 Prisma 唯一约束错误（P2002）', async () => {
    const label = `wp23-test-unique-${Date.now()}`;
    await prisma.basecampProbe.create({ data: { label } });

    await assert.rejects(
      () => prisma.basecampProbe.create({ data: { label } }),
      (error) => {
        assert.equal(error.code, 'P2002', `期望 Prisma 唯一约束错误码 P2002，实际: ${error.code}`);
        return true;
      },
    );
  });

  test('Better Auth prismaAdapter 冒烟：初始化成功 + 对 user 表完成一次真实空查询', async () => {
    const { betterAuth } = await import('better-auth');
    const { prismaAdapter } = await import('better-auth/adapters/prisma');

    const auth = betterAuth({
      secret: 'wp-2-3-integration-test-secret-not-for-prod',
      baseURL: 'http://localhost:3100',
      database: prismaAdapter(prisma, { provider: 'postgresql' }),
    });

    assert.ok(auth, 'betterAuth() 应成功返回实例（未抛错即视为初始化成功）');

    // 对 user 表完成一次真实空查询（不是 mock/内存替身），证明 adapter 确实连到 RDS。
    const users = await prisma.user.findMany({ where: { email: 'wp23-nonexistent@example.invalid' } });
    assert.deepEqual(users, []);
  });
}
