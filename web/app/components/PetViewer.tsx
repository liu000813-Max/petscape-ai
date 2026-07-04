'use client';

// 宠物角色 three.js 舞台（批次1）：加载 avatar 的 model.glb，OrbitControls 360° 旋转查看。
// 参考 scene-lab/SceneLabViewer.tsx 的 GLB 加载 / RoomEnvironment IBL 灯光 / OrbitControls /
// React Strict Mode 双挂载防御（cancelled 标记覆盖所有异步回调入口）。
// 单模型、自动按包围盒归一化取景（avatar GLB 未经 normalize 脚本烘焙，尺度不定，运行时 Box3 居中取景）。
// 必须 client-only（three.js 用 window/document）；父组件用 next/dynamic ssr:false 加载。

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export interface PetViewerProps {
  modelUrl: string;
}

export default function PetViewer({ modelUrl }: PetViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Strict Mode 双挂载防御：第一次挂载的异步回调可能在清理后才 resolve，cancelled 让其 no-op。
    let cancelled = false;
    setStatus('loading');
    setErrorMsg('');

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0a0a);

    const camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.01, 1000);
    camera.position.set(0, 0.6, 3);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    container.appendChild(renderer.domElement);

    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTex;

    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(3, 5, 3);
    scene.add(dir);
    scene.add(new THREE.AmbientLight(0xffffff, 0.3));

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 1.2;
    controls.target.set(0, 0, 0);

    const loader = new GLTFLoader();
    loader.load(
      modelUrl,
      (gltf) => {
        if (cancelled) return;
        const obj = gltf.scene;
        // 按包围盒归一化：居中到原点，缩放到最长边 ≈ 2 单位，让取景稳定。
        const box = new THREE.Box3().setFromObject(obj);
        const size = new THREE.Vector3();
        const center = new THREE.Vector3();
        box.getSize(size);
        box.getCenter(center);
        const maxDim = Math.max(size.x, size.y, size.z) || 1;
        const scale = 2 / maxDim;
        obj.position.set(-center.x * scale, -center.y * scale, -center.z * scale);
        obj.scale.setScalar(scale);
        scene.add(obj);
        controls.target.set(0, 0, 0);
        camera.position.set(0, 0.6, 3.2);
        controls.update();
        setStatus('ready');
      },
      undefined,
      (err) => {
        if (cancelled) return;
        setStatus('error');
        setErrorMsg(String(err instanceof Error ? err.message : err));
      },
    );

    let frameId = 0;
    const animate = () => {
      frameId = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const onResize = () => {
      if (!container) return;
      camera.aspect = container.clientWidth / container.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight);
    };
    window.addEventListener('resize', onResize);

    return () => {
      cancelled = true;
      cancelAnimationFrame(frameId);
      window.removeEventListener('resize', onResize);
      controls.dispose();
      renderer.dispose();
      pmrem.dispose();
      envTex.dispose();
      if (renderer.domElement.parentNode === container) container.removeChild(renderer.domElement);
    };
  }, [modelUrl]);

  return (
    <div style={{ position: 'absolute', inset: 0, borderRadius: 24, overflow: 'hidden' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      {status === 'loading' && (
        <div className="pet-viewer-overlay">加载 3D 模型…</div>
      )}
      {status === 'error' && (
        <div className="pet-viewer-overlay pet-viewer-overlay--error">模型加载失败：{errorMsg}</div>
      )}
    </div>
  );
}
