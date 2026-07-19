'use client';

import { GizmoHelper, useGizmoContext } from '@react-three/drei';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { ThreeEvent } from '@react-three/fiber';

const FACE_LABELS = ['右', '左', '顶', '底', '前', '后'] as const;
const FACE_DIRECTIONS = [
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(-1, 0, 0),
  new THREE.Vector3(0, 1, 0.28).normalize(),
  new THREE.Vector3(0, -1, 0.28).normalize(),
  new THREE.Vector3(0, 0, 1),
  new THREE.Vector3(0, 0, -1),
] as const;

function faceMaterial(label: string) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  if (!context) return new THREE.MeshBasicMaterial({ color: '#fcfcfb' });
  context.fillStyle = '#fcfcfb';
  context.fillRect(0, 0, 128, 128);
  context.strokeStyle = 'rgba(0,0,0,0.16)';
  context.lineWidth = 2;
  context.strokeRect(1, 1, 126, 126);
  context.fillStyle = 'rgba(0,0,0,0.62)';
  context.font = '500 30px Inter, "PingFang SC", sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(label, 64, 67);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshBasicMaterial({ map: texture, toneMapped: false });
}

function Cube() {
  const { tweenCamera } = useGizmoContext();
  const materials = useMemo(
    () => typeof document === 'undefined' ? [] : FACE_LABELS.map(faceMaterial),
    [],
  );

  useEffect(() => () => {
    materials.forEach((material) => {
      material.map?.dispose();
      material.dispose();
    });
  }, [materials]);

  if (materials.length === 0) return null;
  return (
    <mesh
      material={materials}
      onPointerUp={(event: ThreeEvent<PointerEvent>) => {
        event.stopPropagation();
        const materialIndex = event.face?.materialIndex ?? -1;
        const direction = FACE_DIRECTIONS[materialIndex];
        if (direction) tweenCamera(direction);
      }}
    >
      <boxGeometry args={[56, 56, 56]} />
    </mesh>
  );
}

export function ViewerViewCube() {
  return (
    <GizmoHelper alignment="top-right" margin={[72, 72]}>
      <Cube />
    </GizmoHelper>
  );
}
