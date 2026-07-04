import React, { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { Plus, X } from 'lucide-react';

// F31：three.js 真实场景（client-only，撞 window/document，参考 app/scene-lab/SceneLabViewer.tsx 的
// next/dynamic + ssr:false 约定）。
const SceneViewer = dynamic(() => import('../SceneViewer'), { ssr: false });

// F46 报价明细用材料单价常量（贴 materialRows 里的 PETG 单价，纯前端展示，不接后端计价）。
const MATERIAL_UNIT_PRICE_LABEL = 'PETG ¥0.42 / g';

function parsePrice(priceStr) {
  return Number.parseInt(priceStr.replace(/[^\d]/g, ''), 10) || 0;
}

export function EnvironmentPreviewSection({ sectionRef, availableModules = [], selectedIds = [], selectedModules, sceneItems, focusedInstanceId, onSceneItemsChange, onToggleModule, onRemoveModule, projectId, mockMode }) {
  const total = useMemo(() => selectedModules.reduce((sum, item) => sum + parsePrice(item.price), 0), [selectedModules]);
  const publicAvailableModules = useMemo(() => availableModules.filter(item => !item.scenePackOnly), [availableModules]);
  const [avatarModelUrl, setAvatarModelUrl] = useState(null);
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [quoteSnapshot, setQuoteSnapshot] = useState(null);

  // 中央宠物位：只读 project.avatar.modelUrl（批次1 产物），不依赖批次1 代码，字段不存在则空着。
  useEffect(() => {
    if (!projectId) return undefined;
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/project/${projectId}`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!cancelled) setAvatarModelUrl(data?.avatar?.modelUrl || null);
      } catch {
        // 网络失败静默忽略，宠物位保持留空，不报错
      }
    };
    poll();
    const intervalId = setInterval(poll, 1500);
    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [projectId, mockMode]);

  const moduleTitleById = useMemo(() => new Map(selectedModules.map(item => [item.id, item.title])), [selectedModules]);

  const handleGenerateQuote = () => {
    setQuoteSnapshot(selectedModules.map((item) => ({ id: item.id, title: item.title, price: item.price })));
    setQuoteOpen(true);
  };

  // 已选模块变化后，若明细卡已展开则跟着刷新（spec 5B-4：再加模块后重新点击才更新——
  // 这里保持"仅点击才刷新"的语义，模块变化不自动重算，直到用户再次点击生成）。

  return (
    <section className="preview-section" ref={sectionRef} id="environment-preview">
      <div className="preview-copy">
        <span className="eyebrow">加入 3D 环境预览</span>
        <h2>打印模块可以被放入你的宠物环境预览中。</h2>
        <p>可拖动旋转视角，实时查看已选模块的组合效果。</p>
      </div>
      <div className="preview-board">
        <div className="preview-stage">
          <div className="asset-placeholder dark preview-scene-frame">
            <SceneViewer items={sceneItems} selectedModuleTitles={Object.fromEntries(moduleTitleById)} focusedInstanceId={focusedInstanceId} onItemsChange={onSceneItemsChange} petAvatarUrl={avatarModelUrl} />
          </div>
          <div className="module-strip" aria-label="模块选择">
            {publicAvailableModules.map(item => {
              const selected = selectedIds.includes(item.id);
              return (
                <button className={`module-strip-pill ${selected ? 'selected' : ''}`} type="button" key={item.id} onClick={() => onToggleModule?.(item.id)} aria-pressed={selected}>
                  <span>{item.title}</span>
                  <strong>{item.price}</strong>
                  {selected ? <X size={14} aria-hidden="true" /> : <Plus size={14} aria-hidden="true" />}
                </button>
              );
            })}
          </div>
        </div>
        <div className="preview-side">
          <div className="fit-score">
            <span>适配评分</span>
            <strong>{selectedModules.length ? '92%' : '--'}</strong>
          </div>
          <div className="preview-list">
            {selectedModules.length === 0 ? <p>点击下方模块名称，即可构建预览组合。</p> : selectedModules.map(item => <div className="preview-line preview-line-with-media" key={item.id}>{item.image ? <img src={item.image} alt={`${item.title} 缩略图`} /> : <span className="preview-thumb-fallback" aria-hidden="true" />}<span>{item.title}</span><strong>{item.price}</strong><button className="preview-remove-button" type="button" aria-label={`移除 ${item.title}`} onClick={() => onRemoveModule?.(item.id)}><X size={14} /></button></div>)}
          </div>
          <div className="preview-total">
            <span>模块小计</span>
            <strong>{selectedModules.length ? `¥${total}` : '¥0'}</strong>
          </div>
          <button type="button" onClick={handleGenerateQuote}>生成场景报价</button>
          {quoteOpen && quoteSnapshot && (
            <div className="preview-list" data-testid="quote-detail">
              {quoteSnapshot.map((item) => (
                <div className="preview-line" key={item.id}>
                  <span>{item.title}</span>
                  <strong>{item.price}</strong>
                </div>
              ))}
              <div className="preview-line">
                <span>材料单价</span>
                <strong>{MATERIAL_UNIT_PRICE_LABEL}</strong>
              </div>
              <div className="preview-total">
                <span>合计</span>
                <strong>¥{quoteSnapshot.reduce((sum, item) => sum + parsePrice(item.price), 0)}</strong>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
