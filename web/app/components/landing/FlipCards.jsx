import React from 'react';
import { ArrowRight } from 'lucide-react';
import { workflowCards } from './data';

export function FlipCards() {
  return <section className="workflow-section" id="workflow"><div className="section-copy"><span>能力地图</span><h2>把视觉钩子连接到真实产品系统。</h2></div><div className="flip-grid">{workflowCards.map(({ title, label, image, front, back }) => <div className="flip-card" key={title}><div className="flip-inner"><div className="flip-face flip-front"><img className={`workflow-image ${title === '物种入口' ? 'species-workflow-image' : ''}`} src={image} alt={`${title}流程配图`} /><span>{label}</span><h3>{title}</h3><p>{front}</p></div><div className="flip-face flip-back"><img className={`workflow-image ${title === '物种入口' ? 'species-workflow-image' : ''}`} src={image} alt="" /><span>{label}</span><h3>{title}</h3><p>{back}</p><ArrowRight size={18} /></div></div></div>)}</div></section>;
}
