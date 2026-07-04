'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import type { CanvasItem, ModelConfig, PetScapeProject, UserState } from './lib/types/project';
import { defaultModelConfig } from './lib/types/project';
import type { WorkbenchCanvasHandle } from './components/WorkbenchCanvas';
import ModelStudio from './components/ModelStudio';

// tldraw 必须 client-only：SSR 会因 window/document 报错。next/dynamic ssr:false 隔离。
const WorkbenchCanvas = dynamic(() => import('./components/WorkbenchCanvas'), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center text-ink-soft">画布加载中…</div>,
});

const SPECIES: { slug: string; label: string }[] = [
  { slug: 'fancy_rat', label: '花枝鼠' },
  { slug: 'hamster', label: '仓鼠' },
  { slug: 'leopard_gecko', label: '豹纹守宫' },
  { slug: 'crested_gecko', label: '睫角守宫' },
  { slug: 'bearded_dragon', label: '鬃狮蜥' },
];
const STYLES = ['自然蘑菇', '溪流石', '原木森系', '极简', '苔藓森林'];
const TABOOS = ['无尖锐边', '洞口不可过小', '避免死角', '防翻倒'];
const TRAITS = ['爱钻洞', '爱攀爬', '爱觅食', '爱社交', '胆小怕光', '爱啃咬'];

const STEPS: { key: UserState; n: number; label: string }[] = [
  { key: 'briefing', n: 1, label: '需求收集' },
  { key: 'designing2d', n: 2, label: '2D 方案画布' },
  { key: 'tuning3d', n: 3, label: '3D 预览调参' },
];

const defaultConfig = defaultModelConfig();

