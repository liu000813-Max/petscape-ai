import { readFileSync } from 'node:fs';
import path from 'node:path';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const DEFAULT_MODEL = 'gpt-4o-mini';
const TIMEOUT_MS = 4500;
const MAX_PROMPT_CHARS = 200;

type RewriteBody = {
  text?: unknown;
  species?: unknown;
  hasEnvironmentImage?: unknown;
};

function readEnvValue(name: string) {
  if (process.env[name]) return process.env[name];

  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^${escaped}=(.+)$`, 'm');
  const candidates = [
    path.join(/*turbopackIgnore: true*/ process.cwd(), '.env.local'),
    path.join(/*turbopackIgnore: true*/ process.cwd(), '..', '.env'),
    path.join(/*turbopackIgnore: true*/ process.cwd(), 'web', '.env.local'),
    path.join(/*turbopackIgnore: true*/ process.cwd(), '.env'),
  ];

  for (const envPath of candidates) {
    try {
      const match = readFileSync(/*turbopackIgnore: true*/ envPath, 'utf8').match(pattern);
      if (match?.[1]) return match[1].trim().replace(/^['"]|['"]$/g, '');
    } catch {}
  }
  return '';
}

function sanitizePrompt(text: string) {
  const withoutFence = text.replace(/```[\s\S]*?```/g, '');
  const compact = withoutFence
    .replace(/\r?\n+/g, '')
    .replace(/\s+/g, '')
    .replace(/^[#*\-\s]*(?:VIBE|vibe|提示词|改写|输出|结果)[：:]/, '')
    .replace(/^["'“”‘’`]+|["'“”‘’`]+$/g, '')
    .trim();
  return Array.from(compact).slice(0, MAX_PROMPT_CHARS).join('');
}

function collectText(value: unknown, acc: string[]) {
  if (!value || typeof value !== 'object') return;
  const record = value as Record<string, unknown>;
  if (typeof record.text === 'string') acc.push(record.text);
  if (Array.isArray(record.content)) record.content.forEach((item) => collectText(item, acc));
  if (Array.isArray(record.output)) record.output.forEach((item) => collectText(item, acc));
}

function extractResponseText(data: unknown) {
  if (data && typeof data === 'object' && typeof (data as { output_text?: unknown }).output_text === 'string') {
    return (data as { output_text: string }).output_text;
  }

  const parts: string[] = [];
  if (data && typeof data === 'object' && Array.isArray((data as { output?: unknown }).output)) {
    (data as { output: unknown[] }).output.forEach((item) => collectText(item, parts));
  }
  return parts.join('');
}

function buildInput(text: string, species: string, hasEnvironmentImage: boolean) {
  const environmentRule = hasEnvironmentImage
    ? '用户已上传环境图；必须保留原始笼箱/环境结构、比例和动线，只微调装饰、材质与光影。'
    : '用户尚未上传环境图；描述可作为宠物空间设计方向，但不要假定具体照片结构。';

  return [
    {
      role: 'system',
      content:
        '你是宠物造景 VIBE 提示词改写器。只输出一句紧凑中文提示词，不要标签、解释、Markdown 或换行。目标 50-100 个汉字，硬上限 200 字。可以补充 1-2 个克制、合理的细节；若输入已经完整，不要继续扩写，只做压缩或微调。',
    },
    {
      role: 'user',
      content: `宠物类型：${species || '小宠'}。${environmentRule}原始描述：${text}`,
    },
  ];
}

function buildOpenAIRequestBody(model: string, text: string, species: string, hasEnvironmentImage: boolean) {
  const body: Record<string, unknown> = {
    model,
    input: buildInput(sanitizePrompt(text), species, hasEnvironmentImage),
    max_output_tokens: 160,
  };

  if (!model.startsWith('gpt-5')) {
    body.temperature = 0.35;
  }

  return body;
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as RewriteBody;
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  const species = typeof body.species === 'string' ? body.species.trim() : '';
  const hasEnvironmentImage = body.hasEnvironmentImage === true;

  if (!text) return NextResponse.json({ error: 'Missing text' }, { status: 400 });

  const apiKey = readEnvValue('OPENAI_API_KEY') || readEnvValue('OPENAI_KEY');
  if (!apiKey) return NextResponse.json({ error: 'LLM rewrite unavailable' }, { status: 503 });

  const model = readEnvValue('OPENAI_REWRITE_MODEL') || DEFAULT_MODEL;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(OPENAI_RESPONSES_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(buildOpenAIRequestBody(model, text, species, hasEnvironmentImage)),
      signal: controller.signal,
    });

    if (!res.ok) {
      return NextResponse.json({ error: 'LLM rewrite unavailable' }, { status: 503 });
    }

    const data = await res.json();
    const prompt = sanitizePrompt(extractResponseText(data));
    if (!prompt) return NextResponse.json({ error: 'LLM rewrite returned empty output' }, { status: 500 });

    return NextResponse.json({ prompt, source: 'llm' });
  } catch (error) {
    const isAbort = error instanceof Error && error.name === 'AbortError';
    return NextResponse.json(
      { error: isAbort ? 'LLM rewrite timed out' : 'LLM rewrite failed' },
      { status: isAbort ? 504 : 500 },
    );
  } finally {
    clearTimeout(timeout);
  }
}
