'use client';

// F31 环境预览画布：three.js 场景，已选模块（GLB 网格 或 billboard 立牌）实时出现/消失。
// 参考实现：app/scene-lab/SceneLabViewer.tsx（老文件只读参考，不改）。
// 必须 client-only（window/document），调用方须 next/dynamic + ssr:false 加载本组件。

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { getAssetEntry } from './assetIndex';

export type SceneViewerModule = {
  id: string;
  title?: string;
};

export interface SceneViewerProps {
  selectedModules: SceneViewerModule[];
  petAvatarUrl?: string | null; // project.avatar.modelUrl（批次1 产物，只读）
}

type AssetMeta = {
  heightMm: number;
  footprint: { xMm: number; zMm: number };
};

// 简单网格布局：2-3 列，间距按内容自适应留白（mm）。中央预留给宠物位，模块环绕摆放。
const GRID_COLS = 3;
const CELL_SIZE_MM = 260;
const BILLBOARD_HEIGHT_MM = 160;

function gridPosition(index: number): [number, number] {
  // 跳过中心格（留给宠物），从周围格子按顺序摆放。
  const col = index % GRID_COLS;
  const row = Math.floor(index / GRID_COLS);
  const x = (col - (GRID_COLS - 1) / 2) * CELL_SIZE_MM;
  const z = row * CELL_SIZE_MM + CELL_SIZE_MM; // row 0 就已经离中心一格，给宠物位让路
  return [x, z];
}

