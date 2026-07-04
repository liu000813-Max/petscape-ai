import React, { useEffect, useRef, useState } from 'react';
import { Camera, Upload, WandSparkles } from 'lucide-react';
import { ImageDropzone } from '../ImageDropzone';

const DEFAULT_VIBE = '森林奶酪屋，童话厨房氛围，适合花枝鼠钻洞、觅食和攀爬。';

const splitPromptParts = (text) =>
  text
    .split(/[\n，,。；;、]+/)
    .map((part) => part.trim())
    .filter(Boolean);

const extractPromptIdea = (text) => {
  const trimmed = text.trim();
  const originalIdea = trimmed.match(/^原始想法[：:]\s*(.+)$/m);
  return (originalIdea?.[1] || trimmed || DEFAULT_VIBE).trim();
};

const pickPromptPart = (parts, patterns) =>
  parts.find((part) => patterns.some((pattern) => pattern.test(part)));

const activityPatterns = [/适合/, /活动/, /钻/, /爬/, /攀/, /觅食/, /躲/, /跳/, /跑/, /睡/, /休息/];

const pickActivityPart = (parts) => {
  const startIndex = parts.findIndex((part) =>
    activityPatterns.some((pattern) => pattern.test(part)),
  );
  if (startIndex === -1) return '';

  const activityParts = [parts[startIndex]];
  for (const part of parts.slice(startIndex + 1)) {
    if (!activityPatterns.some((pattern) => pattern.test(part))) break;
    activityParts.push(part);
  }
  return activityParts.join('、');
};

const createStructuredVibePrompt = (text) => {
  const idea = extractPromptIdea(text);
  const parts = splitPromptParts(idea);
  const theme = parts[0] || idea;
  const mood =
    pickPromptPart(parts, [/氛围/, /风格/, /感觉/]) ||
    pickPromptPart(parts, [/童话/, /自然/, /温馨/, /科幻/, /森林/, /厨房/]) ||
    `${theme}的整体气质，温暖、清晰、有宠物小家的故事感`;
  const activity =
    pickActivityPart(parts) ||
    '安排钻洞、觅食、攀爬、躲藏和休息的连续动线';

  return [
    `原始想法：${idea}`,
    `主题：${theme}`,
    `氛围：${mood}`,
    `宠物活动：${activity}`,
    '空间结构：以前景入口、中景活动区、背景休息角形成层次，贴合当前笼箱比例，保留通风和日常照护空间。',
    '材质与安全：使用圆角、防滑、无尖锐边、易清洁的宠物友好材质，结构稳固，饮水和食盆位置不被遮挡。',
    '画面约束：基于真实笼箱照片改造，保持原始透视、光线和宠物尺度，画面明亮清晰，避免过度拥挤。',
  ].join('\n');
};

// 批次2（F36-F39）：cage 照真实上传（POST /upload kind=cage）+ 宠物照自动带入创建器已传图（可另选替换，
// 替换仅影响本区展示、不回写创建器 state）+ vibe 文字可编辑 + 生成按钮打 POST vibe → 轮询 project。
export function UploadVibeSection({ projectId, mockMode, petImageUrl }) {
  const [vibeText, setVibeText] = useState(DEFAULT_VIBE);
  const [cagePreviewUrl, setCagePreviewUrl] = useState('');
  const [localPetPreviewUrl, setLocalPetPreviewUrl] = useState('');
  const [status, setStatus] = useState('idle'); // idle | running | done | failed
  const [error, setError] = useState('');
  const pollRef = useRef(null);
  const vibeTextareaRef = useRef(null);

  // 宠物位默认跟随创建器已传照片；用户在本区另选成功上传后，改用后端返回 URL 作为本区预览。
  const petPreviewUrl = localPetPreviewUrl || petImageUrl || '';

  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current);
  }, []);

  useEffect(() => {
    const textarea = vibeTextareaRef.current;
    if (!textarea) return;

    const resizeTextarea = () => {
      textarea.style.height = 'auto';
      textarea.style.height = `${textarea.scrollHeight}px`;
    };

    resizeTextarea();
    window.addEventListener('resize', resizeTextarea);
    return () => window.removeEventListener('resize', resizeTextarea);
  }, [vibeText]);

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

  const handleStructurePrompt = () => {
    setVibeText((currentText) => createStructuredVibePrompt(currentText));
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
          <button
            type="button"
            className="vibe-structure-button"
            onClick={handleStructurePrompt}
            aria-label="将当前 Vibe 描述整理成结构化提示词"
            title="将当前 Vibe 描述整理成结构化提示词"
          >
            <WandSparkles size={18} strokeWidth={1.8} aria-hidden="true" />
          </button>
          <textarea
            ref={vibeTextareaRef}
            className="vibe-textarea"
            value={vibeText}
            onChange={(event) => setVibeText(event.target.value)}
            rows={2}
          />
          <button
            type="button"
            className="vibe-generate-button"
            onClick={handleGenerate}
            disabled={!canGenerate}
          >
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
