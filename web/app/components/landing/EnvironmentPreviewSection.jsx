import React, { useMemo } from 'react';
import { Box } from 'lucide-react';
import { AssetPlaceholder } from './AssetPlaceholder';

export function EnvironmentPreviewSection({ selectedModules }) {
  const total = useMemo(() => selectedModules.reduce((sum, item) => sum + Number.parseInt(item.price.replace(/[^\d]/g, ''), 10), 0), [selectedModules]);
  return <section className="preview-section"><div className="preview-copy"><span className="eyebrow">加入 3D 环境预览</span><h2>打印模块可以被放入你的宠物环境预览中。</h2><p>当前是静态 demo，后续可接入 Three.js / GLB 模型和真实尺寸校验。</p></div><div className="preview-board"><div className="preview-stage"><AssetPlaceholder title="我的宠物 3D 环境预览" ratio="交互画布 / 16:10" icon={Box} tone="dark" /><div className="preview-chips">{selectedModules.length === 0 ? <span>还没有添加模块</span> : selectedModules.map(item => <span key={item.id}>{item.title}</span>)}</div></div><div className="preview-side"><div className="fit-score"><span>适配评分</span><strong>{selectedModules.length ? '92%' : '--'}</strong></div><div className="preview-list">{selectedModules.length === 0 ? <p>点击模块卡片中的“加入 3D 场景”，即可构建预览组合。</p> : selectedModules.map(item => <div className="preview-line" key={item.id}><span>{item.title}</span><strong>{item.price}</strong></div>)}</div><div className="preview-total"><span>模块小计</span><strong>{selectedModules.length ? `¥${total}` : '¥0'}</strong></div><button type="button">生成场景报价</button></div></div></section>;
}
