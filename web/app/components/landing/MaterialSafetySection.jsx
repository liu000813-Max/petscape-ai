import React from 'react';
import { ShieldCheck } from 'lucide-react';
import { safetyMaterials } from './data';

export function MaterialSafetySection() {
  const featured = safetyMaterials.slice(0, 3);
  const comparison = safetyMaterials.slice(3);

  return (
    <section className="material-safety-section">
      <div className="section-copy">
        <span>材料安全</span>
        <h2>宠物接触场景，优先选择更安全的打印材料。</h2>
      </div>
      <div className="safety-layout">
        <div className="safety-lead">
          <p>系统会根据宠物类型、接触频率和使用场景，推荐 PETG、TPU、尼龙 PA 等材料，并把不适合长期接触的材料标记为谨慎使用。</p>
          <div className="safety-rule">
            <ShieldCheck size={20} />
            <span>默认策略：主体结构优先 PETG，柔性接触面使用 TPU，高强度承重件再升级尼龙 PA。</span>
          </div>
        </div>
        <div className="safety-card-grid">
          {featured.map(item => (
            <article className="safety-card recommended" key={item.name}>
              <div>
                <span>{item.level}</span>
                <strong>{item.name}</strong>
              </div>
              <p>{item.scene}</p>
              <div className="safety-tags">
                <span>安全性 {item.safety}</span>
                <span>耐咬性 {item.durability}</span>
                <span>耐热性 {item.heat}</span>
              </div>
              <em>{item.pets}</em>
            </article>
          ))}
        </div>
      </div>
      <div className="safety-table" aria-label="常见3D打印材料安全性与宠物适配">
        <div className="safety-row safety-head">
          <span>材料</span>
          <span>安全性</span>
          <span>耐咬性</span>
          <span>耐热性</span>
          <span>适合宠物</span>
          <span>建议场景</span>
        </div>
        {comparison.map(item => (
          <div className="safety-row" key={item.name}>
            <strong>{item.name}</strong>
            <span>{item.safety}</span>
            <span>{item.durability}</span>
            <span>{item.heat}</span>
            <span>{item.pets}</span>
            <span>{item.scene}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
