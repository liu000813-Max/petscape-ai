'use client';

// three.js 组合场景预览（v2，明早 demo 用）：定制件 GLB + N 个预置模块 GLB + 程序化底座笼箱共存渲染。
// 资产已用 scripts/normalize_asset.py 一次性烘焙为 1 unit = 1mm 的 .norm.glb + .meta.json，
// 运行时不再做 Box3 归一化猜测——直接按 mm 世界坐标贴地摆放，笼箱按真实 600x400x400mm 画，
// 与资产同尺度，比例真实感是本次验收核心。
// 必须 client-only（three.js 用 window/document），父组件已用 next/dynamic ssr:false 加载本组件。

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

type AssetMeta = {
  heightMm: number;
  footprint: { xMm: number; zMm: number };
};

type ModuleDef = {
  id: string;
  label: string;
  glbPath: string;
  metaPath: string;
  // 世界坐标（mm）：底部中心落点的 x/z；y 恒为 0（贴地），不由这里指定。
  position: [number, number];
};

const CUSTOM_ITEM: ModuleDef = {
  id: 'custom-item',
  label: '定制件（常驻）',
  glbPath: '/scene-lab-assets/custom-item.norm.glb',
  metaPath: '/scene-lab-assets/custom-item.meta.json',
  position: [0, 0],
};

const MODULES: ModuleDef[] = [
  {
    id: 'climber',
    label: '模块1：攀爬架',
    glbPath: '/scene-lab-assets/module-climber.norm.glb',
    metaPath: '/scene-lab-assets/module-climber.meta.json',
    position: [-190, -90],
  },
  {
    id: 'module2',
    label: '模块2',
    glbPath: '/scene-lab-assets/module-2.norm.glb',
    metaPath: '/scene-lab-assets/module-2.meta.json',
    position: [190, -90],
  },
];

// 笼箱底座真实尺寸（mm），与资产同尺度（1 unit = 1mm）。
const CAGE_SIZE_MM = { width: 600, depth: 400, height: 400 };

// 打印材质预览色板：常见 PETG/PLA 色
const CLAY_COLORS = [
  { id: 'off-white', label: '米白', hex: 0xf1ece1 },
  { id: 'wood', label: '木色', hex: 0xc9a679 },
  { id: 'sage', label: '浅绿', hex: 0xa9c0a0 },
  { id: 'gray', label: '灰', hex: 0x9a9a96 },
  { id: 'blush', label: '粉', hex: 0xe3b6b6 },
];

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

/** 把已归一化（1 unit = 1mm，min.y=0，x/z 居中于自身原点）的模型贴地摆到世界坐标 [x, z]。 */
function placeNormalized(object: THREE.Object3D, position: [number, number]) {
  object.position.set(position[0], 0, position[1]);
}

/** 场景内所有 mesh 覆盖为统一单色 clay 材质，保留原几何体/贴图 UV，只替换材质实例。 */
function applyClayMaterial(object: THREE.Object3D, color: number) {
  object.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      const mat = new THREE.MeshStandardMaterial({ color, metalness: 0, roughness: 0.8 });
      child.material = mat;
      child.castShadow = false;
      child.receiveShadow = false;
    }
  });
}

