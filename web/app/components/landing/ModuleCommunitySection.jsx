import React, { useMemo, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { modules, species } from './data';
import { ModuleCard } from './ModuleCard';

export function ModuleCommunitySection({ selectedIds, onAddSceneItem, marketRef, selectedSpeciesId }) {
  const [showAllModules, setShowAllModules] = useState(false);
  // F48：命中当前物种 species.modules 的模块排序置顶并标「推荐」，不隐藏其余、不改布局结构。
  const recommendedIds = useMemo(() => {
    const current = species.find(item => item.id === selectedSpeciesId);
    return new Set(current?.modules ?? []);
  }, [selectedSpeciesId]);
  const orderedModules = useMemo(() => {
    const recommended = modules.filter(module => recommendedIds.has(module.id));
    const rest = modules.filter(module => !recommendedIds.has(module.id));
    return [...recommended, ...rest];
  }, [recommendedIds]);
  const visibleModules = showAllModules ? orderedModules : orderedModules.slice(0, 3);
  const toggleFullMarket = () => {
    setShowAllModules(current => {
      const next = !current;
      if (next) requestAnimationFrame(() => marketRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
      return next;
    });
  };
  return <section className={`module-section ${showAllModules ? 'market-open' : ''}`} ref={marketRef} id="module-market"><div className="section-with-action"><div className="section-copy"><h2>爱宠之家社区</h2></div><button className="view-more-button" type="button" onClick={toggleFullMarket}>{showAllModules ? '收起' : '查看更多'}<ArrowRight className={showAllModules ? 'rotated' : ''} size={16} /></button></div><div className="market-status"><span>{showAllModules ? `已加载 ${modules.length} 个梦想配件` : '当前展示 3 个入门配件'}</span><strong>{selectedIds.length} 类模块已加入当前 3D 场景</strong></div><div className="module-layout"><div className="module-grid">{visibleModules.map(module => <div className="module-card-slot" key={module.id}>{recommendedIds.has(module.id) && <span className="module-recommend-badge">推荐</span>}<ModuleCard module={module} selected={selectedIds.includes(module.id)} onAddSceneItem={onAddSceneItem} /></div>)}</div>{!showAllModules && <button className="module-more-card" type="button" onClick={toggleFullMarket}><span>进入完整爱宠社区</span><strong>查看更多梦想配件</strong><p>打开完整的梦想配件库，并继续把配件加入宠物 3D 场景。</p></button>}</div></section>;
}
