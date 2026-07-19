'use client';

import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { SceneConfirmationResponse, SceneItem, SceneRecord } from '@petscape/server/contracts/scenes';
import { VIEWER_ASSET_CATALOG, getViewerAsset } from '../../lib/viewer/catalog';
import { formatDimensionsMm, formatMillimeters } from '../../lib/display-format';
import { confirmViewerScene, saveViewerScene, ViewerApiError } from '../../lib/viewer/viewer-api';
import {
  addContextItem,
  addPetReference,
  createSceneEditorState,
  draftDiffersFromLastConfirmation,
  getSceneConfirmationEligibility,
  removeSceneItem,
  resetAllSceneItems,
  resetSceneItem,
  snapSceneItemToSupport,
  updateCageDimensions,
  updateSceneItemTransform,
  type SceneBlockingReason,
  type SceneEditorState,
} from '../../lib/viewer/scene-state';
import { ViewerViewCube } from './ViewerViewCube';

type LoadState = Record<string, 'loading' | 'ready' | 'error'>;

const CONTEXT_ASSETS = VIEWER_ASSET_CATALOG.filter((asset) => asset.role === 'context');

function BoxEdges({
  size,
  position,
  color = '#171717',
  opacity = 0.72,
}: {
  size: [number, number, number];
  position: [number, number, number];
  color?: string;
  opacity?: number;
}) {
  const [width, height, depth] = size;
  const geometry = useMemo(() => {
    const box = new THREE.BoxGeometry(width, height, depth);
    const edges = new THREE.EdgesGeometry(box);
    box.dispose();
    return edges;
  }, [depth, height, width]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <lineSegments geometry={geometry} position={position}>
      <lineBasicMaterial color={color} transparent opacity={opacity} toneMapped={false} />
    </lineSegments>
  );
}

function disposeScene(scene: THREE.Object3D) {
  const textures = new Set<THREE.Texture>();
  const materials = new Set<THREE.Material>();
  const geometries = new Set<THREE.BufferGeometry>();
  scene.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    geometries.add(child.geometry);
    const childMaterials = Array.isArray(child.material) ? child.material : [child.material];
    childMaterials.forEach((material) => {
      materials.add(material);
      Object.values(material).forEach((value) => {
        if (value instanceof THREE.Texture) textures.add(value);
      });
    });
  });
  textures.forEach((texture) => texture.dispose());
  materials.forEach((material) => material.dispose());
  geometries.forEach((geometry) => geometry.dispose());
}

function GltfItem({
  item,
  publicPath,
  selected,
  onSelect,
  onMove,
  onMoveEnd,
  onLoad,
  onInteraction,
}: {
  item: SceneItem;
  publicPath: string;
  selected: boolean;
  onSelect: () => void;
  onMove: (x: number, z: number) => void;
  onMoveEnd: () => void;
  onLoad: (status: 'loading' | 'ready' | 'error') => void;
  onInteraction: (active: boolean) => void;
}) {
  const [scene, setScene] = useState<THREE.Group | null>(null);
  const dragging = useRef(false);
  const onLoadRef = useRef(onLoad);
  const offset = useRef(new THREE.Vector3());
  const plane = useMemo(
    () => new THREE.Plane(new THREE.Vector3(0, 1, 0), -item.positionMm.y),
    [item.positionMm.y],
  );

  useEffect(() => { onLoadRef.current = onLoad; }, [onLoad]);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    let owned: THREE.Group | null = null;
    onLoadRef.current('loading');
    void (async () => {
      try {
        const response = await fetch(publicPath, { cache: 'force-cache', signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const bytes = await response.arrayBuffer();
        if (!active) return;
        const gltf = await new GLTFLoader().parseAsync(bytes, publicPath.slice(0, publicPath.lastIndexOf('/') + 1));
        owned = gltf.scene;
        owned.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });
        if (!active) {
          disposeScene(owned);
          return;
        }
        setScene(owned);
        onLoadRef.current('ready');
      } catch {
        if (active && !controller.signal.aborted) onLoadRef.current('error');
      }
    })();
    return () => {
      active = false;
      controller.abort();
      if (owned) disposeScene(owned);
    };
  }, [publicPath]);

  const pointOnPlane = (event: ThreeEvent<PointerEvent>) => {
    const point = new THREE.Vector3();
    return event.ray.intersectPlane(plane, point) ? point : null;
  };

  return (
    <group
      position={[item.positionMm.x, item.positionMm.y, item.positionMm.z]}
      rotation={[0, item.rotationYRad, 0]}
      scale={item.uniformScale}
      onPointerDown={(event) => {
        event.stopPropagation();
        onSelect();
        const point = pointOnPlane(event);
        if (!point) return;
        dragging.current = true;
        onInteraction(true);
        offset.current.set(item.positionMm.x - point.x, 0, item.positionMm.z - point.z);
        (event.target as HTMLElement).setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!dragging.current) return;
        event.stopPropagation();
        const point = pointOnPlane(event);
        if (point) onMove(point.x + offset.current.x, point.z + offset.current.z);
      }}
      onPointerUp={(event) => {
        if (!dragging.current) return;
        dragging.current = false;
        onInteraction(false);
        (event.target as HTMLElement).releasePointerCapture(event.pointerId);
        onMoveEnd();
      }}
      onPointerCancel={() => { dragging.current = false; onInteraction(false); }}
      onLostPointerCapture={() => { dragging.current = false; onInteraction(false); }}
    >
      {scene ? <primitive object={scene} /> : null}
      {selected ? <BoxEdges size={[item.sourceBoundsMm.x, item.sourceBoundsMm.y, item.sourceBoundsMm.z]} position={[0, item.sourceBoundsMm.y / 2, 0]} /> : null}
    </group>
  );
}

