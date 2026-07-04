import { appendFile, mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { getSession, makeMessage } from '../store/sessions';
import {
  downloadFile,
  glbUrlFrom,
  pollTask,
  printabilityNeedsRepair,
  submitImageTo3d,
  submitPrintabilityAnalyze,
  submitRepair,
  summarizePrintability,
} from '../meshy/client';
import { JOB_TIMEOUT_MS, JobTimeoutError, userTimeoutMessage, withTimeout } from './timeouts';

function publicToAbs(publicPath: string) {
  return path.join(process.cwd(), 'public', publicPath.replace(/^\//, ''));
}

function sessionDir(sessionId: string) {
  return path.join(process.cwd(), 'public', 'generated', sessionId);
}

async function log(sessionId: string, line: string) {
  const dir = sessionDir(sessionId);
  await mkdir(dir, { recursive: true });
  await appendFile(path.join(dir, 'meshy.log'), `[${new Date().toISOString()}] ${line}\n`);
  console.log(`[meshy ${sessionId}] ${line}`);
}

function nextModelIndex(sessionId: string) {
  const session = getSession(sessionId);
  // 每次触发以当前 meshy 是否已有模型递增；足够保证单会话串行重试/重跑不覆盖。
  const messages = session?.messages.filter((m) => m.modelPath).length ?? 0;
  return messages + 1;
}

function setProgress(sessionId: string, progress: number) {
  const session = getSession(sessionId);
  if (session?.pendingJob?.type === 'meshy') session.pendingJob.progress = Math.max(0, Math.min(100, Math.round(progress)));
}

export function startMeshyJob(sessionId: string) {
  const session = getSession(sessionId);
  if (!session) return;
  session.stage = 'generating3d';
  session.pendingJob = { type: 'meshy', status: 'running', progress: 0 };
  session.messages.push(makeMessage('assistant', '正在生成 3D 模型…（约 2-3 分钟）。我会提交 Meshy、轮询生成结果，并自动做打印性检测/修复。'));

  void withTimeout('meshy', JOB_TIMEOUT_MS.meshy, () => runMeshyJob(sessionId)).catch(async (error) => {
    const current = getSession(sessionId);
    const message = error instanceof JobTimeoutError ? userTimeoutMessage('meshy') : error instanceof Error ? error.message : String(error);
    await log(sessionId, `${error instanceof JobTimeoutError ? 'TIMEOUT' : 'FAILED'} ${message}`).catch(() => undefined);
    if (!current) return;
    current.stage = 'generating3d';
    current.pendingJob = { type: 'meshy', status: 'failed', error: message };
    current.messages.push(makeMessage('assistant', `3D 生成失败：${message}\n你可以直接回复“重试”，我会从白底物品图继续重新生成 3D，不需要重新抠图。`));
  });
}

async function runMeshyJob(sessionId: string) {
  const session = getSession(sessionId);
  if (!session?.cleanItemImage) throw new Error('缺少白底单物品图，无法提交 Meshy');
  const cleanAbsPath = publicToAbs(session.cleanItemImage);
  const dir = sessionDir(sessionId);
  await mkdir(dir, { recursive: true });
  const index = nextModelIndex(sessionId);
  const started = Date.now();

  await log(sessionId, `START timeoutMs=${JOB_TIMEOUT_MS.meshy}`);
  await log(sessionId, `submit image-to-3d input=${session.cleanItemImage}`);
  const submit = await submitImageTo3d(cleanAbsPath);
  session.meshy = { taskId: submit.taskId };
  await writeFile(path.join(dir, `meshy-submit-${index}.json`), JSON.stringify(submit.response, null, 2));
  await log(sessionId, `image-to-3d taskId=${submit.taskId}`);
  setProgress(sessionId, 5);

  const gen = await pollTask('image-to-3d', submit.taskId, {
    intervalMs: 15000,
    timeoutMs: 10 * 60_000,
    onPoll: async (r, count) => {
      await writeFile(path.join(dir, `meshy-image-to-3d-${submit.taskId}.latest.json`), JSON.stringify(r, null, 2));
      const p = typeof r.progress === 'number' ? r.progress : Math.min(90, count * 8);
      setProgress(sessionId, 5 + p * 0.7);
      await log(sessionId, `poll image-to-3d #${count} status=${r.status} progress=${r.progress ?? ''}`);
    },
  });
  await writeFile(path.join(dir, `meshy-result-${index}.json`), JSON.stringify(gen, null, 2));
  const glbPublic = `/generated/${sessionId}/model-${index}.glb`;
  const glbBytes = await downloadFile(glbUrlFrom(gen), publicToAbs(glbPublic));
  session.meshy.glbPath = glbPublic;
  await log(sessionId, `download raw glb=${glbPublic} bytes=${glbBytes}`);
  setProgress(sessionId, 78);

  const analyze = await submitPrintabilityAnalyze(submit.taskId);
  await writeFile(path.join(dir, `meshy-analyze-submit-${index}.json`), JSON.stringify(analyze.response, null, 2));
  await log(sessionId, `print/analyze taskId=${analyze.taskId}`);
  const an = await pollTask('print/analyze', analyze.taskId, {
    intervalMs: 2000,
    onPoll: async (r, count) => {
      await writeFile(path.join(dir, `meshy-print-analyze-${analyze.taskId}.latest.json`), JSON.stringify(r, null, 2));
      setProgress(sessionId, 82 + Math.min(8, count * 2));
    },
  });
  await writeFile(path.join(dir, `meshy-analyze-result-${index}.json`), JSON.stringify(an, null, 2));
  let printability = an.printability;
  let repaired = false;
  let repairedPath: string | undefined;

  if (printabilityNeedsRepair(printability)) {
    const repair = await submitRepair(submit.taskId);
    await writeFile(path.join(dir, `meshy-repair-submit-${index}.json`), JSON.stringify(repair.response, null, 2));
    await log(sessionId, `print/repair taskId=${repair.taskId}`);
    const rep = await pollTask('print/repair', repair.taskId, {
      intervalMs: 2000,
      onPoll: async (r, count) => {
        await writeFile(path.join(dir, `meshy-print-repair-${repair.taskId}.latest.json`), JSON.stringify(r, null, 2));
        setProgress(sessionId, 90 + Math.min(8, count * 2));
      },
    });
    await writeFile(path.join(dir, `meshy-repair-result-${index}.json`), JSON.stringify(rep, null, 2));
    repairedPath = `/generated/${sessionId}/model-${index}-repaired.glb`;
    const repairedBytes = await downloadFile(glbUrlFrom(rep), publicToAbs(repairedPath));
    await log(sessionId, `download repaired glb=${repairedPath} bytes=${repairedBytes}`);
    repaired = true;

    // 免费复检修复后的 repair task，让 session 中记录最终打印性。
    const ran = await submitPrintabilityAnalyze(repair.taskId);
    const ranResult = await pollTask('print/analyze', ran.taskId, { intervalMs: 2000 });
    await writeFile(path.join(dir, `meshy-repaired-analyze-result-${index}.json`), JSON.stringify(ranResult, null, 2));
    printability = ranResult.printability || printability;
  }

  const current = getSession(sessionId);
  if (!current) return;
  current.meshy = {
    taskId: submit.taskId,
    glbPath: glbPublic,
    repairedGlbPath: repairedPath,
    printability: { issues: summarizePrintability(printability), repaired },
  };
  current.stage = 'preview';
  delete current.pendingJob;
  setProgress(sessionId, 100);
  const elapsedSec = Math.round((Date.now() - started) / 1000);
  await log(sessionId, `SUCCEEDED elapsedSec=${elapsedSec} repaired=${repaired} issues=${current.meshy.printability?.issues.join('; ')}`);
  current.messages.push(makeMessage('assistant', `3D 模型已生成，用时约 ${elapsedSec} 秒。下面是可旋转缩放的原始材质预览；打印将使用${repaired ? '修复后的几何' : '当前几何'}。如果满意请回复“可以，就这个”；也可以说“重新生成3D / 修改外观 / 重新选一个物品”。`, undefined, glbPublic));
}
