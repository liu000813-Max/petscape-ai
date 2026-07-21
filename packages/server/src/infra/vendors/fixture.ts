// infra/vendors/fixture.ts —— vibe_render provider 的 fixture 实现（WP-G3）。
// spec: docs/plans/g-line-execution-plan.md §一.5（?mock 语义升级为 provider 端口的
//   fixture 实现，server 侧注入）+ WP-G3 TDD（fixture provider 跑通 3a 链）。
//
// CI 与日常回归零外部调用：本 provider 不发任何网络请求，返回一张确定性 PNG。
// 幂等契约天然满足（无外部计费，同 idempotencyKey 多次调用等价）。
import type {
  VibeRenderProvider,
  VibeRenderProviderInput,
  VibeRenderProviderResult,
} from '../../application/vibe-render.ts';

// 最小合法 1×1 PNG（透明像素），base64 常量。够验证「产物字节非空、经 OSS 落地、
// Asset 登记、签名 URL 可下载」整条链路，不引入图片编码依赖。
const FIXTURE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

export interface FixtureProviderOptions {
  /** 模拟耗时（毫秒），默认 0；用于覆盖 worker 心跳周期的测试。 */
  delayMs?: number;
  /** 覆盖返回字节（测试用）；默认返回 1×1 PNG。 */
  imageBytes?: Buffer;
}

/**
 * fixture vibe_render provider：确定性返回一张 PNG，engine 标记为 'fixture'。
 * 记录最近一次调用的 input，供测试断言 prompt/参考图数量/幂等键透传是否正确。
 */
export function createFixtureVibeRenderProvider(
  options: FixtureProviderOptions = {},
): VibeRenderProvider & { lastInput?: VibeRenderProviderInput; callCount: number } {
  const { delayMs = 0, imageBytes } = options;
  const bytes = imageBytes ?? Buffer.from(FIXTURE_PNG_BASE64, 'base64');

  const provider = {
    callCount: 0,
    lastInput: undefined as VibeRenderProviderInput | undefined,
    async generate(input: VibeRenderProviderInput): Promise<VibeRenderProviderResult> {
      provider.callCount += 1;
      provider.lastInput = input;
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
      return { imageBytes: bytes, mime: 'image/png', engine: 'fixture' };
    },
  };
  return provider;
}
