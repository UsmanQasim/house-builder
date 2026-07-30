/* Bespoke AI floor-plan generation — a NEW plan is designed for every request.
 * The LLM acts as a residential architect; its output is parsed, repaired and
 * validated against hard architectural invariants. On violations it gets ONE
 * corrective round-trip with the exact issue list. Templates are only a
 * fallback when no key is configured or the AI fails twice. */
import { HouseLayout } from '../src/engine/layout.js';
import type { Layout, RawPlan, Spec } from '../src/engine/types.js';
import type { Provider } from './providers.js';

export interface GeneratedPlan { layout: Layout; concept: string; attempts: number; coverage: number; score: number; }
interface Hit { title: string; snippet: string; }

function footprintOf(spec: Spec): { fw: number; fh: number } {
  const margin = Math.max(0.4, Math.min(1.0, Math.min(spec.plotW, spec.plotD) * 0.05));
  return { fw: Math.max(6, spec.plotW - 2 * margin), fh: Math.max(6, spec.plotD - 2 * margin) };
}

const SHAPE = '{"concept":"1-2 sentences describing the design idea","floors":[{"rooms":[{"type":"living|bedroom|kitchen|bathroom|dining|garage|corridor|room","name":"string","x":metres,"y":metres,"w":metres,"h":metres,"door":{"side":"left|right|top|bottom","pos":metres_along_that_wall_in_floor_coords,"width":0.9}}],"corridor":{"x":m,"y":m,"w":m,"h":m},"entrance":{"x":m,"y":m,"width":1.2},"stairs":{"x":m,"y":m,"w":m,"h":m}}]}';

function systemPrompt(spec: Spec, fw: number, fh: number): string {
  const custom = (spec.customRooms || []).map(r => (r.count || 1) + ' room(s) named "' + r.name + '" with type "room"').join(', ');
  return 'You are a licensed residential architect. Design a BESPOKE floor plan — imagine the family, then design for them. Do not reproduce a generic textbook layout; vary proportions and room placement creatively while staying practical.\n' +
    'Coordinate system: metres, origin top-left, x rightwards (0..' + fw.toFixed(1) + '), y downwards (0..' + fh.toFixed(1) + '). The street and main entrance are at the BOTTOM edge (y=' + fh.toFixed(1) + ').\n' +
    'HARD RULES — the plan is machine-validated and rejected on violation:\n' +
    '1. Return exactly ' + spec.floors + ' floor object(s).\n' +
    '2. Rooms are axis-aligned rectangles that EXACTLY TILE the footprint: no overlaps, no gaps, nothing outside 0..' + fw.toFixed(1) + ' x 0..' + fh.toFixed(1) + '. Include corridors/halls as rooms with type "corridor".\n' +
    '3. Every floor needs a corridor or hall that connects everything. Every non-corridor room MUST have a "door" on a side it physically shares with the corridor or an adjacent public room. door.pos is the coordinate of the door centre along that wall (x-coordinate for top/bottom doors, y-coordinate for left/right doors).\n' +
    '4. Ground floor: "entrance" on the front edge (y=' + fh.toFixed(1) + ') opening into a hall or living zone; kitchen adjacent to dining; public rooms toward the front' + (spec.garage ? '; the garage spans to the front edge so a car can drive in' : '') + '.\n' +
    '5. ' + (spec.floors > 1 ? 'Upper floors: bedrooms and bathrooms off a landing (corridor) stacked directly above the ground-floor circulation. "stairs" must be the SAME rect {x,y,w,h} on every floor and must sit inside the corridor/landing.' : 'Single storey: bedrooms grouped in a quiet zone away from the entrance.') + '\n' +
    '6. Room counts: exactly ' + spec.bedrooms + ' bedroom(s) (first is "Master Bedroom"), ' + spec.bathrooms + ' bathroom(s), ' + spec.kitchens + ' kitchen(s), ' + spec.living + ' living room(s)' + (spec.dining ? ', 1 dining room' : '') + (spec.garage ? ', 1 garage' : '') + (custom ? ', plus ' + custom : '') + ' — across all floors.\n' +
    '7. Minimum sizes (metres): living 3.6x4.0, bedroom 3.0x3.2, master 3.4x3.8, bathroom 2.0x2.2, kitchen 2.6x3.0, dining 2.8x3.0, garage 3.0x5.5, corridor width 1.1-1.6.\n' +
    'Return ONLY JSON of exactly this shape: ' + SHAPE;
}

function userPrompt(spec: Spec, research: Hit[], variation: number): string {
  let s = 'Design brief: ' + spec.floors + '-storey ' + spec.style + ' home, footprint per the system rules. ' +
    spec.bedrooms + ' bed / ' + spec.bathrooms + ' bath / ' + spec.kitchens + ' kitchen / ' + spec.living + ' living' +
    (spec.dining ? ' + dining' : '') + (spec.garage ? ' + garage' : '') + '.';
  if (spec.customRooms && spec.customRooms.length) s += '\nRequired named spaces: ' + spec.customRooms.map(r => (r.count || 1) + ' x ' + r.name).join(', ') + '.';
  if (spec.prompt) s += '\nThe client says: "' + String(spec.prompt).slice(0, 700) + '" — honor this in the layout.';
  if (research.length) s += '\nInspiration from real plans (for ideas, not copying):\n' + research.slice(0, 4).map((h, i) => (i + 1) + '. ' + h.title + ': ' + h.snippet).join('\n');
  s += '\nDesign variation seed: ' + variation + ' — make this design distinct.';
  return s;
}

export async function generateBespokePlan(P: Provider, spec: Spec, research: Hit[]): Promise<GeneratedPlan | null> {
  const { fw, fh } = footprintOf(spec);
  const sys = systemPrompt(spec, fw, fh);
  const variation = Math.floor(Math.random() * 1000);
  const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
    { role: 'system', content: sys },
    { role: 'user', content: userPrompt(spec, research, variation) }
  ];
  let best: GeneratedPlan | null = null;

  for (let attempt = 1; attempt <= 2; attempt++) {
    let raw: RawPlan;
    try {
      raw = await P.chatJSON<RawPlan>({ temperature: attempt === 1 ? 0.7 : 0.35, maxTokens: 3800, messages });
    } catch { return best; }
    const rep = HouseLayout.fromAIReport(raw, { ...spec, strictCounts: true });
    if (rep.layout) {
      const cand: GeneratedPlan = { layout: rep.layout, concept: raw.concept || '', attempts: attempt, coverage: rep.coverage, score: rep.validation.score };
      if (rep.validation.ok && rep.coverage >= 0.9) return cand;                  // only ship a genuinely complete plan
      if (rep.validation.ok && (!best || rep.coverage > best.coverage)) best = cand; // valid but sparse — keep as candidate
    }
    if (attempt === 1) {
      const issues = rep.validation.issues.slice(0, 12).join('; ') || 'coverage too low (rooms must tile the whole footprint)';
      messages.push({ role: 'assistant', content: JSON.stringify(raw).slice(0, 6000) });
      messages.push({ role: 'user', content: 'Your plan violated these machine-checked rules: ' + issues + '. Unique coverage was ' + Math.round(rep.coverage * 100) + '% (need >=90% of the footprint tiled with no overlaps). Produce a corrected plan that fixes every violation. Same JSON shape, nothing else.' });
    }
  }
  return best;
}
