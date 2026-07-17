'use client';

import dynamic from 'next/dynamic';

// three.js 用 window/document，SSR 会报错，同 tldraw 一样必须 next/dynamic + ssr:false。
const SceneLabViewer = dynamic(() => import('./SceneLabViewer'), {
  ssr: false,
  loading: () => <div style={{ padding: 24 }}>场景加载中…</div>,
});

export default function SceneLabPage() {
  return <SceneLabViewer />;
}
