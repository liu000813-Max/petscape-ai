import React, { useEffect, useRef, useState } from 'react';
import { Camera, Upload, WandSparkles } from 'lucide-react';
import { ImageDropzone } from '../ImageDropzone';

const DEFAULT_VIBE = '森林奶酪屋，童话厨房氛围，适合花枝鼠钻洞、觅食和攀爬。';

// 批次2（F36-F39）：cage 照真实上传（POST /upload kind=cage）+ 宠物照自动带入创建器已传图（可另选替换，
// 替换仅影响本区展示、不回写创建器 state）+ vibe 文字可编辑 + 生成按钮打 POST vibe → 轮询 project。
export function UploadVibeSection({ projectId, mockMode, petImageUrl }) {
  const [vibeText, setVibeText] = useState(DEFAULT_VIBE);
  const [cagePreviewUrl, setCagePreviewUrl] = useState('');
  const [localPetPreviewUrl, setLocalPetPreviewUrl] = useState('');
  const [status, setStatus] = useState('idle'); // idle | running | done | failed
  const [error, setError] = useState('');
  const pollRef = useRef(null);

  // 宠物位默认跟随创建器已传照片；用户在本区另选成功上传后，改用后端返回 URL 作为本区预览。
  const petPreviewUrl = localPetPreviewUrl || petImageUrl || '';

  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current);
  }, []);

  const mockQuery = mockMode ? '?mock=1' : '';

  const uploadImage = async (file, kind) => {
    if (!projectId) throw new Error('项目还在初始化，请稍后再试');
    const form = new FormData();
    form.append('file', file);
    form.append('kind', kind);
    const res = await fetch(`/api/project/${projectId}/upload`, { method: 'POST', body: form });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || '上传失败');
    }
    return res.json();
  };

  const handleCageUpload = async (file) => {
    const data = await uploadImage(file, 'cage');
    setCagePreviewUrl(data.url);
  };

  const handlePetReplace = async (file) => {
    const data = await uploadImage(file, 'pet');
    setLocalPetPreviewUrl(data.url);
  };

  const pollProject = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      const res = await fetch(`/api/project/${projectId}`);
      if (!res.ok) return;
      const data = await res.json();
      const job = data.vibeRender;
      if (!job) return;
      if (job.status === 'done') {
        setStatus('done');
        clearInterval(pollRef.current);
      } else if (job.status === 'failed') {
        setStatus('failed');
        setError(job.error || '生成失败');
        clearInterval(pollRef.current);
      }
    }, 1000);
  };

  const handleGenerate = async () => {
    if (!projectId || !cagePreviewUrl) return;
    setStatus('running');
    setError('');
    const res = await fetch(`/api/project/${projectId}/vibe${mockQuery}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vibe: vibeText }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setStatus('failed');
      setError(data.error || '生成失败');
      return;
    }
    pollProject();
  };

  const canGenerate = !!cagePreviewUrl && status !== 'running';

  return (
    <section className="builder-section">
      <div className="builder-left">
        <span className="eyebrow">上传与 Vibe 描述</span>
        <h2>上传真实环境，再描述你想要的宠物小家。</h2>
        <p>当前 demo 保留上传位、生成路径和订单交接逻辑，后续可连接生图模型、混元 3D 和生产报价。</p>
        <div className="prompt-box">
          <WandSparkles size={18} />
          <textarea
            className="vibe-textarea"
            value={vibeText}
            onChange={(event) => setVibeText(event.target.value)}
            rows={2}
          />
          <button type="button" onClick={handleGenerate} disabled={!canGenerate}>
            {status === 'running' ? '生成中…' : '生成'}
          </button>
        </div>
        {status === 'running' && (
          <div className="vibe-generating-hint">
            <span>正在生成改造效果图，请稍候…</span>
          </div>
        )}
        {status === 'failed' && error && (
          <div className="vibe-generating-hint vibe-error-hint">
            <span>{error}</span>
          </div>
        )}
      </div>
      <div className="upload-grid">
        <ImageDropzone
          className="upload-vibe-card"
          data-ratio="4:3"
          previewUrl={cagePreviewUrl}
          alt="当前笼箱照片预览"
          onFile={handleCageUpload}
          emptyContent={
            <span className="upload-empty">
              <Upload size={22} strokeWidth={1.6} />
              <strong>当前笼箱照片</strong>
              <em>4:3</em>
            </span>
          }
        />
        <ImageDropzone
          className="upload-vibe-card"
          data-ratio="1:1"
          previewUrl={petPreviewUrl}
          alt="宠物照片预览"
          onFile={handlePetReplace}
          emptyContent={
            <span className="upload-empty">
              <Camera size={22} strokeWidth={1.6} />
              <strong>宠物照片</strong>
              <em>1:1</em>
            </span>
          }
        />
      </div>
    </section>
  );
}
