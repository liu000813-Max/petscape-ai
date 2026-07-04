import { codexQueue } from './codexQueue';
import { getSession, makeMessage } from '../store/sessions';
import type { Session, Stage } from '../types/session';
import { runCollectingAgent } from '../agents/collecting/agent';
import { runRenderingAgent } from '../agents/rendering/agent';
import { runSelectingAgent } from '../agents/selecting/agent';
import { runPreviewAgent } from '../agents/preview/agent';
import { buildInitialScenePrompt, generateSceneImage } from '../images/renderScene';
import { generateCleanItemImage } from '../images/cleanItem';
import { startMeshyJob } from './meshyJob';
import { startSliceJob } from './sliceJob';
import { JobTimeoutError, userTimeoutMessage } from './timeouts';

function mergeConstraints(session: Session, constraints: string[]) {
  for (const c of constraints) {
    const trimmed = c.trim();
    if (trimmed && !session.constraints.includes(trimmed)) session.constraints.push(trimmed);
  }
}

async function renderImageForSession(session: Session, prompt: string, userFacingIntro?: string) {
  session.currentImagePrompt = prompt;
  if (userFacingIntro) session.messages.push(makeMessage('assistant', userFacingIntro));
  session.pendingJob = { type: 'renderImage', status: 'running' };
  // 已有场景图时走 fal edit 通道：以最新一张为底做指令式修改，前后场景保持一致。
  const imagePath = await generateSceneImage(session.id, prompt, session.sceneImages.length + 1, session.sceneImages.at(-1));
  session.sceneImages.push(imagePath);
  session.messages.push(makeMessage('assistant', `效果图已生成（修改轮次 ${session.renderRounds}/3）。你可以继续提出修改，或告诉我想打印图中的哪个物品。`, imagePath));
}

async function handleCollecting(session: Session, userText: string, photoAbsPath?: string) {
  const result = await runCollectingAgent(session, userText, photoAbsPath);
  session.brief = {
    ...session.brief,
    ...Object.fromEntries(Object.entries(result.brief).filter(([, v]) => v !== undefined && v !== '')),
    photoPath: session.brief.photoPath || result.brief.photoPath,
  };
  mergeConstraints(session, result.newConstraints);
  session.messages.push(makeMessage('assistant', result.replyToUser));
  if (result.readyToRender && session.brief.species && session.brief.petSize && session.brief.style && session.brief.item) {
    session.stage = 'rendering';
    const prompt = buildInitialScenePrompt(session);
    await renderImageForSession(session, prompt, '信息已齐，我开始生成第一张场景效果图。');
  }
}

function looksLikeProceed(text: string) {
  return /(就(这个|它)|可以|满意|不用改|下一步|继续|打印|选(这个|它)|确认)/.test(text);
}

async function handleRendering(session: Session, userText: string) {
  // 意图判断交给 rendering Agent（spec §3.1）：不要用关键词正则抢跑，
  // 否则「屋顶换成蓝色」会因命中「屋」被误判为选物而跳过重新生图。
  if (session.renderRounds >= 3 && !looksLikeProceed(userText)) {
    session.messages.push(makeMessage('assistant', '已经达到 3/3 次效果图修改上限，不能再重新生图了。请从现有效果图中选择要打印的物品，或接受当前版本继续下一步。'));
    return;
  }

  const result = await runRenderingAgent(session, userText);
  mergeConstraints(session, result.newConstraints);

  if (result.action === 'proceed') {
    session.messages.push(makeMessage('assistant', result.replyToUser || '好的，请告诉我你想打印图中的哪个物品。'));
    // schema 兜底的澄清回复不推进阶段；正常 proceed 才进入 selecting。
    if (!result.parseFailed) {
      session.stage = 'selecting';
      // 用户在看完效果图后常会直接说“就打印图里那个躲避屋”。
      // 这类消息同时也是选物指令，直接复用本轮输入进入 selecting，避免要求用户重复一遍。
      if (looksLikeSelectionIntent(userText)) await handleSelecting(session, userText);
    }
    return;
  }

  if (session.renderRounds >= 3) {
    session.messages.push(makeMessage('assistant', '已经达到 3/3 次效果图修改上限，不能再重新生图了。请从现有效果图中选择要打印的物品，或接受当前版本继续下一步。'));
    return;
  }

  session.renderRounds += 1;
  await renderImageForSession(session, result.revisedPrompt!, result.replyToUser || '收到，我按你的反馈重新生成效果图。');
}

