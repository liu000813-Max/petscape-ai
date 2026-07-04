import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Plus } from 'lucide-react';
import { ease, species } from './data';

export function SpeciesShowcase({ selectedSpeciesId, onSelectSpecies, onAddPet }) {
  const selectedIndex = Math.max(0, species.findIndex(item => item.id === selectedSpeciesId));
  const [activeIndex, setActiveIndex] = useState(selectedIndex);
  const [rotationSeed, setRotationSeed] = useState(0);

  useEffect(() => {
    const nextIndex = Math.max(0, species.findIndex(item => item.id === selectedSpeciesId));
    setActiveIndex(nextIndex);
  }, [selectedSpeciesId]);

  useEffect(() => {
    // onSelectSpecies 不能放进 setActiveIndex 的 updater——updater 必须纯函数，
    // React 18 会在 render 阶段重放它，触发 setState-in-render 警告（V3 原版既有问题）。
    // activeIndex 入依赖：每次切换（自动或手动）都重建计时器，即"交互重置 4.2s 倒计时"。
    const timer = window.setInterval(() => {
      const next = (activeIndex + 1) % species.length;
      setActiveIndex(next);
      onSelectSpecies(species[next].id);
    }, 4200);
    return () => window.clearInterval(timer);
  }, [activeIndex, onSelectSpecies, rotationSeed]);

  const chooseSpecies = index => {
    setActiveIndex(index);
    onSelectSpecies(species[index].id);
    setRotationSeed(seed => seed + 1);
  };

  const getCardPose = index => {
    const rawOffset = index - activeIndex;
    const half = species.length / 2;
    let offset = rawOffset;
    if (rawOffset > half) offset -= species.length;
    if (rawOffset < -half) offset += species.length;
    const distance = Math.abs(offset);
    return {
      x: offset * 235,
      y: distance * 12,
      scale: distance === 0 ? 1 : distance === 1 ? 0.84 : 0.68,
      opacity: distance === 0 ? 1 : distance === 1 ? 0.68 : 0.36,
      rotateY: offset * -13,
      zIndex: 20 - distance
    };
  };

  return <section className="species-section"><div className="section-copy"><span>大众物种入口</span><h2>先从熟悉的宠物进入，再浏览它专属的白底配件。</h2></div><div className="species-carousel" aria-label="宠物物种横向轮转卡片"><div className="species-carousel-stage">{species.map((item, index) => { const pose = getCardPose(index); const isActive = index === activeIndex; return <motion.button className={`species-card species-button carousel-species-card ${isActive ? 'selected' : ''}`} key={item.id} type="button" onClick={() => chooseSpecies(index)} animate={{ x: pose.x, y: pose.y, scale: pose.scale, opacity: pose.opacity, rotateY: pose.rotateY }} transition={{ duration: 0.82, ease }} style={{ zIndex: pose.zIndex }} aria-pressed={isActive}><div className="species-image-frame"><img src={item.image} alt={`${item.name} 档案卡照片`} /><span>{item.name} 档案图 / 4:5</span></div><div className="species-copy"><span>{item.en}</span><h3>{item.name}</h3><p>{item.habitat}</p><div className="profile-tags">{item.traits.map(trait => <span key={trait}>{trait}</span>)}</div><strong>{item.material}</strong></div></motion.button>; })}</div><div className="species-dots">{species.map((item, index) => <button className={index === activeIndex ? 'active' : ''} key={item.id} type="button" onClick={() => chooseSpecies(index)} aria-label={`切换到${item.name}`} />)}</div><button className="add-species-card compact-add-species" type="button" onClick={onAddPet}><span className="add-species-icon"><Plus size={20} strokeWidth={2.4} /></span><div><span>宠物档案</span><h3>创建专属宠物档案</h3><p>上传照片、记录名字与习性，让每一次装扮和打印都围绕你的爱宠展开。</p></div></button></div></section>;
}
