'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Factory } from 'lucide-react';
import { materialRows } from './data';

// 材料单价（元/g），与后端 avatarJob FILAMENT_PRICE_PER_G / data.js materialRows PETG 对齐。
const PRICE_PER_G = 0.42;
// 体型档 1-5 → scaleMm，与后端 sizeToScaleMm 对齐（换档触发重切）。
const SIZE_TO_MM = { 1: 80, 2: 100, 3: 120, 4: 140, 5: 160 };

// weightG → 价格区间（基础 = 料重*单价 + 后处理，区间给 ±上浮体现材料/工艺档差）。
function priceRange(weightG) {
  if (!weightG) return null;
  const base = weightG * PRICE_PER_G + 49; // 后处理起 ¥49（data.js 口径）
  const low = Math.round(base);
  const high = Math.round(base * 2.2);
  return { low, high };
}

export function ManufacturingSection({ projectId, mockMode, petName, petSize, selectedModules }) {
  const [slice, setSlice] = useState(null); // avatarSlice：{status, scaleMm, stlUrl, gcodeUrl, weightG, printTimeMin}
  const [avatarDone, setAvatarDone] = useState(false);
  const debounceRef = useRef(null);
  const pollRef = useRef(null);
  const mockQuery = mockMode ? '?mock=1' : '';

  const poll = useCallback(async () => {
    if (!projectId) return;
    try {
      const res = await fetch(`/api/project/${projectId}`, { cache: 'no-store' });
      if (!res.ok) return;
      const project = await res.json();
      setSlice(project.avatarSlice ?? null);
      setAvatarDone(project.avatar?.status === 'done');
    } catch {
      /* 瞬时错误：下一轮继续 */
    }
  }, [projectId]);

  // 常驻轻量轮询（2s），报价面板需感知 avatar/slice 就绪。
  useEffect(() => {
    if (!projectId) return;
    poll();
    pollRef.current = setInterval(poll, 2000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [projectId, poll]);

  // 换体型档 → 1s 防抖重切（幂等：同 mm 后端直接返回）。仅 avatar done 后才有意义。
  useEffect(() => {
    if (!projectId || !avatarDone) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const scaleMm = SIZE_TO_MM[petSize] ?? 120;
      // 已是目标 mm 且 done：不重复触发。
      if (slice?.status === 'done' && slice?.scaleMm === scaleMm) return;
      fetch(`/api/project/${projectId}/avatar-slice${mockQuery}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ petSize }),
      }).catch(() => {});
    }, 1000);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [petSize, avatarDone, projectId]);

  const ready = slice?.status === 'done' && slice?.weightG != null;
  const computing = slice?.status === 'running';
  const range = ready ? priceRange(slice.weightG) : null;
  const printMin = slice?.printTimeMin;
  const printTimeLabel = printMin
    ? printMin >= 60
      ? `${Math.floor(printMin / 60)} 时 ${printMin % 60} 分`
      : `${printMin} 分`
    : null;

  const title = ready || avatarDone ? `${petName || '你的宠物'} 的专属模型` : '森林奶酪屋套装';

  return (
    <section className="manufacturing-section">
      <style>{`
        .quote-downloads { display: flex; gap: 10px; margin-top: 12px; }
        .quote-download-btn {
          flex: 1; min-height: 44px; display: inline-flex; align-items: center; justify-content: center;
          border-radius: 999px; background: #111; color: #fff; text-decoration: none; font-size: 14px;
          border: 1px solid rgba(0,0,0,0.1); transition: opacity .2s ease;
        }
        .quote-download-btn:hover { opacity: 0.86; }
      `}</style>
      <div className="manufacturing-copy">
        <span className="eyebrow">3D 模型与打印</span>
        <h2>让用户清楚看到：效果图可以变成真实订单。</h2>
        <p>这里预留模型预览、材料选择、重量计价和生产周期，后续可连接模型生成、切片重量和打印排产。</p>
      </div>
      <div className="manufacturing-grid">
        <img className="feature-image manufacturing-image" src="/assets/model-preview.jpg" alt="3D 模型预览" />
        <div className="quote-panel">
          <div className="quote-head">
            <Factory size={20} />
            <div>
              <span>报价示例</span>
              <strong>{title}</strong>
            </div>
          </div>
          <div className="material-table">
            {materialRows.map(([name, desc, price]) => (
              <div className="material-row" key={name}>
                <strong>{name}</strong>
                <span>{desc}</span>
                <em>{price}</em>
              </div>
            ))}
          </div>

          {ready ? (
            <>
              <div className="quote-total">
                <span>
                  重量 {slice.weightG} g{printTimeLabel ? ` / 打印 ${printTimeLabel}` : ''}
                </span>
                <strong>
                  ¥{range.low} - ¥{range.high}
                </strong>
              </div>
              <div className="quote-downloads">
                <a className="quote-download-btn" href={slice.stlUrl} download>
                  下载 STL
                </a>
                <a className="quote-download-btn" href={slice.gcodeUrl} download>
                  下载 G-code
                </a>
              </div>
            </>
          ) : computing ? (
            <div className="quote-total">
              <span>切片计算中…</span>
              <strong>计算中</strong>
            </div>
          ) : (
            <div className="quote-total">
              <span>预计 1.8kg / 生产 2-4 天</span>
              <strong>¥399 - ¥899</strong>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
