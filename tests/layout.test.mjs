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
    const all = L.floors.flatMap(f => f.rooms);
    const count = type => all.filter(r => r.type === type).length;
    assert.equal(count('bedroom'), spec.bedrooms, 'exact bedroom count');
    assert.equal(count('bathroom'), spec.bathrooms, 'exact bathroom count');
    assert.equal(count('kitchen'), spec.kitchens, 'exact kitchen count');
    assert.equal(count('living'), spec.living, 'exact living count');
    assert.equal(count('dining'), spec.dining ? 1 : 0, 'exact dining count');
    assert.equal(count('garage'), spec.garage ? 1 : 0, 'exact garage count');
    assert.ok(HouseLayout.coverage(L) >= HouseLayout.MIN_COVERAGE, 'union coverage passes');
    assert.equal(L.planSource, 'procedural', 'procedural generation is primary');
    assert.ok(Number.isInteger(L.planSeed), 'generation seed is exposed');
    assert.ok(Number.isFinite(L.planScore), 'quality score is exposed');
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
    { type: 'bedroom', name: 'Bed 2', x: 0, y: 5, w: 4, h: 6, door: { side: 'right', pos: 7.5 } },
    { type: 'corridor', name: 'Hallway', x: 4, y: 0, w: 1.4, h: 11 },
    { type: 'kitchen', name: 'Kitchen', x: 5.4, y: 0, w: 3.6, h: 4, door: { side: 'left', pos: 2 } },
    { type: 'bathroom', name: 'Bathroom', x: 5.4, y: 4, w: 3.6, h: 2.3, door: { side: 'left', pos: 5 } },
    { type: 'living', name: 'Living', x: 5.4, y: 6.3, w: 3.6, h: 4.7, door: { side: 'left', pos: 8 } }
  ], entrance: { x: 4.7, y: 11, width: 1.2 } }] };
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

test('coverage measures geometric union and duplicate Hall rooms are rejected', () => {
  const spec = { plotW: 10, plotD: 12, floors: 1, bedrooms: 1, bathrooms: 0, kitchens: 0, living: 0, dining: false, garage: false, style: 'modern' };
  const halls = Array.from({ length: 6 }, () => ({ type: 'corridor', name: 'Hall', x: 4, y: 0, w: 1, h: 11 }));
  const raw = { floors: [{ rooms: [
    { type: 'bedroom', name: 'Master Bedroom', x: 0, y: 0, w: 4, h: 4, door: { side: 'right', pos: 2 } },
    ...halls
  ], entrance: { x: 4.5, y: 11, width: 1.2 } }] };
  const rep = HouseLayout.fromAIReport(raw, spec);
  assert.equal(rep.validation.ok, false);
  assert.ok(rep.validation.issues.some(x => x.startsWith('overlap F1')), rep.validation.issues.join('; '));
  assert.ok(rep.coverage < 0.3, `duplicate area must not inflate union coverage: ${rep.coverage}`);
});

test('a disconnected corridor is not treated as an independent reachability root', () => {
  const spec = { plotW: 10, plotD: 12, floors: 1, bedrooms: 0, bathrooms: 0, kitchens: 0, living: 0, dining: false, garage: false, style: 'modern' };
  const raw = { floors: [{ rooms: [
    { type: 'corridor', name: 'Isolated Hall', x: 0, y: 0, w: 9, h: 5 },
    { type: 'corridor', name: 'Entry Hall', x: 0, y: 6, w: 9, h: 5 }
  ], entrance: { x: 4.5, y: 11, width: 1.2 } }] };
  const rep = HouseLayout.fromAIReport(raw, spec);
  assert.equal(rep.validation.ok, false);
  assert.ok(rep.validation.issues.includes('unreachable F1: Isolated Hall'), rep.validation.issues.join('; '));
  assert.ok(rep.coverage > 0.9, 'failure is connectivity, not sparse coverage');
});

test('all requested room counts are exact, not presence-only', () => {
  const spec = { plotW: 14, plotD: 14, floors: 2, bedrooms: 3, bathrooms: 2, kitchens: 2, living: 2, dining: true, garage: true, style: 'modern', seed: 44 };
  const L = HouseLayout.computeLayout(spec);
  const altered = structuredClone(L);
  altered.floors.flatMap(f => f.rooms).find(r => r.type === 'kitchen').type = 'living';
  const v = HouseLayout.validateLayout(altered, spec);
  assert.equal(v.ok, false);
  assert.ok(v.issues.includes('kitchen count 1/2'));
  assert.ok(v.issues.includes('living count 3/2'));
});

