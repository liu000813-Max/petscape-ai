// infra/vendors/ —— 外部供应商适配层（ADR-0006：客户端实现收编于此，
// 密钥经 infra/config 读取，对 application 暴露 provider 端口）。
//
// WP-G3：云雾图像 provider（vibe 效果图生成）收编落地。fal 已废弃（账号锁定，
// 用户拍板不解锁）。Tripo/Meshy 3D 级联留给 WP-G5。
import type { VibeRenderProvider } from '../../application/vibe-render.ts';
import { createYunwuVibeRenderProvider } from './yunwu.ts';

export {
  createYunwuVibeRenderProvider,
  extractDataUriImage,
  YunwuPermanentError,
} from './yunwu.ts';
export type { YunwuProviderOptions } from './yunwu.ts';

export { createFixtureVibeRenderProvider } from './fixture.ts';
export type { FixtureProviderOptions } from './fixture.ts';

/** 装配 vibe_render provider 所需的最小配置切片（来自 loadWorkerConfig）。 */
export interface VibeRenderProviderConfig {
  YUNWU_API_KEY?: string;
  YUNWU_API_KEY_LOWRATE?: string;
  YUNWU_BASE_URL: string;
  YUNWU_IMAGE_MODEL: string;
}

/**
 * 按配置装配真实 vibe_render provider（云雾）。
 * key 选择（ADR-0006 (key,model) 耦合）：优先低倍率 key（YUNWU_API_KEY_LOWRATE，
 * 配默认模型 gemini-3.1-flash-image-preview，$0.1655/图）；缺省回落标准 key。
 * 两个 key 都缺失 → 抛错（worker 装配阶段 fail-fast，不静默用坏配置）。
 */
export function createVibeRenderProviderFromConfig(
  config: VibeRenderProviderConfig,
  overrides?: { fetchImpl?: typeof fetch },
): VibeRenderProvider {
  const apiKey = config.YUNWU_API_KEY_LOWRATE ?? config.YUNWU_API_KEY;
  if (!apiKey) {
    throw new Error(
      '[vendors] 云雾 vibe_render provider 需要 YUNWU_API_KEY_LOWRATE 或 YUNWU_API_KEY，两者均未配置。',
    );
  }
  return createYunwuVibeRenderProvider({
    apiKey,
    baseUrl: config.YUNWU_BASE_URL,
    model: config.YUNWU_IMAGE_MODEL,
    fetchImpl: overrides?.fetchImpl,
  });
}

export type { VibeRenderProvider };