function looksLikeSelectionIntent(text: string) {
  return /(打印|选|就要|就这个|那个|这(个|件)|躲避屋|食盆|水盆|洞|屋|桥|玩具|平台|隧道|小屋|树桩)/i.test(text);
}

async function handleSelecting(session: Session, userText: string) {
  const result = await runSelectingAgent(session, userText);
  session.messages.push(makeMessage('assistant', result.replyToUser));

  if (result.parseFailed || !result.selectedItem || !result.itemDescription) return;

  const sameSelection = session.selection?.selectedItem.trim().toLowerCase() === result.selectedItem.trim().toLowerCase();
  session.brief.item = result.selectedItem;
  session.selection = { selectedItem: result.selectedItem, itemDescription: result.itemDescription };

  if (sameSelection && session.cleanItemImage) {
    session.stage = 'cleaningItem';
    session.messages.push(makeMessage('assistant', `仍然选择「${result.selectedItem}」。已复用上一张白底单物品图，不再重复抠图；如果没问题请回复“确认”进入 3D 生成。`, session.cleanItemImage));
    return;
  }

  session.stage = 'cleaningItem';
  session.pendingJob = { type: 'cleanItem', status: 'running' };
  session.messages.push(makeMessage('assistant', `已选中「${result.selectedItem}」。我现在开始提取这个物品，生成白底单物品图，大约十几秒。`));

  const latestScene = session.sceneImages.at(-1);
  if (!latestScene) throw new Error('没有可用于抠图的场景图');
  const cleanPath = await generateCleanItemImage(session.id, latestScene, `${result.selectedItem}：${result.itemDescription}`);
  session.cleanItemImage = cleanPath;
  session.messages.push(makeMessage('assistant', '物品已提取为白底单物品图。现在自动进入 3D 生成。', cleanPath));
  startMeshyJob(session.id);
}

function looksLikeConfirm3d(text: string) {
  return /(确认|可以|开始|继续|没问题|就这个|生成\s*3d|生成三维|下一步)/i.test(text);
}

async function handleCleaningItem(session: Session, userText: string) {
  if (!session.cleanItemImage) {
    session.messages.push(makeMessage('assistant', '白底单物品图还没有生成成功。请重新描述你想选的物品，我会再试一次。'));
    session.stage = 'selecting';
    return;
  }
  if (!looksLikeConfirm3d(userText)) {
    session.messages.push(makeMessage('assistant', '如果这张白底物品图没问题，请回复“确认”，我就进入 3D 生成。若不对，请说明要重新选择哪个物品。'));
    return;
  }
  startMeshyJob(session.id);
}

async function handleGenerating3d(session: Session, userText: string) {
  if (!session.cleanItemImage) {
    session.messages.push(makeMessage('assistant', '缺少白底单物品图，无法重试 3D。请重新选择物品。'));
    session.stage = 'selecting';
    return;
  }
  if (/(重试|重新|再来|retry|继续|开始|生成)/i.test(userText)) {
    startMeshyJob(session.id);
    return;
  }
  session.messages.push(makeMessage('assistant', '上一轮 3D 生成未完成或失败。请回复“重试”，我会从当前白底物品图重新生成 3D。'));
}

