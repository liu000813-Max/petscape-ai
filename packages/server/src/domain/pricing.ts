// WP-B7-1 — v0-sandbox Decimal 定价纯函数。
// 外部金额边界始终是整数分；中间材料成本使用 Decimal，禁止二进制浮点运算。
import { Decimal } from '@prisma/client-runtime-utils';

const POSTGRES_INTEGER_MAX = 2_147_483_647;

export interface SandboxMaterialPricingInput {
  densityMilligramPerCm3: number;
  unitPriceCentPerGram: number;
  currency: string;
  isSellable: boolean;
  sandboxOnly: boolean;
}

export interface SandboxPricingRuleInput {
  formulaVersion: string;
  baseFeeCent: number;
  multiplier: string | Decimal;
  floorPriceCent: number;
  currency: string;
  taxMode: string;
  roundingMode: string;
  isSellable: boolean;
  sandboxOnly: boolean;
}

export class PricingEligibilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PricingEligibilityError';
  }
}

export function assertFormalPricingAllowed({
  material,
  rule,
}: {
  material: SandboxMaterialPricingInput;
  rule: SandboxPricingRuleInput;
}): void {
  if (material.sandboxOnly || rule.sandboxOnly) {
    throw new PricingEligibilityError('sandbox material or pricing rule cannot create a formal Quote');
  }
  if (!material.isSellable || !rule.isSellable) {
    throw new PricingEligibilityError('non-sellable material or pricing rule cannot create a formal Quote');
  }
}

export function calculateSandboxPrice({
  volumeMm3,
  material,
  rule,
}: {
  volumeMm3: string;
  material: SandboxMaterialPricingInput;
  rule: SandboxPricingRuleInput;
}) {
  if (rule.formulaVersion !== 'material-cent-ceil-plus-base-times-multiplier-v0') {
    throw new Error('不支持的沙箱定价公式版本');
  }
  if (material.currency !== rule.currency) {
    throw new Error('材料与定价规则币种必须一致');
  }
  if (rule.currency !== 'CNY' || rule.taxMode !== 'tax_inclusive') {
    throw new Error('v0-sandbox 只支持 CNY tax_inclusive');
  }
  if (rule.roundingMode !== 'ceil_whole_yuan') {
    throw new Error('v0-sandbox 只支持 ceil_whole_yuan');
  }

  const volume = new Decimal(volumeMm3);
  if (!volume.isFinite() || volume.lte(0)) throw new Error('volumeMm3 必须是有限正数');

  // mm³ → cm³: /1000；mg/cm³ → g/cm³: /1000。
  // 重量固定到 0.001g，作为 v0 算法的一部分，避免显示与计价使用不同精度。
  const weight = volume
    .mul(material.densityMilligramPerCm3)
    .div(1_000_000)
    .toDecimalPlaces(3, Decimal.ROUND_HALF_UP);
  // 货币边界不允许小数分：材料成本先以 Decimal 精确计算，再向上取到整数分。
  // 这是 v0-sandbox 的显式中间舍入口径，避免 API/后续快照泄露小数分。
  const materialCost = weight
    .mul(material.unitPriceCentPerGram)
    .toDecimalPlaces(0, Decimal.ROUND_CEIL);
  const materialCostCent = materialCost.toNumber();
  if (!Number.isSafeInteger(materialCostCent) || materialCostCent < 0) {
    throw new Error('材料成本超出安全整数分范围');
  }
  const calculated = materialCost.add(rule.baseFeeCent).mul(new Decimal(rule.multiplier));
  const beforeRounding = Decimal.max(calculated, new Decimal(rule.floorPriceCent));
  const rounded = beforeRounding.div(100).ceil().mul(100);
  const amountCent = rounded.toNumber();

  if (!Number.isSafeInteger(amountCent) || amountCent <= 0) {
    throw new Error('计算金额超出安全整数分范围');
  }
  if (amountCent > POSTGRES_INTEGER_MAX) {
    throw new Error('计算金额超出 PostgreSQL INTEGER 持久化范围');
  }

  return {
    weightGrams: weight.toString(),
    materialCostCent,
    amountBeforeRoundingCent: beforeRounding.toString(),
    amountCent,
    currency: 'CNY' as const,
    taxMode: 'tax_inclusive' as const,
    roundingMode: 'ceil_whole_yuan' as const,
  };
}
