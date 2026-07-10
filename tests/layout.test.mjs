/* Architectural invariant tests for the floor-plan engine (runs against tsc output).
 * Run: npm test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HouseLayout } from '../build/src/engine/layout.js';
import { describeHouse } from '../build/src/engine/house3d.js';

const SPECS = [
  { plotW: 11, plotD: 13, floors: 2, bedrooms: 3, bathrooms: 2, kitchens: 1, living: 1, dining: true, garage: true, style: 'modern' },
  { plotW: 9, plotD: 12, floors: 1, bedrooms: 2, bathrooms: 1, kitchens: 1, living: 1, dining: true, garage: false, style: 'scandinavian' },
  { plotW: 14, plotD: 16, floors: 2, bedrooms: 4, bathrooms: 3, kitchens: 1, living: 1, dining: true, garage: false, style: 'traditional' },
  { plotW: 18, plotD: 14, floors: 3, bedrooms: 5, bathrooms: 3, kitchens: 1, living: 1, dining: true, garage: true, style: 'industrial' },
  { plotW: 8, plotD: 10, floors: 1, bedrooms: 1, bathrooms: 1, kitchens: 1, living: 1, dining: false, garage: false, style: 'minimalist' },
  { plotW: 20, plotD: 18, floors: 4, bedrooms: 8, bathrooms: 5, kitchens: 2, living: 2, dining: true, garage: true, style: 'modern' },
  { plotW: 12, plotD: 12, floors: 2, bedrooms: 2, bathrooms: 2, kitchens: 1, living: 1, dining: true, garage: true, style: 'modern' }
];

for (const spec of SPECS) {
  const tag = `${spec.floors}F/${spec.bedrooms}bed/${spec.bathrooms}bath${spec.garage ? '/garage' : ''} ${spec.plotW}x${spec.plotD}`;

  test(`computeLayout valid: ${tag}`, () => {
    const L = HouseLayout.computeLayout(spec);
    assert.ok(L, 'layout exists');
    assert.equal(L.floors.length, spec.floors, 'floor count');
    const v = HouseLayout.validateLayout(L, spec);
    assert.deepEqual(v.issues, [], 'no validity issues');
    assert.ok(v.ok, 'validator passes');
  });

  test(`describeHouse builds: ${tag}`, () => {
    const L = HouseLayout.computeLayout(spec);
    const d = describeHouse(L, spec);
    assert.ok(d.items.length > 50, 'scene has items');
    assert.ok(d.collision.length > 0, 'collision boxes exist');
    assert.ok(Number.isFinite(d.spawn.x) && Number.isFinite(d.spawn.z), 'spawn is finite');
    d.items.forEach(it => {
      assert.ok([it.x, it.y, it.z, it.w, it.h, it.d].every(Number.isFinite), 'item coords finite: ' + it.t);
      assert.ok(it.w > 0 && it.h > 0 && it.d > 0, 'no degenerate meshes: ' + it.t);
    });
  });
}

test('stairs aligned across floors', () => {
  const spec = SPECS[3];
  const L = HouseLayout.computeLayout(spec);
  for (let i = 0; i + 1 < L.floors.length; i++) {
    const a = L.floors[i].stairs, b = L.floors[i + 1].stairs;
    assert.ok(a && b, `stairs on F${i + 1} and F${i + 2}`);
    assert.ok(Math.abs(a.x - b.x) < 0.15 && Math.abs(a.y - b.y) < 0.15, `stairs stacked F${i + 1}->F${i + 2}`);
  }
});

test('windows only on exterior walls', () => {
  for (const spec of SPECS) {
    const L = HouseLayout.computeLayout(spec);
    const f = L.foot, E = 0.1;
    L.floors.flatMap(fl => fl.rooms).forEach(r => r.windows.forEach(w => {
      const onEdge =
        (w.side === 'left' && Math.abs(r.x - f.x) < E) ||
        (w.side === 'right' && Math.abs(r.x + r.w - (f.x + f.w)) < E) ||
        (w.side === 'top' && Math.abs(r.y - f.y) < E) ||
        (w.side === 'bottom' && Math.abs(r.y + r.h - (f.y + f.h)) < E);
      assert.ok(onEdge, `window on exterior wall (${r.name}, ${w.side})`);
    }));
  }
});

test('fromAIReport: garbage is repaired-or-rejected, never invalid', () => {
  const spec = SPECS[1];
  const bad = { floors: [{ rooms: [
    { type: 'bedroom', name: 'A', x: 0, y: 0, w: 50, h: 50 },
    { type: 'bedroom', name: 'B', x: 0, y: 0, w: 50, h: 50 },
    { type: 'bedroom', name: 'C', x: 1, y: 1, w: 50, h: 50 }
  ] }] };
  const rep = HouseLayout.fromAIReport(bad, spec);
  if (rep.layout && rep.validation.ok) {
    const v = HouseLayout.validateLayout(rep.layout, spec);
    assert.ok(v.ok, 'repaired AI layout must validate');
  } else {
    assert.ok(!rep.validation.ok || rep.layout === null);
  }
});

test('fromAIReport: sane plan accepted with high coverage', () => {
  const spec = { plotW: 10, plotD: 12, floors: 1, bedrooms: 2, bathrooms: 1, kitchens: 1, living: 1, dining: false, garage: false, style: 'modern' };
  const sane = { floors: [{ rooms: [
    { type: 'bedroom', name: 'Master', x: 0, y: 0, w: 4, h: 5, door: { side: 'right', pos: 2.5 } },
    { type: 'bedroom', name: 'Bed 2', x: 0, y: 5, w: 4, h: 5.8, door: { side: 'right', pos: 7.5 } },
    { type: 'corridor', name: 'Hallway', x: 4, y: 0, w: 1.4, h: 10.8 },
    { type: 'kitchen', name: 'Kitchen', x: 5.4, y: 0, w: 3.6, h: 4, door: { side: 'left', pos: 2 } },
    { type: 'living', name: 'Living', x: 5.4, y: 4, w: 3.6, h: 6.8, door: { side: 'left', pos: 7 } }
  ], entrance: { x: 4.7, y: 10.8, width: 1.2 } }] };
  const rep = HouseLayout.fromAIReport(sane, spec);
  assert.ok(rep.layout, 'sane AI layout accepted');
  assert.deepEqual(rep.validation.issues, []);
  assert.ok(rep.coverage > 0.9, 'coverage computed: ' + rep.coverage);
});

test('bespoke plans include entrance fallback', () => {
  const spec = { plotW: 10, plotD: 12, floors: 1, bedrooms: 1, bathrooms: 1, kitchens: 1, living: 1, dining: false, garage: false, style: 'modern' };
  const noEntrance = { floors: [{ rooms: [
    { type: 'living', name: 'Living', x: 0, y: 0, w: 9, h: 10.8, door: { side: 'bottom', pos: 4.5 } }
  ] }] };
  const rep = HouseLayout.fromAIReport(noEntrance, spec);
  assert.ok(rep.layout.floors[0].entrance, 'entrance auto-added on ground floor');
});
