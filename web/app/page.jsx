'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import { getAssetEntry } from './components/assetIndex';
import './components/landing/styles.css';

const DEFAULT_COLLISION_BY_MODULE = {
  'cheese-lounge-bed': { x: 274.148, y: 100, z: 194.543 },
  'banana-bed': { x: 234.107, y: 100, z: 94.742 },
  'banana-layer-pad': { x: 140.667, y: 80, z: 140.955 },
  'hanging-climb-baskets': { x: 82.924, y: 120, z: 57.215 },
  'cheese-play-mat': { x: 162.435, y: 60, z: 162.434 },
  'starry-hideout': { x: 186.334, y: 150, z: 186.351 },
};

const DEFAULT_BILLBOARD_COLLISION = { x: 120, y: 150, z: 80 };
const SCENE_BOUNDS = { halfWidth: 300, halfDepth: 200, height: 400 };

const INITIAL_SCENE_ITEMS = [
  {
    instanceId: 'initial-cheese-lounge-bed',
    moduleId: 'cheese-lounge-bed',
    position: { x: -120, y: 0, z: -70 },
    rotationY: 0.08,
    scale: 1,
    collisionSize: DEFAULT_COLLISION_BY_MODULE['cheese-lounge-bed'],
    assetKind: 'glb',
  },
  {
    instanceId: 'initial-hanging-climb-baskets',
    moduleId: 'hanging-climb-baskets',
    position: { x: 150, y: 0, z: 80 },
    rotationY: -0.35,
    scale: 1,
    collisionSize: DEFAULT_COLLISION_BY_MODULE['hanging-climb-baskets'],
    assetKind: 'glb',
  },
];

