'use client';

import { useCallback, useEffect, useRef, useState, type ComponentRef } from 'react';
import { Canvas, type ThreeEvent, useFrame, useThree } from '@react-three/fiber';
import {
  ContactShadows,
  GizmoHelper,
  GizmoViewport,
  Html,
  OrbitControls,
  TransformControls as DreiTransformControls,
} from '@react-three/drei';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  VIEWER_ASSET_CATALOG,
  getViewerAsset,
  type ViewerCatalogAsset,
} from '../../lib/viewer/catalog';
import '../../components/appshell/app-ui.css';
import './viewer-spike.css';

type ProbeStats = { fps: number; geometries: number; textures: number; calls: number };
type ResourceCounters = { loaded: number; disposed: number; cancelled: number };
type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';
type TransformLifecycle = {
  addEventListener: (type: 'dragging-changed', listener: (event: { value: unknown }) => void) => void;
  removeEventListener: (type: 'dragging-changed', listener: (event: { value: unknown }) => void) => void;
  object?: THREE.Object3D;
};

const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const ignoreInteraction = () => undefined;
const ignorePointerKind = () => undefined;
const ignorePosition = () => undefined;
const ignoreStatus = () => undefined;

function disposeScene(scene: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  scene.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    if (child.geometry) geometries.add(child.geometry);
    const childMaterials = Array.isArray(child.material) ? child.material : [child.material];
    childMaterials.forEach((material) => {
      if (!material) return;
      materials.add(material);
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) textures.add(value);
      }
    });
  });
  textures.forEach((texture) => texture.dispose());
  materials.forEach((material) => material.dispose());
  geometries.forEach((geometry) => geometry.dispose());
}

function useGltfResource(
  url: string,
  retryToken: number,
  onStatus: (status: LoadStatus, detail?: string) => void,
  onResourceEvent: (event: keyof ResourceCounters) => void,
) {
  const [scene, setScene] = useState<THREE.Group | null>(null);

  useEffect(() => {
    const abortController = new AbortController();
    let active = true;
    let ownedScene: THREE.Group | null = null;
    onStatus('loading');

    async function load() {
      try {
        const response = await fetch(url, { signal: abortController.signal, cache: 'no-store' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const bytes = await response.arrayBuffer();
        if (!active) return;
        const loader = new GLTFLoader();
        const gltf = await loader.parseAsync(bytes, url.slice(0, url.lastIndexOf('/') + 1));
        ownedScene = gltf.scene;
        ownedScene.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });
        if (!active) {
          disposeScene(ownedScene);
          ownedScene = null;
          onResourceEvent('disposed');
          return;
        }
        setScene(ownedScene);
        onResourceEvent('loaded');
        onStatus('ready');
      } catch (error) {
        if (!active || abortController.signal.aborted) return;
        onStatus('error', error instanceof Error ? error.message : '未知加载错误');
      }
    }

    void load();
    return () => {
      active = false;
      abortController.abort();
      if (ownedScene) {
        disposeScene(ownedScene);
        ownedScene = null;
        onResourceEvent('disposed');
      } else {
        onResourceEvent('cancelled');
      }
    };
  }, [url, retryToken, onResourceEvent, onStatus]);

  return scene;
}

function ResourceProbe({ onStats }: { onStats: (stats: ProbeStats) => void }) {
  const gl = useThree((state) => state.gl);
  const frames = useRef(0);
  const lastSample = useRef(0);

  useFrame(() => {
    frames.current += 1;
    const now = performance.now();
    if (lastSample.current === 0) {
      lastSample.current = now;
      return;
    }
    const elapsed = now - lastSample.current;
    if (elapsed < 800) return;
    onStats({
      fps: Math.round((frames.current * 1000) / elapsed),
      geometries: gl.info.memory.geometries,
      textures: gl.info.memory.textures,
      calls: gl.info.render.calls,
    });
    frames.current = 0;
    lastSample.current = now;
  });
  return null;
}

function CameraReset({ token }: { token: number }) {
  const { camera, controls } = useThree();
  useEffect(() => {
    camera.position.set(480, 320, 480);
    camera.updateProjectionMatrix();
    if (controls && 'target' in controls) {
      const orbit = controls as unknown as { target: THREE.Vector3; update: () => void };
      orbit.target.set(0, 70, 0);
      orbit.update();
    }
  }, [camera, controls, token]);
  return null;
}

