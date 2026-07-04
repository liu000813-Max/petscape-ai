import { Codex } from '@openai/codex-sdk';
import type { PreviewAgentResult, Session } from '../../types/session';
import { previewInstruction, previewOutputSchema } from './instructions';
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

function validate(value: unknown): PreviewAgentResult {
  if (!value || typeof value !== 'object') throw new Error('Result is not object');
  const v = value as Record<string, unknown>;
  if (v.action !== 'confirm' && v.action !== 'retry3d' && v.action !== 'modifyAppearance' && v.action !== 'reselect') throw new Error('invalid action');
  if (typeof v.replyToUser !== 'string') throw new Error('replyToUser missing');
  return { action: v.action, replyToUser: v.replyToUser };
}

function buildPrompt(session: Session, userText: string) {
  return `${previewInstruction}\n\n[session 上下文]\nbrief: ${JSON.stringify(session.brief, null, 2)}\nselection: ${JSON.stringify(session.selection || null, null, 2)}\nconstraints: ${JSON.stringify(session.constraints, null, 2)}\nrenderRounds: ${session.renderRounds}/3\nmeshy: ${JSON.stringify(session.meshy || null, null, 2)}\n\n[用户消息]\n${userText}\n\n[输出要求]\n只输出符合 outputSchema 的 JSON 对象，不要 Markdown，不要额外解释。outputSchema=${JSON.stringify(previewOutputSchema)}\n`;
}

function heuristic(userText: string): PreviewAgentResult | undefined {
  if (/(重新|再).*(选|挑)|换成|食盆|水盆|另一个|不要这个/.test(userText)) return { action: 'reselect', replyToUser: '好的，我们回到选物步骤，请告诉我想改选图中的哪个物品。' };
  if (/(改|修改|调整|换色|颜色|屋顶|入口|风格|外观|绿色|蓝色|红色|形状|大一点|小一点)/.test(userText)) return { action: 'modifyAppearance', replyToUser: '好的，我们回到效果图修改阶段，根据你的意见重新调整外观。' };
  if (/(重新生成|重跑|再生成|再来|retry|坏|破|不好|失败|3d|三维|模型)/i.test(userText)) return { action: 'retry3d', replyToUser: '好的，我会用同一张白底物品图重新生成 3D。' };
  if (/(可以|确认|就这个|满意|下一步|继续|切片|打印|好)/.test(userText)) return { action: 'confirm', replyToUser: '好的，进入切片准备阶段。' };
  return undefined;
}

export async function runPreviewAgent(session: Session, userText: string): Promise<PreviewAgentResult> {
  const h = heuristic(userText);
  if (h) return h;
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const thread = new Codex().startThread({ workingDirectory, skipGitRepoCheck: true, sandboxMode: 'read-only' });
      const turn = await runCodexTurn('agentReply', JOB_TIMEOUT_MS.agentReply, (signal) => thread.run(buildPrompt(session, userText), { outputSchema: previewOutputSchema as never, signal }));
      const raw = typeof turn.finalResponse === 'string' ? turn.finalResponse : JSON.stringify(turn.finalResponse);
      return validate(extractJson(raw));
    } catch (error) {
      lastError = error;
      console.error(`[preview-agent] attempt ${attempt + 1} failed`, error);
    }
  }
  console.error('[preview-agent] schema fallback after retries', lastError);
  return { action: 'confirm', replyToUser: '如果当前 3D 模型可以，请回复“确认”；如果要重跑、修改外观或重新选物，请明确告诉我。', parseFailed: true };
}
