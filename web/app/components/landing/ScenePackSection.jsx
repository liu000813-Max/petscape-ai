import React from 'react';
import { Image } from 'lucide-react';
import { scenePacks } from './data';
import { AssetPlaceholder } from './AssetPlaceholder';

// F42 场景包假闭环：点击「加入预览」把场景包的 moduleIds 子集批量并入 selectedIds
// （接驳层 page.jsx 已注入 onAddModules=addModules，addModules 内部用 Set 去重合并，
// 天然支持"再点另一场景包→叠加生效不清空前者"）。已全部加入则按钮显示"已加入"且禁用。
export function ScenePackSection({ selectedIds = [], onAddModules }) {
  return <section className="scene-section"><div className="section-copy narrow"><span>场景包</span><h2>把喜欢的氛围一键打包成可以落地的爱宠小窝。</h2></div><div className="scene-grid">{scenePacks.map(({ title, tag, copy, price, image, moduleIds }) => {
    const allAdded = moduleIds.every(id => selectedIds.includes(id));
    return <article className="scene-card" key={title}><div className="scene-media">{image ? <img className="scene-image" src={image} alt={`${title} 效果图`} /> : <AssetPlaceholder title={`${title} 效果图`} ratio="16:9" icon={Image} />}</div><div className="scene-body"><span>{tag}</span><h3>{title}</h3><p>{copy}</p><strong>{price}</strong>{/* 视觉语汇贴 ModuleCard「加入」按钮（styles.css .module-body button 的取值），不改 styles.css，改用行内样式复刻取值 */}<button type="button" disabled={allAdded} onClick={() => onAddModules?.(moduleIds)} style={{ minHeight: 48, border: 0, borderRadius: 999, background: allAdded ? '#f4f4f2' : '#000', color: allAdded ? '#000' : '#fff', cursor: allAdded ? 'default' : 'pointer', fontSize: 13, marginTop: 12, padding: '0 20px' }}>{allAdded ? '已加入' : '加入预览'}</button></div></article>;
  })}</div></section>;
}
