import path from 'path';
import { Codex } from '@openai/codex-sdk';
import type { SelectingAgentResult, Session } from '../../types/session';
import { selectingInstruction, selectingOutputSchema } from './instructions';
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

function validate(value: unknown): SelectingAgentResult {
  if (!value || typeof value !== 'object') throw new Error('Result is not object');
  const v = value as Record<string, unknown>;
  if (typeof v.selectedItem !== 'string') throw new Error('selectedItem missing');
  if (typeof v.itemDescription !== 'string') throw new Error('itemDescription missing');
  if (typeof v.replyToUser !== 'string') throw new Error('replyToUser missing');
  return {
    selectedItem: v.selectedItem.trim(),
    itemDescription: v.itemDescription.trim(),
    replyToUser: v.replyToUser.trim(),
    parseFailed: false,
  };
}

function publicImageToAbs(imagePath: string) {
  return path.join(workingDirectory, 'public', imagePath.replace(/^\//, ''));
}

function buildPrompt(session: Session, userText: string, sceneImagePath: string) {
  return `${selectingInstruction}\n\n[session 上下文]\nbrief: ${JSON.stringify(session.brief, null, 2)}\n累积 constraints: ${JSON.stringify(session.constraints, null, 2)}\n最新场景图 public path: ${sceneImagePath}\n已有场景图: ${JSON.stringify(session.sceneImages)}\n当前阶段: ${session.stage}\n\n[用户选物指令]\n${userText}\n\n[输出要求]\n只输出符合 outputSchema 的 JSON 对象，不要 Markdown，不要额外解释。outputSchema=${JSON.stringify(selectingOutputSchema)}\n`;
}

function heuristicSelection(session: Session, userText: string): SelectingAgentResult | undefined {
  const item = /(蓝色[^，。,.]*?(?:躲避屋|小屋|屋))/.exec(userText)?.[1]
    || /(蘑菇屋|躲避屋|小屋|食盆|水盆|隧道|平台|树桩)/.exec(userText)?.[1];
  if (!item) return undefined;
  const color = /(蓝色|绿色|红色|黄色|木色|棕色|白色)/.exec(userText)?.[1]
    || session.constraints.find((c) => /蓝色|绿色|红色|黄色|木色|棕色|白色/.test(c));
  const selectedItem = color && !item.includes(color) ? `${color}${item}` : item;
  return {
    selectedItem,
    itemDescription: `用户明确选择“${selectedItem}”。请以最新场景图中符合该名称/颜色/形状的主体物品为准；累积约束：${session.constraints.join('；') || '无'}。`,
    replyToUser: `好的，我选中「${selectedItem}」。`,
    parseFailed: false,
  };
}

export async function runSelectingAgent(session: Session, userText: string): Promise<SelectingAgentResult> {
  const latestScene = session.sceneImages.at(-1);
  if (!latestScene) {
    return {
      selectedItem: '',
      itemDescription: '',
      replyToUser: '我还没有可供选择的效果图。请先完成场景图生成。',
      parseFailed: true,
    };
  }

  const heuristic = heuristicSelection(session, userText);
  if (heuristic) return heuristic;

  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const thread = new Codex().startThread({ workingDirectory, skipGitRepoCheck: true, sandboxMode: 'read-only' });
      const prompt = buildPrompt(session, userText, latestScene);
      const turn = await runCodexTurn('agentReply', JOB_TIMEOUT_MS.agentReply, (signal) => thread.run([
        { type: 'text', text: prompt },
        { type: 'local_image', path: publicImageToAbs(latestScene) },
      ] as never, { outputSchema: selectingOutputSchema as never, signal }));
      const raw = typeof turn.finalResponse === 'string' ? turn.finalResponse : JSON.stringify(turn.finalResponse);
      return validate(extractJson(raw));
    } catch (error) {
      lastError = error;
      console.error(`[selecting-agent] attempt ${attempt + 1} failed`, error);
    }
  }
  console.error('[selecting-agent] schema fallback after retries', lastError);
  return {
    selectedItem: '',
    itemDescription: '',
    replyToUser: '我刚才没有可靠识别出你想选的物品。请用位置、颜色和形状再描述一下，例如“左下角蓝色屋顶的躲避屋”。',
    parseFailed: true,
  };
}
