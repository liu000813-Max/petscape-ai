import React from 'react';
import { Image } from 'lucide-react';
import { scenePacks } from './data';
import { AssetPlaceholder } from './AssetPlaceholder';

export function ScenePackSection() {
  return <section className="scene-section"><div className="section-copy narrow"><span>场景包</span><h2>把喜欢的氛围一键打包成可以落地的爱宠小窝。</h2></div><div className="scene-grid">{scenePacks.map(({ title, tag, copy, price, image }) => <article className="scene-card" key={title}><div className="scene-media">{image ? <img className="scene-image" src={image} alt={`${title} 效果图`} /> : <AssetPlaceholder title={`${title} 效果图`} ratio="16:9" icon={Image} />}</div><div className="scene-body"><span>{tag}</span><h3>{title}</h3><p>{copy}</p><strong>{price}</strong></div></article>)}</div></section>;
}
