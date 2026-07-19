'use client';

import { useEffect, useMemo, useState } from 'react';
import { BadgeCheck, Ban, Calculator, Clock3 } from 'lucide-react';
import Link from 'next/link';
import type { CustomizationRequestResponse } from '@petscape/server/contracts/customization-requests';
import type { CheckRunResponse } from '@petscape/server/contracts/check-runs';
import type { QuoteResponse } from '@petscape/server/contracts/quotes';

class ApiError extends Error {}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(typeof data?.detail === 'string' ? data.detail : `请求失败（${response.status}）`);
  return data as T;
}

function key(prefix: string) {
  return `${prefix}-${typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : Date.now()}`;
}

const statusLabel: Record<QuoteResponse['status'], string> = {
  active: '有效', accepted: '已接受', expired: '已过期', superseded: '已替代', canceled: '已取消',
};

export function QuotesClient() {
  const [requests, setRequests] = useState<CustomizationRequestResponse[]>([]);
  const [checks, setChecks] = useState<CheckRunResponse[]>([]);
  const [quotes, setQuotes] = useState<QuoteResponse[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function load() {
    const [requestData, checkData, quoteData] = await Promise.all([
      api<{ requests: CustomizationRequestResponse[] }>('/api/v1/commerce/customization-requests'),
      api<{ checkRuns: CheckRunResponse[] }>('/api/v1/commerce/check-runs'),
      api<{ quotes: QuoteResponse[] }>('/api/v1/commerce/quotes'),
    ]);
    setRequests(requestData.requests); setChecks(checkData.checkRuns); setQuotes(quoteData.quotes);
  }

  useEffect(() => {
    let active = true;
    Promise.all([
      api<{ requests: CustomizationRequestResponse[] }>('/api/v1/commerce/customization-requests'),
      api<{ checkRuns: CheckRunResponse[] }>('/api/v1/commerce/check-runs'),
      api<{ quotes: QuoteResponse[] }>('/api/v1/commerce/quotes'),
    ]).then(([requestData, checkData, quoteData]) => {
      if (active) {
        setRequests(requestData.requests); setChecks(checkData.checkRuns); setQuotes(quoteData.quotes);
      }
    }).catch((caught) => {
      if (active) setError(caught instanceof Error ? caught.message : '读取失败');
    });
    return () => { active = false; };
  }, []);

  const eligible = useMemo(() => requests.filter((request) => request.status === 'submitted' && checks.some(
    (check) => check.requestId === request.id && check.status === 'completed' && check.result === 'approved',
  ) && !quotes.some((quote) => quote.requestId === request.id)), [requests, checks, quotes]);

  async function createFor(request: CustomizationRequestResponse) {
    setBusyId(request.id); setError(null); setNotice('正在运行服务端网格分析…');
    try {
      const queued = await api<{ estimateJobId: string }>('/api/v1/commerce/estimates', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sceneConfirmationId: request.sceneConfirmation.sceneConfirmationId }),
      });
      let ready = false;
      for (let attempt = 0; attempt < 90; attempt += 1) {
        const estimate = await api<{ status: string; detail?: string }>(`/api/v1/commerce/estimates/${queued.estimateJobId}`);
        if (estimate.status === 'ready') { ready = true; break; }
        if (estimate.status === 'failed') throw new ApiError(estimate.detail ?? '网格分析失败');
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
      }
      if (!ready) throw new ApiError('网格分析仍在运行，请稍后重试');
      await api<QuoteResponse>('/api/v1/commerce/quotes', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          requestId: request.id, estimateJobId: queued.estimateJobId,
          idempotencyKey: key('c2-ui'), quoteMode: 'sandbox_test',
        }),
      });
      await load();
      setNotice('沙箱测试报价已生成。金额来自服务端快照，不能用于真实支付。');
    } catch (caught) { setError(caught instanceof Error ? caught.message : '报价生成失败'); }
    finally { setBusyId(null); }
  }

  async function transition(quote: QuoteResponse, action: 'accept' | 'cancel') {
    setBusyId(quote.id); setError(null);
    try {
      await api(`/api/v1/commerce/quotes/${quote.id}/${action}`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ expectedStatus: 'active' }),
      });
      await load();
      setNotice(action === 'accept' ? '已接受沙箱测试报价；支付入口仍关闭。' : '沙箱测试报价已取消。');
    } catch (caught) { setError(caught instanceof Error ? caught.message : '状态更新失败'); }
    finally { setBusyId(null); }
  }

  return <div className="psx-page psx-quote-page psx-fade-up">
    <header className="psx-request-heading">
      <div><span className="psx-dot-label">Sandbox quote</span><h1 className="psx-page-title">测试报价</h1>
        <p>仅消费审核通过与完整服务端分析；金额、材料和规则均冻结为不可变快照。</p></div>
      <span className="psx-sandbox-badge">沙箱 · 不可真实支付</span>
    </header>
    {error ? <div className="psx-request-alert is-error" role="alert">{error}</div> : null}
    {notice ? <div className="psx-request-alert" role="status">{notice}</div> : null}
    <section className="psx-quote-eligible">
      <div className="psx-request-history-heading"><div><span className="psx-dot-label">Approved input</span><h2>可生成报价的申请</h2></div><span>{eligible.length} 条</span></div>
      {eligible.length === 0 ? <div className="psx-request-empty">尚无 completed + approved 的申请。</div> : eligible.map((request) =>
        <article className="psx-quote-source" key={request.id}>
          <div><strong>{request.productCode}</strong><span>{request.materialName}</span><small>{request.sceneConfirmation.dimensionsMm.x} × {request.sceneConfirmation.dimensionsMm.y} × {request.sceneConfirmation.dimensionsMm.z} mm</small></div>
          <button className="psx-btn-primary" disabled={busyId !== null} onClick={() => createFor(request)}><Calculator size={16}/>{busyId === request.id ? '分析中…' : '生成沙箱测试报价'}</button>
        </article>)}
    </section>
    <section className="psx-quote-history">
      <div className="psx-request-history-heading"><div><span className="psx-dot-label">Immutable history</span><h2>报价历史</h2></div><span>{quotes.length} 条</span></div>
      {quotes.length === 0 ? <div className="psx-request-empty">尚无报价。</div> : <div className="psx-quote-grid">{quotes.map((quote) =>
        <article className={`psx-quote-card is-${quote.status}`} key={quote.id}>
          <header><span>{statusLabel[quote.status]}</span><small>{quote.label}</small></header>
          <div className="psx-quote-money"><small>含税一口价</small><strong>¥{(quote.amountCent / 100).toFixed(2)}</strong></div>
          <dl><div><dt>材料</dt><dd>{quote.materialName}</dd></div><div><dt>规则</dt><dd>{quote.pricingRuleVersion}</dd></div><div><dt>有效期</dt><dd>{new Date(quote.expiresAt).toLocaleString('zh-CN')}</dd></div></dl>
          <p><Clock3 size={14}/>{quote.deliveryEstimate.label}</p>
          {quote.status === 'active' ? <div className="psx-quote-actions">
            <button disabled={busyId !== null} onClick={() => transition(quote, 'accept')}><BadgeCheck size={15}/>接受测试报价</button>
            <button disabled={busyId !== null} onClick={() => transition(quote, 'cancel')}><Ban size={15}/>取消</button>
          </div> : quote.status === 'accepted' ? <div className="psx-quote-actions">
            <Link href="/checkout">填写并确认配送地址</Link>
          </div> : null}
        </article>)}</div>}
    </section>
  </div>;
}
