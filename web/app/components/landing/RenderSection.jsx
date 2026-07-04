import React, { useEffect, useRef, useState } from 'react';
import { Image, Sparkles } from 'lucide-react';
import { AssetPlaceholder } from './AssetPlaceholder';

// 批次2（F39）：三态展示——改造前(cage原图)/改造后(afterUrl)/小红书分享图(改造后图 3:4 中心裁切+品牌角标)。
// 与 UploadVibeSection 解耦：不共享本地 state，靠轮询 GET /api/project/[id] 读 vibeRender 同步。
export function RenderSection({ projectId }) {
  const [vibeRender, setVibeRender] = useState(null);
  const pollRef = useRef(null);

  useEffect(() => {
    if (!projectId) return undefined;
    const poll = async () => {
      const res = await fetch(`/api/project/${projectId}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.vibeRender) setVibeRender(data.vibeRender);
    };
    poll();
    pollRef.current = setInterval(poll, 1000);
    return () => clearInterval(pollRef.current);
  }, [projectId]);

  const beforeUrl = vibeRender?.beforeUrl;
  const afterUrl = vibeRender?.status === 'done' ? vibeRender?.afterUrl : undefined;

  return (
    <section className="render-section">
      <div className="section-copy">
        <span>AI 效果图</span>
        <h2>一键生成社媒传播预览，查看小窝的出片效果。</h2>
      </div>
      <div className="render-grid">
        {beforeUrl ? (
          <div className="render-photo-card" data-ratio="4:3">
            <img src={beforeUrl} alt="改造前环境" />
            <span className="render-photo-label">改造前环境</span>
          </div>
        ) : (
          <AssetPlaceholder title="改造前环境" ratio="4:3" icon={Image} tone="dark" />
        )}
        {afterUrl ? (
          <div className="render-photo-card" data-ratio="16:9">
            <img src={afterUrl} alt="AI 改造效果图" />
            <span className="render-photo-label">AI 改造效果图</span>
          </div>
        ) : (
          <AssetPlaceholder title="AI 改造效果图" ratio="16:9" icon={Sparkles} tone="dark" />
        )}
        {afterUrl ? (
          <div className="render-photo-card share-card" data-ratio="3:4">
            <div className="share-crop">
              <img src={afterUrl} alt="小红书分享图" />
            </div>
            <div className="share-badge">
              <img src="/assets/petscape-logo.png" alt="" className="share-badge-logo" />
              <span>PetScape · 我的宠物小家改造</span>
            </div>
          </div>
        ) : (
          <AssetPlaceholder title="小红书分享图" ratio="3:4" icon={Image} tone="dark" />
        )}
      </div>
    </section>
  );
}