export default function Workbench() {
  const [project, setProject] = useState<PetScapeProject | null>(null);
  const [missing, setMissing] = useState<string[]>(['物种', '宠物尺寸', '风格']);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const patchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canvasRef = useRef<WorkbenchCanvasHandle | null>(null);
  // 客户端 viewState：stepper 回退导航用，不改 server userState、不加 API。
  // 默认跟随 server userState；用户点已到达的步骤可临时回退查看，server 状态变化时自动跳回对应步骤。
  const [viewState, setViewState] = useState<UserState>('briefing');
  const prevServerStateRef = useRef<UserState | null>(null);
  const [selectedScene, setSelectedScene] = useState<{
    itemId: string | null;
    kind: CanvasItem['kind'] | null;
    hasAnnotations: boolean;
  }>({
    itemId: null,
    kind: null,
    hasAnnotations: false,
  });
  const [revising, setRevising] = useState(false);
  const [reviseError, setReviseError] = useState('');
  // 右栏 Agent 静默抽取 Chat（气泡上屏 + pending 态）
  const [chatMessages, setChatMessages] = useState<{ role: 'user' | 'assistant'; text: string }[]>([
    { role: 'assistant', text: '你好！左侧表单是需求真相源。填齐物种 / 尺寸 / 风格后点「生成 2D 方案」，我会出 3 个不同方向。' },
  ]);
  const [chatInput, setChatInput] = useState('');
  const [chatPending, setChatPending] = useState(false);
  // 门 1：物品名输入（预填 brief.item）
  const [gate1ItemName, setGate1ItemName] = useState('');
  const [gate1Error, setGate1Error] = useState('');
  // ?mock=1 开发/回归模式：生成 + 按标注修改都不烧 fal，走占位图（T1 沉淀的约定，T2 沿用）。
  const mockParam = typeof window !== 'undefined' ? new URLSearchParams(location.search).get('mock') === '1' : false;

  // 启动：复用 localStorage 里的 projectId，否则新建（刷新恢复的关键）
  useEffect(() => {
    let cancelled = false;
    async function boot() {
      // ?project=<id> 深链优先（分享 / 直达已有项目），否则回退 localStorage
      const deepLink = new URLSearchParams(location.search).get('project');
      const existing = deepLink || localStorage.getItem('petscape.projectId');
      if (existing) {
        const res = await fetch(`/api/project/${existing}`);
        if (res.ok) {
          const data = await res.json();
          localStorage.setItem('petscape.projectId', existing);
          if (!cancelled) applyProject(data);
          return;
        }
      }
      const res = await fetch('/api/project', { method: 'POST' });
      const data = await res.json();
      localStorage.setItem('petscape.projectId', data.id);
      if (!cancelled) applyProject({ ...data, missing: ['物种', '宠物尺寸', '风格'] });
    }
    boot();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyProject(data: PetScapeProject & { missing?: string[] }) {
    setProject(data);
    if (data.missing) setMissing(data.missing);
    setGenerating(Boolean(data.generating));
  }

  // 选中一张 ready 场景卡 → 门 1 物品名输入框预填 brief.item（可改）。
  useEffect(() => {
    if (selectedScene.kind === 'scene2d' && selectedScene.itemId) {
      setGate1ItemName((cur) => cur || project?.brief.item?.trim() || '');
      setGate1Error('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedScene.itemId, selectedScene.kind]);

  // 有活在跑就轮询 GET：2D 生成中、或 3D 生成中、或切片中，任一未完成都轮询直到 ready。
  const jobRunning =
    generating || project?.model3d?.status === 'running' || project?.slice?.status === 'running';
  useEffect(() => {
    if (!project || !jobRunning) return;
    const id = project.id;
    const timer = setInterval(async () => {
      const res = await fetch(`/api/project/${id}`);
      if (!res.ok) return;
      const data = (await res.json()) as PetScapeProject & { missing?: string[] };
      applyProject(data);
    }, 2000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id, jobRunning]);

  // 表单字段 PATCH（表单是真相源）。
  // chips/select 是离散操作 → immediate（否则共享去抖 timer 会互相取消，丢字段）；
  // 文本框逐字输入 → 去抖 400ms。
  const patchBrief = useCallback(
    (partial: Record<string, unknown>, immediate = false) => {
      if (!project) return;
      setProject((p) => (p ? { ...p, brief: { ...p.brief, ...partial } } : p));
      const id = project.id;
      const send = async () => {
        const res = await fetch(`/api/project/${id}/brief`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(partial),
        });
        if (res.ok) setMissing((await res.json()).missing);
      };
      if (immediate) {
        void send();
        return;
      }
      if (patchTimer.current) clearTimeout(patchTimer.current);
      patchTimer.current = setTimeout(() => void send(), 400);
    },
    [project],
  );

  const persistSnapshot = useCallback(
    (snapshot: unknown) => {
      if (!project) return;
      fetch(`/api/project/${project.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ canvasSnapshot: snapshot }),
      }).catch(() => {});
    },
    [project],
  );

  async function generate() {
    if (!project || missing.length > 0) return;
    setError('');
    setGenerating(true);
    const res = await fetch(`/api/project/${project.id}/scenes${mockParam ? '?mock=1' : ''}`, { method: 'POST' });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.missing ? `缺少：${data.missing.join('、')}` : '生成失败');
      setGenerating(false);
      return;
    }
    // 立即拉一次拿 generating 卡片
    const g = await fetch(`/api/project/${project.id}`);
    if (g.ok) applyProject(await g.json());
  }

  // 「按标注修改」：导出选中场景卡+其标注的合成图 → POST revise → 新 generating 卡落画布（轮询变 ready）。
  async function reviseSelected() {
    if (!project || !selectedScene.itemId || !canvasRef.current) return;
    setReviseError('');
    const exported = await canvasRef.current.exportAnnotatedScene(selectedScene.itemId);
    if (!exported) {
      setReviseError('未找到标注文字，请先在标注箭头上写字');
      return;
    }
    setRevising(true);
    setGenerating(true);
    const res = await fetch(
      `/api/project/${project.id}/scenes/${selectedScene.itemId}/revise${mockParam ? '?mock=1' : ''}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ annotatedImageDataUri: exported.dataUri, note: exported.note }),
      },
    );
    setRevising(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setReviseError(data.error ?? '按标注修改失败');
      setGenerating(false);
      return;
    }
    const g = await fetch(`/api/project/${project.id}`);
    if (g.ok) applyProject(await g.json());
  }

  // 门 1：确认选中场景 + 指定物品名 → 抠白底 + 提交 3D 生成 → 进入 tuning3d。
  async function confirmGate1() {
    if (!project || !selectedScene.itemId || selectedScene.kind !== 'scene2d') return;
    const itemName = gate1ItemName.trim();
    if (!itemName) {
      setGate1Error('请填写要做成 3D 的物品名');
      return;
    }
    setGate1Error('');
    const res = await fetch(`/api/project/${project.id}/gate1${mockParam ? '?mock=1' : ''}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sceneId: selectedScene.itemId, itemName }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setGate1Error(data.error ?? '进入 3D 失败');
      return;
    }
    setSelectedScene({ itemId: null, kind: null, hasAnnotations: false });
    const g = await fetch(`/api/project/${project.id}`);
    if (g.ok) applyProject(await g.json());
    // 门 1 是显式用户动作 → 直接跳 viewState 到 tuning3d。
    // 不能只靠「server userState 变化」被动效果：重选方案再次确认时 serverState 值本就已是
    // tuning3d（不变），值相等不会触发那个 effect，会出现"确认了但没跳回 3D"的假回退。
    prevServerStateRef.current = 'tuning3d';
    setViewState('tuning3d');
  }

  // 参数面板即时改：本地乐观更新 modelConfig（渲染层立即生效，门 2 时随 body 提交）。
  function updateModelConfig(partial: Partial<ModelConfig>) {
    setProject((p) => (p ? { ...p, modelConfig: { ...(p.modelConfig ?? defaultConfig), ...partial } } : p));
  }

  // 门 2：提交当前参数 → normalize + 切片 → 轮询到 STL/G-code 下载。
  async function confirmGate2() {
    if (!project) return;
    const config = project.modelConfig ?? defaultConfig;
    setProject((p) => (p ? { ...p, slice: { status: 'running', progress: 2 } } : p));
    const res = await fetch(`/api/project/${project.id}/gate2${mockParam ? '?mock=1' : ''}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(config),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setProject((p) => (p ? { ...p, slice: { status: 'failed', error: data.error ?? '切片失败' } } : p));
      return;
    }
    const g = await fetch(`/api/project/${project.id}`);
    if (g.ok) applyProject(await g.json());
  }

  // 右栏 Chat 一句话 → POST agent/extract 抽取字段落表 → GET 刷新 brief 使左栏可见更新。
  async function sendChatMessage() {
    const text = chatInput.trim();
    if (!text || !project || chatPending) return;
    setChatInput('');
    setChatMessages((m) => [...m, { role: 'user', text }]);
    setChatPending(true);
    try {
      const res = await fetch(`/api/project/${project.id}/agent/extract`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setChatMessages((m) => [...m, { role: 'assistant', text: data.error ?? '我这边开小差了，请直接在左侧表单填写' }]);
        return;
      }
      setChatMessages((m) => [...m, { role: 'assistant', text: data.reply ?? '收到。' }]);
      if (data.missing) setMissing(data.missing);
      const g = await fetch(`/api/project/${project.id}`);
      if (g.ok) applyProject(await g.json());
    } catch {
      setChatMessages((m) => [...m, { role: 'assistant', text: '我这边开小差了，请直接在左侧表单填写' }]);
    } finally {
      setChatPending(false);
    }
  }

  const brief = project?.brief;
  const canGenerate = missing.length === 0 && !generating;
  const items: CanvasItem[] = project?.canvasItems ?? [];
  const readyCount = items.filter((i) => i.status === 'ready').length;

  // server 驱动的真实阶段（决定生成链路能不能跑、gate1/gate2 是否可提交）。
  const serverState: UserState = project?.userState ?? 'briefing';
  // 步骤可达性：步骤2 = 存在 scene2d 卡；步骤3 = 存在 ready 的 model3d 卡。
  const hasScene2d = items.some((it) => it.kind === 'scene2d');
  const hasReadyModel3d = items.some((it) => it.kind === 'model3d' && it.status === 'ready');
  const canReachStep = (key: UserState) => {
    if (key === 'briefing') return true;
    if (key === 'designing2d') return hasScene2d || serverState !== 'briefing';
    if (key === 'tuning3d') return hasReadyModel3d;
    return false;
  };

  // server userState 变化时（如重新确认门1 → tuning3d）viewState 跟随跳转（保持现有自动跳转体验）。
  useEffect(() => {
    if (prevServerStateRef.current !== serverState) {
      prevServerStateRef.current = serverState;
      setViewState(serverState);
    }
  }, [serverState]);

  // viewState 变化 → 驱动画布相机（首帧后才可调用 tldraw API，canvasRef 内部已保证）。
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (viewState === 'designing2d') canvas.focusItemsOfKind('scene2d');
    else if (viewState === 'tuning3d') canvas.focusLatestItemOfKind('model3d');
    else canvas.resetCamera();
  }, [viewState, items]);

  function goToStep(key: UserState) {
    if (!canReachStep(key)) return;
    setViewState(key);
  }

  // 右栏/覆盖层按 viewState 渲染（回退查看不影响 server 真实阶段）。
  const activeStep: UserState = viewState;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-paper font-body text-ink">
      {/* 顶栏 + stepper */}
      <header className="flex h-[58px] items-center gap-6 bg-forest px-5 text-[#EDE8DB]">
        <div className="flex min-w-[210px] items-baseline gap-2">
          <b className="font-display text-xl tracking-wide text-white">PetScape</b>
          <span className="text-[11px] opacity-60">宠物造景设计工作台</span>
        </div>
        <nav className="flex flex-1 items-center justify-center">
          {STEPS.map((s, i) => {
            const serverIdx = STEPS.findIndex((x) => x.key === serverState);
            const reachable = canReachStep(s.key);
            const isActive = s.key === activeStep;
            // "done"：server 已经越过这一步（用于对勾底色），与当前回看的 viewState 无关。
            const isDone = !isActive && i < serverIdx;
            const state = isActive ? 'active' : isDone ? 'done' : 'todo';
            return (
              <div key={s.key} className="flex items-center">
                <button
                  type="button"
                  onClick={() => goToStep(s.key)}
                  disabled={!reachable}
                  title={reachable ? `查看：${s.label}` : '尚未到达此步骤'}
                  className={`flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[13px] transition ${
                    state === 'active' ? 'bg-white/15 text-white' : state === 'done' ? 'text-white/80' : 'text-white/55'
                  } ${reachable ? 'cursor-pointer hover:bg-white/20 hover:text-white' : 'cursor-not-allowed'}`}
                >
                  <span
                    className={`inline-flex h-5 w-5 items-center justify-center rounded-full border text-[11px] ${
                      state === 'done' ? 'border-moss bg-moss text-white' : 'border-current'
                    }`}
                  >
                    {s.n}
                  </span>
                  {s.label}
                </button>
                {i < STEPS.length - 1 && <div className="mx-2 h-px w-6 bg-white/25" />}
              </div>
            );
          })}
        </nav>
        <div className="flex min-w-[210px] items-center justify-end gap-3.5">
          <span className="text-[12px] opacity-70">未命名项目</span>
          <div className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-wood text-[12px] font-semibold text-white">
            谷
          </div>
        </div>
      </header>

      <main className="grid flex-1 overflow-hidden" style={{ gridTemplateColumns: '300px 1fr 336px' }}>
        {/* 左栏 · Brief 表单（真相源） */}
        <aside className="flex flex-col overflow-hidden border-r border-line bg-card">
          <div className="border-b border-line px-[18px] pb-3 pt-[18px]">
            <div className="text-[10px] uppercase tracking-[2px] text-ink-soft">BRIEF · 真相源</div>
            <h2 className="mt-1 font-display text-[19px] font-bold">设计需求</h2>
            <div className="mt-1 text-[11px] leading-relaxed text-ink-soft">
              手动填写，或让右侧 Agent 帮你补全——两个入口写同一份数据。
            </div>
          </div>

          <div className="flex-1 space-y-4 overflow-y-auto px-[18px] pb-[18px] pt-3.5">
            <Field label="宠物名字">
              <input
                className="field-input"
                placeholder="给你的宠物起个名字"
                value={brief?.petName ?? ''}
                onChange={(e) => patchBrief({ petName: e.target.value })}
              />
            </Field>

            <Field label="物种" required missing={missing.includes('物种')}>
              <Chips
                options={SPECIES.map((s) => s.label)}
                value={brief?.species ? [SPECIES.find((s) => s.slug === brief.species)?.label ?? ''] : []}
                single
                onToggle={(label) => {
                  const slug = SPECIES.find((s) => s.label === label)?.slug ?? '';
                  patchBrief({ species: slug }, true);
                }}
              />
            </Field>

            <Field label="宠物尺寸" required missing={missing.includes('宠物尺寸')}>
              <div className="flex items-center gap-2">
                <input
                  className="field-input flex-1"
                  placeholder="体长约 9"
                  value={brief?.petSize ?? ''}
                  onChange={(e) => patchBrief({ petSize: e.target.value })}
                />
                <span className="text-[12px] text-ink-soft">cm</span>
              </div>
            </Field>

            <Field label="性格 / 习性">
              <Chips
                options={TRAITS}
                value={brief?.traits ?? []}
                onToggle={(v) => {
                  const cur = new Set(brief?.traits ?? []);
                  cur.has(v) ? cur.delete(v) : cur.add(v);
                  patchBrief({ traits: Array.from(cur) }, true);
                }}
              />
            </Field>

            <Field label="风格" required missing={missing.includes('风格')}>
              <Chips options={STYLES} value={brief?.style ? [brief.style] : []} single onToggle={(v) => patchBrief({ style: v }, true)} />
            </Field>

            <Field label="氛围描述">
              <textarea
                className="field-input min-h-[72px] resize-none"
                placeholder="森林奶酪屋，童话厨房氛围，适合钻洞和觅食"
                value={brief?.vibe ?? ''}
                onChange={(e) => patchBrief({ vibe: e.target.value })}
              />
            </Field>

            <Field label="禁忌与安全">
              <Chips
                options={TABOOS}
                value={brief?.taboos ?? []}
                taboo
                onToggle={(v) => {
                  const cur = new Set(brief?.taboos ?? []);
                  cur.has(v) ? cur.delete(v) : cur.add(v);
                  patchBrief({ taboos: Array.from(cur) }, true);
                }}
              />
            </Field>

            <Field label="宠物照片">
              <PhotoUpload
                projectId={project?.id}
                kind="pet"
                url={brief?.petPhotoUrl}
                onUploaded={(url) => patchBrief({ petPhotoUrl: url }, true)}
              />
            </Field>

            <Field label="笼箱照片">
              <PhotoUpload
                projectId={project?.id}
                kind="cage"
                url={brief?.cagePhotoUrl}
                onUploaded={(url) => patchBrief({ cagePhotoUrl: url }, true)}
              />
            </Field>
          </div>

          <div className="border-t border-line bg-[#FBFAF6] px-[18px] py-3.5">
            <button
              disabled={!canGenerate}
              onClick={generate}
              className="w-full rounded-[10px] bg-forest py-[11px] text-[14px] font-semibold tracking-wide text-white transition hover:bg-forest-deep disabled:cursor-not-allowed disabled:bg-[#B9C4BC]"
            >
              {generating ? '生成中…' : '✦ 生成 2D 方案（3 张）'}
            </button>
            <div className="mt-2 text-center text-[10.5px] leading-relaxed text-ink-soft">
              {missing.length > 0 ? (
                <span className="text-amber">还缺必填：{missing.join(' · ')}</span>
              ) : (
                <>必填 3 项已齐：物种 · 宠物尺寸 · 风格</>
              )}
              {error && <div className="mt-1 text-anno">{error}</div>}
            </div>
          </div>
        </aside>

        {/* 中栏 · 画布 */}
        <section className="relative overflow-hidden" style={{ background: '#EFECE2' }}>
          {items.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <div className="text-[13px] text-ink-soft">
                画布主工作区 —— 填齐左侧必填 3 项后点「生成 2D 方案」，3 张场景图会落在这里
              </div>
            </div>
          ) : (
            <WorkbenchCanvas
              ref={canvasRef}
              items={items}
              snapshot={project?.canvasSnapshot}
              onSnapshotChange={persistSnapshot}
              onSelectionChange={setSelectedScene}
            />
          )}

          {generating && (
            <div className="absolute left-1/2 top-4 z-40 -translate-x-1/2 rounded-full border border-line bg-card px-4 py-1.5 text-[12px] text-ink-soft shadow-workbench">
              正在生成 {readyCount}/3 张场景图…
            </div>
          )}

          {/* 「按标注修改」只对 scene2d 卡浮出 */}
          {selectedScene.kind === 'scene2d' && selectedScene.itemId && selectedScene.hasAnnotations && (
            <div className="absolute bottom-24 left-5 z-40 flex flex-col items-start gap-1.5">
              <button
                onClick={reviseSelected}
                disabled={revising || generating}
                className="rounded-full bg-anno px-4 py-2 text-[13px] font-semibold text-white shadow-workbench transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {revising ? '正在按标注修改…' : '✎ 按标注修改'}
              </button>
              {reviseError && (
                <div className="rounded-full border border-line bg-card px-3 py-1 text-[11px] text-anno shadow-workbench">
                  {reviseError}
                </div>
              )}
            </div>
          )}

          {/* 门 1 条：选中 ready 场景卡（且尚未进入 3D）→ 底部浮出物品名输入 + 确认 */}
          {activeStep === 'designing2d' &&
            selectedScene.kind === 'scene2d' &&
            selectedScene.itemId &&
            (() => {
              const sel = items.find((i) => i.id === selectedScene.itemId);
              if (!sel || sel.status !== 'ready') return null;
              return (
                <div className="absolute bottom-24 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-2xl border border-line bg-card px-4 py-3 shadow-workbench">
                  <div className="text-[12px] font-semibold text-ink">门 1 · 确认方案</div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] text-ink-soft">做成 3D 的物品</span>
                    <input
                      value={gate1ItemName}
                      onChange={(e) => setGate1ItemName(e.target.value)}
                      placeholder="如：蘑菇躲避屋"
                      className="w-[160px] rounded-lg border border-line bg-[#FDFCF9] px-2.5 py-1.5 text-[13px] outline-none focus:border-forest-soft"
                    />
                  </div>
                  <button
                    onClick={confirmGate1}
                    className="rounded-lg bg-forest px-3.5 py-2 text-[13px] font-semibold text-white transition hover:bg-forest-deep"
                  >
                    确认方案，进入 3D →
                  </button>
                  {gate1Error && <span className="text-[11px] text-anno">{gate1Error}</span>}
                </div>
              );
            })()}

          {/* 3D 态覆盖层：生成状态卡 + model-viewer + 参数面板 + 门 2 + 下载 */}
          {activeStep === 'tuning3d' && project && (
            <ModelStudio
              project={project}
              mock={mockParam}
              onUpdateConfig={updateModelConfig}
              onConfirmGate2={confirmGate2}
            />
          )}
        </section>

        {/* 右栏 · Agent 对话（T1 只做壳） */}
        <aside className="flex flex-col overflow-hidden border-l border-line bg-card">
          <div className="flex items-center gap-2.5 border-b border-line px-[18px] py-3.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-forest text-[15px] text-white">✦</div>
            <div>
              <div className="text-[13px] font-bold">造景设计师 Agent</div>
              <div className="text-[10.5px] text-ink-soft">追问 · 落表 · 改图 · 解释风险</div>
            </div>
          </div>
          <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
            {chatMessages.map((m, i) => (
              <div
                key={i}
                className={
                  m.role === 'user'
                    ? 'max-w-[88%] self-end rounded-[13px_3px_13px_13px] bg-forest px-3.5 py-2.5 text-[12.5px] leading-relaxed text-white'
                    : 'max-w-[88%] self-start rounded-[3px_13px_13px_13px] bg-[#F4F1E8] px-3.5 py-2.5 text-[12.5px] leading-relaxed'
                }
              >
                {m.text}
              </div>
            ))}
            {chatPending && (
              <div className="max-w-[88%] self-start rounded-[3px_13px_13px_13px] bg-[#F4F1E8] px-3.5 py-2.5 text-[12.5px] italic text-ink-soft">
                思考中…
              </div>
            )}
          </div>
          <div className="border-t border-line p-3.5">
            <div className="flex items-center gap-2 rounded-[11px] border border-line bg-[#F0EEE7] px-3 py-1">
              <input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void sendChatMessage();
                  }
                }}
                disabled={chatPending}
                placeholder="跟我说说你家宠物的情况…"
                className="flex-1 bg-transparent py-1.5 text-[13px] outline-none placeholder:text-ink-soft disabled:opacity-60"
              />
              <button
                onClick={() => void sendChatMessage()}
                disabled={chatPending || !chatInput.trim()}
                className="h-8 w-8 rounded-[9px] bg-forest text-[14px] text-white transition disabled:cursor-not-allowed disabled:bg-[#B9C4BC]"
              >
                ↑
              </button>
            </div>
          </div>
        </aside>
      </main>
    </div>
  );
}

