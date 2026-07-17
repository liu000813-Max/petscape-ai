import { randomUUID } from 'crypto';
import { appendFile, copyFile, mkdir, stat, writeFile } from 'fs/promises';
import path from 'path';
import { getProject, touch } from '../store/projects';
import type { CanvasItem, PetScapeProject } from '../types/project';
import { defaultModelConfig } from '../types/project';
import { falEditImage, downloadImage, fileToDataUri, publicImageToAbs } from '../images/falClient';
import { buildMultiviewGridPrompt } from '../images/multiviewPrompt';
import { cropGridToViews } from '../images/cropGrid';
import {
  downloadFile as tripoDownloadFile,
  glbUrlFrom as tripoGlbUrlFrom,
  pollTask as tripoPollTask,
  submitMultiviewToModel,
} from '../tripo/client';
import { checkPrintabilityLocal, summarizeLocalPrintability, carveShell, summarizeCarve } from '../printability/localCheck';
import { JOB_TIMEOUT_MS, withTimeout } from './timeouts';

// 门 1 竖切链路（主链：一致性四视图 → Tripo multiview_to_model）：
//   选中场景卡 → cleanItem(fal edit 抠白底) → item2d 卡
//   → fal edit 生成 2×2 正交四视图网格 → 服务端像素级裁切 4 张
//   → Tripo multiview_to_model → 下载 GLB → 本地可打印性检查 → model3d 卡。
// mock=1：白底图用现成占位、3D 结果用 public/mockup-assets/mock-model.glb，全链零成本跑通。
// Meshy client 保留不删（备选引擎裁决）。

// fal 偶发瞬时错误重试一次：失败等 2s 重试，仍失败才向上抛（原始错误保留在 console.error）。
async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    console.error(`[gate1 retry] ${label} 首次失败，2s 后重试一次：${err instanceof Error ? err.message : String(err)}`);
    await new Promise((resolve) => setTimeout(resolve, 2000));
    return fn();
  }
}

const workingDir = process.cwd();

function projectDir(id: string) {
  return path.join(workingDir, 'public', 'generated', id);
}

async function log(id: string, line: string) {
  const dir = projectDir(id);
  await mkdir(dir, { recursive: true }).catch(() => {});
  await appendFile(path.join(dir, 'gate1.log'), `[${new Date().toISOString()}] ${line}\n`).catch(() => {});
  console.log(`[gate1 ${id}] ${line}`);
}

// 门 1 入口：同步建两张 generating 卡（item2d、model3d）+ 置 tuning3d，立即返回；重活后台跑，前端轮询。
export function startGate1(project: PetScapeProject, sceneId: string, itemName: string, mock: boolean) {
  const scene = project.canvasItems.find((it) => it.id === sceneId && it.kind === 'scene2d');
  if (!scene || !scene.imagePath) throw new Error('未找到选中的场景卡或其图片未就绪');

  const now = new Date().toISOString();
  const itemCard: CanvasItem = {
    id: randomUUID(),
    kind: 'item2d',
    name: `白底物品图 · ${itemName}`,
    status: 'generating',
    parentId: scene.id,
    createdAt: now,
  };
  const modelCard: CanvasItem = {
    id: randomUUID(),
    kind: 'model3d',
    name: `3D 模型 · ${itemName}`,
    status: 'generating',
    parentId: itemCard.id,
    createdAt: now,
  };
  project.canvasItems.push(itemCard, modelCard);
  project.userState = 'tuning3d';
  project.gate1SceneId = sceneId;
  project.itemName = itemName;
  project.model3d = { status: 'running', progress: 2 };
  if (!project.modelConfig) project.modelConfig = defaultModelConfig();
  touch(project);

  void withTimeout('meshy', JOB_TIMEOUT_MS.meshy, () => runGate1(project.id, scene.imagePath!, itemName, itemCard.id, modelCard.id, mock)).catch(
    async (error) => {
      const message = error instanceof Error ? error.message : String(error);
      await log(project.id, `FAILED ${message}`);
      const p = getProject(project.id);
      if (!p) return;
      const mc = p.canvasItems.find((it) => it.id === modelCard.id);
      const ic = p.canvasItems.find((it) => it.id === itemCard.id);
      if (ic && ic.status === 'generating') { ic.status = 'failed'; ic.error = message; }
      if (mc) { mc.status = 'failed'; mc.error = message; }
      p.model3d = { ...(p.model3d ?? { status: 'running' }), status: 'failed', error: message };
      touch(p);
    },
  );
}

