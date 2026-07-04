import { Codex } from '@openai/codex-sdk';
import type { RenderingAgentResult, Session } from '../../types/session';
import { renderingInstruction, renderingOutputSchema } from './instructions';
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

function validate(value: unknown): RenderingAgentResult {
  if (!value || typeof value !== 'object') throw new Error('Result is not object');
  const v = value as Record<string, unknown>;
  if (v.action !== 'regenerate' && v.action !== 'proceed') throw new Error('invalid action');
  if (!Array.isArray(v.newConstraints)) throw new Error('newConstraints missing');
  if (typeof v.replyToUser !== 'string') throw new Error('replyToUser missing');
  const revisedPrompt = typeof v.revisedPrompt === 'string' && v.revisedPrompt.trim() ? v.revisedPrompt.trim() : undefined;
  if (v.action === 'regenerate' && !revisedPrompt) throw new Error('revisedPrompt required for regenerate');
  return {
    action: v.action,
    revisedPrompt,
    newConstraints: v.newConstraints.filter((x): x is string => typeof x === 'string' && x.trim().length > 0),
    replyToUser: v.replyToUser,
  };
}

function buildPrompt(session: Session, userText: string) {
  return `${renderingInstruction}\n\n[session 上下文]\nbrief: ${JSON.stringify(session.brief, null, 2)}\n累积 constraints: ${JSON.stringify(session.constraints, null, 2)}\n当前生图 prompt: ${session.currentImagePrompt || '(尚无)'}\n已有场景图: ${JSON.stringify(session.sceneImages)}\n已用修改轮次: ${session.renderRounds}/3\n\n[用户消息]\n${userText}\n\n[输出要求]\n只输出符合 outputSchema 的 JSON 对象，不要 Markdown，不要额外解释。outputSchema=${JSON.stringify(renderingOutputSchema)}\n`;
}

export async function runRenderingAgent(session: Session, userText: string): Promise<RenderingAgentResult> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const thread = new Codex().startThread({ workingDirectory, skipGitRepoCheck: true, sandboxMode: 'read-only' });
      const turn = await runCodexTurn('agentReply', JOB_TIMEOUT_MS.agentReply, (signal) => thread.run(buildPrompt(session, userText), { outputSchema: renderingOutputSchema as never, signal }));
      const raw = typeof turn.finalResponse === 'string' ? turn.finalResponse : JSON.stringify(turn.finalResponse);
      return validate(extractJson(raw));
    } catch (error) {
      lastError = error;
      console.error(`[rendering-agent] attempt ${attempt + 1} failed`, error);
    }
  }
  console.error('[rendering-agent] schema fallback after retries', lastError);
  return { action: 'proceed', newConstraints: [], replyToUser: '我没完全理解修改点。若当前效果图可以，请直接告诉我想选哪个物品；如果要改图，请更具体描述要调整的颜色、形状或风格。', parseFailed: true };
}
