'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, BadgeCheck, Ban, BedDouble, Calculator, Check } from 'lucide-react';
import type { CustomizationRequestResponse } from '@petscape/server/contracts/customization-requests';
import type { CheckRunResponse } from '@petscape/server/contracts/check-runs';
import type { SandboxEstimateResponse } from '@petscape/server/contracts/commerce-estimates';
import type { QuoteResponse } from '@petscape/server/contracts/quotes';
import { formatRoundedDimensionsMm } from '../../lib/display-format';
import { getViewerAsset } from '../../lib/viewer/catalog';

type ReadyEstimate = Extract<SandboxEstimateResponse, { status: 'ready' }>;

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

function formatMoney(amountCent: number, decimals = true) {
  return new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: decimals ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(amountCent / 100);
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

const statusLabel: Record<QuoteResponse['status'], string> = {
  active: '有效',
  accepted: '已接受',
  expired: '已过期',
  superseded: '已替代',
  canceled: '已取消',
};

export function QuotesClient() {
  const [requests, setRequests] = useState<CustomizationRequestResponse[]>([]);
  const [checks, setChecks] = useState<CheckRunResponse[]>([]);
  const [quotes, setQuotes] = useState<QuoteResponse[]>([]);
  const [estimateDetails, setEstimateDetails] = useState<Record<string, ReadyEstimate | null>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function loadEstimateDetails(nextQuotes: QuoteResponse[]) {
    const entries = await Promise.all(nextQuotes.map(async (quote) => {
      try {
        const estimate = await api<SandboxEstimateResponse>(`/api/v1/commerce/estimates/${quote.estimateJobId}`);
        return [quote.id, estimate.status === 'ready' ? estimate : null] as const;
      } catch {
        return [quote.id, null] as const;
      }
    }));
    setEstimateDetails(Object.fromEntries(entries));
  }

  async function load() {
    const [requestData, checkData, quoteData] = await Promise.all([
      api<{ requests: CustomizationRequestResponse[] }>('/api/v1/commerce/customization-requests'),
      api<{ checkRuns: CheckRunResponse[] }>('/api/v1/commerce/check-runs'),
      api<{ quotes: QuoteResponse[] }>('/api/v1/commerce/quotes'),
    ]);
    setRequests(requestData.requests);
    setChecks(checkData.checkRuns);
    setQuotes(quoteData.quotes);
    await loadEstimateDetails(quoteData.quotes);
  }

  useEffect(() => {
    let active = true;
    Promise.all([
      api<{ requests: CustomizationRequestResponse[] }>('/api/v1/commerce/customization-requests'),
      api<{ checkRuns: CheckRunResponse[] }>('/api/v1/commerce/check-runs'),
      api<{ quotes: QuoteResponse[] }>('/api/v1/commerce/quotes'),
    ]).then(async ([requestData, checkData, quoteData]) => {
      if (!active) return;
      setRequests(requestData.requests);
      setChecks(checkData.checkRuns);
      setQuotes(quoteData.quotes);
      const entries = await Promise.all(quoteData.quotes.map(async (quote) => {
        try {
          const estimate = await api<SandboxEstimateResponse>(`/api/v1/commerce/estimates/${quote.estimateJobId}`);
          return [quote.id, estimate.status === 'ready' ? estimate : null] as const;
        } catch {
          return [quote.id, null] as const;
        }
      }));
      if (active) setEstimateDetails(Object.fromEntries(entries));
    }).catch((caught) => {
      if (active) setError(caught instanceof Error ? caught.message : '读取失败');
    });
    return () => {
      active = false;
    };
  }, []);

  const eligible = useMemo(() => requests.filter((request) => request.status === 'submitted' && checks.some(
    (check) => check.requestId === request.id && check.status === 'completed' && check.result === 'approved',
  ) && !quotes.some((quote) => quote.requestId === request.id)), [requests, checks, quotes]);

  async function createFor(request: CustomizationRequestResponse) {
    setBusyId(request.id);
    setError(null);
    setNotice('正在分析模型并计算测试报价…');
    try {
      const queued = await api<{ estimateJobId: string }>('/api/v1/commerce/estimates', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sceneConfirmationId: request.sceneConfirmation.sceneConfirmationId }),
      });
      let ready = false;
      for (let attempt = 0; attempt < 90; attempt += 1) {
        const estimate = await api<{ status: string; detail?: string }>(`/api/v1/commerce/estimates/${queued.estimateJobId}`);
        if (estimate.status === 'ready') {
          ready = true;
          break;
        }
        if (estimate.status === 'failed') throw new ApiError(estimate.detail ?? '模型分析失败');
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
      }
      if (!ready) throw new ApiError('模型分析仍在运行，请稍后重试');
      await api<QuoteResponse>('/api/v1/commerce/quotes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          requestId: request.id,
          estimateJobId: queued.estimateJobId,
          idempotencyKey: key('c2-ui'),
          quoteMode: 'sandbox_test',
        }),
      });
      await load();
      setNotice('测试报价已生成。金额来自服务端保存的本次快照，不能用于真实支付。');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '报价生成失败');
    } finally {
      setBusyId(null);
    }
  }

  async function transition(quote: QuoteResponse, action: 'accept' | 'cancel') {
    setBusyId(quote.id);
    setError(null);
    try {
      await api(`/api/v1/commerce/quotes/${quote.id}/${action}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ expectedStatus: 'active' }),
      });
      await load();
      setNotice(action === 'accept'
        ? '已接受测试报价。下一步确认配送地址，再创建沙箱支付意图。'
        : '测试报价已取消。');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '状态更新失败');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="psx-page psx-quote-page psx-fade-up">
      <header className="psx-request-heading">
        <div><span className="psx-dot-label">定制流程 · 报价</span><h1 className="psx-page-title">测试报价</h1><p>审核通过的申请可以生成一份测试报价。金额、材料和规则会被保存，直到过期或被接受。</p></div>
        <span className="psx-sandbox-badge">沙箱 · 不可真实支付</span>
      </header>
      {error ? <div className="psx-request-alert is-error" role="alert">{error}</div> : null}
      {notice ? <div className="psx-request-alert" role="status">{notice}</div> : null}

      <section className="psx-quote-section">
        <div className="psx-request-history-heading"><div><span className="psx-dot-label">审核已通过</span><h2>可生成报价的申请</h2></div><span>{eligible.length} 条</span></div>
        {eligible.length === 0 ? <div className="psx-quote-empty"><span>还没有通过审核的申请。<br />先在定制申请里提交，审核通过后会出现在这里。</span><Link href="/requests">前往定制申请 <ArrowRight size={13} /></Link></div> : (
          <div className="psx-quote-sources">{eligible.map((request) => {
            const approval = checks.find((check) => check.requestId === request.id && check.result === 'approved');
            return <article className="psx-quote-source" key={request.id}>
              <span className="psx-quote-source-icon"><BedDouble size={25} /></span>
              <div className="psx-quote-source-main"><div><strong>{getViewerAsset(request.productCode).label}</strong><small>{request.productCode}</small></div><p>{request.materialName.replace('（沙箱）', '')}　·　{formatRoundedDimensionsMm(request.sceneConfirmation.dimensionsMm)}　·　<span><Check size={11} />{approval?.completedAt ? `${new Date(approval.completedAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}审核通过` : '审核通过'}</span></p></div>
              <button className="psx-btn-primary" disabled={busyId !== null} onClick={() => createFor(request)}><Calculator size={16} />{busyId === request.id ? '分析中…' : '生成测试报价'}</button>
            </article>;
          })}</div>
        )}
      </section>

      <section className="psx-quote-section psx-quote-history">
        <div className="psx-request-history-heading"><div><span className="psx-dot-label">金额与规则已冻结</span><h2>报价历史</h2></div><span>{quotes.length} 份</span></div>
        {quotes.length === 0 ? <div className="psx-quote-empty"><span>还没有生成过报价。</span></div> : <div className="psx-quote-grid">{quotes.map((quote) => {
          const estimate = estimateDetails[quote.id];
          const calculatedCent = estimate ? Math.round((estimate.materialCostCent + estimate.baseFeeCent) * Number(estimate.multiplier)) : null;
          return <article className={`psx-quote-card is-${quote.status}`} key={quote.id}>
            <header><span className={`psx-quote-status is-${quote.status}`}>{statusLabel[quote.status]}</span><small>{formatDate(quote.createdAt)} 生成</small></header>
            <div className="psx-quote-money"><small>含税一口价</small><strong><i>¥</i>{formatMoney(quote.amountCent, false)}</strong></div>
            <dl className="psx-quote-breakdown">
              <div><dt>材料成本<small>{quote.materialName.replace('（沙箱）', '')}{estimate ? ` · 约 ${Math.round(Number(estimate.weightGrams))} g` : ''}</small></dt><dd>{estimate ? `¥${formatMoney(estimate.materialCostCent)}` : '已保存'}</dd></div>
              <div><dt>基础制作费</dt><dd>{estimate ? `¥${formatMoney(estimate.baseFeeCent)}` : '已保存'}</dd></div>
              <div><dt>定制系数{estimate ? ` ×${estimate.multiplier}` : ''}</dt><dd>{calculatedCent === null ? '已保存' : `¥${formatMoney(calculatedCent)}`}</dd></div>
              <div className="is-total"><dt>向上取整到整元</dt><dd>¥{formatMoney(quote.amountCent)}</dd></div>
            </dl>
            {quote.status === 'active' ? <div className="psx-quote-meta"><strong>{formatDate(quote.expiresAt)} 前有效</strong> · {quote.deliveryEstimate.label}。这是沙箱测试报价，金额来自服务端快照，不能用于真实支付。</div> : null}
            {quote.status === 'accepted' ? <div className="psx-quote-meta is-accepted">报价已接受。配送地址、支付意图与支付结果都只在沙箱中流转，不会真实扣款、生产或配送。</div> : null}
            {quote.status === 'expired' ? <p className="psx-quote-expired-note">有效期已结束。金额保留作参考，需要时可在上方重新生成。</p> : null}
            {quote.status === 'superseded' ? <p className="psx-quote-expired-note">这份报价已被新报价替代，金额只作历史参考。</p> : null}
            {quote.status === 'canceled' ? <p className="psx-quote-expired-note">这份报价已取消，金额只作历史参考。</p> : null}
            {quote.status === 'active' ? <div className="psx-quote-actions"><button className="psx-btn-primary" disabled={busyId !== null} onClick={() => transition(quote, 'accept')}><BadgeCheck size={15} />接受测试报价</button><button className="psx-linklike" disabled={busyId !== null} onClick={() => transition(quote, 'cancel')}><Ban size={14} />放弃这份报价</button></div> : null}
            {quote.status === 'accepted' ? <div className="psx-quote-payment-entry"><div><strong>继续沙箱支付</strong><span>确认配送地址 → 创建支付意图 → 沙箱支付页</span></div><Link className="psx-btn-ghost" href="/checkout">填写并确认配送地址 <ArrowRight size={14} /></Link></div> : null}
          </article>;
        })}</div>}
      </section>
      <p className="psx-page-footnote">PETSCAPE · 测试报价 / 沙箱验证环境</p>
    </div>
  );
}
