import React from 'react';
import { Image } from 'lucide-react';
import { scenePacks } from './data';
import { AssetPlaceholder } from './AssetPlaceholder';

export function ScenePackSection({ selectedIds = [], onApplyScenePack }) {
  return <section className="scene-section"><div className="section-copy narrow"><span>场景包</span><h2>把喜欢的氛围一键打包成可以落地的爱宠小窝。</h2></div><div className="scene-grid">{scenePacks.map((pack) => {
    const { title, tag, copy, price, image, moduleIds, layoutStatus, layout } = pack;
    const isReady = layoutStatus === 'ready' && layout?.length;
    const allAdded = moduleIds.every(id => selectedIds.includes(id));
    return <article className="scene-card" key={title}><div className="scene-media">{image ? <img className="scene-image" src={image} alt={`${title} 效果图`} /> : <AssetPlaceholder title={`${title} 效果图`} ratio="16:9" icon={Image} />}</div><div className="scene-body"><span>{tag}</span><h3>{title}</h3><p>{copy}</p>{!isReady && <p className="scene-layout-note">完整 3D 布局开发中，当前不会批量伪装为真实场景。</p>}<strong>{price}</strong><button type="button" disabled={!isReady} onClick={() => onApplyScenePack?.(pack)} style={{ minHeight: 48, border: 0, borderRadius: 999, background: isReady ? (allAdded ? '#f4f4f2' : '#000') : '#ecebe6', color: isReady && !allAdded ? '#fff' : '#000', cursor: isReady ? 'pointer' : 'not-allowed', fontSize: 13, marginTop: 12, padding: '0 20px' }}>{isReady ? (allAdded ? '重新应用布局' : '应用真实 3D 布局') : '布局开发中'}</button></div></article>;
  })}</div></section>;
}
