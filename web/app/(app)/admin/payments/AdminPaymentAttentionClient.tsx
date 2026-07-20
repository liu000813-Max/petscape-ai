'use client';

import { useEffect, useState } from 'react';
import { RefreshCcw, ShieldAlert } from 'lucide-react';
import type { AdminPaymentAttentionItem } from '@petscape/server/contracts/payments';

const reasonLabel = {
  amount_mismatch: '渠道金额与支付意图不一致',
  stale_succeeded_attempt: '旧支付尝试迟到成功',
  provider_state_conflict: '渠道状态与本地状态冲突',
  unspecified: '原因尚未归类',
} as const;

async function readQueue() {
  const response = await fetch('/api/v1/admin/payment-attention');
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.detail ?? `读取失败（${response.status}）`);
  return data.items as AdminPaymentAttentionItem[];
}

export function AdminPaymentAttentionClient() {
  const [items, setItems] = useState<AdminPaymentAttentionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    try { setItems(await readQueue()); }
    catch (caught) { setError(caught instanceof Error ? caught.message : '支付异常读取失败'); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    let active = true;
    readQueue()
      .then((next) => { if (active) setItems(next); })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : '支付异常读取失败'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  return <div className="psx-page psx-admin-payments psx-fade-up">
    <header className="psx-admin-payments-heading">
      <div><span className="psx-dot-label">只读异常队列</span><h1>沙箱支付异常</h1><p>这里只暴露可信事件产生的人工关注原因，不提供资金状态改写或强制建单。</p></div>
      <span className="psx-sandbox-badge"><ShieldAlert size={15}/> 仅管理员 · 只读</span>
    </header>
    <div className="psx-admin-payments-toolbar"><button type="button" onClick={() => void load()}><RefreshCcw size={15}/>刷新</button><span>{items.length} 条</span></div>
    {error ? <div role="alert" className="psx-request-alert is-error">{error}</div> : null}
    {loading ? <div className="psx-admin-payments-empty">正在读取异常队列…</div> : items.length === 0 ? <div className="psx-admin-payments-empty">暂无需要人工关注的支付。</div> : <div className="psx-admin-payments-list">{items.map(({ ownerUserId, paymentIntent }) => {
      const code = paymentIntent.attentionCode ?? 'unspecified';
      return <article key={paymentIntent.id}>
        <header><strong>{reasonLabel[code]}</strong><code>{code}</code></header>
        <dl><div><dt>PaymentIntent</dt><dd>{paymentIntent.id}</dd></div><div><dt>用户</dt><dd>{ownerUserId}</dd></div><div><dt>金额</dt><dd>¥{(paymentIntent.amountCent / 100).toFixed(2)}</dd></div><div><dt>尝试</dt><dd>{paymentIntent.attempts.length}</dd></div></dl>
      </article>;
    })}</div>}
  </div>;
}
