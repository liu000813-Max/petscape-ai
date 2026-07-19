import test from 'node:test';
import assert from 'node:assert/strict';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  if (process.env.CI) throw new Error('CI 缺少 DATABASE_URL：B7 目录集成测试不得静默 skip');
  test('b7-catalog.integration.test.mjs skipped: DATABASE_URL not set', (t) => {
    t.skip('需要执行最新 migration 的真实 PostgreSQL');
  });
} else {
  const { createPrismaClient } = await import('../src/infra/db/index.ts');
  const prisma = createPrismaClient({ connectionString: databaseUrl, poolMax: 3 });
  test.after(() => prisma.$disconnect());

  test('v0 sandbox Material/PricingRule seed exact and formally unsellable', async () => {
    const material = await prisma.material.findUniqueOrThrow({
      where: { versionCode: 'petg-cheese-yellow-sandbox-v0' },
    });
    const rule = await prisma.pricingRule.findUniqueOrThrow({
      where: { versionCode: 'v0-sandbox' },
    });

    assert.equal(material.displayName, 'PETG 奶酪黄（沙箱）');
    assert.equal(material.densityMilligramPerCm3, 1270);
    assert.equal(material.unitPriceCentPerGram, 35);
    assert.equal(material.currency, 'CNY');
    assert.equal(material.isSellable, false);
    assert.equal(material.sandboxOnly, true);

    assert.equal(rule.materialId, material.id);
    assert.equal(rule.formulaVersion, 'material-cent-ceil-plus-base-times-multiplier-v0');
    assert.equal(rule.baseFeeCent, 2500);
    assert.equal(rule.multiplier.toString(), '2.5');
    assert.equal(rule.floorPriceCent, 12900);
    assert.equal(rule.currency, 'CNY');
    assert.equal(rule.taxMode, 'tax_inclusive');
    assert.equal(rule.roundingMode, 'ceil_whole_yuan');
    assert.equal(rule.isSellable, false);
    assert.equal(rule.sandboxOnly, true);
  });

  test('Material and PricingRule rows are database-enforced append-only', async () => {
    await assert.rejects(
      () => prisma.material.update({
        where: { versionCode: 'petg-cheese-yellow-sandbox-v0' },
        data: { unitPriceCentPerGram: 36 },
      }),
      /append-only/i,
    );
    await assert.rejects(
      () => prisma.pricingRule.delete({ where: { versionCode: 'v0-sandbox' } }),
      /append-only/i,
    );

    const material = await prisma.material.findUniqueOrThrow({
      where: { versionCode: 'petg-cheese-yellow-sandbox-v0' },
    });
    assert.equal(material.unitPriceCentPerGram, 35);
  });
}