function Field({
  label,
  required,
  missing,
  children,
}: {
  label: string;
  required?: boolean;
  missing?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold text-ink">
        {label}
        {required && <span className="text-[13px] text-anno">*</span>}
        {required && missing && <span className="ml-auto text-[9.5px] text-amber">待填</span>}
      </div>
      {children}
    </div>
  );
}

function Chips({
  options,
  value,
  onToggle,
  single,
  taboo,
}: {
  options: string[];
  value: string[];
  onToggle: (v: string) => void;
  single?: boolean;
  taboo?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((opt) => {
        const on = value.includes(opt);
        const onClasses = taboo ? 'bg-[#8A4436] border-[#8A4436] text-white' : 'bg-forest border-forest text-white';
        return (
          <button
            key={opt}
            onClick={() => onToggle(single && on ? '' : opt)}
            className={`rounded-full border px-3 py-1 text-[12px] transition ${
              on ? `${onClasses} font-medium` : 'border-line bg-[#FDFCF9] text-ink-soft hover:border-forest-soft'
            }`}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}

function PhotoUpload({
  projectId,
  kind,
  url,
  onUploaded,
}: {
  projectId: string | undefined;
  kind: 'pet' | 'cage';
  url?: string;
  onUploaded: (url: string) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !projectId) return;
    setUploading(true);
    setError('');
    const form = new FormData();
    form.append('file', file);
    form.append('kind', kind);
    const res = await fetch(`/api/project/${projectId}/upload`, { method: 'POST', body: form });
    setUploading(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? '上传失败');
      return;
    }
    const data = await res.json();
    onUploaded(data.url as string);
  }

  return (
    <div className="flex items-center gap-2.5">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={kind} className="h-12 w-12 rounded-lg border border-line object-cover" />
      ) : (
        <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-dashed border-line text-[10px] text-ink-soft">
          无图
        </div>
      )}
      <label className="cursor-pointer rounded-lg border border-line bg-[#FDFCF9] px-3 py-1.5 text-[12px] text-ink-soft transition hover:border-forest-soft">
        {uploading ? '上传中…' : url ? '重新上传' : '选择图片'}
        <input type="file" accept="image/*" className="hidden" onChange={handleFile} disabled={uploading} />
      </label>
      {error && <span className="text-[11px] text-anno">{error}</span>}
    </div>
  );
}
