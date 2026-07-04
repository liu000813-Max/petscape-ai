'use client';

import { createElement, FormEvent, useEffect, useMemo, useRef, useState } from 'react';

type Stage = 'collecting' | 'rendering' | 'selecting' | 'cleaningItem' | 'generating3d' | 'preview' | 'slicing' | 'done';
type Message = { id: string; role: 'user' | 'assistant' | 'system'; text?: string; imagePath?: string; modelPath?: string; sliceResult?: boolean; createdAt: string };
type Session = {
  id: string;
  stage: Stage;
  pendingJob?: { type: string; status: string; error?: string; progress?: number; queuePosition?: number };
  messages: Message[];
  brief: { species: string; petSize?: string; style?: string; item?: string; photoPath?: string };
  constraints: string[];
  renderRounds: number;
  sceneImages: string[];
  cleanItemImage?: string;
  selection?: { selectedItem: string; itemDescription: string };
  meshy?: { taskId: string; glbPath?: string; repairedGlbPath?: string; printability?: { issues: string[]; repaired: boolean } };
  slice?: { stlPath?: string; gcodePath?: string; warnings: string[]; estimatedTime?: string; filament?: string; normalize?: { actualExtentsMm?: number[] } }; 
};

const stages: { key: Stage; label: string }[] = [
  { key: 'collecting', label: '收集需求' },
  { key: 'rendering', label: '效果图' },
  { key: 'selecting', label: '选物' },
  { key: 'cleaningItem', label: '抠图' },
  { key: 'generating3d', label: '生成 3D' },
  { key: 'preview', label: '预览确认' },
  { key: 'slicing', label: '切片' },
  { key: 'done', label: '完成' },
];

