/* Offline fallback floor-plan templates (TypeScript). Rooms use normalized coords (0-1).
 * Used ONLY when no AI key is configured or AI generation fails — the primary
 * path is bespoke AI generation (server/plan-generator.ts). */
import type { RoomType, Side, Spec } from './types.js';

export interface TplDoor { side: Side; pos: number; rel?: boolean; width?: number; }
export interface TplRoom { type: RoomType; name: string; x: number; y: number; w: number; h: number; door?: TplDoor; }
export interface TplFloor { rooms: TplRoom[]; corridor?: { x: number; y: number; w: number; h: number }; entrance?: { x: number; y: number; width: number; rel?: boolean }; stairs?: { x: number; y: number; w: number; h: number }; }
export interface Template { name: string; match: (c: Spec) => boolean; floors: TplFloor[]; concept: string; }

export const CATALOG: Record<string, Template> = {
  sideGarage3bed: {
    name: 'Side garage + open living (3 bed)',
    match: c => c.floors === 2 && c.bedrooms >= 2 && c.bedrooms <= 4 && c.bathrooms >= 1 && c.garage && c.dining,
    floors: [
      {
        rooms: [
          { type: 'living', name: 'Living Room', x: 0, y: 0, w: 0.34, h: 0.52, door: { side: 'right', pos: 0.5, rel: true } },
          { type: 'garage', name: 'Garage', x: 0, y: 0.52, w: 0.34, h: 0.48, door: { side: 'right', pos: 0.5, rel: true } },
          { type: 'kitchen', name: 'Kitchen', x: 0.46, y: 0, w: 0.54, h: 0.32, door: { side: 'left', pos: 0.5, rel: true } },
          { type: 'dining', name: 'Dining', x: 0.46, y: 0.32, w: 0.30, h: 0.34, door: { side: 'left', pos: 0.5, rel: true } },
          { type: 'bathroom', name: 'WC', x: 0.76, y: 0.32, w: 0.24, h: 0.34, door: { side: 'left', pos: 0.5, rel: true } },
          { type: 'living', name: 'Family Room', x: 0.46, y: 0.66, w: 0.54, h: 0.34, door: { side: 'left', pos: 0.5, rel: true } },
          { type: 'corridor', name: 'Hallway', x: 0.34, y: 0, w: 0.12, h: 1 }
        ],
        corridor: { x: 0.34, y: 0, w: 0.12, h: 1 },
        entrance: { x: 0.40, y: 1.0, width: 1.2, rel: true },
        stairs: { x: 0.34, y: 0, w: 0.12, h: 0.26 }
      },
      {
        rooms: [
          { type: 'corridor', name: 'Landing', x: 0.34, y: 0, w: 0.12, h: 1 },
          { type: 'bedroom', name: 'Master Bedroom', x: 0, y: 0, w: 0.34, h: 0.56, door: { side: 'right', pos: 0.5, rel: true } },
          { type: 'bedroom', name: 'Bedroom 2', x: 0, y: 0.56, w: 0.34, h: 0.44, door: { side: 'right', pos: 0.5, rel: true } },
          { type: 'bedroom', name: 'Bedroom 3', x: 0.46, y: 0, w: 0.54, h: 0.54, door: { side: 'left', pos: 0.5, rel: true } },
          { type: 'bathroom', name: 'Bathroom', x: 0.46, y: 0.54, w: 0.27, h: 0.46, door: { side: 'left', pos: 0.5, rel: true } },
          { type: 'bathroom', name: 'Bath 2', x: 0.73, y: 0.54, w: 0.27, h: 0.46, door: { side: 'left', pos: 0.5, rel: true } }
        ],
        corridor: { x: 0.34, y: 0, w: 0.12, h: 1 },
        stairs: { x: 0.34, y: 0, w: 0.12, h: 0.26 }
      }
    ],
    concept: 'Front garage beside the living room; open kitchen-dining-family to the rear; stacked stair hall; three bedrooms + two baths upstairs.'
  },
  openPlan2bed: {
    name: 'Compact open plan (2 bed, 1 floor)',
    match: c => c.floors === 1 && c.bedrooms >= 1 && c.bedrooms <= 3 && !c.garage,
    floors: [
      {
        rooms: [
          { type: 'bedroom', name: 'Master Bedroom', x: 0, y: 0, w: 0.40, h: 0.50, door: { side: 'right', pos: 0.5, rel: true } },
          { type: 'bedroom', name: 'Bedroom 2', x: 0, y: 0.50, w: 0.40, h: 0.50, door: { side: 'right', pos: 0.5, rel: true } },
          { type: 'kitchen', name: 'Kitchen', x: 0.52, y: 0, w: 0.28, h: 0.30, door: { side: 'left', pos: 0.5, rel: true } },
          { type: 'bathroom', name: 'Bathroom', x: 0.80, y: 0, w: 0.20, h: 0.30, door: { side: 'left', pos: 0.5, rel: true } },
          { type: 'dining', name: 'Dining', x: 0.52, y: 0.30, w: 0.48, h: 0.22, door: { side: 'left', pos: 0.5, rel: true } },
          { type: 'living', name: 'Living Room', x: 0.52, y: 0.52, w: 0.48, h: 0.48, door: { side: 'left', pos: 0.5, rel: true } },
          { type: 'corridor', name: 'Hallway', x: 0.40, y: 0, w: 0.12, h: 1 }
        ],
        corridor: { x: 0.40, y: 0, w: 0.12, h: 1 },
        entrance: { x: 0.46, y: 1.0, width: 1.2, rel: true }
      }
    ],
    concept: 'Two bedrooms off a hall to one side; open kitchen-dining-living facing the street.'
  },
  centralHall4bed: {
    name: 'Central hall 4 bed (no garage)',
    match: c => c.floors === 2 && c.bedrooms >= 4 && !c.garage && c.dining,
    floors: [
      {
        rooms: [
          { type: 'living', name: 'Living Room', x: 0, y: 0.08, w: 0.44, h: 0.44, door: { side: 'right', pos: 0.5, rel: true } },
          { type: 'kitchen', name: 'Kitchen', x: 0.56, y: 0.08, w: 0.44, h: 0.26, door: { side: 'left', pos: 0.5, rel: true } },
          { type: 'dining', name: 'Dining', x: 0.56, y: 0.34, w: 0.44, h: 0.24, door: { side: 'left', pos: 0.5, rel: true } },
          { type: 'corridor', name: 'Hallway', x: 0.44, y: 0, w: 0.12, h: 1 },
          { type: 'bathroom', name: 'WC', x: 0.56, y: 0.58, w: 0.22, h: 0.20, door: { side: 'left', pos: 0.5, rel: true } }
        ],
        corridor: { x: 0.44, y: 0, w: 0.12, h: 1 },
        entrance: { x: 0.50, y: 1.0, width: 1.2, rel: true },
        stairs: { x: 0.44, y: 0.56, w: 0.12, h: 0.24 }
      },
      {
        rooms: [
          { type: 'corridor', name: 'Landing', x: 0.44, y: 0, w: 0.12, h: 1 },
          { type: 'bedroom', name: 'Master Bedroom', x: 0, y: 0, w: 0.44, h: 0.36, door: { side: 'right', pos: 0.5, rel: true } },
          { type: 'bedroom', name: 'Bedroom 2', x: 0, y: 0.36, w: 0.44, h: 0.30, door: { side: 'right', pos: 0.5, rel: true } },
          { type: 'bedroom', name: 'Bedroom 3', x: 0.56, y: 0, w: 0.44, h: 0.30, door: { side: 'left', pos: 0.5, rel: true } },
          { type: 'bedroom', name: 'Bedroom 4', x: 0.56, y: 0.30, w: 0.44, h: 0.30, door: { side: 'left', pos: 0.5, rel: true } },
          { type: 'bathroom', name: 'Bathroom', x: 0.56, y: 0.72, w: 0.22, h: 0.20, door: { side: 'left', pos: 0.5, rel: true } },
          { type: 'bathroom', name: 'Bath 2', x: 0.78, y: 0.72, w: 0.22, h: 0.20, door: { side: 'left', pos: 0.5, rel: true } }
        ],
        corridor: { x: 0.44, y: 0, w: 0.12, h: 1 },
        stairs: { x: 0.44, y: 0.56, w: 0.12, h: 0.24 }
      }
    ],
    concept: 'Traditional central hall with four bedrooms on the upper floor; circulation stacked over the entry hall.'
  }
};

export function listTemplates(): { id: string; name: string; concept: string }[] {
  return Object.keys(CATALOG).map(id => ({ id, name: CATALOG[id].name, concept: CATALOG[id].concept }));
}

export function pickTemplate(c: Spec): string {
  let best: string | null = null, score = -1;
  Object.keys(CATALOG).forEach(id => {
    const t = CATALOG[id];
    if (!t.match(c)) return;
    let s = 100;
    if (c.bedrooms === 3 && id === 'sideGarage3bed') s += 20;
    if (c.floors === 1 && id === 'openPlan2bed') s += 20;
    if (c.bedrooms >= 4 && id === 'centralHall4bed') s += 20;
    if (s > score) { score = s; best = id; }
  });
  if (best) return best;
  if (c.floors >= 2 && c.garage) return 'sideGarage3bed';
  if (c.floors === 1) return 'openPlan2bed';
  return 'sideGarage3bed';
}

export const PlanTemplates = { CATALOG, listTemplates, pickTemplate };
export default PlanTemplates;
