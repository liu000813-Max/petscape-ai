import React from 'react';
import { Factory } from 'lucide-react';
import { materialRows } from './data';

export function ManufacturingSection() {
  return <section className="manufacturing-section"><div className="manufacturing-copy"><span className="eyebrow">3D 模型与打印</span><h2>让用户清楚看到：效果图可以变成真实订单。</h2><p>这里预留模型预览、材料选择、重量计价和生产周期，后续可连接模型生成、切片重量和打印排产。</p></div><div className="manufacturing-grid"><img className="feature-image manufacturing-image" src="/assets/model-preview.jpg" alt="3D 模型预览" /><div className="quote-panel"><div className="quote-head"><Factory size={20} /><div><span>报价示例</span><strong>森林奶酪屋套装</strong></div></div><div className="material-table">{materialRows.map(([name, desc, price]) => <div className="material-row" key={name}><strong>{name}</strong><span>{desc}</span><em>{price}</em></div>)}</div><div className="quote-total"><span>预计 1.8kg / 生产 2-4 天</span><strong>¥399 - ¥899</strong></div></div></div></section>;
}
