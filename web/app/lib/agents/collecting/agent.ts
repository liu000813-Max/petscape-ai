import path from 'path';
import { Codex } from '@openai/codex-sdk';
import type { CollectingAgentResult, Session } from '../../types/session';
import { collectingInstruction, collectingOutputSchema } from './instructions';
import { JOB_TIMEOUT_MS, runCodexTurn } from '../../jobs/timeouts';

const workingDirectory = process.cwd();

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  try { return JSON.parse(trimmed); } catch {}
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced) return JSON.parse(fenced[1]);
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
  throw new Error('No JSON object found');
}

function validate(value: unknown): CollectingAgentResult {
  if (!value || typeof value !== 'object') throw new Error('Result is not object');
  const v = value as Record<string, unknown>;
  if (!v.brief || typeof v.brief !== 'object') throw new Error('brief missing');
  if (typeof v.readyToRender !== 'boolean') throw new Error('readyToRender missing');
  if (!Array.isArray(v.newConstraints)) throw new Error('newConstraints missing');
  if (typeof v.replyToUser !== 'string') throw new Error('replyToUser missing');
  const b = v.brief as Record<string, unknown>;
  return {
    brief: {
      species: typeof b.species === 'string' ? b.species : '',
      petSize: typeof b.petSize === 'string' && b.petSize.trim() ? b.petSize : undefined,
      style: typeof b.style === 'string' && b.style.trim() ? b.style : undefined,
      item: typeof b.item === 'string' && b.item.trim() ? b.item : undefined,
      photoPath: typeof b.photoPath === 'string' && b.photoPath.trim() ? b.photoPath : undefined,
    },
    readyToRender: v.readyToRender,
    newConstraints: v.newConstraints.filter((x): x is string => typeof x === 'string' && x.trim().length > 0),
    replyToUser: v.replyToUser,
  };
}

function buildPrompt(session: Session, userText: string, hasPhoto: boolean) {
  return `${collectingInstruction}\n\n[session 上下文]\n当前 brief: ${JSON.stringify(session.brief, null, 2)}\n累积 constraints: ${JSON.stringify(session.constraints, null, 2)}\n当前阶段: ${session.stage}\n渲染轮次: ${session.renderRounds}\n照片状态: ${hasPhoto ? `本轮附带照片，photoPath=${session.brief.photoPath}` : '本轮无照片'}\n\n[用户消息]\n${userText || '(用户只上传了图片，没有文字)'}\n\n[输出要求]\n只输出符合 outputSchema 的 JSON 对象，不要 Markdown，不要额外解释。outputSchema=${JSON.stringify(collectingOutputSchema)}\n`;
}

export async function runCollectingAgent(session: Session, userText: string, photoAbsPath?: string): Promise<CollectingAgentResult> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const thread = new Codex().startThread({
        workingDirectory,
        skipGitRepoCheck: true,
        sandboxMode: 'read-only',
      });
      const prompt = buildPrompt(session, userText, Boolean(photoAbsPath));
      const input = photoAbsPath
        ? [{ type: 'text', text: prompt }, { type: 'local_image', path: path.resolve(photoAbsPath) }]
        : prompt;
      const turn = await runCodexTurn('agentReply', JOB_TIMEOUT_MS.agentReply, (signal) => thread.run(input as never, { outputSchema: collectingOutputSchema as never, signal }));
      const raw = typeof turn.finalResponse === 'string' ? turn.finalResponse : JSON.stringify(turn.finalResponse);
      return validate(extractJson(raw));
    } catch (error) {
      lastError = error;
      console.error(`[collecting-agent] attempt ${attempt + 1} failed`, error);
    }
  }
  console.error('[collecting-agent] schema fallback after retries', lastError);
  return {
    brief: session.brief,
    readyToRender: false,
    newConstraints: [],
    replyToUser: '我刚才没有整理清楚信息。请再告诉我：宠物品种、实际尺寸/体长、想做的物品和喜欢的风格；如果有照片也可以继续上传。',
  };
}