export default function Home() {
  const [session, setSession] = useState<Session | null>(null);
  const [text, setText] = useState('');
  const [image, setImage] = useState<File | null>(null);
  const [error, setError] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  const pendingText = useMemo(() => {
    if (!session?.pendingJob) return '';
    const pos = session.pendingJob.queuePosition;
    if (session.pendingJob.status === 'queued') return `排队中${pos ? `（第 ${pos} 位）` : ''}`;
    if (session.pendingJob.status === 'running' && session.pendingJob.type === 'renderImage') return '正在生成效果图…';
    if (session.pendingJob.status === 'running' && session.pendingJob.type === 'cleanItem') return '正在提取物品…';
    if (session.pendingJob.status === 'running' && session.pendingJob.type === 'meshy') return `正在生成 3D 模型…（约 2-3 分钟）${typeof session.pendingJob.progress === 'number' ? ` ${session.pendingJob.progress}%` : ''}`;
    if (session.pendingJob.status === 'running' && session.pendingJob.type === 'slice') return `正在标准化并切片…${typeof session.pendingJob.progress === 'number' ? ` ${session.pendingJob.progress}%` : ''}`;
    if (session.pendingJob.status === 'running') return 'Agent 正在处理…';
    if (session.pendingJob.status === 'failed') return `失败：${session.pendingJob.error || '未知错误'}`;
    return '处理中…';
  }, [session?.pendingJob]);

  async function refresh(id: string) {
    const res = await fetch(`/api/session/${id}`, { cache: 'no-store' });
    if (res.ok) setSession(await res.json());
  }

  useEffect(() => {
    void import('@google/model-viewer');
    fetch('/api/session', { method: 'POST' }).then((r) => r.json()).then(setSession).catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    if (!session?.id) return;
    const timer = setInterval(() => refresh(session.id), session.pendingJob ? 1200 : 3000);
    return () => clearInterval(timer);
  }, [session?.id, session?.pendingJob]);

  useEffect(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), [session?.messages.length, pendingText]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!session || inputLocked || (!text.trim() && !image)) return;
    setError('');
    const form = new FormData();
    form.set('message', text.trim());
    if (image) form.set('image', image);
    const res = await fetch(`/api/session/${session.id}/message`, { method: 'POST', body: form });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error || `请求失败 ${res.status}`);
    }
    setText('');
    setImage(null);
    await refresh(session.id);
  }

  const stageIndex = session ? stages.findIndex((s) => s.key === session.stage) : 0;
  const inputLocked = Boolean(session?.pendingJob && session.pendingJob.status !== 'failed');

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col p-4 sm:p-6">
      <header className="mb-4 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold">PetScape 宠物造景打印</h1>
            <p className="mt-1 text-sm text-slate-500">M5：3D 预览确认 → 尺寸标准化 → PrusaSlicer 切片 → G-code 下载</p>
          </div>
          <div className="text-xs text-slate-500">会话：{session?.id || '创建中…'}</div>
        </div>
        <div className="mt-5 grid grid-cols-4 gap-2 sm:grid-cols-8">
          {stages.map((s, i) => {
            const active = i === stageIndex;
            const done = i < stageIndex;
            return (
              <div key={s.key} className={`rounded-2xl px-3 py-2 text-center text-xs font-medium ${active ? 'bg-emerald-600 text-white' : done ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>{s.label}</div>
            );
          })}
        </div>
      </header>

      <section className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[1fr_280px]">
        <div className="flex min-h-[60vh] flex-col rounded-3xl bg-white shadow-sm ring-1 ring-slate-200">
          <div className="flex-1 space-y-4 overflow-y-auto p-4">
            {session?.messages.map((m) => {
              const latestModelId = [...session.messages].reverse().find((msg) => msg.modelPath)?.id;
              return (
              <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[82%] rounded-3xl px-4 py-3 ${m.role === 'user' ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-900'}`}>
                  {m.imagePath && <div className="mb-2 overflow-hidden rounded-2xl bg-white/60 p-1"><img src={m.imagePath} alt="图片卡片" className="max-h-80 rounded-xl object-contain" /></div>}
                  {m.modelPath && <ModelCard src={m.modelPath} repaired={Boolean(session?.meshy?.repairedGlbPath)} latest={m.id === latestModelId} />}
                  {m.sliceResult && session.slice && <SliceCard slice={session.slice} />}
                  {m.text && <p className="whitespace-pre-wrap text-sm leading-6">{m.text}</p>}
                </div>
              </div>
              );
            })}
            {pendingText && <div className="mx-auto w-full max-w-md rounded-2xl bg-amber-50 px-4 py-3 text-center text-sm text-amber-700">
              <div>{pendingText}</div>
              {(session?.pendingJob?.type === 'meshy' || session?.pendingJob?.type === 'slice') && typeof session.pendingJob.progress === 'number' && (
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-amber-100"><div className="h-full bg-amber-500 transition-all" style={{ width: `${session.pendingJob.progress}%` }} /></div>
              )}
            </div>}
            <div ref={bottomRef} />
          </div>
          <form onSubmit={submit} className="border-t border-slate-200 p-4">
            {error && <div className="mb-2 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
            <div className="flex flex-col gap-3 sm:flex-row">
              <input className="flex-1 rounded-2xl border border-slate-300 px-4 py-3 outline-none focus:border-emerald-500 disabled:bg-slate-100" value={text} onChange={(e) => setText(e.target.value)} placeholder="例如：我养了只金丝熊，想要森系风格的躲避屋，大概12cm" disabled={inputLocked} />
              <label className="cursor-pointer rounded-2xl border border-slate-300 px-4 py-3 text-center text-sm text-slate-600 hover:bg-slate-50">
                {image ? image.name : '上传图片'}
                <input type="file" accept="image/*" className="hidden" disabled={inputLocked} onChange={(e) => setImage(e.target.files?.[0] || null)} />
              </label>
              <button className="rounded-2xl bg-emerald-600 px-6 py-3 font-medium text-white hover:bg-emerald-700 disabled:bg-slate-300" disabled={!session || inputLocked}>发送</button>
            </div>
          </form>
        </div>

        <aside className="rounded-3xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <h2 className="font-semibold">结构化 brief</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <Brief label="物种" value={session?.brief.species} />
            <Brief label="尺寸" value={session?.brief.petSize} />
            <Brief label="风格" value={session?.brief.style} />
            <Brief label="物品" value={session?.brief.item} />
            <Brief label="照片" value={session?.brief.photoPath} />
          </dl>
          <h3 className="mt-5 font-semibold">效果图迭代</h3>
          <div className="mt-2 rounded-2xl bg-slate-50 px-3 py-2 text-sm text-slate-700">{session?.renderRounds ?? 0}/3</div>
          <h3 className="mt-5 font-semibold">白底物品图</h3>
          {session?.cleanItemImage ? (
            <div className="mt-2 overflow-hidden rounded-2xl bg-slate-50 p-2"><img src={session.cleanItemImage} alt="白底物品图" className="rounded-xl object-contain" /></div>
          ) : (
            <div className="mt-2 rounded-2xl bg-slate-50 px-3 py-2 text-sm text-slate-500">待生成</div>
          )}
          <h3 className="mt-5 font-semibold">Meshy 3D</h3>
          {session?.meshy ? (
            <div className="mt-2 space-y-2 rounded-2xl bg-slate-50 px-3 py-2 text-xs text-slate-700">
              <div>taskId: <span className="break-all font-mono">{session.meshy.taskId}</span></div>
              <div>预览 GLB: {session.meshy.glbPath ? <a className="text-emerald-700 underline" href={session.meshy.glbPath} target="_blank">打开</a> : '生成中'}</div>
              <div>修复版: {session.meshy.repairedGlbPath ? <a className="text-emerald-700 underline" href={session.meshy.repairedGlbPath} target="_blank">打开</a> : '无/待定'}</div>
              <div>打印性: {session.meshy.printability?.issues?.join('；') || '待检测'}</div>
            </div>
          ) : (
            <div className="mt-2 rounded-2xl bg-slate-50 px-3 py-2 text-sm text-slate-500">待生成</div>
          )}
          <h3 className="mt-5 font-semibold">切片产物</h3>
          {session?.slice ? (
            <div className="mt-2 space-y-2 rounded-2xl bg-slate-50 px-3 py-2 text-xs text-slate-700">
              <div>G-code: {session.slice.gcodePath ? <a className="text-emerald-700 underline" href={session.slice.gcodePath} download>下载</a> : '待生成'}</div>
              <div>STL: {session.slice.stlPath ? <a className="text-emerald-700 underline" href={session.slice.stlPath} download>下载</a> : '待生成'}</div>
              <div>预估时长: {session.slice.estimatedTime || '未解析'}</div>
              <div>耗材: {session.slice.filament || '未解析'}</div>
            </div>
          ) : (
            <div className="mt-2 rounded-2xl bg-slate-50 px-3 py-2 text-sm text-slate-500">待切片</div>
          )}
          <h3 className="mt-5 font-semibold">累积约束</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600">
            {session?.constraints.length ? session.constraints.map((c) => <li key={c}>{c}</li>) : <li>暂无</li>}
          </ul>
        </aside>
      </section>
    </main>
  );
}

