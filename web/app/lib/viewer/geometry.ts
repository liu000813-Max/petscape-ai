export type BoundsMm = { x: number; y: number; z: number };
export type PositionMm = { x: number; y: number; z: number };
export type CageMm = { width: number; height: number; depth: number };
export type WorldAabb = { min: PositionMm; max: PositionMm };

export function calculateFinalBounds(source: BoundsMm, uniformScale: number): BoundsMm {
  if (!Number.isFinite(uniformScale) || uniformScale <= 0) {
    throw new RangeError('uniformScale 必须是有限正数');
  }
  return {
    x: source.x * uniformScale,
    y: source.y * uniformScale,
    z: source.z * uniformScale,
  };
}

export function rotatedWorldAabb(
  finalBounds: BoundsMm,
  position: PositionMm,
  rotationYRad: number,
): WorldAabb {
  const cosine = Math.abs(Math.cos(rotationYRad));
  const sine = Math.abs(Math.sin(rotationYRad));
  const halfX = (finalBounds.x * cosine + finalBounds.z * sine) / 2;
  const halfZ = (finalBounds.x * sine + finalBounds.z * cosine) / 2;
  return {
    min: { x: position.x - halfX, y: position.y, z: position.z - halfZ },
    max: { x: position.x + halfX, y: position.y + finalBounds.y, z: position.z + halfZ },
  };
}

export function cageViolation(
  box: WorldAabb,
  cage: CageMm,
): 'x' | 'z' | 'floor' | 'height' | null {
  if (box.min.x < -cage.width / 2 || box.max.x > cage.width / 2) return 'x';
  if (box.min.z < -cage.depth / 2 || box.max.z > cage.depth / 2) return 'z';
  if (box.min.y < 0) return 'floor';
  if (box.max.y > cage.height) return 'height';
  return null;
}

export function aabbOverlap(a: WorldAabb, b: WorldAabb): boolean {
  return (
    a.min.x < b.max.x &&
    a.max.x > b.min.x &&
    a.min.y < b.max.y &&
    a.max.y > b.min.y &&
    a.min.z < b.max.z &&
    a.max.z > b.min.z
  );
}

function horizontalOverlapRatio(candidate: WorldAabb, support: WorldAabb): number {
  const overlapX = Math.max(0, Math.min(candidate.max.x, support.max.x) - Math.max(candidate.min.x, support.min.x));
  const overlapZ = Math.max(0, Math.min(candidate.max.z, support.max.z) - Math.max(candidate.min.z, support.min.z));
  const candidateArea = Math.max(
    Number.EPSILON,
    (candidate.max.x - candidate.min.x) * (candidate.max.z - candidate.min.z),
  );
  return (overlapX * overlapZ) / candidateArea;
}

export function supportSurfaceY(
  candidate: WorldAabb,
  supports: WorldAabb[],
  minimumOverlapRatio = 0.5,
): number {
  return supports.reduce((highest, support) => {
    if (horizontalOverlapRatio(candidate, support) < minimumOverlapRatio) return highest;
    return Math.max(highest, support.max.y);
  }, 0);
}