async function handlePreview(session: Session, userText: string) {
  const result = await runPreviewAgent(session, userText);
  session.messages.push(makeMessage('assistant', result.replyToUser));
  if (result.parseFailed) return;

  if (result.action === 'confirm') {
    startSliceJob(session.id);
    return;
  }
  if (result.action === 'retry3d') {
    startMeshyJob(session.id);
    return;
  }
  if (result.action === 'modifyAppearance') {
    session.stage = 'rendering';
    // 本轮预览反馈本身就是修改意见，直接复用既有 rendering 流程；renderRounds 上限仍由 handleRendering 强制执行。
    await handleRendering(session, userText);
    return;
  }
  if (result.action === 'reselect') {
    session.stage = 'selecting';
    session.messages.push(makeMessage('assistant', '请告诉我你想从当前效果图中改选哪个物品。'));
  }
}

type StageHandler = (session: Session, userText: string, photoAbsPath?: string) => Promise<void>;

async function handleSlicing(session: Session, userText: string) {
  if (/(重试|retry|继续|切片)/i.test(userText)) {
    startSliceJob(session.id);
    return;
  }
  session.messages.push(makeMessage('assistant', '切片正在进行或刚刚失败。如需重试，请回复“重试切片”。'));
}

async function handleDone(session: Session) {
  session.messages.push(makeMessage('assistant', '当前会话已经完成切片。请下载 G-code/STL；如果想做新模型，请刷新页面或新建会话重新开始。'));
}

const stageHandlers: Partial<Record<Stage, StageHandler>> = {
  collecting: handleCollecting,
  rendering: handleRendering,
  selecting: handleSelecting,
  cleaningItem: handleCleaningItem,
  generating3d: handleGenerating3d,
  preview: handlePreview,
  slicing: handleSlicing,
  done: handleDone,
};

export function enqueueStageJob(sessionId: string, userText: string, photoAbsPath?: string) {
  const session = getSession(sessionId);
  if (!session) return;
  if (!session.pendingJob) session.pendingJob = { type: 'agentReply', status: 'queued' };

  const queuedAt = Date.now();
  console.log(`[job ${sessionId}] queued type=${session.pendingJob.type} stage=${session.stage}`);
  void codexQueue.enqueue(sessionId, async () => {
    const current = getSession(sessionId);
    if (!current) return;
    current.pendingJob = { type: 'agentReply', status: 'running' };
    const started = Date.now();
    console.log(`[job ${sessionId}] start type=agentReply stage=${current.stage} queueWaitMs=${started - queuedAt}`);
    const handler = stageHandlers[current.stage];
    if (!handler) {
      current.messages.push(makeMessage('assistant', `当前阶段 ${current.stage} 的消息处理将在后续里程碑实现。`));
      return;
    }
    await handler(current, userText, photoAbsPath);
    const finishedType = current.pendingJob?.type || 'agentReply';
    console.log(`[job ${sessionId}] success type=${finishedType} stage=${current.stage} elapsedMs=${Date.now() - started}`);
    // Meshy / Slice 管线脱离 Codex 队列后台运行；不要在这里清除它们的 pending 锁。
    if (current.pendingJob?.type !== 'meshy' && current.pendingJob?.type !== 'slice') delete current.pendingJob;
  }).catch((error) => {
    const current = getSession(sessionId);
    if (!current) return;
    const type = current.pendingJob?.type || 'agentReply';
    const timeout = error instanceof JobTimeoutError;
    const message = timeout ? userTimeoutMessage(type) : error instanceof Error ? error.message : String(error);
    console.error(`[job ${sessionId}] ${timeout ? 'timeout' : 'fail'} type=${type} stage=${current.stage} elapsedMs=${Date.now() - queuedAt}`, error);
    current.pendingJob = { type, status: 'failed', error: message };
    current.messages.push(makeMessage('assistant', `${message}。你可以直接再发一条消息重试；我会从当前阶段继续。`));
  });
}

export const enqueueAgentReply = enqueueStageJob;

export function getQueuePosition(sessionId: string) {
  return codexQueue.position(sessionId);
}
