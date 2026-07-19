'use client';

import { Canvas, useThree } from '@react-three/fiber';
import { ContactShadows, OrbitControls } from '@react-three/drei';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { getViewerAsset } from '../../lib/viewer/catalog';
import type { ViewerStateResponse } from '@petscape/server/contracts/scenes';
import {
  TARGET_INSPECTION_ASSETS,
  createModelInspectionState,
  markInspectionLoadError,
  markInspectionLoadReady,
  retryInspectionLoad,
  selectInspectionAsset,
  setInspectionUniformScale,
  type InspectionLoadStatus,
} from '../../lib/viewer/model-inspection';
import {
  confirmViewerModel,
  createViewerDesignItem,
  loadViewerState,
  saveViewerScene,
} from '../../lib/viewer/viewer-api';
import { createPersistedSceneDraft } from '../../lib/viewer/viewer-workspace';
import { formatDimensionsMm } from '../../lib/display-format';
import { SceneEditorClient } from './SceneEditorClient';
import { ViewerViewCube } from './ViewerViewCube';
import './viewer.css';

function disposeScene(scene: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
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

function CameraReset({ token }: { token: number }) {
  const { camera, controls } = useThree();
  useEffect(() => {
    camera.position.set(430, 280, 430);
    camera.updateProjectionMatrix();
    if (controls && 'target' in controls) {
      const orbit = controls as unknown as { target: THREE.Vector3; update: () => void };
      orbit.target.set(0, 60, 0);
      orbit.update();
    }
  }, [camera, controls, token]);
  return null;
}

function InspectionModel({
  url,
  uniformScale,
  requestId,
  onLoad,
}: {
  url: string;
  uniformScale: number;
  requestId: number;
  onLoad: (status: InspectionLoadStatus, requestId: number, detail?: string) => void;
}) {
  const [scene, setScene] = useState<THREE.Group | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    let ownedScene: THREE.Group | null = null;
    onLoad('loading', requestId);

    async function load() {
      try {
        const response = await fetch(url, { signal: controller.signal, cache: 'no-store' });
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
          return;
        }
        setScene(ownedScene);
        onLoad('ready', requestId);
      } catch (error) {
        if (!active || controller.signal.aborted) return;
        onLoad('error', requestId, error instanceof Error ? error.message : '未知加载错误');
      }
    }

    void load();
    return () => {
      active = false;
      controller.abort();
      if (ownedScene) disposeScene(ownedScene);
    };
  }, [onLoad, requestId, url]);

  if (!scene) return null;
  return <primitive object={scene} scale={uniformScale} />;
}

function InspectionCanvas({
  url,
  uniformScale,
  requestId,
  resetToken,
  onLoad,
}: {
  url: string;
  uniformScale: number;
  requestId: number;
  resetToken: number;
  onLoad: (status: InspectionLoadStatus, requestId: number, detail?: string) => void;
}) {
  return (
    <Canvas shadows camera={{ position: [430, 280, 430], fov: 38, near: 1, far: 3000 }} dpr={[1, 1.75]}>
      <color attach="background" args={['#f7f7f5']} />
      <ambientLight intensity={1.8} />
      <directionalLight position={[260, 420, 180]} intensity={2.4} castShadow />
      <InspectionModel url={url} uniformScale={uniformScale} requestId={requestId} onLoad={onLoad} />
      <ContactShadows position={[0, -1, 0]} opacity={0.24} scale={650} blur={2.8} far={400} />
      <gridHelper args={[650, 13, '#d8d7d2', '#e8e7e2']} position={[0, -0.5, 0]} />
      <OrbitControls makeDefault enableDamping minDistance={180} maxDistance={900} target={[0, 60, 0]} />
      <CameraReset token={resetToken} />
      <ViewerViewCube />
    </Canvas>
  );
}

type ViewerProject = {
  id: string;
  title: string | null;
  status: string;
  updatedAt: string;
};

function projectName(project: ViewerProject) {
  return project.title?.trim() || '未命名项目';
}

