import React, { useEffect, useRef, useState } from 'react';
import { fetchLatestRenderState } from '../../lib/vibeRender';

// 批次2（F39）：三态展示——改造前(cage原图)/改造后(afterUrl)/小红书分享图(改造后图 3:4 中心裁切+品牌角标)。
// WP-G3：与 UploadVibeSection 解耦，靠轮询 GET /api/v1/projects/:id/renders 读最新
// vibe_render 任务的展示态（旧 GET /api/project/[id] 内存 vibeRender 已退役）。
// 「改造前」= 该任务引用的用户环境照签名 URL（与 main 行为等价：显示用户自己上传的
// 环境照）；纯 t2i 场景（无环境照）保留示例图 + 「示例」标签，与 main 生成前初始态一致。
export function RenderSection({ projectId }) {
  const [renderState, setRenderState] = useState({ beforeUrl: null, afterUrl: null });
  const pollRef = useRef(null);

  useEffect(() => {
    if (!projectId) return undefined;
    const handle = { aborted: false };
    pollRef.current = handle;
    let timer;
    const poll = async () => {
      if (handle.aborted) return;
      const next = await fetchLatestRenderState(projectId).catch(() => null);
      if (!handle.aborted && next) setRenderState({ beforeUrl: next.beforeUrl, afterUrl: next.afterUrl });
      if (!handle.aborted) timer = setTimeout(poll, 2000);
    };
    poll();
    return () => {
      handle.aborted = true;
      if (timer) clearTimeout(timer);
    };
  }, [projectId]);

  const hasLiveBefore = !!renderState.beforeUrl;
  const hasLiveAfter = !!renderState.afterUrl;
  const beforeUrl = hasLiveBefore ? renderState.beforeUrl : '/assets/social-before.png';
  const afterUrl = hasLiveAfter ? renderState.afterUrl : '/assets/social-after.png';
  const shareUrl = hasLiveAfter ? renderState.afterUrl : '/assets/social-xhs.png';

  return (
    <section className="render-section">
      <div className="section-copy">
        <span>AI 效果图</span>
        <h2>一键生成社媒传播预览，查看小窝的出片效果。</h2>
      </div>
      <div className="render-grid">
        <div className="render-photo-card" data-ratio="4:3">
          <img src={beforeUrl} alt="改造前环境" />
          <span className="render-photo-label">{hasLiveBefore ? '改造前环境' : '改造前环境示例'}</span>
        </div>
        <div className="render-photo-card" data-ratio="16:9">
          <img src={afterUrl} alt="AI 改造效果图" />
          <span className="render-photo-label">{hasLiveAfter ? 'AI 改造效果图' : 'AI 改造效果图示例'}</span>
        </div>
        <div className="render-photo-card share-card" data-ratio="3:4">
          <div className="share-crop">
            <img src={shareUrl} alt="小红书分享图" />
          </div>
          <div className="share-badge">
            <img src="/assets/petscape-logo.png" alt="" className="share-badge-logo" />
            <span>PetScape · 我的宠物小家改造</span>
          </div>
        </div>
      </div>
    </section>
  );
}