async function runGate1(
  id: string,
  sceneImagePath: string,
  itemName: string,
  itemCardId: string,
  modelCardId: string,
  mock: boolean,
) {
  const dir = projectDir(id);
  await mkdir(dir, { recursive: true });

  // ---- 1) 白底物品图（fal edit 抠图；mock 用占位图）----
  const cleanRel = `/generated/${id}/clean-item.png`;
  const cleanAbs = path.join(dir, 'clean-item.png');
  if (mock) {
    await copyFile(path.join(workingDir, 'public', 'mockup-assets', 'model3d-preview.jpg'), cleanAbs);
    await log(id, `mock clean-item copied → ${cleanRel}`);
  } else {
    const prompt = `仔细观察这张宠物造景场景图，场景里有多个物品（房屋、隧道、平台、木桩、树枝等）。你的任务是只提取其中一个物品：${itemName}。

严格要求：输出图中只允许出现「${itemName}」这一个独立物品，删除场景中的其它一切物体——不要笼子、不要其它房屋/隧道/平台/木桩/树枝/植物、不要宠物、不要垫材和地面。如果该物品与其它物体相连，把它干净地分离出来并补全被遮挡的部分。

把这个唯一物品重绘为纯白背景、无阴影的单物品产品图：居中、完整、边缘清晰；忠实保留输入图中该物品的形状、颜色、材质、比例和关键结构。照片级产品摄影/电商产品图质感。

物理约束（用于 3D 打印，必须遵守）：物品必须是**单一连续实体**——所有部分实心相连成一个整体，禁止分离的悬浮部件、禁止只靠细枝细杆连接的多个舱体。如果原物品是多部件组合，把它重新设计为一体化的单体结构（例如把多个小屋合并为一座连体小屋），保持整体风格与主要特征不变。`;
    await log(id, `fal edit start input=${sceneImagePath} → ${cleanRel}`);
    const sceneUri = await fileToDataUri(publicImageToAbs(sceneImagePath));
    const url = await withRetry('fal clean-item', () => falEditImage(prompt, [sceneUri]));
    await downloadImage(url, cleanAbs);
    await log(id, `fal edit success → ${cleanRel}`);
  }
  const cleanInfo = await stat(cleanAbs).catch(() => null);
  if (!cleanInfo || cleanInfo.size === 0) throw new Error('白底图生成失败：输出文件为空');

  // item2d 卡 ready
  let p = getProject(id);
  if (!p) return;
  const itemCard = p.canvasItems.find((it) => it.id === itemCardId);
  if (itemCard) { itemCard.status = 'ready'; itemCard.imagePath = cleanRel; }
  if (p.model3d) p.model3d.progress = 8;
  touch(p);

  // ---- 2) 3D 生成（四视图网格 → Tripo multiview_to_model + 本地可打印性检查；mock 拷现成 GLB）----
  // repair 暂不做（TODO：Tripo 产物需外部修复通道，Meshy print/repair 只吃自家 task）。
  const glbRel = `/generated/${id}/model.glb`;
  const glbAbs = path.join(dir, 'model.glb');
  let repairedRel: string | undefined;
  let printabilityIssues: string[] | undefined;
  let taskId: string | undefined;

  if (mock) {
    await copyFile(path.join(workingDir, 'public', 'mockup-assets', 'mock-model.glb'), glbAbs);
    // mock 直接过：不 spawn carve_shell（保证 ?mock=1 零外部/本地重计算、恒 ready）。
    // 摘要模拟挖腔已通过的形态，与真链路 summarizeCarve 字段一致。
    repairedRel = glbRel;
    printabilityIssues = ['watertight=true', 'entranceThrough=true', 'minWallMm=3.0', 'entranceAxis=+x', 'mock=1'];
    taskId = 'mock-task';
    // 模拟渐进进度（让前端状态卡有变化）
    for (const prog of [20, 45, 70, 90]) {
      p = getProject(id);
      if (p?.model3d) { p.model3d.progress = prog; touch(p); }
      await new Promise((r) => setTimeout(r, 600));
    }
    await log(id, `mock 3D model copied → ${glbRel}`);
  } else {
    // 2a) fal edit 生成 2×2 正交四视图网格（prompt 单点在 multiviewPrompt.ts）
    const gridAbs = path.join(dir, 'multiview-grid.png');
    const gridPrompt = buildMultiviewGridPrompt({ itemName });
    await log(id, `fal multiview-grid start input=${cleanRel}`);
    const cleanUri = await fileToDataUri(cleanAbs);
    const gridUrl = await withRetry('fal multiview-grid', () => falEditImage(gridPrompt, [cleanUri]));
    await downloadImage(gridUrl, gridAbs);
    const gridInfo = await stat(gridAbs).catch(() => null);
    if (!gridInfo || gridInfo.size === 0) throw new Error('四视图网格生成失败：输出文件为空');
    await log(id, `fal multiview-grid success → /generated/${id}/multiview-grid.png`);
    p = getProject(id);
    if (p?.model3d) { p.model3d.progress = 20; touch(p); }

    // 2b) 服务端像素级裁切 4 张视图（无生成式手段）
    const cropped = await cropGridToViews(gridAbs, dir);
    await log(id, `crop grid → front/back/left/right（Tripo 顺序 FLBR）`);
    p = getProject(id);
    if (p?.model3d) { p.model3d.progress = 28; touch(p); }

    // 2c) Tripo multiview_to_model（上传 4 张 → 提交 → 轮询，超时 10 分钟）
    await log(id, `submit tripo multiview_to_model`);
    const submit = await submitMultiviewToModel(cropped.orderedForTripo);
    taskId = submit.taskId;
    await writeFile(path.join(dir, 'tripo-submit.json'), JSON.stringify(submit.response, null, 2));
    await log(id, `tripo taskId=${taskId}`);
    p = getProject(id);
    if (p?.model3d) { p.model3d.taskId = taskId; p.model3d.progress = 32; touch(p); }

    const gen = await tripoPollTask(submit.taskId, {
      intervalMs: 5000,
      timeoutMs: 10 * 60_000,
      onPoll: async (r, count) => {
        const prog = typeof r.data?.progress === 'number' ? r.data.progress : Math.min(90, count * 6);
        const cur = getProject(id);
        if (cur?.model3d) { cur.model3d.progress = Math.round(32 + prog * 0.55); touch(cur); }
        await log(id, `poll tripo #${count} status=${r.data?.status} progress=${r.data?.progress ?? ''}`);
      },
    });
    await writeFile(path.join(dir, 'tripo-result.json'), JSON.stringify(gen, null, 2));
    // Tripo 原始 GLB 落到 model-raw.glb（留盘备查）；carved 结果占用 model.glb（前台/预览的最终文件）。
    const rawAbs = path.join(dir, 'model-raw.glb');
    const rawRel = `/generated/${id}/model-raw.glb`;
    const glbBytes = await tripoDownloadFile(tripoGlbUrlFrom(gen), rawAbs);
    await log(id, `download tripo glb=${rawRel} bytes=${glbBytes}`);
    p = getProject(id);
    if (p?.model3d) { p.model3d.progress = 88; touch(p); }

    // 2d) 混合内核后处理：重网格修水密 → 布尔挖功能腔（椭球内腔 + Ø69 贯通入口）→ 壁厚校验。
    //     纯本地计算，零外部 API。carved GLB 覆盖 model.glb 作为最终文件；失败不阻塞：
    //     回退用原始 GLB 当 model.glb，摘要如实标注挖腔失败。
    const carveScript = path.join(workingDir, '..', 'scripts', 'carve_shell.py');
    const carveJsonAbs = path.join(dir, 'carve.json');
    await log(id, `carve_shell start raw=${rawRel} → ${glbRel}`);
    const carve = await carveShell(rawAbs, glbAbs, carveJsonAbs, carveScript, {
      standHeightMm: 150,
      entranceDiameterMm: 69,
      wallMinMm: 3,
    });
    if (carve.error) {
      // 挖腔失败 → 原始 GLB 当最终文件，仍做基础水密/连通检查供摘要
      await copyFile(rawAbs, glbAbs);
      const local = await checkPrintabilityLocal(glbAbs);
      await writeFile(path.join(dir, 'printability-local.json'), JSON.stringify(local, null, 2));
      printabilityIssues = [...summarizeCarve(carve), ...summarizeLocalPrintability(local)];
      repairedRel = undefined;
      await log(id, `carve FAILED, fallback raw glb: ${carve.error}`);
    } else {
      printabilityIssues = summarizeCarve(carve);
      repairedRel = glbRel; // carved 即修复后文件
      await log(id, `carve success: ${printabilityIssues.join('; ')}`);
    }
    p = getProject(id);
    if (p?.model3d) { p.model3d.progress = 96; touch(p); }
  }

  const glbInfo = await stat(glbAbs).catch(() => null);
  if (!glbInfo || glbInfo.size === 0) throw new Error('3D 模型生成失败：GLB 文件为空');

  // model3d 卡 ready + project.model3d 收尾
  const final = getProject(id);
  if (!final) return;
  const modelCard = final.canvasItems.find((it) => it.id === modelCardId);
  if (modelCard) { modelCard.status = 'ready'; modelCard.glbPath = glbRel; }
  final.model3d = {
    status: 'ready',
    taskId,
    glbPath: glbRel,
    repairedGlbPath: repairedRel,
    printabilityIssues,
    progress: 100,
  };
  touch(final);
  await log(id, `SUCCEEDED glb=${glbRel} repaired=${repairedRel ?? '(none)'} issues=${printabilityIssues?.join('; ')}`);
}
