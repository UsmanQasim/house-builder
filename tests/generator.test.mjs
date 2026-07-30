/* Bespoke plan generator: validate->retry->repair loop, tested with a mock provider. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateBespokePlan, generateBespokePlanReport } from '../build/server/plan-generator.js';
import { HouseLayout } from '../build/src/engine/layout.js';

const spec = { plotW: 10, plotD: 12, floors: 1, bedrooms: 2, bathrooms: 1, kitchens: 1, living: 1, dining: false, garage: false, style: 'modern' };
const goodPlan = { concept: 'Bespoke split-hall design', floors: [{ rooms: [
  { type: 'bedroom', name: 'Master Bedroom', x: 0, y: 0, w: 4, h: 5, door: { side: 'right', pos: 2.5 } },
  { type: 'bedroom', name: 'Bedroom 2', x: 0, y: 5, w: 4, h: 6, door: { side: 'right', pos: 7.5 } },
  { type: 'corridor', name: 'Hallway', x: 4, y: 0, w: 1.4, h: 11 },
  { type: 'kitchen', name: 'Kitchen', x: 5.4, y: 0, w: 3.6, h: 4, door: { side: 'left', pos: 2 } },
  { type: 'bathroom', name: 'Bathroom', x: 5.4, y: 4, w: 3.6, h: 2.3, door: { side: 'left', pos: 5 } },
  { type: 'living', name: 'Living', x: 5.4, y: 6.3, w: 3.6, h: 4.7, door: { side: 'left', pos: 8 } }
], entrance: { x: 4.7, y: 11, width: 1.2 } }] };
const garbagePlan = { floors: [{ rooms: [{ type: 'bedroom', name: 'A', x: 0, y: 0, w: 50, h: 50 }] }] };

function mockProvider(responses) {
  let call = 0;
  return {
    id: 'mock', available: () => true,
    diagnose: async () => ({ ok: true, message: 'mock' }),
    chatJSON: async () => { const r = responses[Math.min(call, responses.length - 1)]; call++; if (r === 'throw') throw new Error('boom'); return r; },
    generateImage: async () => ({ b64: null, url: null }),
    calls: () => call
  };
}

test('accepts a good plan on first attempt', async () => {
  const P = mockProvider([goodPlan]);
  const out = await generateBespokePlan(P, spec, []);
  assert.ok(out, 'plan generated');
  assert.equal(out.attempts, 1);
  assert.ok(out.coverage > 0.9, 'high coverage: ' + out.coverage);
  const v = HouseLayout.validateLayout(out.layout, spec);
  assert.deepEqual(v.issues, []);
});

test('retries with violation feedback, then accepts the corrected plan', async () => {
  const P = mockProvider([garbagePlan, goodPlan]);
  const out = await generateBespokePlan(P, spec, []);
  assert.ok(out, 'plan generated on retry');
  assert.equal(out.attempts, 2);
  assert.ok(HouseLayout.validateLayout(out.layout, spec).ok);
});

test('rejects invalid AI geometry without returning a substitute plan', async () => {
  const P = mockProvider([garbagePlan, garbagePlan]);
  const report = await generateBespokePlanReport(P, spec, []);
  assert.equal(report.plan, null);
  assert.equal(report.providerFailed, false);
  assert.equal(report.attempts, 2);
  assert.ok(report.issues.length > 0);
});

test('provider failure is reported without creating a substitute plan', async () => {
  const P = mockProvider(['throw']);
  const report = await generateBespokePlanReport(P, spec, []);
  assert.equal(report.plan, null);
  assert.equal(report.providerFailed, true);
});