function RatReference({ item, selected, onSelect }: { item: SceneItem; selected: boolean; onSelect: () => void }) {
  return (
    <group
      position={[item.positionMm.x, item.positionMm.y + 45, item.positionMm.z]}
      rotation={[0, item.rotationYRad, 0]}
      scale={item.uniformScale}
      onPointerDown={(event) => { event.stopPropagation(); onSelect(); }}
    >
      <mesh castShadow>
        <capsuleGeometry args={[35, 105, 12, 20]} />
        <meshStandardMaterial color="#a5a39d" roughness={0.88} transparent opacity={0.72} />
      </mesh>
      <mesh position={[0, 42, -66]} castShadow>
        <sphereGeometry args={[30, 20, 12]} />
        <meshStandardMaterial color="#aaa8a2" transparent opacity={0.72} />
      </mesh>
      {selected ? <BoxEdges size={[item.sourceBoundsMm.x, item.sourceBoundsMm.y, item.sourceBoundsMm.z]} position={[0, 10, 0]} opacity={0.55} /> : null}
    </group>
  );
}

function SceneCameraReset({ token, cageHeight }: { token: number; cageHeight: number }) {
  const { camera, controls } = useThree();
  useEffect(() => {
    camera.position.set(760, 560, 760);
    camera.updateProjectionMatrix();
    if (controls && 'target' in controls) {
      const orbit = controls as unknown as { target: THREE.Vector3; update: () => void };
      orbit.target.set(0, cageHeight * 0.28, 0);
      orbit.update();
    }
  }, [camera, cageHeight, controls, token]);
  return null;
}

