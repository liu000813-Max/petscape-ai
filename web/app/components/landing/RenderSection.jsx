import React from 'react';
import { Image, Sparkles } from 'lucide-react';
import { AssetPlaceholder } from './AssetPlaceholder';

export function RenderSection() {
  return <section className="render-section"><div className="section-copy"><span>AI 效果图</span><h2>一键生成社媒传播预览，查看小窝的出片效果。</h2></div><div className="render-grid"><AssetPlaceholder title="改造前环境" ratio="4:3" icon={Image} tone="dark" /><AssetPlaceholder title="AI 改造效果图" ratio="16:9" icon={Sparkles} tone="dark" /><AssetPlaceholder title="小红书分享图" ratio="3:4" icon={Image} tone="dark" /></div></section>;
}
