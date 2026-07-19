'use client';

import { useEffect, useState } from 'react';
import { ClipboardCheck, RefreshCcw, ShieldCheck } from 'lucide-react';
import type { CheckRunResponse, CheckRunRequestSnapshot } from '@petscape/server/contracts/check-runs';
import { formatDimensionsMm } from '../../../lib/display-format';
import { getViewerAsset } from '../../../lib/viewer/catalog';

type Candidate = { request: CheckRunRequestSnapshot; checkRun: CheckRunResponse | null; canComplete: boolean };
type DecisionDraft = { result: 'approved' | 'rejected' | 'uncertain'; issues: string; suggestions: string; evidence: string; note: string };

const emptyDecision: DecisionDraft = { result: 'uncertain', issues: '', suggestions: '', evidence: '', note: '' };
const resultLabel = { approved: '通过', rejected: '拒绝', uncertain: '不确定' } as const;

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.detail ?? `请求失败（${response.status}）`);
  return data as T;
}

function lines(value: string) {
  return value.split('\n').map((line) => line.trim()).filter(Boolean);
}

export function AdminReviewsClient() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [drafts, setDrafts] = useState<Record<string, DecisionDraft>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const data = await api<{ candidates: Candidate[] }>('/api/v1/admin/check-runs');
    setCandidates(data.candidates);
  }

  useEffect(() => {
    let active = true;
    api<{ candidates: Candidate[] }>('/api/v1/admin/check-runs')
      .then((data) => { if (active) setCandidates(data.candidates); })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : '审核队列读取失败'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function act(requestId: string, path: string, body?: unknown) {
    setBusy(requestId);
    setError(null);
    try {
      await api(path, { method: 'POST', ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '审核操作失败');
    } finally {
      setBusy(null);
    }
  }

  async function complete(candidate: Candidate) {
    if (!candidate.checkRun) return;
    const draft = drafts[candidate.request.customizationRequestId] ?? emptyDecision;
    await act(candidate.request.customizationRequestId, `/api/v1/admin/check-runs/${candidate.checkRun.id}/complete`, {
      result: draft.result,
      issues: lines(draft.issues),
      evidence: draft.evidence.trim() ? [{ kind: 'note', ref: 'manual://sandbox-review', summary: draft.evidence.trim() }] : [],
      adjustmentSuggestions: lines(draft.suggestions),
      note: draft.note.trim() || null,
    });
  }

  return (
    <div className="psx-page b6-page psx-fade-up">
      <header className="b6-heading">
        <div><span className="psx-dot-label">管理员审核</span><h1>沙箱人工审核台</h1><p>检查结论会保存输入快照，但不会生成真实报价、支付或订单。</p></div>
        <span className="psx-sandbox-badge"><ShieldCheck size={15} /> 仅管理员 · 沙箱环境</span>
      </header>
      {error ? <div className="b6-alert" role="alert">{error}</div> : null}
      <div className="b6-toolbar"><button type="button" onClick={() => load()}><RefreshCcw size={15} /> 刷新队列</button><span>{candidates.length} 条 submitted 申请</span></div>
      {loading ? <div className="b6-empty">正在读取审核队列…</div> : candidates.length === 0 ? <div className="b6-empty">暂无待处理申请。</div> : (
        <div className="b6-list">
          {candidates.map((candidate) => {
            const id = candidate.request.customizationRequestId;
            const run = candidate.checkRun;
            const draft = drafts[id] ?? emptyDecision;
            return <article className="b6-card" key={id}>
              <header><div><span className="psx-dot-label">定制申请</span><h2>{candidate.request.contactName} · {candidate.request.contactPhone}</h2></div><ClipboardCheck size={22} /></header>
              <p>{candidate.request.usageDescription}</p>
              {candidate.request.additionalRequirements ? <p className="b6-secondary">补充：{candidate.request.additionalRequirements}</p> : null}
              <dl><div><dt>商品 / 材料</dt><dd>{getViewerAsset(candidate.request.productCode).label} / {candidate.request.materialName}</dd></div><div><dt>资产</dt><dd>{candidate.request.sceneConfirmation.assetRef.kind} · {candidate.request.sceneConfirmation.assetRef.sha256.slice(0, 12)}…</dd></div><div><dt>最终尺寸</dt><dd>{formatDimensionsMm(candidate.request.sceneConfirmation.dimensionsMm)}</dd></div><div><dt>规则</dt><dd>fdm-manual-sandbox-v0</dd></div></dl>
              {!run ? <button disabled={busy === id} onClick={() => act(id, '/api/v1/admin/check-runs', { requestId: id })}>加入审核队列</button> : null}
              {run?.status === 'queued' ? <button disabled={busy === id} onClick={() => act(id, `/api/v1/admin/check-runs/${run.id}/start`)}>认领并开始审核</button> : null}
              {run?.status === 'in_review' && candidate.canComplete ? <div className="b6-decision">
                <label>结论<select value={draft.result} onChange={(event) => setDrafts({ ...drafts, [id]: { ...draft, result: event.target.value as DecisionDraft['result'] } })}><option value="approved">通过</option><option value="rejected">拒绝</option><option value="uncertain">不确定</option></select></label>
                <label>发现的问题（每行一项）<textarea value={draft.issues} onChange={(event) => setDrafts({ ...drafts, [id]: { ...draft, issues: event.target.value } })} /></label>
                <label>证据摘要<textarea value={draft.evidence} onChange={(event) => setDrafts({ ...drafts, [id]: { ...draft, evidence: event.target.value } })} /></label>
                <label>调整建议（每行一项）<textarea value={draft.suggestions} onChange={(event) => setDrafts({ ...drafts, [id]: { ...draft, suggestions: event.target.value } })} /></label>
                <label>审核说明<textarea value={draft.note} onChange={(event) => setDrafts({ ...drafts, [id]: { ...draft, note: event.target.value } })} /></label>
                <button disabled={busy === id} onClick={() => complete(candidate)}>完成沙箱审核</button>
              </div> : null}
              {run?.status === 'in_review' && !candidate.canComplete ? <p className="b6-boundary">已由其他审核员认领；当前账号只能查看，不能提交结论。</p> : null}
              {run?.status === 'completed' && run.result ? <div className={`b6-result is-${run.result}`}><strong>{resultLabel[run.result]}</strong><span>{run.note ?? '审核已完成'}</span></div> : null}
              <p className="b6-boundary">审核记录与申请状态彼此独立；只有审核完成且通过的申请才能进入后续报价流程。</p>
            </article>;
          })}
        </div>
      )}
    </div>
  );
}