export function ModelInspectionClient({ initialProjectId }: { initialProjectId?: string }) {
  const [state, setState] = useState(() => createModelInspectionState('cheese-lounge-bed'));
  const [resetToken, setResetToken] = useState(0);
  const [projects, setProjects] = useState<ViewerProject[]>([]);
  const [selectedProject, setSelectedProject] = useState<ViewerProject | null>(null);
  const [projectStatus, setProjectStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [projectError, setProjectError] = useState('');
  const [projectReloadToken, setProjectReloadToken] = useState(0);
  const [newProjectTitle, setNewProjectTitle] = useState('我的 3D 场景');
  const [creatingProject, setCreatingProject] = useState(false);
  const [viewerState, setViewerState] = useState<ViewerStateResponse | null>(null);
  const [workspaceStatus, setWorkspaceStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [workspaceError, setWorkspaceError] = useState('');
  const [confirmingModel, setConfirmingModel] = useState(false);
  const [reviewAgain, setReviewAgain] = useState(false);
  const asset = useMemo(() => getViewerAsset(state.assetKey), [state.assetKey]);

  useEffect(() => {
    const controller = new AbortController();
    async function loadProjects() {
      setProjectStatus('loading');
      setProjectError('');
      try {
        const response = await fetch('/api/v1/projects', { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error(`项目读取失败 · HTTP ${response.status}`);
        const payload = (await response.json()) as { projects?: ViewerProject[] };
        const nextProjects = Array.isArray(payload.projects) ? payload.projects : [];
        setProjects(nextProjects);
        if (initialProjectId) {
          const explicitProject = nextProjects.find((project) => project.id === initialProjectId);
          if (!explicitProject) throw new Error('链接中的项目不存在或无权访问');
          setWorkspaceStatus('loading');
          setSelectedProject(explicitProject);
        }
        setProjectStatus('ready');
      } catch (error) {
        if (controller.signal.aborted) return;
        setProjectStatus('error');
        setProjectError(error instanceof Error ? error.message : '项目读取失败');
      }
    }
    void loadProjects();
    return () => controller.abort();
  }, [initialProjectId, projectReloadToken]);

  const chooseProject = useCallback((project: ViewerProject) => {
    setWorkspaceStatus('loading');
    setWorkspaceError('');
    setSelectedProject(project);
    setState(createModelInspectionState('cheese-lounge-bed'));
    setViewerState(null);
    setReviewAgain(false);
    window.history.replaceState(null, '', `/viewer?projectId=${encodeURIComponent(project.id)}`);
  }, []);

  useEffect(() => {
    if (!selectedProject) return;
    const controller = new AbortController();
    void loadViewerState(selectedProject.id).then((loaded) => {
      if (controller.signal.aborted) return;
      setViewerState(loaded);
      setWorkspaceStatus('ready');
    }).catch((error) => {
      if (controller.signal.aborted) return;
      setWorkspaceStatus('error');
      setWorkspaceError(error instanceof Error ? error.message : '工作台恢复失败');
    });
    return () => controller.abort();
  }, [selectedProject]);

  const persistModelConfirmation = useCallback(async () => {
    if (!selectedProject || confirmingModel || state.loadStatus !== 'ready') return;
    setConfirmingModel(true);
    setWorkspaceError('');
    try {
      const designItem = viewerState?.designItem ?? await createViewerDesignItem(selectedProject.id, asset.label);
      const confirmation = await confirmViewerModel(designItem.id, {
        modelRef: { ...asset.modelRef },
        sourceBoundsMm: { ...asset.sourceBoundsMm },
        uniformScale: state.uniformScale,
        finalBoundsMm: { ...state.finalBoundsMm },
      });
      const draft = createPersistedSceneDraft(selectedProject.id, designItem.id, confirmation);
      const scene = await saveViewerScene(selectedProject.id, {
        expectedRevision: viewerState?.scene?.revision ?? 0,
        draft,
      });
      setViewerState({
        designItem: { ...designItem, currentModelConfirmationId: confirmation.id },
        modelConfirmation: confirmation,
        scene,
        latestSceneConfirmation: viewerState?.latestSceneConfirmation ?? null,
      });
      setReviewAgain(false);
      setWorkspaceStatus('ready');
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : '模型确认失败');
    } finally {
      setConfirmingModel(false);
    }
  }, [asset, confirmingModel, selectedProject, state.finalBoundsMm, state.loadStatus, state.uniformScale, viewerState]);

  const createProject = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const title = newProjectTitle.trim();
    if (!title || creatingProject) return;
    setCreatingProject(true);
    setProjectError('');
    try {
      const response = await fetch('/api/v1/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title }),
      });
      if (!response.ok) throw new Error(`项目创建失败 · HTTP ${response.status}`);
      const project = (await response.json()) as ViewerProject;
      setProjects((current) => [project, ...current]);
      chooseProject(project);
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : '项目创建失败');
    } finally {
      setCreatingProject(false);
    }
  }, [chooseProject, creatingProject, newProjectTitle]);

  const handleLoad = useCallback(
    (status: InspectionLoadStatus, requestId: number, detail?: string) => {
      if (status === 'ready') setState((current) => markInspectionLoadReady(current, requestId));
      if (status === 'error') {
        setState((current) => markInspectionLoadError(current, requestId, detail ?? '模型加载失败'));
      }
    },
    [],
  );

  if (!selectedProject) {
    return (
      <section className="viewer-project-gate" aria-labelledby="viewer-project-title">
        <div className="viewer-project-card">
          <span className="viewer-eyebrow">3D 工作台入口</span>
          <h1 id="viewer-project-title">先选择一个明确项目</h1>
          <p>选择已有项目，或创建一个新项目开始。</p>

          {projectStatus === 'loading' ? <div className="viewer-project-status" role="status">正在读取你的项目…</div> : null}
          {projectStatus === 'error' ? (
            <div className="viewer-project-status is-error" role="alert">
              <span>{projectError}</span>
              <button type="button" onClick={() => setProjectReloadToken((token) => token + 1)}>重试</button>
            </div>
          ) : null}
          {projectStatus === 'ready' ? (
            <div className="viewer-project-list" aria-label="已有项目">
              {projects.length === 0 ? <p>还没有正式项目。请在下方明确创建一个。</p> : null}
              {projects.map((project) => (
                <button type="button" key={project.id} onClick={() => chooseProject(project)}>
                  <span><strong>{projectName(project)}</strong><small>{project.id}</small></span>
                  <i aria-hidden="true">→</i>
                </button>
              ))}
            </div>
          ) : null}

          <form className="viewer-project-create" onSubmit={createProject}>
            <label htmlFor="viewer-project-name">创建新项目</label>
            <div>
              <input id="viewer-project-name" value={newProjectTitle} onChange={(event) => setNewProjectTitle(event.target.value)} maxLength={80} />
              <button type="submit" disabled={!newProjectTitle.trim() || creatingProject}>{creatingProject ? '创建中…' : '创建并进入'}</button>
            </div>
          </form>
          <p className="viewer-boundary">测试模型 · 沙箱环境；AI 生成即将开放，当前提供测试模型。</p>
        </div>
      </section>
    );
  }

  if (selectedProject && workspaceStatus === 'loading') {
    return <section className="viewer-project-gate"><div className="viewer-project-card" role="status">正在从服务器恢复 3D 工作…</div></section>;
  }

  if (selectedProject && workspaceStatus === 'error' && !viewerState) {
    return <section className="viewer-project-gate"><div className="viewer-project-card"><div className="viewer-project-status is-error" role="alert">{workspaceError}</div><button type="button" onClick={() => { setWorkspaceStatus('loading'); setWorkspaceError(''); setSelectedProject({ ...selectedProject }); }}>重试恢复</button></div></section>;
  }

  if (!reviewAgain && selectedProject && viewerState?.scene && viewerState.modelConfirmation) {
    return (
      <SceneEditorClient
        projectId={selectedProject.id}
        projectName={selectedProject.title?.trim() || '未命名项目'}
        initialScene={viewerState.scene}
        latestConfirmation={viewerState.latestSceneConfirmation}
        onBack={() => { setReviewAgain(true); setState((current) => selectInspectionAsset(current, current.assetKey)); }}
      />
    );
  }

  return (
    <section className="viewer-workbench" aria-label="3D 模型单品检视">
      <header className="viewer-topbar">
        <div className="viewer-steps" aria-label="工作台阶段">
          <span className="viewer-step is-current"><i>1</i>单品检视与模型确认</span>
          <span className="viewer-step-line" />
          <span className="viewer-step"><i>2</i>完整场景确认</span>
        </div>
        <div className="viewer-topbar-context">
          <button
            type="button"
            className="viewer-project-pill"
            onClick={() => {
              setSelectedProject(null);
              window.history.replaceState(null, '', '/viewer');
            }}
          >
            项目 · {projectName(selectedProject)} <span>更换</span>
          </button>
          <span className="viewer-sandbox">测试模型 · 沙箱环境</span>
        </div>
      </header>

      <div className="viewer-grid">
        <aside className="viewer-rail" aria-label="测试模型">
          <div>
            <span className="viewer-eyebrow">测试模型</span>
            <h1>选择一个目标物品</h1>
            <p>首批开放的测试模型。</p>
          </div>
          <div className="viewer-model-list">
            {TARGET_INSPECTION_ASSETS.map((candidate) => (
              <button
                type="button"
                className={candidate.assetKey === state.assetKey ? 'is-selected' : ''}
                aria-pressed={candidate.assetKey === state.assetKey}
                key={candidate.assetKey}
                onClick={() => setState((current) => selectInspectionAsset(current, candidate.assetKey))}
              >
                <strong>{candidate.label}</strong>
                <span>{formatDimensionsMm(candidate.sourceBoundsMm)}</span>
              </button>
            ))}
          </div>
          <p className="viewer-ai-note">AI 生成即将开放，当前提供测试模型</p>
        </aside>

        <div className="viewer-stage">
          <InspectionCanvas
            key={`${state.assetKey}-${state.loadRequestId}`}
            url={asset.publicPath}
            uniformScale={state.uniformScale}
            requestId={state.loadRequestId}
            resetToken={resetToken}
            onLoad={handleLoad}
          />
          <div className="viewer-stage-name"><span />{asset.label}<small>{asset.assetKey}</small></div>
          <div className="viewer-final-chip">最终 {formatDimensionsMm(state.finalBoundsMm)}</div>
          <div className="viewer-toolbar">
            <span>拖动旋转 · 滚轮缩放视角</span>
            <button type="button" onClick={() => setResetToken((token) => token + 1)}>回到原点</button>
          </div>
          {state.loadStatus !== 'ready' ? (
            <div className="viewer-overlay" role={state.loadStatus === 'error' ? 'alert' : 'status'}>
              {state.loadStatus === 'loading' ? (
                <><span className="viewer-spinner" /><strong>正在加载 {asset.label}</strong><p>切换模型会取消旧请求</p></>
              ) : (
                <><span className="viewer-error-mark">!</span><strong>模型加载失败</strong><p>{state.loadError}</p><button type="button" onClick={() => setState(retryInspectionLoad)}>重试</button></>
              )}
            </div>
          ) : null}
        </div>

        <aside className="viewer-panel" aria-label="尺寸与确认">
          <div className="viewer-card">
            <h2>尺寸与比例</h2>
            <div className="viewer-dimension-row"><span>原始尺寸</span><strong>{formatDimensionsMm(asset.sourceBoundsMm)}</strong><small>模型原始尺寸</small></div>
            <div className="viewer-dimension-row"><span>最终尺寸</span><strong>{formatDimensionsMm(state.finalBoundsMm)}</strong><small>预览尺寸，非制造建议</small></div>
            <label className="viewer-scale">
              <span>统一比例 <output>{Math.round(state.uniformScale * 100)}%</output></span>
              <input
                aria-label="统一比例"
                type="range"
                min="0.5"
                max="1.5"
                step="0.01"
                value={state.uniformScale}
                onChange={(event) => setState((current) => setInspectionUniformScale(current, Number(event.target.value)))}
              />
              <small>整体等比缩放</small>
            </label>
          </div>

          <div className="viewer-editorial-space" aria-hidden="true" />

          <div className="viewer-confirm-block">
            <p>确认只表示愿意用此模型继续摆放，不表示可制造、适合宠物使用或已经报价。</p>
            <button
              type="button"
              onClick={() => { void persistModelConfirmation(); }}
              disabled={state.loadStatus !== 'ready' || confirmingModel}
            >
              {confirmingModel ? '正在写入不可变确认…' : '确认此模型，进入场景'} <span aria-hidden="true">→</span>
            </button>
            {workspaceError ? <small role="alert">{workspaceError}</small> : null}
            <small>测试模型 · 沙箱环境</small>
          </div>
        </aside>
      </div>
    </section>
  );
}
