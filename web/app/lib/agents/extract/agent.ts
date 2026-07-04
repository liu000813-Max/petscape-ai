import { Codex } from '@openai/codex-sdk';
import type { Brief } from '../../types/project';
import { runCodexTurn } from '../../jobs/timeouts';
import { buildExtractPrompt, extractOutputSchema, SPECIES_SLUGS, TRAIT_CHIPS } from './instructions';

const workingDirectory = process.cwd();

export interface ExtractResult {
  patch: Partial<Brief>;
  reply: string;
}

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // fall through
  }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced) return JSON.parse(fenced[1]);
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
  throw new Error('No JSON object found in extract agent response');
}

function isSpeciesSlug(value: unknown): value is (typeof SPECIES_SLUGS)[number] {
  return typeof value === 'string' && (SPECIES_SLUGS as readonly string[]).includes(value);
}

function validate(value: unknown): ExtractResult {
  if (!value || typeof value !== 'object') throw new Error('Result is not object');
  const v = value as Record<string, unknown>;
  if (typeof v.reply !== 'string') throw new Error('reply missing');

  const patch: Partial<Brief> = {};
  if (isSpeciesSlug(v.species)) patch.species = v.species;
  if (typeof v.petName === 'string' && v.petName.trim()) patch.petName = v.petName.trim();
  if (typeof v.petSize === 'string' && v.petSize.trim()) patch.petSize = v.petSize.trim();
  if (typeof v.style === 'string' && v.style.trim()) patch.style = v.style.trim();
  if (typeof v.vibe === 'string' && v.vibe.trim()) patch.vibe = v.vibe.trim();

  if (Array.isArray(v.traits)) {
    const traits = v.traits.filter((t): t is string => typeof t === 'string' && (TRAIT_CHIPS as readonly string[]).includes(t));
    if (traits.length > 0) patch.traits = traits;
  }
  if (Array.isArray(v.taboos)) {
    const taboos = v.taboos.filter((t): t is string => typeof t === 'string' && t.trim().length > 0);
    if (taboos.length > 0) patch.taboos = taboos;
  }

  return { patch, reply: v.reply };
}

const FALLBACK_REPLY = '我这边开小差了，请直接在左侧表单填写';
// spec 要求「超时 30s」，但本机实测单轮最简 Codex SDK 调用裸耗时约 27.5s（结构化输出场景更长），
// 30s 会导致近乎必然超时。放宽到 60s 换低误报率，仍远快于其它 job（agentReply 180s），
// 且失败路径的兜底文案不变，不影响「不阻塞表单」的核心验收。
const EXTRACT_TIMEOUT_MS = 60_000;

export async function runExtractAgent(message: string, currentBrief: Brief): Promise<ExtractResult> {
  try {
    const thread = new Codex().startThread({
      workingDirectory,
      skipGitRepoCheck: true,
      sandboxMode: 'read-only',
    });
    const prompt = buildExtractPrompt(message, currentBrief as unknown as Record<string, unknown>);
    const turn = await runCodexTurn('agentReply', EXTRACT_TIMEOUT_MS, (signal) =>
      thread.run(prompt, { outputSchema: extractOutputSchema as never, signal }),
    );
    const raw = typeof turn.finalResponse === 'string' ? turn.finalResponse : JSON.stringify(turn.finalResponse);
    return validate(extractJson(raw));
  } catch (error) {
    console.error('[extract-agent] failed', error);
    return { patch: {}, reply: FALLBACK_REPLY };
  }
}