function SceneCanvas({
  state,
  selectedId,
  onSelect,
  onMove,
  onMoveEnd,
  onLoad,
  resetToken,
}: {
  state: SceneEditorState;
  selectedId: string;
  onSelect: (id: string) => void;
  onMove: (id: string, x: number, z: number) => void;
  onMoveEnd: (id: string) => void;
  onLoad: (id: string, status: 'loading' | 'ready' | 'error') => void;
  resetToken: number;
}) {
  const cage = state.draft.cageMm;
  const [interactionActive, setInteractionActive] = useState(false);
  return (
    <Canvas shadows camera={{ position: [760, 560, 760], fov: 38, near: 1, far: 5000 }} dpr={[1, 1.7]}>
      <color attach="background" args={['#f4f3ef']} />
      <ambientLight intensity={1.8} />
      <directionalLight position={[400, 700, 350]} intensity={2.2} castShadow />
      <gridHelper args={[Math.max(cage.width, cage.depth), 12, '#c7c6c0', '#dfded8']} />
      <BoxEdges size={[cage.width, cage.height, cage.depth]} position={[0, cage.height / 2, 0]} opacity={0.24} />
      {state.draft.items.map((item) => {
        if (item.role === 'pet_reference') {
          return <RatReference key={item.instanceId} item={item} selected={selectedId === item.instanceId} onSelect={() => onSelect(item.instanceId)} />;
        }
        const assetKey = item.modelRef.kind === 'temporary_catalog' ? item.modelRef.assetKey : '';
        const asset = assetKey ? getViewerAsset(assetKey) : null;
        if (!asset) return null;
        return (
          <GltfItem
            key={item.instanceId}
            item={item}
            publicPath={asset.publicPath}
            selected={selectedId === item.instanceId}
            onSelect={() => onSelect(item.instanceId)}
            onMove={(x, z) => onMove(item.instanceId, x, z)}
            onMoveEnd={() => onMoveEnd(item.instanceId)}
            onLoad={(status) => onLoad(item.instanceId, status)}
            onInteraction={setInteractionActive}
          />
        );
      })}
      <OrbitControls makeDefault enabled={!interactionActive} enableDamping minDistance={260} maxDistance={1800} target={[0, cage.height * 0.28, 0]} />
      <SceneCameraReset token={resetToken} cageHeight={cage.height} />
      <ViewerViewCube />
    </Canvas>
  );
}

function reasonLabel(reason: SceneBlockingReason) {
  if (reason.startsWith('item_collision:')) return '本次操作会与其他物品碰撞';
  if (reason.startsWith('item_out_of_bounds:')) return '本次操作会超出笼舍边界';
  return ({
    cage_width_invalid: '笼舍长度必须大于 0',
    cage_height_invalid: '笼舍高度必须大于 0',
    cage_depth_invalid: '笼舍宽度必须大于 0',
    target_asset_unreadable: '目标模型尚未加载完成',
    scene_revision_unsaved: '场景尚未保存',
    target_cannot_be_removed: '目标物品不可删除',
    scene_target_invalid: '场景必须保留唯一目标物品',
    pet_reference_locked: '通用比例参照尺寸固定，仅可显隐',
  } as Partial<Record<SceneBlockingReason, string>>)[reason] ?? reason;
}

function contextItem(assetKey: string, slot: number): SceneItem {
  const asset = getViewerAsset(assetKey);
  return {
    instanceId: `context-${assetKey}`,
    role: 'context',
    modelConfirmationId: null,
    modelRef: { ...asset.modelRef },
    positionMm: { x: slot === 0 ? -260 : 260, y: 0, z: 130 },
    rotationYRad: 0,
    uniformScale: 1,
    sourceBoundsMm: { ...asset.sourceBoundsMm },
    finalBoundsMm: { ...asset.sourceBoundsMm },
  };
}

