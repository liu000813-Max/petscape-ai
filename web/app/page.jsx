'use client';

import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { ease, species, modules } from './components/landing/data';
import { Navbar } from './components/landing/Navbar';
import { HeroFooter } from './components/landing/HeroFooter';
import { DetailDrawer } from './components/landing/DetailDrawer';
import { SpeciesShowcase } from './components/landing/SpeciesShowcase';
import { PetCreatorSection } from './components/landing/PetCreatorSection';
import { IntroSection } from './components/landing/IntroSection';
import { ModuleCommunitySection } from './components/landing/ModuleCommunitySection';
import { EnvironmentPreviewSection } from './components/landing/EnvironmentPreviewSection';
import { UploadVibeSection } from './components/landing/UploadVibeSection';
import { RenderSection } from './components/landing/RenderSection';
import { ScenePackSection } from './components/landing/ScenePackSection';
import { ManufacturingSection } from './components/landing/ManufacturingSection';
import { GiftSection } from './components/landing/GiftSection';
import { OrderFlowSection } from './components/landing/OrderFlowSection';
import { FlipCards } from './components/landing/FlipCards';
import './components/landing/styles.css';

export default function App() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedSpeciesId, setSelectedSpeciesId] = useState('rat');
  const [selectedIds, setSelectedIds] = useState(['cheese-lounge-bed', 'hanging-climb-baskets']);
  const [petName, setPetName] = useState('Nomi');
  const [petSize, setPetSize] = useState(3);
  const [petImageUrl, setPetImageUrl] = useState('');
  const [avatarGenerated, setAvatarGenerated] = useState(false);
  const [avatarRotation, setAvatarRotation] = useState(32);
  const [selectedWearables, setSelectedWearables] = useState(['knit-hat']);
  // 接驳层（批次0.5，主控维护）：projectId + mockMode 是后端批次的统一入口，App 此后冻结。
  const [projectId, setProjectId] = useState(null);
  const [mockMode, setMockMode] = useState(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setMockMode(params.has('mock'));
    const existing = params.get('project');
    const boot = async () => {
      // demo 双轨：?project=<id> 恢复已有项目（预生成的第二轨），无效或缺省则新建。
      if (existing) {
        const res = await fetch(`/api/project/${existing}`);
        if (res.ok) {
          const proj = await res.json();
          if (proj?.avatar?.status === 'done') setAvatarGenerated(true); // 舞台直接进 GLB 态
          setProjectId(existing);
          return;
        }
      }
      const res = await fetch('/api/project', { method: 'POST' });
      const project = await res.json();
      setProjectId(project.id);
    };
    boot().catch(() => setProjectId(null));
  }, []);
  const moduleMarketRef = useRef(null);
  const petCreatorRef = useRef(null);
  const selectedSpecies = species.find(item => item.id === selectedSpeciesId) || species[0];
  const selectedModules = modules.filter(module => selectedIds.includes(module.id));
  const scrollToModules = () => moduleMarketRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const scrollToPetCreator = () => petCreatorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const scrollToTop = () => window.scrollTo({ top: 0, behavior: 'smooth' });
  const toggleModule = moduleId => setSelectedIds(current => current.includes(moduleId) ? current.filter(id => id !== moduleId) : [...current, moduleId]);
  const addModules = moduleIds => setSelectedIds(current => [...new Set([...current, ...moduleIds])]);
  const toggleWearable = wearableId => setSelectedWearables(current => current.includes(wearableId) ? current.filter(id => id !== wearableId) : [...current, wearableId]);
  const handlePetImageUpload = event => { const file = event.target.files?.[0]; if (!file) return; if (petImageUrl) URL.revokeObjectURL(petImageUrl); setPetImageUrl(URL.createObjectURL(file)); setAvatarGenerated(false); };
  const handleGenerateAvatar = () => { setAvatarGenerated(true); setAvatarRotation(32); };
  return <main><section className="hero-shell"><Navbar onOpen={() => setDrawerOpen(true)} onBrowseModules={scrollToModules} onLogoClick={scrollToTop} /><motion.div className="video-wrap" initial={false} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 1.8, ease }}><video className="hero-video" src="/assets/hero-mouse.mp4" poster="/assets/hero-mouse-poster.jpeg" autoPlay muted playsInline loop /></motion.div><HeroFooter onOpen={() => setDrawerOpen(true)} onBrowseModules={scrollToModules} /><DetailDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} /></section><SpeciesShowcase selectedSpeciesId={selectedSpeciesId} onSelectSpecies={setSelectedSpeciesId} onAddPet={scrollToPetCreator} /><PetCreatorSection sectionRef={petCreatorRef} selectedSpecies={selectedSpecies} onSelectSpecies={setSelectedSpeciesId} petName={petName} onPetNameChange={setPetName} petSize={petSize} onPetSizeChange={setPetSize} petImageUrl={petImageUrl} onPetImageUpload={handlePetImageUpload} avatarGenerated={avatarGenerated} onGenerateAvatar={handleGenerateAvatar} onAvatarGeneratedChange={setAvatarGenerated} avatarRotation={avatarRotation} onAvatarRotationChange={setAvatarRotation} selectedWearables={selectedWearables} onToggleWearable={toggleWearable} projectId={projectId} mockMode={mockMode} /><IntroSection /><ModuleCommunitySection selectedIds={selectedIds} onToggleModule={toggleModule} marketRef={moduleMarketRef} selectedSpeciesId={selectedSpeciesId} /><EnvironmentPreviewSection selectedModules={selectedModules} projectId={projectId} mockMode={mockMode} /><UploadVibeSection projectId={projectId} mockMode={mockMode} petImageUrl={petImageUrl} /><RenderSection projectId={projectId} mockMode={mockMode} /><ScenePackSection selectedIds={selectedIds} onAddModules={addModules} /><ManufacturingSection projectId={projectId} mockMode={mockMode} petName={petName} petSize={petSize} selectedModules={selectedModules} /><GiftSection /><OrderFlowSection projectId={projectId} petImageUrl={petImageUrl} avatarGenerated={avatarGenerated} selectedWearables={selectedWearables} selectedIds={selectedIds} /><FlipCards /></main>;
}