test('undersized rooms fail full minimum dimensions', () => {
  const spec = { plotW: 10, plotD: 12, floors: 1, bedrooms: 1, bathrooms: 1, kitchens: 1, living: 1, dining: false, garage: false, style: 'modern', seed: 8 };
  const L = HouseLayout.computeLayout(spec);
  const altered = structuredClone(L);
  const bed = altered.floors[0].rooms.find(r => r.type === 'bedroom');
  bed.w = 2.2; bed.area = bed.w * bed.h;
  const v = HouseLayout.validateLayout(altered, spec);
  assert.ok(v.issues.some(x => x === 'too small Master Bedroom'), v.issues.join('; '));
});

test('seeded generation is reproducible and materially varied', () => {
  const base = { plotW: 11, plotD: 13, floors: 2, bedrooms: 3, bathrooms: 2, kitchens: 1, living: 1, dining: true, garage: true, style: 'modern' };
  const signature = L => JSON.stringify(L.floors.map(f => f.rooms.map(r => [r.type, r.name, +r.x.toFixed(3), +r.y.toFixed(3), +r.w.toFixed(3), +r.h.toFixed(3)])));
  const a = HouseLayout.computeLayout({ ...base, seed: 1234 });
  const b = HouseLayout.computeLayout({ ...base, seed: 1234 });
  const c = HouseLayout.computeLayout({ ...base, seed: 9876 });
  assert.equal(signature(a), signature(b), 'same seed must reproduce the same plan');
  assert.notEqual(signature(a), signature(c), 'different seeds should produce a distinct geometry');
});

test('custom named rooms are preserved and validated exactly', () => {
  const spec = {
    plotW: 15, plotD: 15, floors: 2, bedrooms: 3, bathrooms: 2, kitchens: 1, living: 1,
    dining: true, garage: false, style: 'modern', seed: 77,
    customRooms: [{ name: 'Home Office' }, { name: 'Laundry' }, { name: 'Pantry', preferredFloor: 0 }]
  };
  const L = HouseLayout.computeLayout(spec), rooms = L.floors.flatMap(f => f.rooms).filter(r => r.type === 'room');
  assert.deepEqual(rooms.map(r => r.name).sort(), ['Home Office', 'Laundry', 'Pantry']);
  assert.deepEqual(HouseLayout.validateLayout(L, spec).issues, []);
});

test('over-constrained fallback preserves every requested count', () => {
  const spec = {
    plotW: 13, plotD: 15, floors: 1, bedrooms: 6, bathrooms: 1, kitchens: 2, living: 1,
    dining: false, garage: true, style: 'modern', seed: 12
  };
  const L = HouseLayout.computeLayout(spec), rooms = L.floors.flatMap(f => f.rooms);
  const count = type => rooms.filter(r => r.type === type).length;
  assert.equal(count('bedroom'), 6);
  assert.equal(count('bathroom'), 1);
  assert.equal(count('kitchen'), 2);
  assert.equal(count('living'), 1);
  assert.equal(count('garage'), 1);
  assert.ok(L.planSource.startsWith('procedural'));
});

test('offline prompt hints apply explicit counts, style and named spaces', () => {
  const base = {
    plotW: 13, plotD: 16, floors: 2, bedrooms: 3, bathrooms: 2, kitchens: 1, living: 1,
    dining: true, garage: true, style: 'modern',
    prompt: 'A single-storey Scandinavian 4 bedroom, 3 bathroom home without a garage, with two home offices, a laundry and prayer room.'
  };
  const inferred = HouseLayout.inferSpecFromPrompt(base);
  assert.equal(inferred.floors, 1);
  assert.equal(inferred.bedrooms, 4);
  assert.equal(inferred.bathrooms, 3);
  assert.equal(inferred.garage, false);
  assert.equal(inferred.style, 'scandinavian');
  assert.deepEqual(inferred.customRooms.map(room => [room.name, room.count]), [
    ['Home Office', 2], ['Laundry', 1], ['Prayer Room', 1]
  ]);
});

test('offline prompt hints preserve structured values when prose is not explicit', () => {
  const base = {
    plotW: 11, plotD: 13, floors: 2, bedrooms: 3, bathrooms: 2, kitchens: 1, living: 1,
    dining: true, garage: true, style: 'modern', customRooms: [{ name: 'Office' }],
    prompt: 'A light-filled family home with a quiet office and connected garden living.'
  };
  const inferred = HouseLayout.inferSpecFromPrompt(base);
  assert.equal(inferred.bedrooms, 3);
  assert.equal(inferred.floors, 2);
  assert.deepEqual(inferred.customRooms.map(room => room.name), ['Office']);
});
