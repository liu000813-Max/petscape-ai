// WP-G3：vibe 效果图 renders 契约测试。
// spec: docs/plans/g-line-execution-plan.md WP-G3（contract 禁止客户端注入产物字段）
//   + docs/decisions/0006-3d-generation-pipeline.md。
//
// 覆盖：
//   1. 客户端不得注入产物字段——strictObject 拒绝 assetId 产物/ossKey/kind/金额。
//   2. 合法请求（vibe + 可选 assetId 引用 + 幂等键）通过。
//   3. 缺 vibeText / 缺 idempotencyKey / 超长 vibeText 被拒。
//   4. prompt 组装：有/无环境照、有/无宠物照四分支语义正确。
//   5. yunwu data-URI 抽取：markdown 图片形态与无图形态。
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CreateRenderRequestSchema,
  VIBE_RENDER_JOB_TYPE,
  GENERATED_RENDER_KIND,
} from '../src/contracts/renders.ts';
import { buildVibeRenderPrompt } from '../src/application/vibe-render.ts';
import { extractDataUriImage } from '../src/infra/vendors/yunwu.ts';

test('renders 契约常量与 §一 G0a 一致', () => {
  assert.equal(VIBE_RENDER_JOB_TYPE, 'vibe_render');
  assert.equal(GENERATED_RENDER_KIND, 'generated_render');
});

test('合法请求：vibe + 幂等键（无照片）通过', () => {
  const parsed = CreateRenderRequestSchema.safeParse({
    vibeText: '森林奶酪屋，童话厨房氛围',
    idempotencyKey: 'render-abc-1',
  });
  assert.equal(parsed.success, true);
});

test('合法请求：vibe + 环境照/宠物照 assetId + 幂等键通过', () => {
  const parsed = CreateRenderRequestSchema.safeParse({
    vibeText: '森林奶酪屋',
    environmentAssetId: 'asset_env_1',
    petAssetId: 'asset_pet_1',
    idempotencyKey: 'render-abc-2',
  });
  assert.equal(parsed.success, true);
});

test('客户端注入产物字段被 strict 拒绝（assetId 产物 / ossKey / kind / 金额）', () => {
  for (const injected of [
    { assetId: 'attacker_owned' },
    { ossKey: 'uploads/generated/x/y.png' },
    { kind: 'generated_render' },
    { priceCents: 0 },
    { sandboxOnly: false },
    { status: 'succeeded' },
  ]) {
    const parsed = CreateRenderRequestSchema.safeParse({
      vibeText: '森林奶酪屋',
      idempotencyKey: 'render-inject',
      ...injected,
    });
    assert.equal(
      parsed.success,
      false,
      `注入字段 ${JSON.stringify(injected)} 本应被 strictObject 拒绝`,
    );
  }
});

test('缺 vibeText / 缺 idempotencyKey / 空 vibeText / 超长 vibeText 被拒', () => {
  assert.equal(CreateRenderRequestSchema.safeParse({ idempotencyKey: 'k' }).success, false);
  assert.equal(CreateRenderRequestSchema.safeParse({ vibeText: '森林' }).success, false);
  assert.equal(
    CreateRenderRequestSchema.safeParse({ vibeText: '   ', idempotencyKey: 'k' }).success,
    false,
  );
  assert.equal(
    CreateRenderRequestSchema.safeParse({ vibeText: '氛'.repeat(401), idempotencyKey: 'k' }).success,
    false,
  );
});

test('prompt 组装：无环境照走 t2i 从零生成分支', () => {
  const prompt = buildVibeRenderPrompt({
    vibeText: '森林奶酪屋',
    hasPetPhoto: false,
    hasEnvironmentImage: false,
  });
  assert.match(prompt, /从零设计|完整的小家造景/);
  assert.match(prompt, /一只真实的/); // 无宠物照 → 按物种生成
  assert.match(prompt, /不要出现文字、水印、字母/); // ADR-0006 无文字硬约束
});

test('prompt 组装：有环境照走 i2i 保结构改造分支', () => {
  const prompt = buildVibeRenderPrompt({
    vibeText: '森林奶酪屋',
    hasPetPhoto: true,
    hasEnvironmentImage: true,
  });
  assert.match(prompt, /不改变原笼箱结构/);
  assert.match(prompt, /与提供的宠物参考照保持一致/); // 有宠物照 → 外观一致约束
});

test('yunwu data-URI 抽取：markdown 图片形态解码非空字节', () => {
  const png1x1 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const content = `这是效果图：\n\n![image](data:image/png;base64,${png1x1})`;
  const out = extractDataUriImage(content);
  assert.ok(out, '应抽取到图片');
  assert.equal(out.mime, 'image/png');
  assert.ok(out.bytes.length > 0);
});

test('yunwu data-URI 抽取：纯文本无图返回 null', () => {
  assert.equal(extractDataUriImage('抱歉，我无法生成该图片。'), null);
});