function nextInstanceId(moduleId) {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${moduleId}-${crypto.randomUUID()}`;
  }
  return `${moduleId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function defaultPositionForIndex(index) {
  const positions = [
    { x: -120, y: 0, z: -70 },
    { x: 150, y: 0, z: 80 },
    { x: 155, y: 0, z: -100 },
    { x: -150, y: 0, z: 115 },
    { x: 0, y: 0, z: 130 },
    { x: 0, y: 0, z: -150 },
  ];
  return positions[index % positions.length];
}

function aabbForItem(item) {
  const halfX = item.collisionSize.x * item.scale / 2;
  const height = item.collisionSize.y * item.scale;
  const halfZ = item.collisionSize.z * item.scale / 2;
  const y = item.position.y ?? 0;
  return {
    minX: item.position.x - halfX,
    maxX: item.position.x + halfX,
    minY: y,
    maxY: y + height,
    minZ: item.position.z - halfZ,
    maxZ: item.position.z + halfZ,
  };
}

function isValidSceneItem(candidate, items) {
  const box = aabbForItem(candidate);
  if (box.minX < -SCENE_BOUNDS.halfWidth || box.maxX > SCENE_BOUNDS.halfWidth || box.minY < 0 || box.maxY > SCENE_BOUNDS.height || box.minZ < -SCENE_BOUNDS.halfDepth || box.maxZ > SCENE_BOUNDS.halfDepth) return false;
  return items.every(item => {
    const other = aabbForItem(item);
    return !(box.minX < other.maxX && box.maxX > other.minX && box.minY < other.maxY && box.maxY > other.minY && box.minZ < other.maxZ && box.maxZ > other.minZ);
  });
}

function findOpenPosition(item, items) {
  const candidates = [
    defaultPositionForIndex(items.length),
    { x: 155, y: 0, z: -100 },
    { x: -150, y: 0, z: 115 },
    { x: 0, y: 0, z: 130 },
    { x: 0, y: 0, z: -150 },
    { x: 210, y: 0, z: 0 },
    { x: -210, y: 0, z: 0 },
  ];
  return candidates.find(position => isValidSceneItem({ ...item, position }, items)) || item.position;
}

function createSceneItem(moduleId, overrides = {}) {
  const entry = getAssetEntry(moduleId);
  return {
    instanceId: overrides.instanceId || nextInstanceId(moduleId),
    moduleId,
    position: { x: overrides.position?.x ?? 0, y: overrides.position?.y ?? 0, z: overrides.position?.z ?? 0 },
    rotationY: overrides.rotationY ?? 0,
    scale: overrides.scale ?? 1,
    collisionSize: overrides.collisionSize || DEFAULT_COLLISION_BY_MODULE[moduleId] || DEFAULT_BILLBOARD_COLLISION,
    assetKind: overrides.assetKind || entry?.kind || 'billboard',
  };
}

function uniqueModuleIds(items) {
  return [...new Set(items.map(item => item.moduleId))];
}

export default function App() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedSpeciesId, setSelectedSpeciesId] = useState('rat');
  const [selectedIds, setSelectedIds] = useState(['cheese-lounge-bed', 'hanging-climb-baskets']);
  const [sceneItems, setSceneItems] = useState(INITIAL_SCENE_ITEMS);
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
  const addSceneItem = useCallback(moduleId => {
    setSceneItems(current => {
      const draft = createSceneItem(moduleId, { position: defaultPositionForIndex(current.length) });
      const next = [...current, { ...draft, position: findOpenPosition(draft, current) }];
      setSelectedIds(uniqueModuleIds(next));
      return next;
    });
  }, []);
  const updateSceneItems = useCallback(nextItems => {
    setSceneItems(nextItems);
    setSelectedIds(uniqueModuleIds(nextItems));
  }, []);
  const applyScenePack = useCallback(pack => {
    if (!pack?.layout?.length) return;
    const nextItems = pack.layout.map(item => createSceneItem(item.moduleId, item));
    setSceneItems(nextItems);
    setSelectedIds(uniqueModuleIds(nextItems));
  }, []);
  const toggleWearable = wearableId => setSelectedWearables(current => current.includes(wearableId) ? current.filter(id => id !== wearableId) : [...current, wearableId]);
  const handlePetImageUpload = image => { if (petImageUrl?.startsWith('blob:')) URL.revokeObjectURL(petImageUrl); if (!image) { setPetImageUrl(''); return; } setPetImageUrl(typeof image === 'string' ? image : URL.createObjectURL(image)); setAvatarGenerated(false); };
  const handleGenerateAvatar = () => { setAvatarGenerated(true); setAvatarRotation(32); };
  return <main><section className="hero-shell"><Navbar onOpen={() => setDrawerOpen(true)} onBrowseModules={scrollToModules} onLogoClick={scrollToTop} /><motion.div className="video-wrap" initial={false} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 1.8, ease }}><video className="hero-video" src="/assets/hero-mouse.mp4" poster="/assets/hero-mouse-poster.jpeg" autoPlay muted playsInline loop /></motion.div><HeroFooter onOpen={() => setDrawerOpen(true)} onBrowseModules={scrollToModules} /><DetailDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} /></section><SpeciesShowcase selectedSpeciesId={selectedSpeciesId} onSelectSpecies={setSelectedSpeciesId} onAddPet={scrollToPetCreator} /><PetCreatorSection sectionRef={petCreatorRef} selectedSpecies={selectedSpecies} onSelectSpecies={setSelectedSpeciesId} petName={petName} onPetNameChange={setPetName} petSize={petSize} onPetSizeChange={setPetSize} petImageUrl={petImageUrl} onPetImageUpload={handlePetImageUpload} avatarGenerated={avatarGenerated} onGenerateAvatar={handleGenerateAvatar} onAvatarGeneratedChange={setAvatarGenerated} avatarRotation={avatarRotation} onAvatarRotationChange={setAvatarRotation} selectedWearables={selectedWearables} onToggleWearable={toggleWearable} projectId={projectId} mockMode={mockMode} /><IntroSection projectId={projectId} petImageUrl={petImageUrl} onPetImageUpload={handlePetImageUpload} /><ModuleCommunitySection selectedIds={selectedIds} onAddSceneItem={addSceneItem} marketRef={moduleMarketRef} selectedSpeciesId={selectedSpeciesId} /><EnvironmentPreviewSection selectedModules={selectedModules} sceneItems={sceneItems} onSceneItemsChange={updateSceneItems} projectId={projectId} mockMode={mockMode} /><UploadVibeSection projectId={projectId} mockMode={mockMode} petImageUrl={petImageUrl} /><RenderSection projectId={projectId} mockMode={mockMode} /><ScenePackSection selectedIds={selectedIds} onApplyScenePack={applyScenePack} /><ManufacturingSection projectId={projectId} mockMode={mockMode} petName={petName} petSize={petSize} selectedModules={selectedModules} /><GiftSection /><OrderFlowSection projectId={projectId} petImageUrl={petImageUrl} avatarGenerated={avatarGenerated} selectedWearables={selectedWearables} selectedIds={selectedIds} /><FlipCards /></main>;
}
