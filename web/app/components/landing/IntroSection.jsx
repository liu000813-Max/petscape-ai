import React from 'react';
import { Camera, HeartHandshake, ShieldCheck, Tags } from 'lucide-react';
import { ImageDropzone } from '../ImageDropzone';
import { uploadProjectImageAsset } from '../../lib/assetUpload';

export function IntroSection({ projectId, petImageUrl, onPetImageUpload, petName, petAge, selectedSpecies, petSize }) {
  const displayName = petName?.trim() || '爱宠';
  const speciesName = selectedSpecies?.name || '小宠';
  const ageLabel = petAge?.trim() || '未填写';
  const traits = selectedSpecies?.traits?.length ? selectedSpecies.traits : ['习性待补充'];
  const likes = selectedSpecies?.likes?.length ? selectedSpecies.likes : [selectedSpecies?.habitat || '按物种习性配置'];
  const risks = selectedSpecies?.risks?.length ? selectedSpecies.risks : ['尖角', '不稳结构', '难清洁死角'];
  const material = selectedSpecies?.material || '按物种选择安全材料';
  const sizeLabel = petSize ?? '默认';

  const handleAvatarUpload = async (file) => {
    if (!file) return;
    const previousPreviewUrl = petImageUrl;
    onPetImageUpload(file);
    if (!projectId) {
      onPetImageUpload(previousPreviewUrl || '');
      throw new Error('项目还在初始化，请稍后再试');
    }
    try {
      const { downloadUrl } = await uploadProjectImageAsset(projectId, file);
      onPetImageUpload(downloadUrl);
    } catch (error) {
      onPetImageUpload(previousPreviewUrl || '');
      throw error;
    }
  };

  return (
    <section className="intro-section">
      <div className="section-copy narrow">
        <span>完整落地链路</span>
        <h2>把爱宠档案、赛博云宠和真实打印小窝一次打通。</h2>
      </div>
      <div className="intro-grid">
        <div className="profile-panel">
          <ImageDropzone
            className="asset-placeholder profile-avatar-dropzone"
            previewUrl={petImageUrl}
            alt="宠物头像预览"
            onFile={handleAvatarUpload}
            emptyContent={(
              <>
                <Camera size={22} strokeWidth={1.6} />
                <strong>上传宠物头像</strong>
                <span>点击或拖入图片</span>
              </>
            )}
          />
          <div className="profile-copy">
            <span className="eyebrow">宠物档案</span>
            <h3>{displayName} 的档案</h3>
            <p>
              物种：{speciesName} / 年龄：{ageLabel} / 体型：{sizeLabel} 档 / 性格：{traits.join('、')}。
            </p>
            <div className="profile-tags">
              {traits.map(trait => <span key={trait}>{trait}</span>)}
            </div>
          </div>
        </div>
        <div className="habit-panel">
          <span className="eyebrow">习性适配规则</span>
          <h3>懂习性，才敢把梦中小窝真的带回家。</h3>
          <div className="habit-list">
            <div><HeartHandshake size={18} /><span>喜好：{likes.join('、')}</span></div>
            <div><ShieldCheck size={18} /><span>风险：{risks.join('、')}</span></div>
            <div><Tags size={18} /><span>材料：{material}</span></div>
          </div>
        </div>
      </div>
    </section>
  );
}
