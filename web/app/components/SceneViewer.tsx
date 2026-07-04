'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { getAssetEntry } from './assetIndex';

export type SceneItem = {
  instanceId: string;
  moduleId: string;
  position: { x: number; y?: number; z: number };
  rotationY: number;
  scale: number;
  collisionSize: { x: number; y?: number; z: number };
  assetKind: 'glb' | 'billboard';
};

export interface SceneViewerProps {
  items: SceneItem[];
  selectedModuleTitles?: Record<string, string>;
  petAvatarUrl?: string | null;
  onItemsChange?: (items: SceneItem[]) => void;
}

type AssetMeta = {
  heightMm: number;
  footprint: { xMm: number; zMm: number };
};

const CAGE_SIZE_MM = { width: 600, depth: 400, height: 400 };
const BILLBOARD_HEIGHT_MM = 150;
const CLAY_MATERIAL = new THREE.MeshStandardMaterial({ color: 0xf1ece1, metalness: 0, roughness: 0.72 });
const MODULE_MATERIALS: Record<string, THREE.MeshStandardMaterial> = {
  'pink-teapot': new THREE.MeshStandardMaterial({ color: 0xf2a1b8, metalness: 0, roughness: 0.62 }),
};
const SELECTED_MATERIAL = new THREE.LineBasicMaterial({ color: 0xff4d2f });

function buildCageWireframe(): THREE.Object3D {
  const group = new THREE.Group();
  const geometry = new THREE.BoxGeometry(CAGE_SIZE_MM.width, CAGE_SIZE_MM.height, CAGE_SIZE_MM.depth);
  const edges = new THREE.EdgesGeometry(geometry);
  const material = new THREE.LineBasicMaterial({ color: 0x8a8a8a });
  const wireframe = new THREE.LineSegments(edges, material);
  wireframe.position.y = CAGE_SIZE_MM.height / 2;
  group.add(wireframe);
  return group;
}

function applyClayMaterial(object: THREE.Object3D, moduleId?: string) {
  const baseMaterial = moduleId ? MODULE_MATERIALS[moduleId] : undefined;
  object.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.material = (baseMaterial ?? CLAY_MATERIAL).clone();
      child.castShadow = false;
      child.receiveShadow = true;
    }
  });
}

function disposeObject(object: THREE.Object3D) {
  object.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.geometry?.dispose();
      const material = child.material;
      if (Array.isArray(material)) {
        material.forEach((m) => disposeMaterial(m));
      } else if (material) {
        disposeMaterial(material);
      }
    }
    if (child instanceof THREE.LineSegments) {
      child.geometry?.dispose();
      const material = child.material;
      if (Array.isArray(material)) {
        material.forEach((m) => disposeMaterial(m));
      } else if (material) {
        disposeMaterial(material);
      }
    }
  });
}

function disposeMaterial(material: THREE.Material) {
  const mat = material as THREE.Material & { map?: THREE.Texture | null };
  mat.map?.dispose();
  material.dispose();
}

