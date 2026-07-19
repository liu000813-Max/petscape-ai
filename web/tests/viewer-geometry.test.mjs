import test from 'node:test';
import assert from 'node:assert/strict';

import {
  aabbOverlap,
  calculateFinalBounds,
  cageViolation,
  rotatedWorldAabb,
  supportSurfaceY,
} from '../app/lib/viewer/geometry.ts';

const approximately = (actual, expected, epsilon = 1e-6) => {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} ~= ${expected}`);
};

test('等比缩放同步换算最终三轴尺寸', () => {
  assert.deepEqual(calculateFinalBounds({ x: 200, y: 80, z: 100 }, 1.5), {
    x: 300,
    y: 120,
    z: 150,
  });
});

test('绕 Y 轴旋转后的 world AABB 使用旋转后包围盒', () => {
  const ninety = rotatedWorldAabb({ x: 200, y: 80, z: 100 }, { x: 0, y: 0, z: 0 }, Math.PI / 2);
  approximately(ninety.max.x - ninety.min.x, 100);
  approximately(ninety.max.z - ninety.min.z, 200);

  const fortyFive = rotatedWorldAabb({ x: 200, y: 80, z: 100 }, { x: 0, y: 0, z: 0 }, Math.PI / 4);
  approximately(fortyFive.max.x - fortyFive.min.x, 150 * Math.SQRT2);
  approximately(fortyFive.max.z - fortyFive.min.z, 150 * Math.SQRT2);
});

test('笼舍越界同时检查水平、地面和高度', () => {
  const cage = { width: 600, height: 400, depth: 400 };
  assert.equal(cageViolation(rotatedWorldAabb({ x: 200, y: 80, z: 100 }, { x: 0, y: 0, z: 0 }, 0), cage), null);
  assert.equal(cageViolation(rotatedWorldAabb({ x: 200, y: 80, z: 100 }, { x: 251, y: 0, z: 0 }, 0), cage), 'x');
  assert.equal(cageViolation(rotatedWorldAabb({ x: 200, y: 80, z: 100 }, { x: 0, y: -1, z: 0 }, 0), cage), 'floor');
  assert.equal(cageViolation(rotatedWorldAabb({ x: 200, y: 80, z: 100 }, { x: 0, y: 321, z: 0 }, 0), cage), 'height');
});

test('AABB 体积相交才算碰撞，恰好接触支撑面不算穿模', () => {
  const lower = rotatedWorldAabb({ x: 200, y: 80, z: 100 }, { x: 0, y: 0, z: 0 }, 0);
  const touching = rotatedWorldAabb({ x: 100, y: 50, z: 80 }, { x: 0, y: 80, z: 0 }, 0);
  const penetrating = rotatedWorldAabb({ x: 100, y: 50, z: 80 }, { x: 0, y: 79, z: 0 }, 0);
  assert.equal(aabbOverlap(lower, touching), false);
  assert.equal(aabbOverlap(lower, penetrating), true);
});

test('水平叠放只吸附到具有足够 XZ 重叠的最高支撑面', () => {
  const candidate = rotatedWorldAabb({ x: 100, y: 50, z: 80 }, { x: 0, y: 0, z: 0 }, 0);
  const lower = rotatedWorldAabb({ x: 200, y: 80, z: 100 }, { x: 0, y: 0, z: 0 }, 0);
  const upper = rotatedWorldAabb({ x: 120, y: 40, z: 90 }, { x: 0, y: 80, z: 0 }, 0);
  assert.equal(supportSurfaceY(candidate, [lower, upper]), 120);

  const farAway = rotatedWorldAabb({ x: 200, y: 80, z: 100 }, { x: 500, y: 0, z: 0 }, 0);
  assert.equal(supportSurfaceY(candidate, [farAway]), 0);
});