export default function SceneLabViewer() {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const loadedObjectsRef = useRef<Map<string, THREE.Object3D>>(new Map());
  const [checkedModules, setCheckedModules] = useState<Record<string, boolean>>({
    climber: true,
    module2: true,
  });
  const [status, setStatus] = useState('初始化中…');
  const [loadErrors, setLoadErrors] = useState<string[]>([]);
  const [clayColor, setClayColor] = useState<number>(CLAY_COLORS[0].hex);
  const clayColorRef = useRef(clayColor);
  clayColorRef.current = clayColor;

  // 初始化场景（一次性）
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // React Strict Mode（dev）会把这个 effect 挂载两次：先跑一遍再清理再跑一遍。
    // GLTFLoader / fetch(meta.json) 都是异步的，第一次挂载的回调可能在清理之后才 resolve，
    // 此时不能再碰 sceneRef/loadedObjectsRef（那是第二次挂载的状态）。cancelled 标记覆盖
    // 本 effect 内*所有*异步回调入口（GLTFLoader.load 的成功/失败回调、meta fetch 的 then/catch），
    // 让失效挂载的异步结果变成 no-op，避免「旧 scene 里删对了，可见的新 scene 从没加过」。
    let cancelled = false;

    const scene = new THREE.Scene();
    sceneRef.current = scene;
    loadedObjectsRef.current.clear();

    const container_ = container;
    const camera = new THREE.PerspectiveCamera(
      45,
      container_.clientWidth / container_.clientHeight,
      1,
      5000
    );
    camera.position.set(700, 550, 800);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(container_.clientWidth, container_.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    container_.appendChild(renderer.domElement);

    // 统一光照：RoomEnvironment IBL，配合 ACES 色调映射，让 clay 材质在任意色板下都有稳定质感。
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const envTexture = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTexture;
    scene.background = new THREE.Color(0xf3f1ec);

    // 补一盏方向光，避免纯 IBL 下阴影面细节太平。
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.6);
    dirLight.position.set(300, 500, 300);
    scene.add(dirLight);

    // 地面平面（mm 级）
    const groundGeo = new THREE.PlaneGeometry(3000, 3000);
    const groundMat = new THREE.MeshStandardMaterial({ color: 0xe4e0d6, side: THREE.DoubleSide });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);

    // 笼箱底座（真实尺寸 600x400x400mm 线框，与资产同尺度）
    scene.add(buildCageWireframe());

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 150, 0);
    controls.enableDamping = true;

    const loader = new GLTFLoader();
    const errors: string[] = [];

    async function loadAsset(def: ModuleDef, alwaysVisible: boolean) {
      try {
        const metaRes = await fetch(def.metaPath);
        if (cancelled) return;
        if (!metaRes.ok) throw new Error(`meta.json 请求失败: ${metaRes.status}`);
        const meta = (await metaRes.json()) as AssetMeta;
        if (cancelled) return;

        loader.load(
          def.glbPath,
          (gltf) => {
            if (cancelled) return;
            const obj = gltf.scene;
            placeNormalized(obj, def.position);
            applyClayMaterial(obj, clayColorRef.current);
            loadedObjectsRef.current.set(def.id, obj);

            if (alwaysVisible) {
              scene.add(obj);
              return;
            }
            // 按当前勾选状态决定是否加入场景（用 functional update 读最新值，不依赖闭包旧值）
            setCheckedModules((current) => {
              if (current[def.id]) {
                scene.add(obj);
              }
              return current;
            });
          },
          undefined,
          (err) => {
            if (cancelled) return;
            errors.push(`${def.label} 加载失败: ${String(err)}`);
            setLoadErrors([...errors]);
          }
        );
        void meta; // meta 目前仅用于入库校验，摆放坐标由 normalize 脚本烘焙进 GLB 自身
      } catch (err) {
        if (cancelled) return;
        errors.push(`${def.label} meta 读取失败: ${String(err)}`);
        setLoadErrors([...errors]);
      }
    }

    loadAsset(CUSTOM_ITEM, true);
    MODULES.forEach((mod) => loadAsset(mod, false));

    setStatus('渲染中');

    let frameId: number;
    const animate = () => {
      frameId = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      if (!container_) return;
      camera.aspect = container_.clientWidth / container_.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(container_.clientWidth, container_.clientHeight);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      cancelled = true;
      cancelAnimationFrame(frameId);
      window.removeEventListener('resize', handleResize);
      controls.dispose();
      renderer.dispose();
      pmremGenerator.dispose();
      envTexture.dispose();
      container_.removeChild(renderer.domElement);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 勾选/取消勾选 → 场景 add/remove 对应模块（模型已加载完成后才生效）
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    MODULES.forEach((mod) => {
      const obj = loadedObjectsRef.current.get(mod.id);
      if (!obj) return;
      const shouldShow = checkedModules[mod.id];
      const isInScene = obj.parent === scene;
      if (shouldShow && !isInScene) {
        scene.add(obj);
      } else if (!shouldShow && isInScene) {
        scene.remove(obj);
      }
    });
  }, [checkedModules]);

  // 切换材质色 → 对所有已加载对象重新应用 clay 材质
  useEffect(() => {
    loadedObjectsRef.current.forEach((obj) => {
      applyClayMaterial(obj, clayColor);
    });
  }, [clayColor]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100%', fontFamily: 'sans-serif' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderBottom: '1px solid #ddd', background: '#fafaf8' }}>
        <span style={{ fontSize: 13, color: '#555' }}>打印材质：</span>
        {CLAY_COLORS.map((c) => (
          <button
            key={c.id}
            onClick={() => setClayColor(c.hex)}
            title={c.label}
            style={{
              width: 28,
              height: 28,
              borderRadius: '50%',
              border: clayColor === c.hex ? '3px solid #333' : '1px solid #bbb',
              background: `#${c.hex.toString(16).padStart(6, '0')}`,
              cursor: 'pointer',
              padding: 0,
            }}
          />
        ))}
      </div>
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <div ref={containerRef} style={{ flex: 1, position: 'relative' }} />
        <div style={{ width: 260, padding: 16, borderLeft: '1px solid #ddd', background: '#fafaf8', overflowY: 'auto' }}>
          <h2 style={{ fontSize: 16, marginBottom: 4 }}>组合场景预览</h2>
          <p style={{ fontSize: 12, color: '#888', marginBottom: 16 }}>状态：{status}</p>

          <h3 style={{ fontSize: 13, color: '#555', marginBottom: 8 }}>模块清单</h3>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, opacity: 0.6 }}>
            <input type="checkbox" checked disabled />
            {CUSTOM_ITEM.label}
          </label>
          {MODULES.map((mod) => (
            <label key={mod.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <input
                type="checkbox"
                checked={checkedModules[mod.id] ?? false}
                onChange={(e) =>
                  setCheckedModules((prev) => ({ ...prev, [mod.id]: e.target.checked }))
                }
              />
              {mod.label}
            </label>
          ))}

          {loadErrors.length > 0 && (
            <div style={{ marginTop: 16, fontSize: 12, color: '#c0392b' }}>
              {loadErrors.map((e, i) => (
                <p key={i}>{e}</p>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
