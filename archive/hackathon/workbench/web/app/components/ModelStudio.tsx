'use client';

import { useEffect, useRef } from 'react';
import type { ModelConfig, PetScapeProject } from '../lib/types/project';
import { defaultModelConfig } from '../lib/types/project';

// 3D 预览调参覆盖层（tuning3d 态）。只做真实能力：
//  - 整体尺寸滑块 80–160mm（存 modelConfig.scaleMm，门 2 时驱动 normalize）
//  - 颜色/材质 swatch（渲染层：model-viewer scene-graph 改 baseColorFactor）
//  - 洞口直径显示为锁定项 + 说明（不造假控件）
// GLB/model-viewer 只在浏览器加载，父组件已在 client 环境。

const MATERIALS: { label: string; color: string }[] = [
  { label: 'PLA 木纹', color: '#C08A5A' },
  { label: 'PLA 哑光白', color: '#E8E4DA' },
  { label: 'PLA 森绿', color: '#4B7A5A' },
  { label: 'PLA 陶土橙', color: '#C6693B' },
];

function hexToRgb01(hex: string): [number, number, number, number] {
  const m = hex.replace('#', '');
  const r = parseInt(m.slice(0, 2), 16) / 255;
  const g = parseInt(m.slice(2, 4), 16) / 255;
  const b = parseInt(m.slice(4, 6), 16) / 255;
  return [r, g, b, 1];
}

