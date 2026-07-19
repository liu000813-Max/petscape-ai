'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { BadgeCheck, LockKeyhole, MapPin, PencilLine, ShieldAlert } from 'lucide-react';
import type { DeliveryAddressResponse } from '@petscape/server/contracts/delivery-addresses';
import type { QuoteResponse } from '@petscape/server/contracts/quotes';

type Fields = {
  recipientName: string; mobile: string; province: string; city: string;
  district: string; detail: string; postalCode: string;
};

const EMPTY: Fields = {
  recipientName: '', mobile: '', province: '', city: '', district: '', detail: '', postalCode: '',
};

class ApiError extends Error {}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(typeof data?.detail === 'string' ? data.detail : `请求失败（${response.status}）`);
  return data as T;
}

function fieldsFrom(address?: DeliveryAddressResponse): Fields {
  if (!address) return EMPTY;
  return {
    recipientName: address.recipientName,
    mobile: address.mobile,
    province: address.province,
    city: address.city,
    district: address.district,
    detail: address.detail,
    postalCode: address.postalCode ?? '',
  };
}

export function CheckoutClient() {
  const [quotes, setQuotes] = useState<QuoteResponse[]>([]);
  const [addresses, setAddresses] = useState<DeliveryAddressResponse[]>([]);
  const [quoteId, setQuoteId] = useState('');
  const [fields, setFields] = useState<Fields>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const acceptedQuotes = useMemo(() => quotes.filter((quote) => quote.status === 'accepted'), [quotes]);
  const selectedQuote = acceptedQuotes.find((quote) => quote.id === quoteId);
  const address = addresses.find((item) => item.quoteId === quoteId);

  async function load(preferredQuoteId?: string) {
    const [quoteData, addressData] = await Promise.all([
      api<{ quotes: QuoteResponse[] }>('/api/v1/commerce/quotes'),
      api<{ deliveryAddresses: DeliveryAddressResponse[] }>('/api/v1/commerce/delivery-addresses'),
    ]);
    setQuotes(quoteData.quotes);
    setAddresses(addressData.deliveryAddresses);
    const accepted = quoteData.quotes.filter((quote) => quote.status === 'accepted');
    const nextId = preferredQuoteId && accepted.some((quote) => quote.id === preferredQuoteId)
      ? preferredQuoteId
      : accepted[0]?.id ?? '';
    setQuoteId(nextId);
    setFields(fieldsFrom(addressData.deliveryAddresses.find((item) => item.quoteId === nextId)));
  }

  useEffect(() => {
    let active = true;
    Promise.all([
      api<{ quotes: QuoteResponse[] }>('/api/v1/commerce/quotes'),
      api<{ deliveryAddresses: DeliveryAddressResponse[] }>('/api/v1/commerce/delivery-addresses'),
    ]).then(([quoteData, addressData]) => {
      if (!active) return;
      setQuotes(quoteData.quotes); setAddresses(addressData.deliveryAddresses);
      const first = quoteData.quotes.find((quote) => quote.status === 'accepted')?.id ?? '';
      setQuoteId(first);
      setFields(fieldsFrom(addressData.deliveryAddresses.find((item) => item.quoteId === first)));
    }).catch((caught) => {
      if (active) setError(caught instanceof Error ? caught.message : '读取失败');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  function selectQuote(nextId: string) {
    setQuoteId(nextId);
    setFields(fieldsFrom(addresses.find((item) => item.quoteId === nextId)));
    setError(null); setNotice(null);
  }

  function setField(name: keyof Fields, value: string) {
    setFields((current) => ({ ...current, [name]: value }));
    setNotice(null);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!quoteId) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      await api<DeliveryAddressResponse>('/api/v1/commerce/delivery-addresses', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          quoteId,
          ...(address ? { expectedVersion: address.version } : {}),
          ...fields,
          postalCode: fields.postalCode.trim() || null,
        }),
      });
      await load(quoteId);
      setNotice(address?.confirmed ? '地址已更新，原确认已清除；请核对后重新确认。' : '地址已保存，请核对后确认。');
    } catch (caught) { setError(caught instanceof Error ? caught.message : '地址保存失败'); }
    finally { setBusy(false); }
  }

  async function confirm() {
    if (!address) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      await api<DeliveryAddressResponse>(`/api/v1/commerce/delivery-addresses/${address.id}/confirm`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ expectedVersion: address.version }),
      });
      await load(quoteId);
      setNotice('沙箱配送地址已确认；支付入口仍关闭，不会产生真实交易。');
    } catch (caught) { setError(caught instanceof Error ? caught.message : '地址确认失败'); }
    finally { setBusy(false); }
  }

  if (loading) return <div className="psx-page psx-checkout-page"><div className="psx-request-empty">正在读取结算信息…</div></div>;

  return <div className="psx-page psx-checkout-page psx-fade-up">
    <header className="psx-request-heading">
      <div><span className="psx-dot-label">Sandbox checkout</span><h1 className="psx-page-title">配送确认</h1>
        <p>地址只绑定当前已接受的测试报价；确认后如有编辑，必须重新确认。</p></div>
      <span className="psx-sandbox-badge">沙箱 · 支付入口关闭</span>
    </header>

    <div className="psx-checkout-boundary"><ShieldAlert size={18}/><div><strong>这不是实际下单</strong>
      <span>不会发起真实支付、生产或配送。地址仅用于验证沙箱交易闭环。</span></div></div>
    {error ? <div className="psx-request-alert is-error" role="alert">{error}</div> : null}
    {notice ? <div className="psx-request-alert" role="status">{notice}</div> : null}

    {acceptedQuotes.length === 0 ? <section className="psx-checkout-empty">
      <LockKeyhole size={28}/><h2>还没有已接受的测试报价</h2><p>先到“测试报价”接受一条有效报价，才能填写本次配送地址。</p>
    </section> : <div className="psx-checkout-layout">
      <aside className="psx-checkout-quote">
        <span className="psx-dot-label">Accepted quote</span><h2>本次测试报价</h2>
        <label>选择报价<select value={quoteId} onChange={(event) => selectQuote(event.target.value)}>
          {acceptedQuotes.map((quote) => <option key={quote.id} value={quote.id}>
            ¥{(quote.amountCent / 100).toFixed(2)} · {quote.productCode}
          </option>)}
        </select></label>
        {selectedQuote ? <dl>
          <div><dt>材料</dt><dd>{selectedQuote.materialName}</dd></div>
          <div><dt>规则</dt><dd>{selectedQuote.pricingRuleVersion}</dd></div>
          <div><dt>报价状态</dt><dd>已接受</dd></div>
          <div><dt>交易资格</dt><dd>仅沙箱</dd></div>
        </dl> : null}
      </aside>

      <section className="psx-checkout-form-card">
        <div className="psx-checkout-form-heading"><div><span className="psx-dot-label">Current address</span><h2>本次配送地址</h2></div>
          {address?.confirmed ? <span className="is-confirmed"><BadgeCheck size={15}/>已确认 · v{address.version}</span>
            : <span className="is-pending"><PencilLine size={15}/>{address ? `待确认 · v${address.version}` : '尚未保存'}</span>}</div>
        <form onSubmit={save}>
          <div className="psx-checkout-two">
            <label>收件人<input required maxLength={80} value={fields.recipientName} onChange={(e) => setField('recipientName', e.target.value)}/></label>
            <label>手机号<input required minLength={6} maxLength={32} inputMode="tel" value={fields.mobile} onChange={(e) => setField('mobile', e.target.value)}/></label>
          </div>
          <div className="psx-checkout-three">
            <label>省<input required maxLength={80} value={fields.province} onChange={(e) => setField('province', e.target.value)}/></label>
            <label>市<input required maxLength={80} value={fields.city} onChange={(e) => setField('city', e.target.value)}/></label>
            <label>区/县<input required maxLength={80} value={fields.district} onChange={(e) => setField('district', e.target.value)}/></label>
          </div>
          <label>详细地址<textarea required maxLength={500} rows={3} value={fields.detail} onChange={(e) => setField('detail', e.target.value)}/></label>
          <label>邮政编码（可选）<input maxLength={16} value={fields.postalCode} onChange={(e) => setField('postalCode', e.target.value)}/></label>
          <div className="psx-checkout-actions">
            <button className="psx-btn-primary" disabled={busy} type="submit"><MapPin size={16}/>{busy ? '处理中…' : address ? '保存地址修改' : '保存地址'}</button>
            <button className="psx-btn-secondary" disabled={busy || !address || address.confirmed} type="button" onClick={confirm}>
              <BadgeCheck size={16}/>{address?.confirmed ? '地址已确认' : '确认此地址'}</button>
          </div>
          <p className="psx-checkout-hint">确认后编辑任一字段会自动撤销确认。后续支付意图只能消费再次确认后的服务端快照。</p>
        </form>
      </section>
    </div>}
  </div>;
}