function LoadedAsset({
  asset,
  url,
  retryToken,
  position,
  interactive,
  groundDrag,
  onInteraction,
  onPointerKind,
  onPosition,
  onStatus,
  onResourceEvent,
}: {
  asset: ViewerCatalogAsset;
  url: string;
  retryToken: number;
  position: [number, number, number];
  interactive: boolean;
  groundDrag: boolean;
  onInteraction: (active: boolean) => void;
  onPointerKind: (kind: string) => void;
  onPosition: (position: [number, number, number]) => void;
  onStatus: (status: LoadStatus, detail?: string) => void;
  onResourceEvent: (event: keyof ResourceCounters) => void;
}) {
  const scene = useGltfResource(url, retryToken, onStatus, onResourceEvent);
  const dragging = useRef(false);
  const dragOffset = useRef(new THREE.Vector3());
  const transformControlsRef = useRef<ComponentRef<typeof DreiTransformControls> | null>(null);
  const [localPosition, setLocalPosition] = useState<[number, number, number]>(position);

  useEffect(() => {
    const controls = transformControlsRef.current as unknown as TransformLifecycle | null;
    if (!controls || groundDrag) return;
    const handleDraggingChanged = (event: { value: unknown }) => onInteraction(event.value === true);
    controls.addEventListener('dragging-changed', handleDraggingChanged);
    return () => controls.removeEventListener('dragging-changed', handleDraggingChanged);
  }, [groundDrag, onInteraction]);

  const pointOnGround = useCallback((event: ThreeEvent<PointerEvent>) => {
    const point = new THREE.Vector3();
    return event.ray.intersectPlane(groundPlane, point) ? point : null;
  }, []);

  const pointerDown = (event: ThreeEvent<PointerEvent>) => {
    if (!interactive || !groundDrag) return;
    event.stopPropagation();
    onPointerKind(event.nativeEvent.pointerType || 'mouse');
    const point = pointOnGround(event);
    if (!point) return;
    dragging.current = true;
    dragOffset.current.set(localPosition[0] - point.x, 0, localPosition[2] - point.z);
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
    onInteraction(true);
  };

  const pointerMove = (event: ThreeEvent<PointerEvent>) => {
    if (!dragging.current) return;
    event.stopPropagation();
    onPointerKind(event.nativeEvent.pointerType || 'mouse');
    const point = pointOnGround(event);
    if (!point) return;
    const next: [number, number, number] = [
      Math.max(-240, Math.min(240, point.x + dragOffset.current.x)),
      0,
      Math.max(-150, Math.min(150, point.z + dragOffset.current.z)),
    ];
    setLocalPosition(next);
    onPosition(next);
  };

  const pointerUp = (event: ThreeEvent<PointerEvent>) => {
    if (!dragging.current) return;
    dragging.current = false;
    (event.target as HTMLElement).releasePointerCapture(event.pointerId);
    onInteraction(false);
  };

  if (!scene) return null;

  const object = (
    <group
      position={localPosition}
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={pointerUp}
      onPointerCancel={pointerUp}
    >
      <primitive object={scene} />
      {interactive ? (
        <>
          <mesh position={[0, asset.sourceBoundsMm.y / 2, 0]} visible={false}>
            <boxGeometry args={[asset.sourceBoundsMm.x, asset.sourceBoundsMm.y, asset.sourceBoundsMm.z]} />
            <meshBasicMaterial transparent opacity={0} />
          </mesh>
          <Html position={[0, asset.sourceBoundsMm.y + 20, 0]} center distanceFactor={650}>
            <div className="psx-spike-dimension" data-testid="dimension-label">
              {asset.sourceBoundsMm.x.toFixed(1)} × {asset.sourceBoundsMm.y.toFixed(1)} ×{' '}
              {asset.sourceBoundsMm.z.toFixed(1)} mm
            </div>
          </Html>
        </>
      ) : null}
    </group>
  );

  if (interactive && !groundDrag) {
    return (
      <DreiTransformControls
        ref={transformControlsRef}
        mode="translate"
        showY={false}
        onObjectChange={() => {
          const transformed = (transformControlsRef.current as unknown as TransformLifecycle | null)?.object;
          if (!transformed) return;
          const next: [number, number, number] = [transformed.position.x, 0, transformed.position.z];
          setLocalPosition(next);
          onPosition(next);
        }}
      >
        {object}
      </DreiTransformControls>
    );
  }
  return object;
}

