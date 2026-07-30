import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeHouse, SLAB, WALLH } from '../build/src/engine/house3d.js';

const spec = {
  plotW: 12, plotD: 12, floors: 3,
  bedrooms: 0, bathrooms: 0, kitchens: 0, living: 0,
  dining: false, garage: false, style: 'modern'
};

const foot = { x: 1, y: 1, w: 10, h: 10 };
const stairs = { x: 5, y: 4, w: 2, h: 4 };
const floors = Array.from({ length: 3 }, (_, index) => ({
  index,
  rooms: [{
    type: 'corridor', name: index ? 'Landing' : 'Hall',
    ...foot, area: foot.w * foot.h, door: null, windows: []
  }],
  corridor: { ...foot },
  entrance: index === 0 ? { x: 6, y: 11, width: 1.2 } : null,
  stairs: { ...stairs }
}));

const layout = {
  plotW: spec.plotW,
  plotD: spec.plotD,
  foot,
  corridorX: foot.x,
  CW: foot.w,
  floors,
  partitions: true
};

function worldRect(rect) {
  return {
    minX: rect.x - spec.plotW / 2,
    maxX: rect.x + rect.w - spec.plotW / 2,
    minZ: rect.y - spec.plotD / 2,
    maxZ: rect.y + rect.h - spec.plotD / 2
  };
}

function overlapsOpening(item, opening) {
  const minX = item.x - item.w / 2, maxX = item.x + item.w / 2;
  const minZ = item.z - item.d / 2, maxZ = item.z + item.d / 2;
  const overlapX = Math.min(maxX, opening.maxX) - Math.max(minX, opening.minX);
  const overlapZ = Math.min(maxZ, opening.maxZ) - Math.max(minZ, opening.minZ);
  return overlapX > 1e-6 && overlapZ > 1e-6;
}

function assertOpeningClear(items, opening, label) {
  assert.ok(items.length > 1, `${label} is split into multiple boxes`);
  items.forEach(item => {
    assert.equal(overlapsOpening(item, opening), false,
      `${label} box (${item.x}, ${item.z}, ${item.w}x${item.d}) overlaps stairwell`);
  });
}

test('stacked stairs cut upper slabs/floors and lower ceilings', () => {
  const scene = describeHouse(layout, spec);
  const opening = worldRect(stairs);

  for (let lower = 0; lower < spec.floors - 1; lower++) {
    const upper = lower + 1;
    const lowerCeiling = scene.items.filter(it => it.floor === lower && it.t === 'ceil');
    const upperSlab = scene.items.filter(it => it.floor === upper && it.t === 'underlay');
    const upperFinish = scene.items.filter(it => it.floor === upper && it.t === 'floor');

    assertOpeningClear(lowerCeiling, opening, `level ${lower + 1} ceiling`);
    assertOpeningClear(upperSlab, opening, `level ${upper + 1} underlay`);
    assertOpeningClear(upperFinish, opening, `level ${upper + 1} floor finish`);

    const ceilingArea = lowerCeiling.reduce((sum, it) => sum + it.w * it.d, 0);
    assert.ok(Math.abs(ceilingArea - (foot.w * foot.h - stairs.w * stairs.h)) < 1e-6,
      'split ceiling preserves all area outside the opening');

    const upperBase = upper * (WALLH + SLAB);
    const guards = scene.items.filter(it => it.floor === upper && it.t === 'trim' &&
      it.y >= upperBase && it.y <= upperBase + 1 &&
      (Math.abs(it.h - 0.065) < 1e-6 || Math.abs(it.h - 0.95) < 1e-6));
    assert.ok(guards.length >= 7, `level ${upper + 1} has stair-edge rails and posts`);
  }

  const groundSlab = scene.items.filter(it => it.floor === 0 && it.t === 'underlay');
  assert.equal(groundSlab.length, 1, 'ground slab remains continuous beneath the stairs');

  const topCeiling = scene.items.filter(it => it.floor === spec.floors - 1 && it.t === 'ceil');
  assert.equal(topCeiling.length, 1, 'top-storey ceiling remains continuous');
  assert.equal(topCeiling[0].w, foot.w);
  assert.equal(topCeiling[0].d, foot.h);
});
