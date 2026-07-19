export function formatMillimeters(value: number): string {
  const normalized = Object.is(value, -0) ? 0 : value;
  return new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  }).format(normalized);
}

export function formatDimensionsMm(dimensions: Readonly<{ x: number; y: number; z: number }>): string {
  return `${formatMillimeters(dimensions.x)} × ${formatMillimeters(dimensions.y)} × ${formatMillimeters(dimensions.z)} mm`;
}
