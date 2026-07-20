'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowRight, BedDouble, Check, RefreshCcw, Send } from 'lucide-react';
import type { CustomizationRequestResponse } from '@petscape/server/contracts/customization-requests';
import type { CheckRunResponse } from '@petscape/server/contracts/check-runs';
import { formatRoundedDimensionsMm } from '../../lib/display-format';

type FormState = {
  contactName: string;
  contactPhone: string;
  usageDescription: string;
  additionalRequirements: string;
};

const emptyForm: FormState = {
  contactName: '',
  contactPhone: '',
  usageDescription: '',
  additionalRequirements: '',
};

const statusLabel: Record<CustomizationRequestResponse['status'], string> = {
  draft: '草稿',
  submitted: '已提交',
  superseded: '已被新版本替代',
  canceled: '已取消',
};

const reviewLabel = { queued: '等待审核', in_review: '审核中', completed: '审核完成' } as const;
const reviewResultLabel = { approved: '审核通过', rejected: '审核未通过', uncertain: '需要进一步确认' } as const;

class RequestApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RequestApiError';
  }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = typeof data?.detail === 'string' ? data.detail : null;
    const issue = Array.isArray(data?.issues) && typeof data.issues[0]?.message === 'string'
      ? data.issues[0].message
      : null;
    throw new RequestApiError(detail ?? issue ?? `请求失败（${response.status}）`);
  }
  return data as T;
}