function ModelCard({ src, repaired, latest }: { src: string; repaired: boolean; latest: boolean }) {
  return (
    <div className={`mb-2 overflow-hidden rounded-2xl bg-white p-2 text-slate-900 shadow-sm ring-1 ${latest ? 'ring-emerald-300' : 'opacity-70 ring-slate-200'}`}>
      <div className="mb-2 text-xs font-medium text-slate-600">{latest ? '最新 3D 预览（可确认）' : '旧轮次 3D 预览（仅供回看）'}</div>
      {createElement('model-viewer', { src, alt: '3D 模型预览', 'camera-controls': latest, 'auto-rotate': latest, 'shadow-intensity': '0.7', exposure: '1', style: { width: '100%', height: latest ? 360 : 220, background: '#f8fafc', borderRadius: 14 } })}
      <div className="mt-2 text-xs text-slate-600">打印将使用{repaired ? '修复后的几何' : '当前几何'}；此处展示原始带材质 GLB 供外观确认。</div>
    </div>
  );
}

function SliceCard({ slice }: { slice: NonNullable<Session['slice']> }) {
  const warnings = slice.warnings?.length ? slice.warnings : ['无警告'];
  return (
    <div className="mb-2 rounded-2xl bg-white p-4 text-slate-900 shadow-sm ring-1 ring-emerald-200">
      <div className="font-semibold text-emerald-700">切片完成</div>
      <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
        <div>预估时长：{slice.estimatedTime || '未解析'}</div>
        <div>耗材：{slice.filament || '未解析'}</div>
        <div>尺寸：{slice.normalize?.actualExtentsMm?.join(' × ') || '未解析'} mm</div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {slice.gcodePath && <a className="rounded-xl bg-emerald-600 px-3 py-2 text-sm font-medium text-white" href={slice.gcodePath} download>下载 G-code</a>}
        {slice.stlPath && <a className="rounded-xl bg-slate-800 px-3 py-2 text-sm font-medium text-white" href={slice.stlPath} download>下载 STL</a>}
      </div>
      <div className="mt-3 text-sm">
        <div className="font-medium">警告</div>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-slate-700">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
      </div>
    </div>
  );
}

function Brief({ label, value }: { label: string; value?: string }) {
  return <div className="flex justify-between gap-3"><dt className="text-slate-500">{label}</dt><dd className="text-right font-medium text-slate-800">{value || '待补充'}</dd></div>;
}
