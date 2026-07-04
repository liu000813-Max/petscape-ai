import React, { useEffect, useRef, useState } from 'react';
import { Camera, Upload, WandSparkles } from 'lucide-react';
import { ImageDropzone } from '../ImageDropzone';

const DEFAULT_VIBE = '森林奶酪屋，童话厨房氛围，适合花枝鼠钻洞、觅食和攀爬。';
const MAX_VIBE_PROMPT_CHARS = 200;

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

const sanitizeVibePrompt = (text) => {
  const compact = text
    .replace(/\r?\n+/g, '')
    .replace(/\s+/g, '')
    .replace(/^[#*\-\s]*(?:VIBE|vibe|提示词|改写|输出|结果)[：:]/, '')
    .replace(/^["'“”‘’`]+|["'“”‘’`]+$/g, '')
    .trim();
  return Array.from(compact).slice(0, MAX_VIBE_PROMPT_CHARS).join('');
};

const createStructuredVibePrompt = (text, selectedSpecies, hasEnvironmentImage) => {
  const idea = extractPromptIdea(text);
  const compactIdea = sanitizeVibePrompt(idea);
  const hasOldStructuredLabels = /原始想法[：:]|主题[：:]|氛围[：:]|宠物活动[：:]|空间结构[：:]|材质与安全[：:]|画面约束[：:]/.test(idea);
  if (compactIdea.length >= 45 && compactIdea.length <= 120 && !hasOldStructuredLabels) {
    return compactIdea;
  }

  const parts = splitPromptParts(idea);
  const theme = parts[0] || idea;
  const speciesName = selectedSpecies?.name || selectedSpecies?.label || selectedSpecies?.id || '小宠';
  const mood =
    pickPromptPart(parts, [/氛围/, /风格/, /感觉/]) ||
    pickPromptPart(parts, [/童话/, /自然/, /温馨/, /科幻/, /森林/, /厨房/]) ||
    '温暖清晰、有宠物小家的故事感';
  const activity =
    pickActivityPart(parts) ||
    '安排钻洞、觅食、攀爬和休息的自然动线';
  const environmentRule = hasEnvironmentImage ? '保留原笼箱结构和比例' : '形成清晰的小家空间层次';

  return sanitizeVibePrompt(
    `为${speciesName}打造${theme}主题小家，${mood}，${environmentRule}，加入圆角洞口和觅食层板，${activity}。`,
  );
};

// 批次2（F36-F39）：cage 照真实上传（POST /upload kind=cage）+ 宠物照自动带入创建器已传图（可另选替换，
// 替换仅影响本区展示、不回写创建器 state）+ vibe 文字可编辑 + 生成按钮打 POST vibe → 轮询 project。
export function UploadVibeSection({ projectId, mockMode, petImageUrl, selectedSpecies }) {
  const [vibeText, setVibeText] = useState(DEFAULT_VIBE);
  const [cagePreviewUrl, setCagePreviewUrl] = useState('');
  const [localPetPreviewUrl, setLocalPetPreviewUrl] = useState('');
  const [status, setStatus] = useState('idle'); // idle | running | done | failed
  const [isRewriting, setIsRewriting] = useState(false);
  const [error, setError] = useState('');
  const pollRef = useRef(null);
  const vibeTextareaRef = useRef(null);
  const latestVibeTextRef = useRef(vibeText);
  const rewriteLockRef = useRef(false);
  const rewriteRequestIdRef = useRef(0);

  // 宠物位默认跟随创建器已传照片；用户在本区另选成功上传后，改用后端返回 URL 作为本区预览。
  const petPreviewUrl = localPetPreviewUrl || petImageUrl || '';
  latestVibeTextRef.current = vibeText;

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

  const handleStructurePrompt = async () => {
    if (rewriteLockRef.current) return;

    const requestText = vibeText;
    const requestId = rewriteRequestIdRef.current + 1;
    rewriteRequestIdRef.current = requestId;
    rewriteLockRef.current = true;

    const fallbackPrompt = createStructuredVibePrompt(requestText, selectedSpecies, Boolean(cagePreviewUrl));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4800);
    const commitRewriteResult = (nextPrompt) => {
      if (rewriteRequestIdRef.current === requestId && latestVibeTextRef.current === requestText) {
        setVibeText(nextPrompt);
      }
    };

    setIsRewriting(true);
    try {
      const res = await fetch('/api/vibe/rewrite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: requestText,
          species: selectedSpecies?.name || selectedSpecies?.label || selectedSpecies?.id,
          hasEnvironmentImage: Boolean(cagePreviewUrl),
        }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error('rewrite failed');

      const data = await res.json().catch(() => ({}));
      const nextPrompt = sanitizeVibePrompt(typeof data.prompt === 'string' ? data.prompt : '');
      commitRewriteResult(nextPrompt || fallbackPrompt);
    } catch {
      commitRewriteResult(fallbackPrompt);
    } finally {
      clearTimeout(timeout);
      if (rewriteRequestIdRef.current === requestId) {
        rewriteLockRef.current = false;
        setIsRewriting(false);
      }
    }
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
            disabled={isRewriting}
            aria-label="用 AI 润色当前 Vibe 描述"
            title="用 AI 润色当前 Vibe 描述"
          >
            <WandSparkles size={18} strokeWidth={1.8} aria-hidden="true" />
          </button>
          <textarea
            ref={vibeTextareaRef}
            className="vibe-textarea"
            value={vibeText}
            onChange={(event) => {
              latestVibeTextRef.current = event.target.value;
              setVibeText(event.target.value);
            }}
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
        {isRewriting && status !== 'running' && (
          <div className="vibe-generating-hint">
            <span>正在润色描述…</span>
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
