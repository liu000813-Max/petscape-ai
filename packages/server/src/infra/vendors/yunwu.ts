// infra/vendors/yunwu.ts —— 云雾 API 图像 provider（WP-G3；ADR-0006 终审）。
// spec: docs/decisions/0006-3d-generation-pipeline.md；工程事实正本
//   docs/plans/reference-yunwu-api-research-2026-07-21.md。
//
// 收编自原型 web/app/lib/images/falClient.ts（fal 已废弃，账号锁定，用户拍板不解锁）。
// 关键差异（云雾工程事实，全部实测）：
//   - OpenAI 兼容中转，gemini 系图像模型走 /v1/chat/completions；产物内嵌于返回
//     content 的 markdown `![image](data:image/png;base64,...)`，需正则抽取解码。
//   - (key, model) 耦合：低倍率 key 绑 gemini-3.1-flash-image-preview。
//   - 连接层不稳且**断连仍扣费**——幂等重试是 ADR 级约束：内部重试只在网络层
//     （连接中断/5xx/超时）发生，且用同一 idempotencyKey（云雾 new-api 中转支持
//     请求头去重）；一旦拿到可解析的图片响应即返回，不重复触发计费调用。
//
// 配置经 infra/config（loadWorkerConfig），本文件不读 process.env（lint 边界）。
import type {
  VibeRenderProvider,
  VibeRenderProviderInput,
  VibeRenderProviderResult,
} from '../../application/vibe-render.ts';

export interface YunwuProviderOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  /** 网络层重试上限（断连/5xx/超时），默认 3。首次调用 + 最多 (n-1) 次重试。 */
  maxAttempts?: number;
  /** 单次请求超时（毫秒），默认 120s（i2i 实测最长 ~38s，留足余量）。 */
  timeoutMs?: number;
  /** 注入 fetch（测试用）；默认全局 fetch。 */
  fetchImpl?: typeof fetch;
}

/** 从 chat/completions 返回 content 里抽取首个 data-URI 图片，解码为 { bytes, mime }。 */
export function extractDataUriImage(content: string): { bytes: Buffer; mime: string } | null {
  // markdown 形态 ![alt](data:image/png;base64,....) 或裸 data-URI 兜底。
  const md = content.match(/!\[[^\]]*\]\((data:image\/([A-Za-z0-9.+-]+);base64,([A-Za-z0-9+/=]+))\)/);
  const bare = md ? null : content.match(/(data:image\/([A-Za-z0-9.+-]+);base64,([A-Za-z0-9+/=]+))/);
  const m = md ?? bare;
  if (!m) return null;
  const subtype = m[2];
  const base64 = m[3];
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.length === 0) return null;
  return { bytes, mime: `image/${subtype}` };
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

/** 网络层错误（可重试）：连接中断、5xx、超时。业务层错误（4xx/内容无图）不重试。 */
class YunwuRetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'YunwuRetryableError';
  }
}

/** 业务层永久错误（4xx、鉴权、返回无图）：重试无意义，直接上抛。 */
export class YunwuPermanentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'YunwuPermanentError';
  }
}

export function createYunwuVibeRenderProvider(options: YunwuProviderOptions): VibeRenderProvider {
  const {
    apiKey,
    baseUrl,
    model,
    maxAttempts = 3,
    timeoutMs = 120_000,
    fetchImpl = fetch,
  } = options;
  const url = `${baseUrl.replace(/\/$/, '')}/v1/chat/completions`;

  async function callOnce(
    input: VibeRenderProviderInput,
  ): Promise<VibeRenderProviderResult> {
    const content: Array<Record<string, unknown>> = [{ type: 'text', text: input.prompt }];
    for (const ref of input.references) {
      const dataUri = `data:${ref.mime};base64,${ref.bytes.toString('base64')}`;
      content.push({ type: 'image_url', image_url: { url: dataUri } });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    // 外部 signal 与内部超时任一触发即中止。
    const onAbort = () => controller.abort();
    input.signal?.addEventListener('abort', onAbort, { once: true });

    let res: Response;
    try {
      res = await fetchImpl(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          // 幂等键随请求头透传：云雾（new-api 系中转）对同 key 请求去重，
          // 断连后的重试不重复计费（ADR-0006 断连仍扣费的对策）。
          'Idempotency-Key': input.idempotencyKey,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content }],
        }),
        signal: controller.signal,
      });
    } catch (error) {
      // fetch 抛错 = 连接中断/超时/网络层失败 → 可重试。
      throw new YunwuRetryableError(
        `云雾请求网络层失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      clearTimeout(timeout);
      input.signal?.removeEventListener('abort', onAbort);
    }

    if (!res.ok) {
      const bodyText = await res.text().catch(() => '');
      // 5xx = 服务端瞬时故障，可重试；4xx（鉴权/请求非法）= 永久错误。
      if (res.status >= 500) {
        throw new YunwuRetryableError(`云雾 HTTP ${res.status}: ${bodyText.slice(0, 300)}`);
      }
      throw new YunwuPermanentError(`云雾 HTTP ${res.status}: ${bodyText.slice(0, 300)}`);
    }

    let data: ChatCompletionResponse;
    try {
      data = (await res.json()) as ChatCompletionResponse;
    } catch (error) {
      // 200 但响应体截断/非 JSON（连接层中途断连的典型表现）→ 可重试。
      throw new YunwuRetryableError(
        `云雾响应解析失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const responseContent = data.choices?.[0]?.message?.content ?? '';
    const image = extractDataUriImage(responseContent);
    if (!image) {
      // 返回了文本但无图片：模型未出图（内容策略/prompt 问题），重试大概率同样无图
      // → 永久错误，让 handler 归 permanent，不空转重试烧钱。
      throw new YunwuPermanentError(
        `云雾返回内容不含图片 data-URI（content 前缀: ${responseContent.slice(0, 120)}）`,
      );
    }

    return { imageBytes: image.bytes, mime: image.mime, engine: model };
  }

  return {
    async generate(input: VibeRenderProviderInput): Promise<VibeRenderProviderResult> {
      let lastError: unknown;
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
          return await callOnce(input);
        } catch (error) {
          lastError = error;
          if (error instanceof YunwuPermanentError) throw error; // 业务错误不重试。
          if (attempt < maxAttempts) {
            // 指数退避（1s、2s…），给连接层恢复窗口。
            await new Promise((r) => setTimeout(r, 1000 * attempt));
          }
        }
      }
      throw lastError instanceof Error
        ? lastError
        : new Error(`云雾生成失败: ${String(lastError)}`);
    },
  };
}