function aabbFor(item: SceneItem) {
  const halfX = (item.collisionSize.x * item.scale) / 2;
  const height = ((item.collisionSize.y ?? BILLBOARD_HEIGHT_MM) * item.scale);
  const halfZ = (item.collisionSize.z * item.scale) / 2;
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

function validateItem(candidate: SceneItem, items: SceneItem[]) {
  const box = aabbFor(candidate);
  const halfWidth = CAGE_SIZE_MM.width / 2;
  const halfDepth = CAGE_SIZE_MM.depth / 2;

  if (box.minX < -halfWidth || box.maxX > halfWidth || box.minZ < -halfDepth || box.maxZ > halfDepth) {
    return '已到笼箱边界，不能继续放置。';
  }
  if (box.minY < 0 || box.maxY > CAGE_SIZE_MM.height) {
    return '已到笼箱高度边界，不能继续放置。';
  }

  for (const item of items) {
    if (item.instanceId === candidate.instanceId) continue;
    const other = aabbFor(item);
    const overlaps = box.minX < other.maxX && box.maxX > other.minX && box.minY < other.maxY && box.maxY > other.minY && box.minZ < other.maxZ && box.maxZ > other.minZ;
    if (overlaps) return '会与其它模块重叠，已阻止穿模。';
  }

  return null;
}

function applyItemTransform(object: THREE.Object3D, item: SceneItem) {
  object.position.set(item.position.x, item.position.y ?? 0, item.position.z);
  object.rotation.y = item.rotationY;
  object.scale.setScalar(item.scale);

  if (object.userData.isBillboard) {
    object.position.y = (item.position.y ?? 0) + (BILLBOARD_HEIGHT_MM * item.scale) / 2;
  }
}

function removeSelectionHelper(object: THREE.Object3D) {
  const oldHelper = object.getObjectByName('selected-aabb-helper');
  if (!oldHelper) return;
  object.remove(oldHelper);
  disposeObject(oldHelper);
}

function addSelectionHelper(object: THREE.Object3D, item: SceneItem) {
  removeSelectionHelper(object);
  const boxGeo = new THREE.BoxGeometry(item.collisionSize.x, 4, item.collisionSize.z);
  const helper = new THREE.LineSegments(new THREE.EdgesGeometry(boxGeo), SELECTED_MATERIAL.clone());
  helper.name = 'selected-aabb-helper';
  helper.position.y = 2;
  object.add(helper);
}

function movePatch(item: SceneItem, delta: { x?: number; y?: number; z?: number }): Partial<SceneItem> {
  return {
    position: {
      x: item.position.x + (delta.x ?? 0),
      y: Math.max(0, (item.position.y ?? 0) + (delta.y ?? 0)),
      z: item.position.z + (delta.z ?? 0),
    },
  };
}

function horizontalOverlapRatio(a: SceneItem, b: SceneItem) {
  const ab = aabbFor(a);
  const bb = aabbFor(b);
  const overlapX = Math.max(0, Math.min(ab.maxX, bb.maxX) - Math.max(ab.minX, bb.minX));
  const overlapZ = Math.max(0, Math.min(ab.maxZ, bb.maxZ) - Math.max(ab.minZ, bb.minZ));
  const candidateArea = Math.max(1, (ab.maxX - ab.minX) * (ab.maxZ - ab.minZ));
  return (overlapX * overlapZ) / candidateArea;
}

export default function SceneViewer({ items, selectedModuleTitles = {}, petAvatarUrl, onItemsChange }: SceneViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const transformControlsRef = useRef<TransformControls | null>(null);
  const loadedObjectsRef = useRef<Map<string, THREE.Object3D>>(new Map());
  const petObjectRef = useRef<THREE.Object3D | null>(null);
  const loaderRef = useRef<GLTFLoader | null>(null);
  const textureLoaderRef = useRef<THREE.TextureLoader | null>(null);
  const raycasterRef = useRef(new THREE.Raycaster());
  const itemsRef = useRef(items);
  const selectedInstanceIdRef = useRef<string | null>(items[0]?.instanceId ?? null);
  const transformStartRef = useRef<{ instanceId: string; position: THREE.Vector3 } | null>(null);
  const [selectedInstanceId, setSelectedInstanceId] = useState(items[0]?.instanceId ?? null);
  const [status, setStatus] = useState('点击模块后可拖动；也可用方向、高度和叠放按钮精调。');

  itemsRef.current = items;
  selectedInstanceIdRef.current = selectedInstanceId;

  const selectedItem = useMemo(
    () => items.find((item) => item.instanceId === selectedInstanceId) || null,
    [items, selectedInstanceId]
  );

  useEffect(() => {
    if (selectedInstanceId && !items.some((item) => item.instanceId === selectedInstanceId)) {
      setSelectedInstanceId(items[0]?.instanceId ?? null);
    }
  }, [items, selectedInstanceId]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf3f1ec);
    sceneRef.current = scene;
    loadedObjectsRef.current.clear();

    const camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 1, 5000);
    camera.position.set(650, 520, 720);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const envTexture = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTexture;

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.55);
    dirLight.position.set(320, 520, 320);
    scene.add(dirLight);

    const groundGeo = new THREE.PlaneGeometry(900, 650);
    const groundMat = new THREE.MeshStandardMaterial({ color: 0xe4e0d6, side: THREE.DoubleSide });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);
    scene.add(buildCageWireframe());

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 130, 0);
    controls.enableDamping = true;
    controlsRef.current = controls;

    loaderRef.current = new GLTFLoader();
    textureLoaderRef.current = new THREE.TextureLoader();

    const getPointer = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      return new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -(((event.clientY - rect.top) / rect.height) * 2 - 1));
    };

    const transformControls = new TransformControls(camera, renderer.domElement);
    transformControls.setMode('translate');
    transformControls.setSize(0.82);
    transformControls.showX = true;
    transformControls.showY = true;
    transformControls.showZ = true;
    const transformHelper = transformControls.getHelper();
    scene.add(transformHelper);
    transformControlsRef.current = transformControls;

    const handleTransformDragging = (event: { value: unknown }) => {
      const isDragging = event.value === true;
      controls.enabled = !isDragging;
      const object = transformControls.object;
      if (!object?.userData.instanceId) return;

      if (isDragging) {
        transformStartRef.current = {
          instanceId: object.userData.instanceId,
          position: object.position.clone(),
        };
        setStatus('正在用箭头移动模块。');
        return;
      }

      const current = itemsRef.current.find((item) => item.instanceId === object.userData.instanceId);
      const start = transformStartRef.current;
      transformStartRef.current = null;
      if (!current || !start) return;

      const candidate = {
        ...current,
        position: {
          x: Math.round(object.position.x),
          y: Math.max(0, Math.round(object.position.y - (object.userData.isBillboard ? (BILLBOARD_HEIGHT_MM * current.scale) / 2 : 0))),
          z: Math.round(object.position.z),
        },
      };
      const error = validateItem(candidate, itemsRef.current);
      if (error) {
        object.position.copy(start.position);
        setStatus(error);
        return;
      }
      setStatus('箭头移动已更新。');
      onItemsChange?.(itemsRef.current.map((item) => (item.instanceId === candidate.instanceId ? candidate : item)));
    };
    transformControls.addEventListener('dragging-changed', handleTransformDragging);

    const handlePointerDown = (event: PointerEvent) => {
      if (transformControls.dragging) return;
      const objects = Array.from(loadedObjectsRef.current.values());
      const pointer = getPointer(event);
      const raycaster = raycasterRef.current;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(objects, true);
      if (!hits.length) return;

      let root: THREE.Object3D | null = hits[0].object;
      while (root && !root.userData.instanceId) root = root.parent;
      if (!root?.userData.instanceId) return;

      event.preventDefault();
      setSelectedInstanceId(root.userData.instanceId);
      setStatus('已选中模块，可拖动箭头移动。');
    };

    renderer.domElement.addEventListener('pointerdown', handlePointerDown);

    let frameId: number;
    const animate = () => {
      frameId = requestAnimationFrame(animate);
      controls.update();
      loadedObjectsRef.current.forEach((obj) => {
        if (obj.userData.isBillboard) {
          obj.quaternion.copy(camera.quaternion);
        }
      });
      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      camera.aspect = container.clientWidth / container.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener('resize', handleResize);
      transformControls.removeEventListener('dragging-changed', handleTransformDragging);
      transformControls.detach();
      scene.remove(transformHelper);
      transformHelper.dispose();
      transformControls.dispose();
      transformControlsRef.current = null;
      renderer.domElement.removeEventListener('pointerdown', handlePointerDown);
      controls.dispose();
      loadedObjectsRef.current.forEach((obj) => disposeObject(obj));
      loadedObjectsRef.current.clear();
      renderer.dispose();
      pmremGenerator.dispose();
      envTexture.dispose();
      if (renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [onItemsChange]);

  useEffect(() => {
    const scene = sceneRef.current;
    const loader = loaderRef.current;
    const textureLoader = textureLoaderRef.current;
    if (!scene || !loader || !textureLoader) return;

    let cancelled = false;
    const loaded = loadedObjectsRef.current;
    const activeIds = new Set(items.map((item) => item.instanceId));

    for (const [instanceId, obj] of Array.from(loaded.entries())) {
      if (!activeIds.has(instanceId)) {
        scene.remove(obj);
        disposeObject(obj);
        loaded.delete(instanceId);
      }
    }

    items.forEach((item) => {
      const existing = loaded.get(item.instanceId);
      if (existing) {
        applyItemTransform(existing, item);
        return;
      }

      const entry = getAssetEntry(item.moduleId);
      if (!entry) return;

      if (entry.kind === 'glb') {
        fetch(entry.metaPath)
          .then((res) => {
            if (!res.ok) throw new Error(`meta 请求失败: ${res.status}`);
            return res.json() as Promise<AssetMeta>;
          })
          .then(() => {
            if (cancelled) return;
            loader.load(
              entry.glbPath,
              (gltf) => {
                if (cancelled || !itemsRef.current.some((current) => current.instanceId === item.instanceId)) return;
                const obj = gltf.scene;
                obj.userData.instanceId = item.instanceId;
                obj.userData.moduleId = item.moduleId;
                obj.userData.isBillboard = false;
                applyClayMaterial(obj, item.moduleId);
                applyItemTransform(obj, item);
                loaded.set(item.instanceId, obj);
                scene.add(obj);
                if (selectedInstanceIdRef.current === item.instanceId) {
                  addSelectionHelper(obj, item);
                  transformControlsRef.current?.attach(obj);
                }
              },
              undefined,
              (err) => {
                // eslint-disable-next-line no-console
                console.warn(`[SceneViewer] GLB 加载失败 ${item.moduleId}:`, err);
              }
            );
          })
          .catch((err) => {
            // eslint-disable-next-line no-console
            console.warn(`[SceneViewer] meta 读取失败 ${item.moduleId}:`, err);
          });
        return;
      }

      textureLoader.load(
        entry.imagePath,
        (texture) => {
          if (cancelled || !itemsRef.current.some((current) => current.instanceId === item.instanceId)) return;
          texture.colorSpace = THREE.SRGBColorSpace;
          const aspect = texture.image ? texture.image.width / texture.image.height : 1;
          const height = BILLBOARD_HEIGHT_MM;
          const width = height * aspect;
          const geometry = new THREE.PlaneGeometry(width, height);
          const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide });
          const plane = new THREE.Mesh(geometry, material);
          plane.userData.instanceId = item.instanceId;
          plane.userData.moduleId = item.moduleId;
          plane.userData.isBillboard = true;
          applyItemTransform(plane, item);
          loaded.set(item.instanceId, plane);
          scene.add(plane);
        },
        undefined,
        (err) => {
          // eslint-disable-next-line no-console
          console.warn(`[SceneViewer] billboard 纹理加载失败 ${item.moduleId}:`, err);
        }
      );
    });

    return () => {
      cancelled = true;
    };
  }, [items]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    const transformControls = transformControlsRef.current;
    let attached = false;
    loadedObjectsRef.current.forEach((obj) => {
      removeSelectionHelper(obj);
      if (obj.userData.instanceId !== selectedInstanceId) return;
      const item = itemsRef.current.find((current) => current.instanceId === selectedInstanceId);
      if (!item) return;
      addSelectionHelper(obj, item);
      transformControls?.attach(obj);
      attached = true;
    });
    if (!attached) {
      transformControls?.detach();
    }
  }, [selectedInstanceId, items]);

  useEffect(() => {
    const scene = sceneRef.current;
    const loader = loaderRef.current;
    if (!scene || !loader) return;

    let cancelled = false;
    if (petObjectRef.current) {
      scene.remove(petObjectRef.current);
      disposeObject(petObjectRef.current);
      petObjectRef.current = null;
    }

    if (petAvatarUrl) {
      loader.load(
        petAvatarUrl,
        (gltf) => {
          if (cancelled) return;
          const obj = gltf.scene;
          const petHeightMm = 140;
          const bbox = new THREE.Box3().setFromObject(obj);
          const size = bbox.getSize(new THREE.Vector3());
          const maxDim = Math.max(size.x, size.y, size.z);
          if (maxDim > 0) obj.scale.setScalar(petHeightMm / maxDim);
          const scaled = new THREE.Box3().setFromObject(obj);
          const center = scaled.getCenter(new THREE.Vector3());
          obj.position.set(-center.x, -scaled.min.y, -center.z);
          petObjectRef.current = obj;
          scene.add(obj);
        },
        undefined,
        (err) => {
          // eslint-disable-next-line no-console
          console.warn('[SceneViewer] 宠物模型加载失败:', err);
        }
      );
    }

    return () => {
      cancelled = true;
    };
  }, [petAvatarUrl]);

  const updateSelected = (patch: Partial<SceneItem>) => {
    if (!selectedItem) return;
    const candidate = { ...selectedItem, ...patch };
    const error = validateItem(candidate, items);
    if (error) {
      setStatus(error);
      return;
    }
    setStatus('模块参数已更新。');
    onItemsChange?.(items.map((item) => (item.instanceId === selectedItem.instanceId ? candidate : item)));
  };

  const stackSelected = () => {
    if (!selectedItem) return;
    const supports = items.filter((item) => item.instanceId !== selectedItem.instanceId);
    if (!supports.length) {
      setStatus('没有可叠放的目标组件。');
      return;
    }

    const support = supports
      .map((item) => ({
        item,
        overlap: horizontalOverlapRatio(selectedItem, item),
        distance: Math.hypot(item.position.x - selectedItem.position.x, item.position.z - selectedItem.position.z),
      }))
      .sort((a, b) => b.overlap - a.overlap || a.distance - b.distance)[0].item;
    const supportBox = aabbFor(support);
    const candidate = {
      ...selectedItem,
      position: {
        x: support.position.x,
        y: supportBox.maxY,
        z: support.position.z,
      },
    };
    const error = validateItem(candidate, items);
    if (error) {
      setStatus(error);
      return;
    }
    setStatus(`已放到 ${selectedModuleTitles[support.moduleId] || support.moduleId} 上方。`);
    onItemsChange?.(items.map((item) => (item.instanceId === selectedItem.instanceId ? candidate : item)));
  };

  const deleteSelected = () => {
    if (!selectedItem) return;
    const nextItems = items.filter((item) => item.instanceId !== selectedItem.instanceId);
    onItemsChange?.(nextItems);
    setSelectedInstanceId(nextItems[0]?.instanceId ?? null);
    setStatus('模块已删除。');
  };

  const selectedTitle = selectedItem ? selectedModuleTitles[selectedItem.moduleId] || selectedItem.moduleId : '未选择模块';
  const statusIsError = status.includes('阻止') || status.includes('边界') || status.includes('重叠');

  return (
    <div className="scene-viewer-shell">
      <div ref={containerRef} className="scene-viewer-canvas" />
      <div className="scene-viewer-panel">
        <div>
          <span>当前模块</span>
          <strong>{selectedTitle}</strong>
          {selectedItem?.assetKind === 'billboard' && <em>非真实 3D，仅商品图立牌</em>}
        </div>
        <div className="scene-viewer-controls">
          <button type="button" disabled={!selectedItem} onClick={() => selectedItem && updateSelected(movePatch(selectedItem, { x: -20 }))}>左移</button>
          <button type="button" disabled={!selectedItem} onClick={() => selectedItem && updateSelected(movePatch(selectedItem, { x: 20 }))}>右移</button>
          <button type="button" disabled={!selectedItem} onClick={() => selectedItem && updateSelected(movePatch(selectedItem, { z: -20 }))}>前移</button>
          <button type="button" disabled={!selectedItem} onClick={() => selectedItem && updateSelected(movePatch(selectedItem, { z: 20 }))}>后移</button>
          <button type="button" disabled={!selectedItem} onClick={() => selectedItem && updateSelected(movePatch(selectedItem, { y: 20 }))}>上移</button>
          <button type="button" disabled={!selectedItem} onClick={() => selectedItem && updateSelected(movePatch(selectedItem, { y: -20 }))}>下移</button>
          <button type="button" disabled={!selectedItem} onClick={() => updateSelected({ rotationY: (selectedItem?.rotationY ?? 0) - Math.PI / 12 })}>左转</button>
          <button type="button" disabled={!selectedItem} onClick={() => updateSelected({ rotationY: (selectedItem?.rotationY ?? 0) + Math.PI / 12 })}>右转</button>
          <button type="button" disabled={!selectedItem} onClick={() => updateSelected({ scale: Math.max(0.7, Number(((selectedItem?.scale ?? 1) - 0.05).toFixed(2))) })}>缩小</button>
          <button type="button" disabled={!selectedItem} onClick={() => updateSelected({ scale: Math.min(1.3, Number(((selectedItem?.scale ?? 1) + 0.05).toFixed(2))) })}>放大</button>
          <button type="button" disabled={!selectedItem} onClick={stackSelected}>放到上面</button>
          <button type="button" disabled={!selectedItem} onClick={() => selectedItem && updateSelected({ position: { ...selectedItem.position, y: 0 }, rotationY: 0, scale: 1 })}>重置</button>
          <button type="button" disabled={!selectedItem} onClick={deleteSelected}>删除</button>
        </div>
        <p className={statusIsError ? 'scene-viewer-status error' : 'scene-viewer-status'}>{status}</p>
      </div>
    </div>
  );
}
