import test from 'node:test';
import assert from 'node:assert/strict';

import {
  calculateSandboxPrice,
  assertFormalPricingAllowed,
  PricingEligibilityError,
} from '../src/domain/pricing.ts';

const material = {
  densityMilligramPerCm3: 1270,
  unitPriceCentPerGram: 35,
  currency: 'CNY',
  isSellable: false,
  sandboxOnly: true,
};
const rule = {
  formulaVersion: 'material-cent-ceil-plus-base-times-multiplier-v0',
  baseFeeCent: 2500,
  multiplier: '2.5',
  floorPriceCent: 12900,
  currency: 'CNY',
  taxMode: 'tax_inclusive',
  roundingMode: 'ceil_whole_yuan',
  isSellable: false,
  sandboxOnly: true,
};

test('small mesh uses the ¥129 floor and returns integer cents', () => {
  const result = calculateSandboxPrice({ volumeMm3: '1000', material, rule });
  assert.equal(result.weightGrams, '1.27');
  assert.equal(result.materialCostCent, 45);
  assert.equal(result.amountCent, 12900);
  assert.equal(Number.isSafeInteger(result.amountCent), true);
});

test('Decimal calculation rounds the final quote upward to a whole yuan', () => {
  const result = calculateSandboxPrice({ volumeMm3: '141732.2835', material, rule });
  assert.equal(result.weightGrams, '180');
  assert.equal(result.materialCostCent, 6300);
  assert.equal(result.amountCent, 22000);

  const rounded = calculateSandboxPrice({ volumeMm3: '100000', material, rule });
  assert.equal(rounded.amountBeforeRoundingCent, '17362.5');
  assert.equal(rounded.amountCent, 17400);
});

test('formal pricing rejects the v0 sandbox material and rule', () => {
  assert.throws(
    () => assertFormalPricingAllowed({ material, rule }),
    (error) => error instanceof PricingEligibilityError && /sandbox/i.test(error.message),
  );
});

test('zero, negative and unsafe-huge geometry cannot produce an amount', () => {
  assert.throws(() => calculateSandboxPrice({ volumeMm3: '0', material, rule }), /有限正数/);
  assert.throws(() => calculateSandboxPrice({ volumeMm3: '-1', material, rule }), /有限正数/);
  assert.throws(
    () => calculateSandboxPrice({ volumeMm3: '1e30', material, rule }),
    /安全整数分范围/,
  );
});

test('material and pricing rule currencies must match', () => {
  assert.throws(
    () => calculateSandboxPrice({ volumeMm3: '1000', material: { ...material, currency: 'USD' }, rule }),
    /币种必须一致/,
  );
});

test('pricing implementation rejects an unrecognized formula version', () => {
  assert.throws(
    () => calculateSandboxPrice({ volumeMm3: '1000', material, rule: { ...rule, formulaVersion: 'other' } }),
    /公式版本/,
  );
});
