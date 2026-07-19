'use client';
import { useEffect, useState } from 'react';
import { Box, MapPin, ShieldCheck } from 'lucide-react';
import type { OrderResponse } from '@petscape/server/contracts/orders';

async function readOrders() {
  const response = await fetch('/api/v1/commerce/orders');
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.detail ?? `读取失败（${response.status}）`);
  return body.orders as OrderResponse[];
}

export function OrdersClient() {
  const [orders, setOrders] = useState<OrderResponse[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => { let active = true; readOrders().then((value) => { if (active) setOrders(value); }).catch((cause) => {
    if (active) setError(cause instanceof Error ? cause.message : '读取失败');
  }); return () => { active = false; }; }, []);
  async function cancel(id: string) {
    setBusy(id); setError(null);
    try {
      const response = await fetch(`/api/v1/commerce/orders/${id}/cancel`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedStatus: 'paid' }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.detail ?? `取消失败（${response.status}）`);
      setOrders((current) => current.map((order) => order.id === id ? body as OrderResponse : order));
    } catch (cause) { setError(cause instanceof Error ? cause.message : '取消失败'); }
    finally { setBusy(null); }
  }
  return <div className="psx-page psx-order-page psx-fade-up">
    <header className="psx-request-heading"><div><span className="psx-dot-label">Sandbox orders</span><h1 className="psx-page-title">沙箱订单</h1><p>每笔可信沙箱支付最多生成一张订单，金额、审核和地址均为服务端冻结快照。</p></div><span className="psx-sandbox-badge">不会进入真实生产或物流</span></header>
    <div className="psx-order-warning"><ShieldCheck size={19}/><div><strong>交易功能仍关闭</strong><span>这里的 paid 只表示沙箱 provider 测试成功，不代表真实付款、成交或履约。</span></div></div>
    {error ? <div className="psx-request-alert is-error" role="alert">{error}</div> : null}
    <section><div className="psx-request-history-heading"><div><span className="psx-dot-label">Immutable ledger</span><h2>订单记录</h2></div><span>{orders.length} 条</span></div>
      {orders.length === 0 ? <div className="psx-request-empty">尚无沙箱订单。可信支付成功后会在这里生成。</div> : <div className="psx-order-grid">{orders.map((order) => <article className="psx-order-card" key={order.id}>
        <header><div><span className="psx-order-status"><Box size={14}/>{order.status === 'paid' ? '已支付（沙箱）' : '已取消（沙箱）'}</span><h3>{order.productCode}</h3></div><strong>¥{(order.amountCent / 100).toFixed(2)}</strong></header>
        <dl><div><dt>订单号</dt><dd>{order.id}</dd></div><div><dt>材料</dt><dd>{order.materialName}</dd></div><div><dt>定价版本</dt><dd>{order.pricingRuleVersion}</dd></div><div><dt>支付时间</dt><dd>{new Date(order.paidAt).toLocaleString('zh-CN')}</dd></div></dl>
        <div className="psx-order-address"><MapPin size={17}/><div><strong>{order.deliveryAddressSnapshot.fields.recipientName} · {order.deliveryAddressSnapshot.fields.mobile}</strong><span>{order.deliveryAddressSnapshot.fields.province}{order.deliveryAddressSnapshot.fields.city}{order.deliveryAddressSnapshot.fields.district}{order.deliveryAddressSnapshot.fields.detail}</span></div></div>
        <footer><span>{order.label}</span><span>历史 {order.history.length} 条 · {order.history.at(-1)?.reason}</span>{order.status === 'paid' ? <button className="psx-btn-secondary" disabled={busy !== null} onClick={() => cancel(order.id)}>{busy === order.id ? '取消中…' : '取消沙箱订单'}</button> : null}</footer>
      </article>)}</div>}
    </section>
  </div>;
}