export default function ModelStudio({
  project,
  mock,
  onUpdateConfig,
  onConfirmGate2,
}: {
  project: PetScapeProject;
  mock: boolean;
  onUpdateConfig: (partial: Partial<ModelConfig>) => void;
  onConfirmGate2: () => void;
}) {
  const viewerRef = useRef<any>(null);
  const config = project.modelConfig ?? defaultModelConfig();
  const model3d = project.model3d;
  const slice = project.slice;
  const glbPath = model3d?.glbPath;
  const ready = model3d?.status === 'ready' && Boolean(glbPath);

  // model-viewer 是 web component，需在浏览器注册一次。
  useEffect(() => {
    void import('@google/model-viewer');
  }, []);

  // 颜色/材质变化 → 用 model-viewer scene-graph API 改所有材质的 baseColorFactor（渲染层，不改几何）。
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !ready) return;
    let cancelled = false;
    const apply = () => {
      if (cancelled) return;
      const model = viewer.model;
      if (!model?.materials) return;
      const rgba = hexToRgb01(config.color);
      for (const mat of model.materials) {
        try {
          mat.pbrMetallicRoughness?.setBaseColorFactor(rgba);
        } catch {}
      }
    };
    // 首次可能模型未加载完，监听 load 事件再套色。
    if (viewer.model) apply();
    viewer.addEventListener('load', apply);
    return () => {
      cancelled = true;
      viewer.removeEventListener('load', apply);
    };
  }, [config.color, ready, glbPath]);

  const progress = model3d?.progress ?? 0;

  return (
    <div className="absolute inset-0 z-30 flex">
      {/* 主区：3D 状态卡 或 model-viewer */}
      <div className="relative flex flex-1 items-center justify-center p-6">
        {!ready ? (
          <div className="flex w-[380px] flex-col items-center gap-4 rounded-2xl border border-line bg-card px-8 py-10 text-center shadow-workbench">
            <div className="text-[15px] font-semibold text-ink">
              {model3d?.status === 'failed' ? '3D 生成失败' : '正在生成 3D · 检查可打印性'}
            </div>
            {model3d?.status === 'failed' ? (
              <div className="text-[12px] leading-relaxed text-anno">{model3d.error}</div>
            ) : (
              <>
                <div className="h-2 w-full overflow-hidden rounded-full bg-[#E6E2D6]">
                  <div className="h-full bg-forest transition-all" style={{ width: `${Math.max(4, progress)}%` }} />
                </div>
                <div className="text-[12px] text-ink-soft">
                  正在把白底物品图转成可打印的 3D 模型并检查可打印性…（约 2–3 分钟）
                </div>
              </>
            )}
          </div>
        ) : (
          <div
            className="relative h-full w-full overflow-hidden rounded-2xl border border-line bg-white shadow-workbench"
            data-testid="model-studio-viewer"
          >
            {/* @ts-expect-error model-viewer 是自定义元素 */}
            <model-viewer
              ref={viewerRef}
              src={glbPath}
              alt="3D 模型预览"
              camera-controls
              auto-rotate
              shadow-intensity="0.8"
              exposure="1"
              style={{ width: '100%', height: '100%', background: '#F6F4EE' }}
            />
            <div className="absolute left-3 top-3 rounded-full border border-line bg-card/90 px-3 py-1 text-[11px] text-ink-soft">
              可拖拽旋转 · 滚轮缩放
            </div>
          </div>
        )}
      </div>

      {/* 右浮参数面板 */}
      {ready && (
        <div className="flex w-[300px] flex-col gap-4 overflow-y-auto border-l border-line bg-card p-5 shadow-workbench">
          <div>
            <div className="text-[10px] uppercase tracking-[2px] text-ink-soft">门 2 · 3D 预览调参</div>
            <h3 className="mt-1 font-display text-[17px] font-bold">
              {project.itemName ?? '目标物品'}
            </h3>
          </div>

          {/* 整体尺寸滑块 */}
          <div>
            <div className="mb-1.5 flex items-center justify-between text-[12px] font-semibold text-ink">
              <span>整体尺寸（最长边）</span>
              <span className="text-forest" data-testid="scale-readout">
                {Math.round(config.scaleMm)} mm
              </span>
            </div>
            <input
              type="range"
              min={80}
              max={160}
              step={1}
              value={config.scaleMm}
              onChange={(e) => onUpdateConfig({ scaleMm: Number(e.target.value) })}
              className="w-full accent-forest"
              data-testid="scale-slider"
            />
            <div className="mt-1 flex justify-between text-[10px] text-ink-soft">
              <span>80mm</span>
              <span>160mm</span>
            </div>
            <div className="mt-1 text-[10.5px] text-ink-soft">门 2 切片时把模型标准化到这个目标尺寸。</div>
          </div>

          {/* 颜色 / 材质 swatch（渲染层） */}
          <div>
            <div className="mb-1.5 text-[12px] font-semibold text-ink">颜色 / 材质</div>
            <div className="flex flex-wrap gap-2" data-testid="material-swatches">
              {MATERIALS.map((m) => {
                const on = config.material === m.label;
                return (
                  <button
                    key={m.label}
                    onClick={() => onUpdateConfig({ material: m.label, color: m.color })}
                    className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition ${
                      on ? 'border-forest bg-forest/10 font-medium text-ink' : 'border-line bg-[#FDFCF9] text-ink-soft hover:border-forest-soft'
                    }`}
                  >
                    <span className="h-3.5 w-3.5 rounded-full border border-black/10" style={{ background: m.color }} />
                    {m.label}
                  </button>
                );
              })}
            </div>
            <div className="mt-1 text-[10.5px] text-ink-soft">颜色即时反映在预览上（渲染层）。</div>
          </div>

          {/* 洞口直径 · 锁定项 */}
          <div className="rounded-xl border border-line bg-[#F7F5EF] px-3 py-2.5">
            <div className="flex items-center justify-between text-[12px] font-semibold text-ink">
              <span>洞口直径</span>
              <span className="text-[11px] text-ink-soft">🔒 锁定</span>
            </div>
            <div className="mt-1 text-[10.5px] leading-relaxed text-ink-soft">
              按体型约束推荐，调整能力开发中。
            </div>
          </div>

          {/* 可打印性摘要 */}
          {model3d?.printabilityIssues && model3d.printabilityIssues.length > 0 && (
            <div className="text-[10.5px] leading-relaxed text-ink-soft">
              可打印性检查：{model3d.printabilityIssues.slice(0, 4).join(' · ')}
            </div>
          )}

          {/* 门 2 / 切片状态 / 下载 */}
          <div className="mt-auto border-t border-line pt-4">
            {slice?.status === 'ready' ? (
              <div className="space-y-2" data-testid="slice-ready">
                <div className="text-[12px] font-semibold text-forest">打印文件已就绪 ✓</div>
                {(slice.estimatedTime || slice.filament) && (
                  <div className="text-[10.5px] text-ink-soft">
                    {slice.estimatedTime && <span>预估 {slice.estimatedTime}</span>}
                    {slice.filament && <span> · 耗材 {slice.filament}</span>}
                  </div>
                )}
                <div className="flex gap-2">
                  <a
                    href={slice.stlPath}
                    download
                    data-testid="download-stl"
                    className="flex-1 rounded-lg border border-forest bg-forest/10 py-2 text-center text-[12px] font-semibold text-forest transition hover:bg-forest/20"
                  >
                    下载 STL
                  </a>
                  <a
                    href={slice.gcodePath}
                    download
                    data-testid="download-gcode"
                    className="flex-1 rounded-lg bg-forest py-2 text-center text-[12px] font-semibold text-white transition hover:bg-forest-deep"
                  >
                    下载 G-code
                  </a>
                </div>
              </div>
            ) : slice?.status === 'running' ? (
              <div className="rounded-lg border border-line bg-[#F7F5EF] px-3 py-2.5 text-center text-[12px] text-ink-soft">
                正在准备打印文件…（切片分钟级）
              </div>
            ) : slice?.status === 'failed' ? (
              <div className="space-y-2">
                <div className="text-[11px] text-anno">切片失败：{slice.error}</div>
                <button
                  onClick={onConfirmGate2}
                  className="w-full rounded-lg bg-forest py-2.5 text-[13px] font-semibold text-white hover:bg-forest-deep"
                >
                  重试切片
                </button>
              </div>
            ) : (
              <button
                onClick={onConfirmGate2}
                data-testid="confirm-gate2"
                className="w-full rounded-lg bg-forest py-2.5 text-[13px] font-semibold text-white transition hover:bg-forest-deep"
              >
                确认模型与参数 ✓
              </button>
            )}
            {mock && <div className="mt-2 text-center text-[9.5px] text-ink-soft">mock 模式：占位产物</div>}
          </div>
        </div>
      )}
    </div>
  );
}
