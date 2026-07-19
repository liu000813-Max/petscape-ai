import test from 'node:test';
import assert from 'node:assert/strict';

import { formatDimensionsMm, formatMillimeters } from '../app/lib/display-format.ts';

test('毫米显示统一为整数或一位小数', () => {
  assert.equal(formatMillimeters(120), '120');
  assert.equal(formatMillimeters(119.022), '119');
  assert.equal(formatMillimeters(53.865), '53.9');
  assert.equal(formatMillimeters(-0), '0');
  assert.equal(formatDimensionsMm({ x: 120, y: 119.022, z: 53.865 }), '120 × 119 × 53.9 mm');
});
