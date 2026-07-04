'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { Gift, Rotate3D, Upload } from 'lucide-react';
import { species, wearableItems } from './data';
import { AssetPlaceholder } from './AssetPlaceholder';

// three.js 舞台 client-only（three 用 window/document），ssr 关闭。
const PetViewer = dynamic(() => import('../PetViewer'), { ssr: false });

// avatar 管线阶段（前端可视化）：Meshy 默认走 styling→modeling→done；Tripo 备切多一个 triview。
// 前端固定展示四格叙事阶段，把后端 stage 映射进来，未走到的阶段保持 pending。
const STAGE_STEPS = [
  { key: 'styling', label: '风格化立绘' },
  { key: 'triview', label: '生成三视图' },
  { key: 'modeling', label: '3D 建模中' },
  { key: 'slicing', label: '切片报价' },
];

// 后端 avatar.stage + avatarSlice.status → 当前进行到第几阶段的索引。
function computeStageIndex(avatar, avatarSlice) {
  if (avatarSlice && (avatarSlice.status === 'running' || avatarSlice.status === 'done')) return 3;
  const stage = avatar?.stage;
  if (stage === 'modeling') return 2;
  if (stage === 'triview') return 1;
  if (stage === 'styling') return 0;
  if (avatar?.status === 'done') return 3;
  return 0;
}