export function SceneEditorClient({
  projectId,
  projectName,
  initialScene,
  latestConfirmation,
  onBack,
}: {
  projectId: string;
  projectName: string;
  initialScene: SceneRecord;
  latestConfirmation: SceneConfirmationResponse | null;
  onBack: () => void;
}) {
  const [state, setState] = useState(() => createSceneEditorState(initialScene.draft, latestConfirmation?.snapshot ?? null));
  const [selectedId, setSelectedId] = useState(initialScene.draft.targetInstanceId);
  const [loadState, setLoadState] = useState<LoadState>({ [initialScene.draft.targetInstanceId]: 'loading' });
  const [blockingReasons, setBlockingReasons] = useState<SceneBlockingReason[]>([]);
  const [cameraResetToken, setCameraResetToken] = useState(0);
  const [serverRevision, setServerRevision] = useState(initialScene.revision);
  const [draftVersion, setDraftVersion] = useState(0);
  const [savedVersion, setSavedVersion] = useState(0);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'dirty' | 'saving' | 'error' | 'conflict'>('saved');
  const [saveError, setSaveError] = useState('');
  const [retryToken, setRetryToken] = useState(0);
  const [sceneConfirmation, setSceneConfirmation] = useState<SceneConfirmationResponse | null>(latestConfirmation);
  const [confirmingScene, setConfirmingScene] = useState(false);
  const [confirmationError, setConfirmationError] = useState('');
  const draftVersionRef = useRef(0);
  const serverRevisionRef = useRef(initialScene.revision);
  const saveInFlightRef = useRef(false);
  const selected = state.draft.items.find((item) => item.instanceId === selectedId) ?? state.draft.items[0]!;
  const targetStatus = loadState[state.draft.targetInstanceId];
  const eligibility = getSceneConfirmationEligibility(state, {
    targetAssetReadable: targetStatus === 'ready',
    savedRevisionMatches: saveStatus === 'saved' && draftVersion === savedVersion,
  });

  useEffect(() => { draftVersionRef.current = draftVersion; }, [draftVersion]);
  useEffect(() => { serverRevisionRef.current = serverRevision; }, [serverRevision]);

  const commitEditorState = useCallback((next: SceneEditorState) => {
    setState(next);
    setDraftVersion((version) => version + 1);
    setSaveStatus((status) => status === 'conflict' ? status : 'dirty');
    setSaveError('');
    setConfirmationError('');
  }, []);

  const applyResult = useCallback((result: ReturnType<typeof updateSceneItemTransform>) => {
    if (result.accepted) {
      commitEditorState(result.state);
      setBlockingReasons([]);
    } else {
      setBlockingReasons(result.blockingReasons);
    }
  }, [commitEditorState]);

  useEffect(() => {
    if (draftVersion === savedVersion || saveStatus !== 'dirty' || saveInFlightRef.current) return;
    const timer = window.setTimeout(() => {
      const requestVersion = draftVersion;
      const requestDraft = structuredClone(state.draft);
      const expectedRevision = serverRevisionRef.current;
      saveInFlightRef.current = true;
      setSaveStatus('saving');
      setSaveError('');
      void saveViewerScene(projectId, { expectedRevision, draft: requestDraft }).then((saved) => {
        setServerRevision(saved.revision);
        serverRevisionRef.current = saved.revision;
        setSavedVersion(requestVersion);
        setSaveStatus(draftVersionRef.current === requestVersion ? 'saved' : 'dirty');
      }).catch((error) => {
        if (error instanceof ViewerApiError && error.code === 'revision_conflict') {
          setSaveStatus('conflict');
          setSaveError('其他标签页已保存更新；当前草稿没有覆盖服务器内容。');
          return;
        }
        setSaveStatus('error');
        setSaveError(error instanceof Error ? error.message : '自动保存失败');
      }).finally(() => {
        saveInFlightRef.current = false;
        if (draftVersionRef.current !== requestVersion) setRetryToken((token) => token + 1);
      });
    }, 700);
    return () => window.clearTimeout(timer);
  }, [draftVersion, projectId, retryToken, saveStatus, savedVersion, state.draft]);

  const confirmCurrentScene = useCallback(async () => {
    if (!eligibility.eligible || confirmingScene) return;
    setConfirmingScene(true);
    setConfirmationError('');
    try {
      const confirmed = await confirmViewerScene(initialScene.id, serverRevision);
      setSceneConfirmation(confirmed);
      setState((current) => ({ ...current, lastConfirmation: structuredClone(confirmed.snapshot) }));
    } catch (error) {
      setConfirmationError(error instanceof Error ? error.message : '场景确认失败');
    } finally {
      setConfirmingScene(false);
    }
  }, [confirmingScene, eligibility.eligible, initialScene.id, serverRevision]);

  const changeTransform = (patch: Partial<Pick<SceneItem, 'positionMm' | 'rotationYRad' | 'uniformScale'>>) => {
    applyResult(updateSceneItemTransform(state, selected.instanceId, patch));
  };

  const rat = state.draft.items.find((item) => item.role === 'pet_reference');

  return (
    <section className="viewer-workbench viewer-scene-workbench" aria-label="3D 场景编辑">
      <header className="viewer-topbar">
        <div className="viewer-steps" aria-label="工作台阶段">
          <span className="viewer-step"><i>1</i>单品检视与模型确认</span>
          <span className="viewer-step-line" />
          <span className="viewer-step is-current"><i>2</i>完整场景确认</span>
        </div>
        <div className="viewer-topbar-context"><span className="viewer-project-pill">项目 · {projectName}</span><span className="viewer-sandbox">测试模型 · 沙箱环境</span></div>
      </header>

      <div className="viewer-grid viewer-scene-grid">
        <aside className="viewer-rail viewer-scene-rail">
          <div><span className="viewer-eyebrow">场景物品</span><h1>布置笼舍</h1><p>拖动物品到地面位置。目标由模型确认快照生成，始终保留且唯一。</p></div>
          <div className="viewer-scene-list">
            {state.draft.items.map((item) => (
              <button type="button" key={item.instanceId} className={selected.instanceId === item.instanceId ? 'is-selected' : ''} onClick={() => setSelectedId(item.instanceId)}>
                <span className={`viewer-role is-${item.role}`}>{item.role === 'target' ? '目标' : item.role === 'context' ? '环境' : '比例参照'}</span>
                <strong>{item.modelRef.kind === 'temporary_catalog' && item.role !== 'pet_reference' ? getViewerAsset(item.modelRef.assetKey).label : '通用成年花枝鼠'}</strong>
                {item.role !== 'target' ? <i onClick={(event) => { event.stopPropagation(); applyResult(removeSceneItem(state, item.instanceId)); }}>删除</i> : <small>由确认快照锁定</small>}
              </button>
            ))}
          </div>
          <div className="viewer-add-list">
            <span>加入固定环境物</span>
            {CONTEXT_ASSETS.map((asset, index) => {
              const exists = state.draft.items.some((item) => item.modelRef.kind === 'temporary_catalog' && item.modelRef.assetKey === asset.assetKey);
              return <button type="button" key={asset.assetKey} disabled={exists} onClick={() => applyResult(addContextItem(state, contextItem(asset.assetKey, index)))}>{exists ? '已加入' : '+ 加入'} {asset.label}</button>;
            })}
            <label><input type="checkbox" checked={Boolean(rat)} onChange={(event) => {
              if (event.target.checked) applyResult(addPetReference(state, 'pet-reference-rat', { x: 250, y: 0, z: -120 }));
              else if (rat) applyResult(removeSceneItem(state, rat.instanceId));
            }} />显示通用花枝鼠比例参照</label>
          </div>
        </aside>

        <div className="viewer-stage">
          <SceneCanvas
            state={state}
            selectedId={selected.instanceId}
            onSelect={setSelectedId}
            onMove={(id, x, z) => {
              const item = state.draft.items.find((candidate) => candidate.instanceId === id);
              if (item) applyResult(updateSceneItemTransform(state, id, { positionMm: { ...item.positionMm, x: Math.round(x), z: Math.round(z) } }));
            }}
            onMoveEnd={(id) => applyResult(snapSceneItemToSupport(state, id))}
            onLoad={(id, status) => setLoadState((current) => current[id] === status ? current : { ...current, [id]: status })}
            resetToken={cameraResetToken}
          />
          <div className="viewer-stage-name"><span />1:1 mm 场景<small>笼舍 {state.draft.cageMm.width} × {state.draft.cageMm.height} × {state.draft.cageMm.depth}</small></div>
          <div className="viewer-axis-legend"><b className="is-x">X</b> 长度 <b className="is-y">Y</b> 高度 <b className="is-z">Z</b> 宽度</div>
          <button type="button" className="viewer-scene-camera-reset" onClick={() => setCameraResetToken((token) => token + 1)}>回到原点</button>
          {blockingReasons.length ? <div className="viewer-scene-alert" role="alert">{blockingReasons.map(reasonLabel).join('；')}</div> : null}
        </div>

        <aside className="viewer-panel viewer-scene-panel">
          <div className="viewer-card">
            <h2>笼舍内尺寸 · mm</h2>
            <div className="viewer-cage-inputs">
              {([['width', '长度 X'], ['height', '高度 Y'], ['depth', '宽度 Z']] as const).map(([axis, label]) => <label key={axis}><span>{label}</span><input type="number" min="1" step="10" value={state.draft.cageMm[axis]} onChange={(event) => { commitEditorState(updateCageDimensions(state, { ...state.draft.cageMm, [axis]: Number(event.target.value) })); }} /></label>)}
            </div>
          </div>
          <div className="viewer-card">
            <h2>选中 · {selected.role === 'target' ? '目标' : selected.role === 'context' ? '环境' : '比例参照'}</h2>
            {selected.role === 'pet_reference' ? (
              <div className="viewer-reference-note">标准成年花枝鼠的程序化通用比例参照，尺寸固定为 220 × 110 × 80 mm。它不代表你的宠物真实体型，只能显隐，不能旋转或缩放。</div>
            ) : <div className="viewer-transform-fields">
              <label><span>位置 X (mm)</span><input type="number" step="10" value={selected.positionMm.x} onChange={(event) => changeTransform({ positionMm: { ...selected.positionMm, x: Number(event.target.value) } })} /><output>mm</output></label>
              <label><span>位置 Z (mm)</span><input type="number" step="10" value={selected.positionMm.z} onChange={(event) => changeTransform({ positionMm: { ...selected.positionMm, z: Number(event.target.value) } })} /><output>mm</output></label>
              <label><span>Y 轴旋转</span><input type="range" min={-3.142} max={3.142} step={0.01} value={selected.rotationYRad} onChange={(event) => changeTransform({ rotationYRad: Number(event.target.value) })} /><output>{(selected.rotationYRad * 180 / Math.PI).toFixed(0)}°</output></label>
              <label><span>等比缩放</span><input type="range" min={0.5} max={2} step={0.01} value={selected.uniformScale} onChange={(event) => changeTransform({ uniformScale: Number(event.target.value) })} /><output>{selected.uniformScale.toFixed(2)}×</output></label>
              <p>位置 X {formatMillimeters(selected.positionMm.x)} · Y {formatMillimeters(selected.positionMm.y)} · Z {formatMillimeters(selected.positionMm.z)} mm</p>
              <p>最终尺寸 {formatDimensionsMm(selected.finalBoundsMm)}</p>
              <button type="button" onClick={() => applyResult(snapSceneItemToSupport(state, selected.instanceId))}>贴放到支撑面</button>
              <button type="button" onClick={() => applyResult(resetSceneItem(state, selected.instanceId))}>重置当前物品</button>
              <button type="button" onClick={() => { commitEditorState(resetAllSceneItems(state)); setBlockingReasons([]); }}>全部重置</button>
            </div>}
          </div>
          <div className="viewer-confirm-block viewer-scene-confirm">
            <p role="status">{{ saved: '已自动保存', dirty: '有未保存更改', saving: '保存中…', error: '保存失败，可重试', conflict: '检测到保存冲突，未覆盖服务器内容' }[saveStatus]}</p>
            {saveError ? <p role="alert">{saveError}</p> : null}
            {saveStatus === 'error' ? <button type="button" className="viewer-secondary-action" onClick={() => { setSaveStatus('dirty'); setRetryToken((token) => token + 1); }}>重试保存</button> : null}
            {saveStatus === 'conflict' ? <button type="button" className="viewer-secondary-action" onClick={() => window.location.reload()}>重新载入服务器版本</button> : null}
            {sceneConfirmation ? <p className="is-success">最近确认已保存{draftDiffersFromLastConfirmation(state) ? '；当前场景已有新变化' : ''}</p> : <p>{eligibility.eligible ? '场景已保存且几何检查通过，可以确认。' : eligibility.blockingReasons.map(reasonLabel).join('；')}</p>}
            {confirmationError ? <p role="alert">{confirmationError}</p> : null}
            <button type="button" disabled={!eligibility.eligible || confirmingScene} onClick={() => { void confirmCurrentScene(); }}>{confirmingScene ? '确认中…' : '确认此场景'}</button>
            <button type="button" className="viewer-secondary-action" onClick={onBack}>返回并新建模型确认</button>
            <small>确认已保存到服务器；不代表可制造、适合宠物使用或已报价</small>
          </div>
        </aside>
      </div>
    </section>
  );
}