function nextIdempotencyKey() {
  return typeof crypto.randomUUID === 'function'
    ? `c1-ui-${crypto.randomUUID()}`
    : `c1-ui-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatDate(value: string) {
  return new Date(value).toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function CustomizationRequestsClient({
  sandboxSceneConfirmationId,
}: {
  sandboxSceneConfirmationId: string;
}) {
  const [requests, setRequests] = useState<CustomizationRequestResponse[]>([]);
  const [checkRuns, setCheckRuns] = useState<CheckRunResponse[]>([]);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [supersedesRequestId, setSupersedesRequestId] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(nextIdempotencyKey);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function loadRequests() {
    const [requestData, checkData] = await Promise.all([
      api<{ requests: CustomizationRequestResponse[] }>('/api/v1/commerce/customization-requests'),
      api<{ checkRuns: CheckRunResponse[] }>('/api/v1/commerce/check-runs'),
    ]);
    setRequests(requestData.requests);
    setCheckRuns(checkData.checkRuns);
  }

  useEffect(() => {
    let active = true;
    Promise.all([
      api<{ requests: CustomizationRequestResponse[] }>('/api/v1/commerce/customization-requests'),
      api<{ checkRuns: CheckRunResponse[] }>('/api/v1/commerce/check-runs'),
    ])
      .then(([requestData, checkData]) => {
        if (active) {
          setRequests(requestData.requests);
          setCheckRuns(checkData.checkRuns);
        }
      })
      .catch((caught: unknown) => {
        if (active) setError(caught instanceof Error ? caught.message : '申请读取失败');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  function beginResubmission(request: CustomizationRequestResponse) {
    setForm({
      contactName: request.contactName,
      contactPhone: request.contactPhone,
      usageDescription: request.usageDescription,
      additionalRequirements: request.additionalRequirements ?? '',
    });
    setSupersedesRequestId(request.id);
    setIdempotencyKey(nextIdempotencyKey());
    setError(null);
    setNotice('正在基于旧申请创建新版本；旧内容仍会留在历史里。');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function cancelResubmission() {
    setSupersedesRequestId(null);
    setForm(emptyForm);
    setIdempotencyKey(nextIdempotencyKey());
    setNotice(null);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await api<CustomizationRequestResponse>('/api/v1/commerce/customization-requests', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sceneConfirmationId: sandboxSceneConfirmationId,
          idempotencyKey,
          contactName: form.contactName,
          contactPhone: form.contactPhone,
          usageDescription: form.usageDescription,
          additionalRequirements: form.additionalRequirements.trim() || null,
          ...(supersedesRequestId ? { supersedesRequestId } : {}),
        }),
      });
      await loadRequests();
      setForm(emptyForm);
      setSupersedesRequestId(null);
      setIdempotencyKey(nextIdempotencyKey());
      setNotice('申请已提交。它不会生成真实报价、支付或订单。');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '提交失败，请稍后重试');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="psx-page psx-request-page psx-fade-up">
      <header className="psx-request-heading">
        <div><span className="psx-dot-label">定制流程 · 提交申请</span><h1 className="psx-page-title">定制申请</h1><p>留下用途和联系方式，这次确认的模型与尺寸会一并存档，供人工审核。</p></div>
        <span className="psx-sandbox-badge">沙箱 · 不会真实交易</span>
      </header>

      <div className="psx-request-layout">
        <form className="psx-request-form" onSubmit={submit}>
          <span className="psx-request-section-label">本 次 申 请 对 象</span>
          <div className="psx-request-object-card">
            <span className="psx-request-object-icon"><BedDouble size={25} /></span>
            <div><div className="psx-request-object-name"><strong>奶酪软垫小床</strong><small>cheese-lounge-bed</small></div><p>PETG · 奶酪黄　·　{formatRoundedDimensionsMm({ x: 120, y: 119.022, z: 53.865 })}</p><p>来自 7 月 18 日的场景确认</p></div>
          </div>
          <p className="psx-request-object-boundary">尺寸按毫米取整显示。确认场景不代表可制造、适合宠物使用或已生成报价。</p>

          {supersedesRequestId ? <div className="psx-request-version-note">正在修改并重提。旧版本仍会保留。<button type="button" onClick={cancelResubmission}>取消重提</button></div> : null}

          <div className="psx-request-two-fields">
            <label><span>联系人</span><input required maxLength={80} autoComplete="name" value={form.contactName} onChange={(event) => setForm({ ...form, contactName: event.target.value })} placeholder="怎么称呼你" /></label>
            <label><span>联系电话</span><input required minLength={6} maxLength={32} inputMode="tel" autoComplete="tel" value={form.contactPhone} onChange={(event) => setForm({ ...form, contactPhone: event.target.value })} placeholder="手机号或联系电话" /></label>
          </div>
          <label><span>使用说明</span><textarea required maxLength={2000} rows={5} value={form.usageDescription} onChange={(event) => setForm({ ...form, usageDescription: event.target.value })} placeholder="宠物、摆放环境和预期用途" /></label>
          <label><span>补充要求 <small>选填</small></span><textarea maxLength={2000} rows={4} value={form.additionalRequirements} onChange={(event) => setForm({ ...form, additionalRequirements: event.target.value })} placeholder="例如入口边缘、清洁习惯等" /></label>

          {error ? <div className="psx-request-alert is-error" role="alert">{error}</div> : null}
          {notice ? <div className="psx-request-alert" role="status">{notice}</div> : null}

          <button className="psx-btn-primary psx-request-submit" type="submit" disabled={saving}><Send size={17} />{saving ? '正在提交…' : supersedesRequestId ? '提交新版本' : '提交申请'}</button>
          <p className="psx-request-disclaimer">提交后进入人工审核。提交与场景确认不代表可制造、适合宠物使用或已生成报价；当前为沙箱环境，不会产生真实交易。</p>
        </form>

        <section className="psx-request-history" aria-label="申请历史">
          <div className="psx-request-history-heading"><div><span className="psx-dot-label">历次版本</span><h2>申请历史</h2></div><span>{requests.length} 条</span></div>
          {loading ? <div className="psx-request-empty">正在读取申请…</div> : requests.length === 0 ? <div className="psx-request-empty">还没有申请。提交后，这里会保留每一次修改。</div> : (
            <div className="psx-request-list">{requests.map((request) => {
              const review = checkRuns.find((checkRun) => checkRun.requestId === request.id);
              return <article key={request.id} className={`psx-request-item is-${request.status}`}>
                <header><span className={`psx-request-status is-${request.status}`}>{statusLabel[request.status]}</span><time>{formatDate(request.submittedAt)}</time></header>
                <h3>{request.contactName} · {request.contactPhone}</h3>
                <p>{request.usageDescription}</p>
                {request.additionalRequirements ? <p className="is-secondary">补充：{request.additionalRequirements}</p> : null}
                {review ? <div className={`psx-review-box is-${review.result ?? review.status}`}>
                  <strong>{review.result ? reviewResultLabel[review.result] : reviewLabel[review.status]}</strong>
                  {review.issues.length > 0 ? <span>需要注意：{review.issues.join('；')}</span> : null}
                  {review.adjustmentSuggestions.length > 0 ? <span>调整建议：{review.adjustmentSuggestions.join('；')}</span> : null}
                  {review.note ? <span>{review.note}</span> : null}
                  {review.result === 'approved' ? <Link href="/quotes">去生成测试报价 <ArrowRight size={13} /></Link> : null}
                </div> : <div className="psx-review-box"><strong>等待审核</strong><span>审核通过后可以生成测试报价。</span></div>}
                {request.status === 'submitted' ? <button type="button" onClick={() => beginResubmission(request)}><RefreshCcw size={14} />修改并重提</button> : null}
                {request.status === 'superseded' ? <span className="psx-request-superseded-note"><Check size={13} />旧内容已保留</span> : null}
              </article>;
            })}</div>
          )}
        </section>
      </div>
      <p className="psx-page-footnote">PETSCAPE · 定制申请 / 沙箱验证环境</p>
    </div>
  );
}
