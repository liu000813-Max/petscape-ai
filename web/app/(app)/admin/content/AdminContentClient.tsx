'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';

type ContentType = 'article' | 'post' | 'comment' | 'provider';
type Item = { id: string; title: string; body: string; status: string; updatedAt: string };
type Summary = { events: { eventName: string; count: number }[]; recentErrors: { eventName: string; path: string | null; createdAt: string }[] };
const labels: Record<ContentType, string> = { article: '知识文章', post: '社区帖子', comment: '社区评论', provider: '服务商' };

async function json<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...options, headers: { 'content-type': 'application/json' } });
  const result = await response.json();
  if (!response.ok) throw new Error(response.status === 403 ? '当前账号没有运营权限' : response.status === 401 ? '登录已失效，请重新登录' : result.error === 'conflict' ? '文章标识已存在，请更换' : `请求失败（${response.status}）`);
  return result;
}

export function AdminContentClient() {
  const [contentType, setContentType] = useState<ContentType>('post');
  const [status, setStatus] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [draftType, setDraftType] = useState<'article' | 'provider'>('article');

  const read = useCallback(() => Promise.all([
    json<{ items: Item[] }>(`/api/v1/admin/content?contentType=${contentType}${status ? `&status=${status}` : ''}`),
    json<Summary>('/api/v1/admin/content/analytics'),
  ]), [contentType, status]);

  async function load() {
    setLoading(true); setError('');
    try {
      const [list, analytics] = await read();
      setItems(list.items); setSummary(analytics);
    } catch (caught) { setError(caught instanceof Error ? caught.message : '读取失败'); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    let active = true;
    read().then(([list, analytics]) => { if (active) { setItems(list.items); setSummary(analytics); } })
      .catch((caught: unknown) => { if (active) setError(caught instanceof Error ? caught.message : '读取失败'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [read]);

  async function moderate(id: string, nextStatus: string) {
    setBusy(true); setError('');
    try {
      await json('/api/v1/admin/content/moderate', { method: 'POST', body: JSON.stringify({ contentType, id, status: nextStatus }) });
      setNotice('审核状态已更新'); await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : '更新失败'); }
    finally { setBusy(false); }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const text = (name: string) => String(data.get(name) || '').trim();
    const input = draftType === 'article'
      ? { slug: text('slug'), title: text('title'), summary: text('summary'), body: text('body'), category: text('category') }
      : { name: text('title'), city: text('city'), serviceType: text('serviceType'), description: text('body'), contactUrl: text('contactUrl') || null };
    setBusy(true); setError('');
    try {
      await json('/api/v1/admin/content', { method: 'POST', body: JSON.stringify({ contentType: draftType, input }) });
      setNotice('已保存，审核发布后对用户可见'); form.reset(); await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : '保存失败'); }
    finally { setBusy(false); }
  }

  return <main className="content-ops">
    <header><span className="ops-kicker">PETSCAPE / OPERATIONS</span><h1>内容运营</h1><p>审核知识、社区和同城服务，查看近七天的使用与错误事件。</p></header>
    {error && <p role="alert" className="ops-feedback">{error} <button onClick={() => void load()}>重试</button></p>}
    {notice && <p role="status" className="ops-feedback">{notice}</p>}
    <section aria-label="七日统计" className="ops-stats">
      <div><strong>{summary?.events.reduce((sum, item) => sum + item.count, 0) ?? '—'}</strong><span>近七日事件</span></div>
      <div><strong>{summary?.events.filter((item) => item.eventName.startsWith('client.')).reduce((sum, item) => sum + item.count, 0) ?? '—'}</strong><span>客户端错误</span></div>
    </section>
    <section className="ops-panel"><div className="ops-heading"><h2>审核队列</h2><button disabled={loading} onClick={() => void load()}>刷新</button></div>
      <div className="ops-filters"><label>内容类型<select disabled={busy || loading} value={contentType} onChange={(event) => { setLoading(true); setError(''); setContentType(event.target.value as ContentType); setStatus(''); }}>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>状态<select disabled={busy || loading} value={status} onChange={(event) => { setLoading(true); setError(''); setStatus(event.target.value); }}><option value="">全部</option>{(contentType === 'article' ? ['draft', 'published', 'archived'] : ['pending', 'published', 'rejected', 'archived']).map((value) => <option key={value} value={value}>{value}</option>)}</select></label></div>
      {loading ? <p role="status">正在读取审核队列…</p> : !items.length ? <p>当前没有待处理内容。</p> : items.map((item) => <article className="ops-item" key={item.id}><div className="ops-heading"><h3>{item.title}</h3><span>{item.status}</span></div><p>{item.body}</p><small>{new Date(item.updatedAt).toLocaleString('zh-CN')}</small><div className="ops-actions"><button disabled={busy || item.status === 'published'} onClick={() => void moderate(item.id, 'published')}>通过并发布</button>{contentType !== 'article' && <button disabled={busy || item.status === 'rejected'} onClick={() => void moderate(item.id, 'rejected')}>拒绝</button>}<button disabled={busy || item.status === 'archived'} onClick={() => void moderate(item.id, 'archived')}>下架</button></div></article>)}
    </section>
    <section className="ops-panel"><h2>新增内容</h2><form onSubmit={(event) => void save(event)}>
      <label>类型<select value={draftType} onChange={(event) => setDraftType(event.target.value as 'article' | 'provider')}><option value="article">知识文章</option><option value="provider">服务商</option></select></label>
      <label>{draftType === 'article' ? '标题' : '服务商名称'}<input name="title" required maxLength={160} /></label>
      {draftType === 'article' ? <><label>文章标识（小写英文和连字符）<input name="slug" required pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={191} /></label><label>分类<select name="category">{['花枝鼠', '守宫', '蛇类', '鹦鹉', '蜘蛛', '其他异宠', '空间设计'].map((value) => <option key={value}>{value}</option>)}</select></label><label>摘要<input name="summary" required maxLength={1000} /></label></> : <><label>城市<input name="city" required maxLength={80} /></label><label>服务类型<input name="serviceType" required maxLength={80} placeholder="寄养、护理、环境检查" /></label><label>联系方式链接<input name="contactUrl" type="url" placeholder="https://" /></label></>}
      <label>{draftType === 'article' ? '正文' : '服务介绍'}<textarea name="body" required maxLength={draftType === 'article' ? 100000 : 3000} rows={7} /></label><button className="ops-primary" disabled={busy} type="submit">保存待审内容</button>
    </form></section>
    <section className="ops-panel"><h2>最近客户端错误</h2>{summary?.recentErrors.length ? summary.recentErrors.map((item, index) => <p key={index}><code>{item.eventName}</code> · {item.path || '未知页面'} · {new Date(item.createdAt).toLocaleString('zh-CN')}</p>) : <p>近七天暂无上报错误。</p>}<details><summary>查看事件分布</summary>{summary?.events.map((item) => <p key={item.eventName}>{item.eventName}：{item.count}</p>)}</details></section>
  </main>;
}
