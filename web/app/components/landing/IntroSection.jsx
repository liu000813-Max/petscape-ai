import React from 'react';
import { Camera, HeartHandshake, ShieldCheck, Tags } from 'lucide-react';
import { AssetPlaceholder } from './AssetPlaceholder';

export function IntroSection() {
  return <section className="intro-section"><div className="section-copy narrow"><span>完整落地链路</span><h2>把爱宠档案、赛博云宠和真实打印小窝一次打通。</h2></div><div className="intro-grid"><div className="profile-panel"><AssetPlaceholder title="上传宠物头像" ratio="1:1" icon={Camera} /><div className="profile-copy"><span className="eyebrow">宠物档案</span><h3>Nomi 的档案</h3><p>物种：花枝鼠 / 年龄：6 个月 / 性格：爱钻洞、爱攀爬、爱觅食。</p><div className="profile-tags"><span>爱社交</span><span>爱啃咬</span><span>需要多层空间</span></div></div></div><div className="habit-panel"><span className="eyebrow">习性适配规则</span><h3>懂习性，才敢把梦中小窝真的带回家。</h3><div className="habit-list"><div><HeartHandshake size={18} /><span>喜好：隧道、窝、层板、觅食区</span></div><div><ShieldCheck size={18} /><span>风险：尖角、小零件、尾巴卡缝、难清洁沟槽</span></div><div><Tags size={18} /><span>材料：优先 PETG、圆角处理、可拆卸连接件</span></div></div></div></div></section>;
}
