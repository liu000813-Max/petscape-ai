import React, { useEffect, useState } from 'react';
import { ChevronRight, Download } from 'lucide-react';
import { flowStepAssets, flowSteps } from './data';
import { fetchLatestRenderState } from '../../lib/vibeRender';

// F47 订单条：按 state 推导当前高亮步骤。flowSteps 顺序：
// ['免费生成图', '选择宠物', '创建形象', '添加装扮', '添加模块', '确认模型', '3D 打印', '发货']
// designer 源站把"免费生图"放在第 4 步；这里保留当前 state 语义和顺序，只复用其视觉资产。

export function OrderFlowSection({ projectId, petImageUrl, avatarGenerated, selectedWearables, selectedIds }) {
  // "免费生成图"步骤：WP-G3 起走 v1——项目下存在 generated_render 效果图即视为完成
  // （旧 GET /api/project/:id 的 vibeRender 内存态已退役）。
  // "确认模型"步骤：avatarSlice 仍是 avatar 未迁段产物（G5 范围），继续读旧 GET。
  const [vibeDone, setVibeDone] = useState(false);
  const [avatarSlice, setAvatarSlice] = useState(null);

  useEffect(() => {
    if (!projectId) return undefined;
    let cancelled = false;
    const poll = async () => {
      try {
        const render = await fetchLatestRenderState(projectId).catch(() => null);
        if (cancelled) return;
        setVibeDone(!!render?.afterUrl);
        // avatarSlice 仍来自旧 GET（avatar 段未迁，G5 范围）。
        const res = await fetch(`/api/project/${projectId}`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (cancelled) return;
        setAvatarSlice(data?.avatarSlice ?? null);
      } catch {
        // 静默忽略，保持上一次已知状态
      }
    };
    poll();
    const intervalId = setInterval(poll, 1500);
    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [projectId]);

  const reachedByStep = {
    '免费生成图': vibeDone,
    '选择宠物': !!petImageUrl,
    '创建形象': !!avatarGenerated,
    '添加装扮': (selectedWearables?.length || 0) > 0,
    '添加模块': (selectedIds?.length || 0) > 0,
    '确认模型': avatarSlice?.status === 'done',
    '3D 打印': false,
    '发货': false,
  };

  // 当前高亮 = 最后一个"已达成"的步骤（推导：从后往前找第一个 reached=true）；
  // 全未达成时不高亮任何步骤（初始态仅第 2 步"前置"，不点亮）。
  let currentStep = null;
  for (let i = flowSteps.length - 1; i >= 0; i -= 1) {
    if (reachedByStep[flowSteps[i]]) {
      currentStep = flowSteps[i];
      break;
    }
  }

  const stlReady = avatarSlice?.status === 'done' && Boolean(avatarSlice?.stlUrl);

  return (
    <section className="order-section">
      <div className="section-copy">
        <span>订单闭环</span>
        <h2>从免费效果图开始，到真实打印产品送到家。</h2>
      </div>
      <div className="flow-row">
        {flowSteps.map((step, index) => {
          const isActive = step === currentStep;
          const image = flowStepAssets[step];
          return (
            <div className={`flow-step ${isActive ? 'active' : ''}`} key={step}>
              {image && <img src={image} alt={`${step}流程配图`} />}
              <div className="flow-step-copy">
                <span>{String(index + 1).padStart(2, '0')}</span>
                <strong>{step}</strong>
              </div>
              {index < flowSteps.length - 1 && <ChevronRight size={18} />}
            </div>
          );
        })}
      </div>
      {stlReady ? (
        <div className="order-export-cta" aria-live="polite">
          <div className="order-export-copy">
            <span>STL 模型已就绪</span>
            <strong>当前宠物模型可下载</strong>
          </div>
          <a className="order-export-button" href={avatarSlice.stlUrl} download>
            <Download size={16} aria-hidden="true" />
            下载 STL 模型
          </a>
        </div>
      ) : null}
    </section>
  );
}