export function PetCreatorSection({
  selectedSpecies,
  onSelectSpecies,
  petName,
  onPetNameChange,
  petSize,
  onPetSizeChange,
  petImageUrl,
  onPetImageUpload,
  avatarGenerated,
  onGenerateAvatar,
  onAvatarGeneratedChange,
  avatarRotation,
  onAvatarRotationChange,
  selectedWearables,
  onToggleWearable,
  sectionRef,
  projectId,
  mockMode,
}) {
  const selectedWearableItems = wearableItems.filter((item) => selectedWearables.includes(item.id));
  const wearableTotal = selectedWearableItems.reduce(
    (sum, item) => sum + Number.parseInt(item.price.replace(/[^\d]/g, ''), 10),
    0,
  );
  const avatarScale = 0.82 + petSize * 0.07;

  // ---- avatar 管线状态（轮询后端 project.avatar / avatarSlice）----
  const [avatarJob, setAvatarJob] = useState(null); // {status, stage, styledImageUrl, modelUrl, error}
  const [sliceJob, setSliceJob] = useState(null); // {status, ...}
  const [pipelineActive, setPipelineActive] = useState(false); // 生成中（按钮 disabled 依据）
  const [jobError, setJobError] = useState('');
  // 生成后切换装扮 → 提示重新生成
  const [wearablesDirty, setWearablesDirty] = useState(false);
  const wearablesAtGenRef = useRef(null);
  const pollTimerRef = useRef(null);

  const mockQuery = mockMode ? '?mock=1' : '';

  const modelReady = avatarJob?.status === 'done' && !!avatarJob?.modelUrl;

  // 轮询 project 状态（沿用 workbench 2s 轮询模式）。
  const poll = useCallback(async () => {
    if (!projectId) return;
    try {
      const res = await fetch(`/api/project/${projectId}`, { cache: 'no-store' });
      if (!res.ok) return;
      const project = await res.json();
      setAvatarJob(project.avatar ?? null);
      setSliceJob(project.avatarSlice ?? null);
      const av = project.avatar;
      if (av?.status === 'failed') {
        setJobError(av.error || '生成失败');
        setPipelineActive(false);
      } else if (av?.status === 'done') {
        setJobError('');
        // 首切完成或失败即停止轮询
        const slice = project.avatarSlice;
        if (slice && (slice.status === 'done' || slice.status === 'failed')) {
          setPipelineActive(false);
        }
      }
    } catch {
      /* 瞬时网络错误：下一轮继续 */
    }
  }, [projectId]);

  useEffect(() => {
    if (!pipelineActive) {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      return;
    }
    poll();
    pollTimerRef.current = setInterval(poll, 2000);
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    };
  }, [pipelineActive, poll]);

  // 上传：POST /api/project/[id]/upload kind=pet，保留本地即时预览（onPetImageUpload 仍跑）。
  const handleUpload = async (event) => {
    onPetImageUpload(event); // 本地即时预览 + 复位 avatarGenerated（App 逻辑不变）
    const file = event.target.files?.[0];
    if (!file || !projectId) return;
    const form = new FormData();
    form.append('file', file);
    form.append('kind', 'pet');
    try {
      await fetch(`/api/project/${projectId}/upload`, { method: 'POST', body: form });
    } catch {
      /* 上传失败不阻塞本地预览；生成时后端会因缺图报错并进失败态 */
    }
  };

  // 生成：POST avatar（装扮 ids / 物种 / 体型档）→ 开始轮询。
  const handleGenerate = async () => {
    if (!projectId) return;
    setJobError('');
    setWearablesDirty(false);
    wearablesAtGenRef.current = [...selectedWearables];
    setPipelineActive(true);
    setAvatarJob({ status: 'running', stage: 'styling' });
    setSliceJob(null);
    onGenerateAvatar(); // App 侧 avatarGenerated=true（保持既有 props 契约）
    try {
      const res = await fetch(`/api/project/${projectId}/avatar${mockQuery}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          species: selectedSpecies?.id,
          wearableIds: selectedWearables,
          petSize,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `生成请求失败 HTTP ${res.status}`);
      }
    } catch (e) {
      setJobError(e instanceof Error ? e.message : String(e));
      setPipelineActive(false);
    }
  };

  // 生成后切换装扮 → 标记需重新生成。
  const handleToggleWearable = (id) => {
    onToggleWearable(id);
    if (avatarJob?.status === 'done' || pipelineActive) setWearablesDirty(true);
  };

  const stageIndex = computeStageIndex(avatarJob, sliceJob);
  const showPipeline = pipelineActive || avatarJob?.status === 'running' || (avatarJob?.status === 'done' && !modelReady);
  const showFailure = !!jobError || avatarJob?.status === 'failed';

  return (
    <section className="pet-creator-section" ref={sectionRef}>
      {/* 新增元素样式贴 V3 HUD/徽标语汇（暗底、毛玻璃、胶囊），不引入新设计语言 */}
      <style>{`
        .avatar-pipeline {
          position: absolute; left: 18px; right: 18px; bottom: 18px; z-index: 3;
          display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px;
          border-radius: 20px; background: rgba(255,255,255,0.1); padding: 12px;
          backdrop-filter: blur(18px);
        }
        .pipeline-step { display: grid; justify-items: center; gap: 6px; text-align: center; }
        .pipeline-step em {
          font-style: normal; font-size: 11px; color: rgba(255,255,255,0.5); line-height: 1.2;
        }
        .pipeline-step .pipeline-dot {
          width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center;
          font-size: 12px; background: rgba(255,255,255,0.12); color: rgba(255,255,255,0.6);
          border: 1px solid rgba(255,255,255,0.14); transition: all .3s ease;
        }
        .pipeline-step.active .pipeline-dot {
          background: #fff; color: #000; border-color: #fff;
          box-shadow: 0 0 0 4px rgba(255,255,255,0.15);
        }
        .pipeline-step.active em { color: #fff; }
        .pipeline-step.done .pipeline-dot { background: rgba(215,181,109,0.9); color: #000; border-color: transparent; }
        .pipeline-step.done em { color: rgba(255,255,255,0.7); }
        .avatar-failure {
          position: absolute; left: 18px; right: 18px; bottom: 18px; z-index: 3;
          display: grid; gap: 6px; justify-items: start;
          border-radius: 20px; background: rgba(60,20,20,0.55); padding: 14px;
          backdrop-filter: blur(18px); border: 1px solid rgba(255,120,120,0.4);
        }
        .avatar-failure strong { font-size: 15px; color: #ffd7d7; font-weight: 500; }
        .avatar-failure em { font-style: normal; font-size: 12px; color: rgba(255,255,255,0.7); }
        .avatar-retry {
          margin-top: 4px; min-height: 36px; padding: 0 18px; border: 0; border-radius: 999px;
          background: #fff; color: #000; cursor: pointer; font-size: 13px;
        }
        .wearable-dirty-hint {
          margin: 4px 0 10px; padding: 8px 14px; border-radius: 999px; font-size: 12px;
          background: rgba(215,181,109,0.16); color: #8a6a2a; border: 1px solid rgba(215,181,109,0.5);
        }
        .pet-viewer-overlay {
          position: absolute; inset: 0; display: grid; place-items: center; z-index: 2;
          color: rgba(255,255,255,0.7); font-size: 13px; pointer-events: none;
        }
        .pet-viewer-overlay--error { color: #ffb3b3; padding: 24px; text-align: center; }
      `}</style>
      <div className="creator-copy">
        <span className="eyebrow">创建专属宠物档案</span>
        <h2>上传你的爱宠照片和信息，同步赛博云宠，快来装扮你的爱宠吧。</h2>
        <p>体验要像游戏角色预览：上传宠物照片，生成角色，旋转查看，再为它添加带价格的付费装扮。</p>
      </div>
      <div className="creator-layout">
        <div className="creator-controls">
          <div className="field-card">
            <label htmlFor="pet-name">宠物名字</label>
            <input id="pet-name" value={petName} onChange={(event) => onPetNameChange(event.target.value)} />
          </div>
          <div className="field-card">
            <label>物种</label>
            <div className="species-select-row">
              {species.map((item) => (
                <button
                  className={selectedSpecies.id === item.id ? 'active' : ''}
                  key={item.id}
                  type="button"
                  onClick={() => onSelectSpecies(item.id)}
                >
                  {item.name}
                </button>
              ))}
            </div>
          </div>
          <div className="field-card">
            <label htmlFor="pet-size">体型大小</label>
            <input
              id="pet-size"
              type="range"
              min="1"
              max="5"
              step="1"
              value={petSize}
              onChange={(event) => onPetSizeChange(Number(event.target.value))}
            />
            <div className="size-scale">
              <span>迷你</span>
              <strong>{petSize}</strong>
              <span>大型</span>
            </div>
          </div>
          <label className="upload-pet-card">
            <input type="file" accept="image/*" onChange={handleUpload} />
            {petImageUrl ? (
              <img src={petImageUrl} alt={`${petName || '宠物'} 上传预览`} />
            ) : (
              <span className="upload-empty">
                <Upload size={22} strokeWidth={1.6} />
                <strong>上传宠物照片</strong>
                <em>正面 / 侧面照片</em>
              </span>
            )}
          </label>
        </div>
        <div className="avatar-stage-card">
          <div className={`avatar-stage ${avatarGenerated ? 'generated' : ''}`}>
            {petImageUrl && (
              <div className="avatar-source-photo">
                <img src={avatarJob?.styledImageUrl || petImageUrl} alt={`${petName || '宠物'} 参考照片`} />
                <span>{avatarJob?.styledImageUrl ? '风格化立绘' : '参考照片'}</span>
              </div>
            )}
            <div className="avatar-species-tag">
              <span>{selectedSpecies.name}</span>
              <strong>Lv. {petSize} 档案</strong>
            </div>

            {/* 舞台内容三态：three.js 模型 ready / 管线 loading / 原 CSS avatar（生成前保持不变）*/}
            {modelReady ? (
              <PetViewer modelUrl={avatarJob.modelUrl} />
            ) : (
              <div
                className="avatar-turntable"
                style={{ '--avatar-rotate': `${avatarRotation}deg` }}
              >
                <div className="avatar-model-shell" style={{ '--avatar-size': avatarScale }}>
                  <div className={`avatar-body ${selectedSpecies.id}`}>
                    <span className="avatar-ear left" />
                    <span className="avatar-ear right" />
                    <span className="avatar-face" />
                    {selectedWearables.includes('knit-hat') && <span className="wearable-hat" />}
                    {selectedWearables.includes('chef-scarf') && <span className="wearable-scarf" />}
                    {selectedWearables.includes('name-charm') && <span className="wearable-charm" />}
                    {selectedWearables.includes('mini-cape') && <span className="wearable-cape" />}
                  </div>
                </div>
              </div>
            )}

            {/* 管线阶段进度（当前高亮 + 已完成打勾）*/}
            {showPipeline && !showFailure && (
              <div className="avatar-pipeline">
                {STAGE_STEPS.map((step, i) => {
                  const state = i < stageIndex ? 'done' : i === stageIndex ? 'active' : 'pending';
                  return (
                    <div key={step.key} className={`pipeline-step ${state}`}>
                      <span className="pipeline-dot">{state === 'done' ? '✓' : i + 1}</span>
                      <em>{step.label}</em>
                    </div>
                  );
                })}
              </div>
            )}

            {/* 失败态 + 重试 */}
            {showFailure && (
              <div className="avatar-failure">
                <strong>生成失败</strong>
                <em>{jobError || avatarJob?.error || '请重试'}</em>
                <button type="button" className="avatar-retry" onClick={handleGenerate}>
                  重试
                </button>
              </div>
            )}

            {!showPipeline && !showFailure && (
              <div className="avatar-hud">
                <span>{modelReady ? '已生成 3D 模型' : avatarGenerated ? '已生成角色预览' : '等待生成'}</span>
                <strong>{petName || '你的宠物'}</strong>
                <em>
                  {selectedSpecies.name} / 体型 {petSize} /{' '}
                  {modelReady ? '拖拽可 360° 旋转' : avatarGenerated ? '可旋转查看' : '请先上传照片'}
                </em>
              </div>
            )}
          </div>

          {/* 旋转滑块仅 CSS avatar 态显示；GLB 态由 OrbitControls 接管（F20）*/}
          {!modelReady && (
            <div className="avatar-control-panel">
              <div className="rotate-control">
                <Rotate3D size={18} strokeWidth={1.8} />
                <label htmlFor="avatar-rotation">旋转预览</label>
                <input
                  id="avatar-rotation"
                  type="range"
                  min="0"
                  max="360"
                  value={avatarRotation}
                  onChange={(event) => onAvatarRotationChange(Number(event.target.value))}
                />
                <strong>{avatarRotation}deg</strong>
              </div>
              <div className="loadout-row">
                {wearableItems.map((item) => (
                  <span className={selectedWearables.includes(item.id) ? 'equipped' : ''} key={item.id}>
                    {selectedWearables.includes(item.id) ? item.title : '空槽位'}
                  </span>
                ))}
              </div>
            </div>
          )}

          <button
            className="generate-avatar-button"
            type="button"
            onClick={handleGenerate}
            disabled={!petImageUrl || pipelineActive}
          >
            {pipelineActive
              ? '生成中…'
              : avatarGenerated
                ? '重新生成 3D 可旋转预览'
                : '生成 3D 可旋转预览'}
          </button>
        </div>
        <div className="wearable-shop">
          <div className="shop-head">
            <span>爱宠装扮商店</span>
            <strong>装扮合计：¥{wearableTotal}</strong>
          </div>
          {wearablesDirty && (
            <div className="wearable-dirty-hint">已更换装扮 · 重新生成以应用新装扮</div>
          )}
          <div className="wearable-grid">
            {wearableItems.map((item) => (
              <button
                className={`wearable-card ${selectedWearables.includes(item.id) ? 'selected' : ''}`}
                key={item.id}
                type="button"
                onClick={() => handleToggleWearable(item.id)}
              >
                <AssetPlaceholder title={item.title} ratio="穿戴商品图 / 1:1" icon={Gift} />
                <span>{item.fit}</span>
                <strong>{item.title}</strong>
                <em>{item.price}</em>
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