export default function SceneViewer({ selectedModules, petAvatarUrl }: SceneViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const loadedObjectsRef = useRef<Map<string, THREE.Object3D>>(new Map());
  const petObjectRef = useRef<THREE.Object3D | null>(null);
  const loaderRef = useRef<GLTFLoader | null>(null);
  const textureLoaderRef = useRef<THREE.TextureLoader | null>(null);

  // ---- 场景初始化（一次性）----
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // React Strict Mode（dev）双挂载防御：见 SceneLabViewer.tsx 同名注释，
    // GLTFLoader/TextureLoader 的异步回调必须在 cancelled 后变 no-op，
    // 避免旧挂载的加载结果误加到新挂载（或已清理）的 scene 上。
    let cancelled = false;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf3f1ec);
    sceneRef.current = scene;
    loadedObjectsRef.current.clear();
    petObjectRef.current = null;

    const camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 1, 5000);
    camera.position.set(500, 450, 650);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const ambient = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(ambient);
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.7);
    dirLight.position.set(300, 500, 300);
    scene.add(dirLight);

    // 地台
    const groundGeo = new THREE.PlaneGeometry(1600, 1600);
    const groundMat = new THREE.MeshStandardMaterial({ color: 0xe4e0d6, side: THREE.DoubleSide });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 100, 0);
    controls.enableDamping = true;

    loaderRef.current = new GLTFLoader();
    textureLoaderRef.current = new THREE.TextureLoader();

    let frameId: number;
    const animate = () => {
      frameId = requestAnimationFrame(animate);
      controls.update();
      // billboard 立牌始终面向相机
      loadedObjectsRef.current.forEach((obj) => {
        if (obj.userData.isBillboard) {
          obj.quaternion.copy(camera.quaternion);
        }
      });
      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      if (!container) return;
      camera.aspect = container.clientWidth / container.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      cancelled = true;
      cancelAnimationFrame(frameId);
      window.removeEventListener('resize', handleResize);
      controls.dispose();
      loadedObjectsRef.current.forEach((obj) => disposeObject(obj));
      loadedObjectsRef.current.clear();
      renderer.dispose();
      if (renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- 已选模块 diff：加/减模块实时增删场景对象，不整场景重建 ----
  useEffect(() => {
    const scene = sceneRef.current;
    const loader = loaderRef.current;
    const textureLoader = textureLoaderRef.current;
    if (!scene || !loader || !textureLoader) return;

    let cancelled = false;
    const loaded = loadedObjectsRef.current;
    const selectedIds = new Set(selectedModules.map((m) => m.id));

    // 移除不再被选中的对象
    for (const [id, obj] of Array.from(loaded.entries())) {
      if (!selectedIds.has(id)) {
        scene.remove(obj);
        disposeObject(obj);
        loaded.delete(id);
      }
    }

    // 新增被选中但尚未加载的对象
    selectedModules.forEach((mod, index) => {
      if (loaded.has(mod.id)) return; // 已在场景，跳过
      const entry = getAssetEntry(mod.id);
      const [x, z] = gridPosition(index);

      if (!entry) return; // assetIndex 未覆盖，不渲染（不应发生，13 模块全覆盖）

      if (entry.kind === 'glb') {
        fetch(entry.metaPath)
          .then((res) => {
            if (!res.ok) throw new Error(`meta 请求失败: ${res.status}`);
            return res.json() as Promise<AssetMeta>;
          })
          .then((_meta) => {
            if (cancelled) return;
            loader.load(
              entry.glbPath,
              (gltf) => {
                if (cancelled) return;
                const obj = gltf.scene;
                obj.position.set(x, 0, z);
                obj.userData.isBillboard = false;
                loaded.set(mod.id, obj);
                scene.add(obj);
              },
              undefined,
              (err) => {
                // GLB 加载失败不阻塞其他模块，静默降级（spec：billboard 立牌不追求精美，时间优先给 GLB 加载稳定性）
                // eslint-disable-next-line no-console
                console.warn(`[SceneViewer] GLB 加载失败 ${mod.id}:`, err);
              }
            );
          })
          .catch((err) => {
            // eslint-disable-next-line no-console
            console.warn(`[SceneViewer] meta 读取失败 ${mod.id}:`, err);
          });
      } else {
        // billboard：PlaneGeometry + 商品图纹理，永远面向相机
        textureLoader.load(
          entry.imagePath,
          (texture) => {
            if (cancelled) return;
            texture.colorSpace = THREE.SRGBColorSpace;
            const aspect = texture.image ? texture.image.width / texture.image.height : 1;
            const height = BILLBOARD_HEIGHT_MM;
            const width = height * aspect;
            const geometry = new THREE.PlaneGeometry(width, height);
            const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide });
            const plane = new THREE.Mesh(geometry, material);
            plane.position.set(x, height / 2, z);
            plane.userData.isBillboard = true;
            loaded.set(mod.id, plane);
            scene.add(plane);
          },
          undefined,
          (err) => {
            // eslint-disable-next-line no-console
            console.warn(`[SceneViewer] billboard 纹理加载失败 ${mod.id}:`, err);
          }
        );
      }
    });

    return () => {
      cancelled = true;
    };
  }, [selectedModules]);

  // ---- 中央宠物位：project.avatar.modelUrl 存在则加载置于中央，不存在则空着 ----
  useEffect(() => {
    const scene = sceneRef.current;
    const loader = loaderRef.current;
    if (!scene || !loader) return;

    let cancelled = false;

    // 先清掉旧的宠物模型（url 变化/清空时）
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
          // 宠物 GLB 是运行时生成的 raw 产物（米制、未过 normalize 烘焙），
          // 而场景与模块资产是毫米制——不归一会缩成 ~2mm 肉眼不可见。
          // 按 bbox 归一到固定展示高度，并把底面落到地台。
          const PET_HEIGHT_MM = 140;
          const bbox = new THREE.Box3().setFromObject(obj);
          const size = bbox.getSize(new THREE.Vector3());
          const maxDim = Math.max(size.x, size.y, size.z);
          if (maxDim > 0) {
            const scale = PET_HEIGHT_MM / maxDim;
            obj.scale.setScalar(scale);
          }
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

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />;
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
  });
}

function disposeMaterial(material: THREE.Material) {
  const mat = material as THREE.Material & { map?: THREE.Texture | null };
  mat.map?.dispose();
  material.dispose();
}
