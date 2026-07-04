import React from 'react';
import { ProductRender } from './ProductRender';

export function ModuleCard({ module, selected, onToggleModule }) {
  return <article className={`module-card ${selected ? 'selected' : ''}`}><ProductRender module={module} /><div className="module-body"><div><span>{module.species}</span><h3>{module.title}</h3><p>{module.description}</p></div><div className="module-meta"><span>{module.material}</span><span>{module.weight}</span><strong>{module.price}</strong></div><button type="button" onClick={() => onToggleModule(module.id)}>{selected ? '已加入预览' : '加入 3D 场景'}</button></div></article>;
}