const multiPositions: [number, number, number][] = [
  [-180, 0, -100],
  [160, 0, -90],
  [-160, 0, 110],
  [160, 0, 110],
];

export function R3fSpikeClient() {
  const [assetKey, setAssetKey] = useState('cheese-lounge-bed');
  const [mounted, setMounted] = useState(true);
  const [multiModel, setMultiModel] = useState(false);
  const [groundDrag, setGroundDrag] = useState(true);
  const [interactionActive, setInteractionActive] = useState(false);
  const [interactionCount, setInteractionCount] = useState(0);
  const [forcedError, setForcedError] = useState(false);
  const [retryToken, setRetryToken] = useState(0);
  const [cameraResetToken, setCameraResetToken] = useState(0);
  const [loadStatus, setLoadStatus] = useState<LoadStatus>('idle');
  const [loadDetail, setLoadDetail] = useState('');
  const [pointerKind, setPointerKind] = useState('尚未交互');
  const [position, setPosition] = useState<[number, number, number]>([0, 0, 0]);
  const [stats, setStats] = useState<ProbeStats>({ fps: 0, geometries: 0, textures: 0, calls: 0 });
  const [resources, setResources] = useState<ResourceCounters>({ loaded: 0, disposed: 0, cancelled: 0 });
  const selectedAsset = getViewerAsset(assetKey);

  const resourceEvent = useCallback((event: keyof ResourceCounters) => {
    setResources((current) => ({ ...current, [event]: current[event] + 1 }));
  }, []);

  const status = useCallback((next: LoadStatus, detail?: string) => {
    setLoadStatus(next);
    setLoadDetail(detail ?? '');
  }, []);

  const handleInteraction = useCallback((active: boolean) => {
    setInteractionActive(active);
    if (active) setInteractionCount((count) => count + 1);
  }, []);

  const chooseAsset = (nextKey: string) => {
    setAssetKey(nextKey);
    setForcedError(false);
    setRetryToken((value) => value + 1);
    setPosition([0, 0, 0]);
  };

  const retry = () => {
    setForcedError(false);
    setRetryToken((value) => value + 1);
  };

  return (
    <section className="psx-spike psx-fade-up">
      <header className="psx-spike-header">
        <div>
          <span className="psx-dot-label">WP-B45-0 技术尖峰</span>
          <h1>R3F v9 + drei 行为验证</h1>
          <p>隔离验证资源生命周期、指针交互和多模型性能；这不是正式工作台。</p>
        </div>
        <div className="psx-spike-badges" aria-label="技术版本">
          <span>R3F 9.6.1</span>
          <span>drei 10.7.7</span>
          <span>three 0.185.1</span>
        </div>
      </header>

      <div className="psx-spike-grid">
        <aside className="psx-spike-panel" aria-label="尖峰控制">
          <label>
            代表模型
            <select value={assetKey} onChange={(event) => chooseAsset(event.target.value)} data-testid="asset-select">
              {VIEWER_ASSET_CATALOG.map((asset) => (
                <option key={asset.assetKey} value={asset.assetKey}>
                  {asset.label} · {asset.role}
                </option>
              ))}
            </select>
          </label>

          <div className="psx-spike-button-grid">
            <button type="button" onClick={() => setMounted((value) => !value)} data-testid="toggle-mount">
              {mounted ? '卸载模型' : '重新加载'}
            </button>
            <button type="button" onClick={() => setMultiModel((value) => !value)} data-testid="toggle-multi">
              {multiModel ? '单模型' : '同场 5 模型'}
            </button>
            <button type="button" onClick={() => setGroundDrag((value) => !value)} data-testid="toggle-drag-mode">
              {groundDrag ? '切换 Gizmo' : '切换地面拖动'}
            </button>
            <button type="button" onClick={() => setCameraResetToken((value) => value + 1)} data-testid="reset-camera">
              视角回到原点
            </button>
            <button type="button" onClick={() => setForcedError(true)} data-testid="simulate-error">
              模拟加载失败
            </button>
            <button type="button" onClick={retry} disabled={loadStatus !== 'error'} data-testid="retry-load">
              重试正确地址
            </button>
          </div>

          <dl className="psx-spike-facts">
            <div><dt>加载态</dt><dd data-testid="load-status">{loadStatus}{loadDetail ? ` · ${loadDetail}` : ''}</dd></div>
            <div><dt>Orbit</dt><dd data-testid="orbit-status">{interactionActive ? '已暂停' : `可用 · 已暂停 ${interactionCount} 次`}</dd></div>
            <div><dt>指针</dt><dd data-testid="pointer-kind">{pointerKind}</dd></div>
            <div><dt>位置 mm</dt><dd data-testid="model-position">{position.map((value) => value.toFixed(0)).join(', ')}</dd></div>
            <div><dt>FPS</dt><dd data-testid="fps">{stats.fps}</dd></div>
            <div><dt>GPU 资源</dt><dd>{stats.geometries} geometry · {stats.textures} texture</dd></div>
            <div><dt>Draw calls</dt><dd>{stats.calls}</dd></div>
            <div><dt>生命周期</dt><dd data-testid="resource-counters">载入 {resources.loaded} · 释放 {resources.disposed} · 取消 {resources.cancelled}</dd></div>
          </dl>
          <p className="psx-spike-note">触控与鼠标共用 Pointer Events；视口使用 touch-action: none，拖动时 Orbit 显式暂停。</p>
        </aside>

        <div className="psx-spike-canvas" data-testid="r3f-canvas-shell">
          <Canvas shadows camera={{ position: [480, 320, 480], fov: 38, near: 1, far: 3000 }} dpr={[1, 1.5]}>
            <color attach="background" args={['#f3f0e9']} />
            <ambientLight intensity={1.5} />
            <directionalLight position={[260, 420, 180]} intensity={2.2} castShadow />
            <gridHelper args={[600, 20, '#cbc4b7', '#ded8cd']} />
            <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
              <planeGeometry args={[600, 400]} />
              <shadowMaterial transparent opacity={0.12} />
            </mesh>

            {mounted ? (
              <LoadedAsset
                key={`${selectedAsset.assetKey}-${forcedError}-${retryToken}`}
                asset={selectedAsset}
                url={forcedError ? '/scene-assets/__missing-spike.glb' : selectedAsset.publicPath}
                retryToken={retryToken}
                position={position}
                interactive
                groundDrag={groundDrag}
                onInteraction={handleInteraction}
                onPointerKind={setPointerKind}
                onPosition={setPosition}
                onStatus={status}
                onResourceEvent={resourceEvent}
              />
            ) : null}

            {mounted && multiModel
              ? VIEWER_ASSET_CATALOG.filter((asset) => asset.assetKey !== selectedAsset.assetKey).map((asset, index) => (
                  <LoadedAsset
                    key={`multi-${asset.assetKey}-${retryToken}`}
                    asset={asset}
                    url={asset.publicPath}
                    retryToken={retryToken}
                    position={multiPositions[index] ?? [0, 0, 0]}
                    interactive={false}
                    groundDrag={false}
                    onInteraction={ignoreInteraction}
                    onPointerKind={ignorePointerKind}
                    onPosition={ignorePosition}
                    onStatus={ignoreStatus}
                    onResourceEvent={resourceEvent}
                  />
                ))
              : null}

            <ContactShadows position={[0, 0.2, 0]} opacity={0.32} scale={650} blur={2.8} far={500} />
            <OrbitControls makeDefault enabled={!interactionActive} target={[0, 70, 0]} minDistance={180} maxDistance={1100} />
            <GizmoHelper alignment="top-right" margin={[76, 76]}>
              <GizmoViewport axisColors={['#d85f4d', '#6a9b62', '#557fa6']} labelColor="white" />
            </GizmoHelper>
            <CameraReset token={cameraResetToken} />
            <ResourceProbe onStats={setStats} />
          </Canvas>
        </div>
      </div>
    </section>
  );
}
