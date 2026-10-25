/* Realistic house-layout engine (browser + Node, TypeScript).
 * Coordinates: metres, origin top-left, x right, y down (front/street = bottom).
 *
 * Invariants enforced by validateLayout()/repair():
 *  - rooms never overlap and stay inside the footprint
 *  - every room is reachable from the entrance / stairs via doors
 *  - rooms respect minimum dimensions per type
 *  - windows only on exterior walls
 *  - stairs occupy the same rect on every floor
 */
import type { Door, Floor, Layout, RawPlan, Rect, Room, RoomType, Side, Spec, Validation } from './types.js';

const DOOR = 0.9, FRONT = 1.2, WIN = 1.4, EPS = 0.02, OVERLAP_EPS = 1e-5;
export const MIN_COVERAGE = 0.85;

export const MIN: Record<string, { w: number; h: number }> = {
  living: { w: 3.6, h: 4.0 },
  dining: { w: 2.8, h: 3.0 },
  kitchen: { w: 2.6, h: 3.0 },
  bedroom: { w: 3.0, h: 3.2 },
  master: { w: 3.4, h: 3.8 },
  bathroom: { w: 2.0, h: 2.2 },
  garage: { w: 3.0, h: 5.5 },
  corridor: { w: 1.1, h: 1.2 },
  room: { w: 1.6, h: 1.6 }
};

export interface AIReport { layout: Layout | null; validation: Validation; coverage: number; }

function clamp(v: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, v)); }

const PROMPT_NUMBERS: Record<string, number> = {
  zero: 0, one: 1, single: 1, two: 2, double: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12
};
const PROMPT_COUNT = '(\\d{1,2}|zero|one|single|two|double|three|four|five|six|seven|eight|nine|ten|eleven|twelve)';

function promptCount(text: string, forms: string, max: number): number | null {
  const match = text.match(new RegExp('\\b' + PROMPT_COUNT + '[\\s-]*(?:' + forms + ')\\b', 'i'));
  if (!match) return null;
  const parsed = /^\d+$/.test(match[1]) ? Number(match[1]) : PROMPT_NUMBERS[match[1].toLowerCase()];
  return Number.isFinite(parsed) ? clamp(parsed, 0, max) : null;
}

/** A deterministic, deliberately conservative prompt interpreter for offline
 * mode. It only applies explicit counts/styles and named spaces; all other
 * prose remains design context for an AI provider when one is available. */
export function inferSpecFromPrompt(input: Spec): Spec {
  const text = String(input.prompt || '').trim().toLowerCase();
  const customRooms = (input.customRooms || []).map(room => ({ ...room }));
  const next: Spec = { ...input, customRooms };
  if (!text) return next;

  const core: Array<[keyof Pick<Spec, 'bedrooms' | 'bathrooms' | 'kitchens' | 'living' | 'floors'>, string, number]> = [
    ['bedrooms', 'beds?|bedrooms?', 12],
    ['bathrooms', 'baths?|bathrooms?', 8],
    ['kitchens', 'kitchens?', 4],
    ['living', 'living\\s+(?:rooms?|spaces?)', 4],
    ['floors', '(?:storeys?|stories|story|floors?|levels?)', 4]
  ];
  core.forEach(([key, forms, max]) => {
    const value = promptCount(text, forms, max);
    if (value != null && (key !== 'floors' || value > 0)) (next[key] as number) = value;
  });

  if (/\b(?:no|without)\s+(?:a\s+)?garage\b/.test(text)) next.garage = false;
  else if (/\b(?:garage|carport)\b/.test(text)) next.garage = true;
  if (/\b(?:no|without)\s+(?:a\s+)?(?:dedicated\s+)?dining(?:\s+room)?\b/.test(text)) next.dining = false;
  else if (/\b(?:dining\s+room|dedicated\s+dining)\b/.test(text)) next.dining = true;

  if (/\bscandinavian\b/.test(text)) next.style = 'scandinavian';
  else if (/\bindustrial\b/.test(text)) next.style = 'industrial';
  else if (/\bminimal(?:ist)?\b/.test(text)) next.style = 'minimalist';
  else if (/\b(?:traditional|classic)\b/.test(text)) next.style = 'traditional';
  else if (/\b(?:modern|contemporary)\b/.test(text)) next.style = 'modern';

  const extras = [
    { name: 'Home Office', forms: 'home\\s+offices?|offices?|stud(?:y|ies)', aliases: /\b(?:home\s+office|office|study)\b/, minW: 2.4, minH: 2.6 },
    { name: 'Laundry', forms: 'laundr(?:y|ies)|laundry\\s+rooms?', aliases: /\blaundry\b/, minW: 1.8, minH: 2.0 },
    { name: 'Pantry', forms: 'pantr(?:y|ies)|walk-in\\s+pantr(?:y|ies)', aliases: /\bpantry\b/, minW: 1.6, minH: 1.8 },
    { name: 'Utility Room', forms: 'utility\\s+rooms?', aliases: /\butility\b/, minW: 1.8, minH: 2.0 },
    { name: 'Prayer Room', forms: 'prayer\\s+rooms?|musallas?', aliases: /\b(?:prayer|musalla)\b/, minW: 2.4, minH: 2.8 },
    { name: 'Gym', forms: 'gyms?|fitness\\s+rooms?', aliases: /\b(?:gym|fitness)\b/, minW: 2.8, minH: 3.0 },
    { name: 'Media Room', forms: 'media\\s+rooms?|home\\s+theaters?|cinemas?', aliases: /\b(?:media|theater|cinema)\b/, minW: 3.0, minH: 3.2 },
    { name: 'Library', forms: 'librar(?:y|ies)', aliases: /\blibrary\b/, minW: 2.6, minH: 2.8 },
    { name: 'Mudroom', forms: 'mudrooms?', aliases: /\bmudroom\b/, minW: 1.8, minH: 2.0 },
    { name: 'Workshop', forms: 'workshops?', aliases: /\bworkshop\b/, minW: 2.8, minH: 3.0 }
  ];
  extras.forEach(extra => {
    const mentioned = new RegExp('\\b(?:' + extra.forms + ')\\b', 'i').test(text);
    if (!mentioned || customRooms.some(room => extra.aliases.test(String(room.name).toLowerCase()))) return;
    const count = promptCount(text, extra.forms, 4) || 1;
    customRooms.push({ name: extra.name, count, minW: extra.minW, minH: extra.minH });
  });
  return next;
}

function sizedFootprint(c: Spec) {
  const margin = clamp(Math.min(c.plotW, c.plotD) * 0.05, 0.4, 1.0);
  const fw = Math.max(6, c.plotW - 2 * margin), fh = Math.max(6, c.plotD - 2 * margin);
  return { fw, fh, fx: (c.plotW - fw) / 2, fy: (c.plotD - fh) / 2 };
}
function mk(type: RoomType, name: string, x: number, y: number, w: number, h: number): Room {
  w = Math.max(0.5, w); h = Math.max(0.5, h);
  return { type, name, x, y, w, h, area: w * h, door: null, windows: [] };
}
function setDoor(rm: Room, side: Side, pos: number, width?: number): void { rm.door = { side, pos, width: width || DOOR }; }

function windows(rm: Room, fx: number, fy: number, fw: number, fh: number): void {
  if (rm.type === 'corridor') return;
  rm.windows = [];
  if (Math.abs(rm.x - fx) < EPS && rm.h > 1.4) rm.windows.push({ side: 'left', pos: rm.y + rm.h / 2, len: Math.min(WIN, rm.h - 0.9) });
  if (Math.abs(rm.x + rm.w - (fx + fw)) < EPS && rm.h > 1.4) rm.windows.push({ side: 'right', pos: rm.y + rm.h / 2, len: Math.min(WIN, rm.h - 0.9) });
  if (Math.abs(rm.y - fy) < EPS && rm.w > 1.4) rm.windows.push({ side: 'top', pos: rm.x + rm.w / 2, len: Math.min(WIN, rm.w - 0.9) });
  if (Math.abs(rm.y + rm.h - (fy + fh)) < EPS && rm.w > 1.4) rm.windows.push({ side: 'bottom', pos: rm.x + rm.w / 2, len: Math.min(WIN, rm.w - 0.9) });
}
function applyWindows(rooms: Room[], fx: number, fy: number, fw: number, fh: number): void { rooms.forEach(rm => windows(rm, fx, fy, fw, fh)); }

function splitHeights(total: number, count: number, firstLarger: boolean): number[] {
  if (count <= 0) return [];
  if (count === 1) return [clamp(total, MIN.bedroom.h, total)];
  if (firstLarger) {
    const first = clamp(total * 0.36, MIN.master.h, total - MIN.bedroom.h * (count - 1));
    const rest = (total - first) / (count - 1);
    const out = [first];
    for (let i = 1; i < count; i++) out.push(clamp(rest, MIN.bedroom.h, total));
    return out;
  }
  const each = total / count, arr: number[] = [];
  for (let j = 0; j < count; j++) arr.push(clamp(each, MIN.bedroom.h, total));
  return arr;
}

function layoutPublicZone(c: Spec, floor: Floor, x: number, y: number, w: number, h: number, hallD: number, withStairs: boolean, footArea: number) {
  const hallD2 = clamp(hallD, MIN.corridor.h, Math.min(2.0, h * 0.18));
  const pubH = h - hallD2;
  const svcW = clamp(Math.max(MIN.kitchen.w, w * 0.34), MIN.kitchen.w, w - MIN.living.w);
  const livingW = w - svcW;
  const sx = x + livingW;
  const maxLiving = clamp(footArea * 0.16, 20, 38);

  const livingD = clamp(maxLiving / livingW, MIN.living.h, Math.min(5.2, pubH - hallD2 - 1.2));
  const living = mk('living', c.living > 1 ? 'Living 1' : 'Living Room', x, y, livingW, livingD);
  setDoor(living, 'bottom', x + livingW * 0.5);
  floor.rooms.push(living);

  const connD = pubH - livingD - hallD2;
  if (connD > 1.0) floor.rooms.push(mk('corridor', 'Hall', x, y + livingD, livingW, connD));

  let svcY = y, svcRem = pubH;
  if (c.bathrooms > 0 && pubH > MIN.kitchen.h + MIN.bathroom.h + (c.dining ? MIN.dining.h : 0)) {
    const bathH = MIN.bathroom.h + 0.25;
    const bath = mk('bathroom', c.bathrooms > 1 ? 'WC' : 'Bathroom', sx, svcY, svcW, bathH);
    setDoor(bath, 'left', svcY + bathH / 2);
    floor.rooms.push(bath);
    svcY += bathH; svcRem -= bathH;
  }

  let kH: number, dH = 0;
  if (c.dining && svcRem > MIN.kitchen.h + MIN.dining.h) {
    kH = clamp(svcRem * 0.46, MIN.kitchen.h, svcRem - MIN.dining.h);
    dH = svcRem - kH;
  } else kH = svcRem;

  const kitchen = mk('kitchen', c.kitchens > 1 ? 'Kitchen 1' : 'Kitchen', sx, svcY, svcW, kH);
  setDoor(kitchen, 'left', svcY + kH * 0.5);
  floor.rooms.push(kitchen);

  if (c.dining && dH >= MIN.dining.h * 0.85) {
    const dining = mk('dining', 'Dining', sx, svcY + kH, svcW, dH);
    setDoor(dining, 'left', svcY + kH + dH * 0.45);
    floor.rooms.push(dining);
  }

  const hallW = clamp(livingW * 0.4, 1.5, 2.8);
  const hallX = x + (livingW - hallW) / 2;
  const hallY = y + pubH;
  floor.rooms.push(mk('corridor', 'Entry Hall', hallX, hallY, hallW, hallD2));
  floor.corridor = { x: hallX, y: hallY, w: hallW, h: hallD2 };
  floor.entrance = { x: hallX + hallW / 2, y: y + h, width: FRONT };

  if (withStairs) floor.stairs = { x: sx, y: y + pubH - clamp(2.6, 2.2, pubH * 0.28), w: svcW, h: clamp(2.6, 2.2, pubH * 0.28) };
}

function layoutBedRow(floor: Floor, names: string[], x: number, y: number, w: number, h: number, doorSide: Side): void {
  const n = names.length;
  if (n === 0) return;
  const cols = n <= 2 ? n : (n <= 4 ? 2 : 3);
  const rows = Math.ceil(n / cols);
  const cellW = Math.max(w / cols, MIN.bedroom.w);
  const cellH = Math.max(h / rows, MIN.bedroom.h);
  let idx = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols && idx < n; c++) {
      const isMaster = /master/i.test(names[idx]);
      let rw = Math.min(cellW, w - c * cellW);
      const rh = Math.min(cellH, h - r * cellH);
      if (isMaster && cols > 1) rw = Math.min(w * 0.55, Math.max(rw, MIN.master.w));
      const bx = x + c * cellW, by = y + r * cellH;
      const rm = mk('bedroom', names[idx], bx, by, rw, rh);
      setDoor(rm, doorSide, doorSide === 'bottom' ? bx + rw / 2 : by + rh / 2);
      floor.rooms.push(rm);
      idx++;
    }
  }
}

function layoutGround(c: Spec, fx: number, fy: number, fw: number, fh: number): Floor {
  const floor: Floor = { index: 0, rooms: [], corridor: null, entrance: null, stairs: null };
  let x = fx, w = fw;
  const y = fy, h = fh;

  if (c.garage) {
    const gw = clamp(Math.min(3.8, w * 0.22), MIN.garage.w, 3.8);
    const gr = mk('garage', 'Garage', x, y, gw, h);
    setDoor(gr, 'right', y + h * 0.72);
    floor.rooms.push(gr);
    x += gw; w -= gw;
  }

  if (c.floors === 1 && c.bedrooms > 0) {
    const bedBand = clamp(h * 0.4, MIN.bedroom.h * 1.2, h * 0.5);
    layoutPublicZone(c, floor, x, y + bedBand, w, h - bedBand, 1.5, false, fw * fh);
    const bedNames: string[] = [];
    for (let i = 0; i < c.bedrooms; i++) bedNames.push(i === 0 ? 'Master Bedroom' : 'Bedroom ' + (i + 1));
    layoutBedRow(floor, bedNames, x, y, w, bedBand, 'bottom');
  } else {
    layoutPublicZone(c, floor, x, y, w, h, 1.5, c.floors > 1, fw * fh);
  }

  applyWindows(floor.rooms, fx, fy, fw, fh);
  return floor;
}

function bedsForUpperFloor(c: Spec, floorIndex: number): number {
  if (c.floors <= 1) return 0;
  const upper = c.floors - 1;
  const base = Math.floor(c.bedrooms / upper);
  const extra = c.bedrooms % upper;
  return base + ((floorIndex - 1) < extra ? 1 : 0);
}
function bathsForUpperFloor(c: Spec, floorIndex: number): number {
  if (c.bathrooms <= 1 || c.floors <= 1) return 0;
  const upper = c.floors - 1;
  const rem = Math.max(0, c.bathrooms - 1);
  const base = Math.floor(rem / upper);
  const extra = rem % upper;
  return base + ((floorIndex - 1) < extra ? 1 : 0);
}

function layoutUpper(c: Spec, fx: number, fy: number, fw: number, fh: number, floorIndex: number) {
  const floor: Floor = { index: floorIndex, rooms: [], corridor: null, entrance: null, stairs: null };
  const CW = clamp(1.25, MIN.corridor.w, 1.4);
  const corridorX = fx + (fw - CW) / 2;
  const leftW = corridorX - fx;
  const rightW = fx + fw - corridorX - CW;
  const stairH = clamp(2.6, 2.2, fh * 0.2);

  floor.corridor = { x: corridorX, y: fy, w: CW, h: fh };
  floor.stairs = { x: corridorX, y: fy + fh - stairH, w: CW, h: stairH };
  floor.rooms.push(mk('corridor', 'Landing', corridorX, fy, CW, fh));

  const bedsOnFloor = bedsForUpperFloor(c, floorIndex);
  const bathsOnFloor = bathsForUpperFloor(c, floorIndex);
  const bathH = MIN.bathroom.h + 0.25;
  const bathW = Math.min(MIN.bathroom.w + 0.35, leftW - 0.1, rightW - 0.1);

  const leftN = Math.ceil(bedsOnFloor / 2);
  const rightN = bedsOnFloor - leftN;
  const leftBathSlots = Math.ceil(bathsOnFloor / 2);
  const rightBathSlots = bathsOnFloor - leftBathSlots;

  const leftBedH = fh - leftBathSlots * bathH;
  const rightBedH = fh - rightBathSlots * bathH;
  const leftHs = splitHeights(leftBedH, leftN, floorIndex === 1);
  const rightHs = splitHeights(rightBedH, rightN, false);

  const footArea = fw * fh;
  const maxBed = clamp(footArea * 0.07, 11, 20);
  const maxMaster = clamp(footArea * 0.09, 14, 24);
  const names: string[] = [];
  for (let nk = 0; nk < bedsOnFloor; nk++) {
    const num = (floorIndex - 1) * 2 + nk + 1;
    names.push(floorIndex === 1 && nk === 0 ? 'Master Bedroom' : 'Bedroom ' + num);
  }
  function capBed(rm: Room, isMaster: boolean): Room {
    const cap = isMaster ? maxMaster : maxBed;
    if (rm.area > cap) { rm.h = Math.max(MIN.bedroom.h, cap / rm.w); rm.area = rm.w * rm.h; }
    return rm;
  }

  let cy = fy, idx = 0;
  for (let k = 0; k < leftN; k++) {
    const lb = capBed(mk('bedroom', names[idx++] || ('Bedroom ' + (k + 1)), fx, cy, leftW, leftHs[k] || MIN.bedroom.h), floorIndex === 1 && k === 0);
    setDoor(lb, 'right', cy + lb.h / 2);
    floor.rooms.push(lb); cy += lb.h;
  }
  for (let k = 0; k < leftBathSlots; k++) {
    const by = Math.max(cy, fy + leftBedH) + k * bathH;
    const lbath = mk('bathroom', c.bathrooms > 1 ? 'Bath ' + (k + 2) : 'Bathroom', fx + leftW - bathW, by, bathW, Math.min(bathH, fy + fh - by));
    setDoor(lbath, 'right', by + lbath.h / 2);
    floor.rooms.push(lbath);
  }
  cy = fy;
  for (let k = 0; k < rightN; k++) {
    const rb = capBed(mk('bedroom', names[idx++] || ('Bedroom ' + (k + 1)), corridorX + CW, cy, rightW, rightHs[k] || MIN.bedroom.h), false);
    setDoor(rb, 'left', cy + rb.h / 2);
    floor.rooms.push(rb); cy += rb.h;
  }
  for (let k = 0; k < rightBathSlots; k++) {
    const by = Math.max(cy, fy + rightBedH) + k * bathH;
    const rbath = mk('bathroom', 'Bath ' + (leftBathSlots + k + 2), corridorX + CW, by, bathW, Math.min(bathH, fy + fh - by));
    setDoor(rbath, 'left', by + rbath.h / 2);
    floor.rooms.push(rbath);
  }

  applyWindows(floor.rooms, fx, fy, fw, fh);
  return { floor, corridorX, CW };
}

/* ----------------------------- validity engine ----------------------------- */

function overlaps(a: Room, b: Room): boolean {
  return a.x < b.x + b.w - OVERLAP_EPS && a.x + a.w > b.x + OVERLAP_EPS &&
    a.y < b.y + b.h - OVERLAP_EPS && a.y + a.h > b.y + OVERLAP_EPS;
}
interface Span { side: Side; from: number; to: number; }
function sharedSpan(A: Room, B: Room): Span | null {
  const T = 0.08;
  let lo: number, hi: number;
  if (Math.abs(A.x + A.w - B.x) < T || Math.abs(B.x + B.w - A.x) < T) {
    lo = Math.max(A.y, B.y); hi = Math.min(A.y + A.h, B.y + B.h);
    if (hi - lo > 0.6) return { side: Math.abs(A.x + A.w - B.x) < T ? 'right' : 'left', from: lo, to: hi };
  }
  if (Math.abs(A.y + A.h - B.y) < T || Math.abs(B.y + B.h - A.y) < T) {
    lo = Math.max(A.x, B.x); hi = Math.min(A.x + A.w, B.x + B.w);
    if (hi - lo > 0.6) return { side: Math.abs(A.y + A.h - B.y) < T ? 'bottom' : 'top', from: lo, to: hi };
  }
  return null;
}
function opposite(side: Side): Side { return side === 'left' ? 'right' : side === 'right' ? 'left' : side === 'top' ? 'bottom' : 'top'; }
function doorConnects(A: Room, B: Room): boolean {
  const s = sharedSpan(A, B);
  if (!s) return false;
  const openA = A.type === 'corridor', openB = B.type === 'corridor';
  if ((openA && openB) ||
      (A.type === 'living' && openB && B.name === 'Hall') ||
      (B.type === 'living' && openA && A.name === 'Hall')) return true;
  const inSpan = (d: Door | null) => !!d && d.pos >= s.from - 0.15 && d.pos <= s.to + 0.15;
  if (A.door && A.door.side === s.side && inSpan(A.door)) return true;
  if (B.door && B.door.side === opposite(s.side) && inSpan(B.door)) return true;
  return false;
}

function reachable(floor: Floor, foot: Rect, isGround: boolean): { room: Room; ok: boolean }[] {
  const rooms = floor.rooms;
  const seen = new Array<boolean>(rooms.length).fill(false);
  const queue: number[] = [];
  rooms.forEach((r, i) => {
    if (isGround && floor.entrance &&
        floor.entrance.x >= r.x - 0.1 && floor.entrance.x <= r.x + r.w + 0.1 &&
        Math.abs(r.y + r.h - (foot.y + foot.h)) < 0.1) { if (!seen[i]) { seen[i] = true; queue.push(i); } }
    if (!isGround && floor.stairs && r.type === 'corridor') {
      const sx = floor.stairs.x + floor.stairs.w / 2, sy = floor.stairs.y + floor.stairs.h / 2;
      if (sx >= r.x - EPS && sx <= r.x + r.w + EPS && sy >= r.y - EPS && sy <= r.y + r.h + EPS) {
        if (!seen[i]) { seen[i] = true; queue.push(i); }
      }
    }
  });
  while (queue.length) {
    const i = queue.shift()!;
    for (let j = 0; j < rooms.length; j++) {
      if (seen[j]) continue;
      if (doorConnects(rooms[i], rooms[j])) { seen[j] = true; queue.push(j); }
    }
  }
  return rooms.map((r, i) => ({ room: r, ok: seen[i] }));
}

function ensureDoors(floor: Floor, foot: Rect, isGround: boolean): boolean {
  for (let pass = 0; pass < 4; pass++) {
    const state = reachable(floor, foot, isGround);
    const bad = state.filter(s => !s.ok);
    if (!bad.length) return true;
    let fixed = false;
    bad.forEach(({ room }) => {
      const candidates = state.filter(s => s.ok).map(s => s.room)
        .map(o => ({ o, span: sharedSpan(room, o) }))
        .filter((c): c is { o: Room; span: Span } => !!c.span)
        .sort((a, b) => (b.o.type === 'corridor' ? 1 : 0) - (a.o.type === 'corridor' ? 1 : 0));
      if (candidates.length) {
        const { span } = candidates[0];
        setDoor(room, span.side, (span.from + span.to) / 2, Math.min(DOOR, span.to - span.from - 0.2));
        fixed = true;
      }
    });
    if (!fixed) return false;
  }
  return reachable(floor, foot, isGround).every(s => s.ok);
}

function clampRooms(floor: Floor, foot: Rect): void {
  floor.rooms.forEach(r => {
    r.x = clamp(r.x, foot.x, foot.x + foot.w - 0.5);
    r.y = clamp(r.y, foot.y, foot.y + foot.h - 0.5);
    r.w = clamp(r.w, 0.5, foot.x + foot.w - r.x);
    r.h = clamp(r.h, 0.5, foot.y + foot.h - r.y);
    r.area = r.w * r.h;
  });
}

function fixOverlaps(floor: Floor): void {
  const rooms = floor.rooms;
  for (let a = 0; a < rooms.length; a++) {
    for (let b = a + 1; b < rooms.length; b++) {
      const A = rooms[a], B = rooms[b];
      if (!overlaps(A, B)) continue;
      const S = A.area <= B.area ? A : B, L2 = S === A ? B : A;
      const oxr = (L2.x + L2.w) - S.x, oxl = (S.x + S.w) - L2.x;
      const oyb = (L2.y + L2.h) - S.y, oyt = (S.y + S.h) - L2.y;
      const cands = [
        { d: oxr, fn: () => { const nx = L2.x + L2.w; S.w -= (nx - S.x); S.x = nx; } },
        { d: oxl, fn: () => { S.w = L2.x - S.x; } },
        { d: oyb, fn: () => { const ny = L2.y + L2.h; S.h -= (ny - S.y); S.y = ny; } },
        { d: oyt, fn: () => { S.h = L2.y - S.y; } }
      ].filter(c => c.d > 0).sort((p, q) => p.d - q.d);
      if (cands.length) { cands[0].fn(); S.w = Math.max(0.5, S.w); S.h = Math.max(0.5, S.h); S.area = S.w * S.h; }
    }
  }
}

function alignStairs(layout: Layout): void {
  const floors = layout.floors;
  if (floors.length < 2) { if (floors[0]) floors[0].stairs = null; return; }
  const rect = (floors[1] && floors[1].stairs) || floors[0].stairs;
  if (!rect) return;
  for (let i = 0; i < floors.length; i++) {
    floors[i].stairs = { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
  }
}

export function repair(layout: Layout, c: Spec): Layout {
  const foot = layout.foot;
  layout.floors.forEach((fl, i) => {
    fl.rooms.forEach(r => { r.area = r.w * r.h; });
    applyWindows(fl.rooms, foot.x, foot.y, foot.w, foot.h);
    ensureDoors(fl, foot, i === 0);
  });
  return layout;
}

function unionAreaInFoot(rooms: Room[], foot: Rect): number {
  const rects = rooms.map(r => ({
    x1: Math.max(foot.x, r.x), y1: Math.max(foot.y, r.y),
    x2: Math.min(foot.x + foot.w, r.x + r.w), y2: Math.min(foot.y + foot.h, r.y + r.h)
  })).filter(r => Number.isFinite(r.x1 + r.y1 + r.x2 + r.y2) && r.x2 - r.x1 > OVERLAP_EPS && r.y2 - r.y1 > OVERLAP_EPS);
  if (!rects.length) return 0;
  const xs = Array.from(new Set(rects.flatMap(r => [r.x1, r.x2]))).sort((a, b) => a - b);
  let area = 0;
  for (let i = 0; i + 1 < xs.length; i++) {
    const x1 = xs[i], x2 = xs[i + 1], dx = x2 - x1;
    if (dx <= OVERLAP_EPS) continue;
    const ys = rects.filter(r => r.x1 < x2 - OVERLAP_EPS && r.x2 > x1 + OVERLAP_EPS)
      .map(r => [r.y1, r.y2] as [number, number]).sort((a, b) => a[0] - b[0]);
    let length = 0, lo = 0, hi = 0, active = false;
    ys.forEach(([a, b]) => {
      if (!active) { lo = a; hi = b; active = true; }
      else if (a <= hi + OVERLAP_EPS) hi = Math.max(hi, b);
      else { length += hi - lo; lo = a; hi = b; }
    });
    if (active) length += hi - lo;
    area += dx * length;
  }
  return area;
}

export function coverage(layout: Layout): number {
  const foot = layout.foot, fa = foot.w * foot.h;
  if (!fa) return 0;
  let worst = 1;
  layout.floors.forEach(fl => {
    worst = Math.min(worst, Math.min(1, unionAreaInFoot(fl.rooms, foot) / fa));
  });
  return worst;
}

export function validateLayout(layout: Layout | null, c: { floors: number } & Partial<Spec>): Validation {
  if (!layout || !layout.floors || layout.floors.length !== c.floors) return { ok: false, score: 0, issues: ['floor count'] };
  const issues: string[] = [], f = layout.foot;
  let score = 100;
  const all = layout.floors.flatMap(fl => fl.rooms);
  const count = (t: string) => all.filter(r => r.type === t).length;
  const exact = (type: string, expected: number | undefined, penalty: number) => {
    if (typeof expected !== 'number') return;
    const actual = count(type);
    if (actual !== expected) { issues.push(type + ' count ' + actual + '/' + expected); score -= penalty; }
  };
  exact('bedroom', c.bedrooms, 30);
  exact('bathroom', c.bathrooms, 24);
  exact('kitchen', c.kitchens, 24);
  exact('living', c.living, 24);
  if (typeof c.dining === 'boolean') exact('dining', c.dining ? 1 : 0, 15);
  if (typeof c.garage === 'boolean') exact('garage', c.garage ? 1 : 0, 15);
  if (Array.isArray(c.customRooms)) {
    const requested = new Map<string, number>();
    c.customRooms.forEach(req => {
      const name = String(req && req.name || '').trim().toLowerCase();
      if (name) requested.set(name, (requested.get(name) || 0) + Math.max(1, Math.min(12, Math.round(req.count || 1))));
    });
    exact('room', Array.from(requested.values()).reduce((s, n) => s + n, 0), 18);
    const generic = all.filter(r => r.type === 'room');
    requested.forEach((expected, base) => {
      const actual = generic.filter(r => { const n = r.name.trim().toLowerCase(); return n === base || n.startsWith(base + ' '); }).length;
      if (actual !== expected) { issues.push('custom room "' + base + '" count ' + actual + '/' + expected); score -= 12; }
    });
  }
  layout.floors.forEach((fl, i) => {
    for (let a = 0; a < fl.rooms.length; a++) {
      for (let b = a + 1; b < fl.rooms.length; b++) {
        if (overlaps(fl.rooms[a], fl.rooms[b])) { issues.push('overlap F' + (i + 1) + ': ' + fl.rooms[a].name + '/' + fl.rooms[b].name); score -= 25; }
      }
      const r = fl.rooms[a];
      if (![r.x, r.y, r.w, r.h].every(Number.isFinite) || r.w <= 0 || r.h <= 0) {
        issues.push('invalid geometry ' + r.name); score -= 25; continue;
      }
      if (r.x < f.x - EPS || r.y < f.y - EPS || r.x + r.w > f.x + f.w + EPS || r.y + r.h > f.y + f.h + EPS) {
        issues.push('out of bounds ' + r.name); score -= 15;
      }
      let lim = r.type === 'bedroom' && /master/i.test(r.name) ? MIN.master : (MIN[r.type] || MIN.room);
      if (r.type === 'room' && Array.isArray(c.customRooms)) {
        const rn = r.name.trim().toLowerCase();
        const req = c.customRooms.find(q => { const base = String(q && q.name || '').trim().toLowerCase(); return base && (rn === base || rn.startsWith(base + ' ')); });
        if (req) {
          const base = String(req.name).toLowerCase();
          const inferred = /office|study/.test(base) ? { w: 2.6, h: 2.8 }
            : /laundry|utility/.test(base) ? { w: 1.8, h: 2.0 }
            : /pantry|closet|store/.test(base) ? { w: 1.5, h: 1.8 }
            : /ensuite|powder|wc/.test(base) ? MIN.bathroom : MIN.room;
          lim = { w: clamp(Number(req.minW) || inferred.w, 1.2, 12), h: clamp(Number(req.minH) || inferred.h, 1.2, 12) };
        }
      }
      const actualShort = Math.min(r.w, r.h), actualLong = Math.max(r.w, r.h);
      const minShort = Math.min(lim.w, lim.h), minLong = Math.max(lim.w, lim.h);
      if (actualShort + EPS < minShort || actualLong + EPS < minLong) {
        issues.push('too small ' + r.name); score -= 5;
      }
      if (r.door) {
        const along0 = r.door.side === 'left' || r.door.side === 'right' ? r.y : r.x;
        const along1 = r.door.side === 'left' || r.door.side === 'right' ? r.y + r.h : r.x + r.w;
        if (!Number.isFinite(r.door.pos) || r.door.width < 0.7 || r.door.pos - r.door.width / 2 < along0 - EPS || r.door.pos + r.door.width / 2 > along1 + EPS) {
          issues.push('invalid door ' + r.name); score -= 8;
        }
      }
      r.windows.forEach(wdw => {
        const onEdge =
          (wdw.side === 'left' && Math.abs(r.x - f.x) < EPS * 4) ||
          (wdw.side === 'right' && Math.abs(r.x + r.w - (f.x + f.w)) < EPS * 4) ||
          (wdw.side === 'top' && Math.abs(r.y - f.y) < EPS * 4) ||
          (wdw.side === 'bottom' && Math.abs(r.y + r.h - (f.y + f.h)) < EPS * 4);
        if (!onEdge) { issues.push('interior window ' + r.name); score -= 10; }
      });
    }
    const unreachable = reachable(fl, f, i === 0).filter(s => !s.ok);
    unreachable.forEach(u => { issues.push('unreachable F' + (i + 1) + ': ' + u.room.name); score -= 20; });
    const fc = unionAreaInFoot(fl.rooms, f) / Math.max(OVERLAP_EPS, f.w * f.h);
    if (fc + OVERLAP_EPS < MIN_COVERAGE) { issues.push('coverage F' + (i + 1) + ': ' + Math.round(fc * 100) + '%/' + Math.round(MIN_COVERAGE * 100) + '%'); score -= 25; }
    if (i === 0) {
      if (!fl.entrance || Math.abs(fl.entrance.y - (f.y + f.h)) > 0.15 || fl.entrance.x < f.x || fl.entrance.x > f.x + f.w) {
        issues.push('invalid entrance'); score -= 20;
      }
    }
    if (layout.floors.length > 1) {
      const st = fl.stairs;
      if (!st) { issues.push('missing stairs F' + (i + 1)); score -= 15; }
      else {
        const inside = st.x >= f.x - EPS && st.y >= f.y - EPS && st.x + st.w <= f.x + f.w + EPS && st.y + st.h <= f.y + f.h + EPS;
        const inCirculation = fl.rooms.some(r => r.type === 'corridor' && st.x >= r.x - EPS && st.y >= r.y - EPS && st.x + st.w <= r.x + r.w + EPS && st.y + st.h <= r.y + r.h + EPS);
        if (!inside || st.w < 0.8 || st.h < 1.8) { issues.push('invalid stairs F' + (i + 1)); score -= 15; }
        if (!inCirculation) { issues.push('stairs outside circulation F' + (i + 1)); score -= 15; }
      }
    }
  });
  for (let i = 0; i + 1 < layout.floors.length; i++) {
    const a = layout.floors[i].stairs, b = layout.floors[i + 1].stairs;
    if (a && b && (Math.abs(a.x - b.x) > 0.15 || Math.abs(a.y - b.y) > 0.15 || Math.abs(a.w - b.w) > 0.15 || Math.abs(a.h - b.h) > 0.15)) {
      issues.push('stairs misaligned F' + (i + 1) + '/F' + (i + 2)); score -= 15;
    }
  }
  return { ok: issues.length === 0, score: Math.max(0, score), issues };
}

/* ---------------------- seeded procedural candidate engine ---------------------- */

interface ProgramRoom {
  type: RoomType;
  name: string;
  index: number;
  minW: number;
  minH: number;
  targetArea: number;
  preferredFloor?: number;
  customBase?: string;
}
interface BinDef { capacity: number; cross: number; }
interface Candidate { layout: Layout; validation: Validation; quality: number; }
type Rng = () => number;

function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function mixSeed(seed: number, n: number): number {
  let x = (seed ^ Math.imul(n + 1, 0x9E3779B1)) >>> 0;
  x ^= x >>> 16; x = Math.imul(x, 0x7FEB352D); x ^= x >>> 15; x = Math.imul(x, 0x846CA68B); x ^= x >>> 16;
  return x >>> 0;
}
function shuffled<T>(src: T[], rng: Rng): T[] {
  const out = src.slice();
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}
function countOf(v: number): number { return Math.max(0, Math.round(Number.isFinite(v) ? v : 0)); }

function makeProgramRoom(type: RoomType, name: string, index: number): ProgramRoom {
  const lim = type === 'bedroom' && index === 0 ? MIN.master : (MIN[type] || MIN.room);
  const factor: Record<string, number> = { living: 1.35, bedroom: index === 0 ? 1.25 : 1.12, kitchen: 1.2, bathroom: 1.1, dining: 1.18, garage: 1.08, room: 1.1 };
  return { type, name, index, minW: lim.w, minH: lim.h, targetArea: lim.w * lim.h * (factor[type] || 1.1) };
}
function roomProgram(c: Spec): ProgramRoom[] {
  const out: ProgramRoom[] = [];
  const living = countOf(c.living), kitchens = countOf(c.kitchens), beds = countOf(c.bedrooms), baths = countOf(c.bathrooms);
  for (let i = 0; i < living; i++) out.push(makeProgramRoom('living', living === 1 ? 'Living Room' : 'Living ' + (i + 1), i));
  for (let i = 0; i < kitchens; i++) out.push(makeProgramRoom('kitchen', kitchens === 1 ? 'Kitchen' : 'Kitchen ' + (i + 1), i));
  if (c.dining) out.push(makeProgramRoom('dining', 'Dining', 0));
  if (c.garage) out.push(makeProgramRoom('garage', 'Garage', 0));
  for (let i = 0; i < beds; i++) out.push(makeProgramRoom('bedroom', i === 0 ? 'Master Bedroom' : 'Bedroom ' + (i + 1), i));
  for (let i = 0; i < baths; i++) out.push(makeProgramRoom('bathroom', baths === 1 ? 'Bathroom' : 'Bathroom ' + (i + 1), i));
  (c.customRooms || []).slice(0, 20).forEach(req => {
    const base = String(req && req.name || '').trim().slice(0, 60);
    if (!base) return;
    const n = Math.max(1, Math.min(12, Math.round(req.count || 1)));
    const lower = base.toLowerCase();
    const inferred = /office|study/.test(lower) ? { w: 2.6, h: 2.8 }
      : /laundry|utility/.test(lower) ? { w: 1.8, h: 2.0 }
      : /pantry|closet|store/.test(lower) ? { w: 1.5, h: 1.8 }
      : /ensuite|powder|wc/.test(lower) ? MIN.bathroom : MIN.room;
    const minW = clamp(Number(req.minW) || inferred.w, 1.2, 12), minH = clamp(Number(req.minH) || inferred.h, 1.2, 12);
    for (let i = 0; i < n; i++) out.push({
      type: 'room', name: n === 1 ? base : base + ' ' + (i + 1), index: i,
      minW, minH, targetArea: minW * minH * 1.15,
      preferredFloor: Number.isFinite(req.preferredFloor) ? clamp(Math.round(req.preferredFloor!), 0, c.floors - 1) : undefined,
      customBase: base
    });
  });
  return out;
}

function assignmentRank(r: ProgramRoom): number {
  if (r.type === 'garage') return 0;
  if (r.type === 'living' || r.type === 'kitchen' || r.type === 'dining') return 1;
  if (r.type === 'bedroom') return 2;
  return 3;
}
function floorPreference(r: ProgramRoom, floor: number, floors: number, rngBias: number): number {
  if (r.type === 'garage') return floor === 0 ? 0 : 1e6;
  if (floors === 1) return 0;
  if (r.type === 'dining') return floor === 0 ? 0 : 3.2;
  if ((r.type === 'living' || r.type === 'kitchen') && r.index === 0) return floor === 0 ? 0 : 2.8;
  if (r.type === 'bedroom') {
    const preferred = 1 + ((r.index + Math.floor(rngBias * (floors - 1))) % (floors - 1));
    return floor === preferred ? 0 : floor === 0 ? 2.0 : 0.65;
  }
  if (r.type === 'bathroom') {
    if (r.index === 0) return floor === 0 ? 0.25 : 0.7;
    const preferred = 1 + ((r.index - 1) % (floors - 1));
    return floor === preferred ? 0 : floor === 0 ? 1.1 : 0.45;
  }
  if (r.type === 'room' && r.preferredFloor != null) return floor === r.preferredFloor ? 0 : 2.4 + Math.abs(floor - r.preferredFloor) * 0.3;
  return floor * 0.15;
}
function assignProgramToFloors(program: ProgramRoom[], c: Spec, foot: Rect, rng: Rng): ProgramRoom[][] {
  const buckets = Array.from({ length: c.floors }, () => [] as ProgramRoom[]);
  const loads = new Array<number>(c.floors).fill(0);
  const biases = new Map<ProgramRoom, number>(); program.forEach(r => biases.set(r, rng()));
  const ordered = program.slice().sort((a, b) => assignmentRank(a) - assignmentRank(b) || b.targetArea - a.targetArea || (biases.get(a)! - biases.get(b)!));
  const capacity = Math.max(1, foot.w * foot.h * 0.82);
  ordered.forEach(r => {
    let best = 0, bestCost = Infinity;
    for (let f = 0; f < c.floors; f++) {
      const pref = floorPreference(r, f, c.floors, biases.get(r)!);
      const projected = (loads[f] + r.targetArea) / capacity;
      const spread = buckets[f].length * 0.025;
      const cost = pref + projected * projected * 2.2 + spread + rng() * 0.08;
      if (cost < bestCost) { bestCost = cost; best = f; }
    }
    buckets[best].push(r); loads[best] += r.targetArea;
  });
  return buckets;
}

/** Required length along a partition when its other dimension is fixed. */
function minAlong(r: ProgramRoom, cross: number): number | null {
  const options: number[] = [];
  if (cross + EPS >= r.minW) options.push(r.minH);
  if (cross + EPS >= r.minH) options.push(r.minW);
  return options.length ? Math.min(...options) : null;
}
function splitBins(rooms: ProgramRoom[], bins: [BinDef, BinDef], rng: Rng, force?: (r: ProgramRoom) => 0 | 1 | null): [ProgramRoom[], ProgramRoom[]] | null {
  if (!rooms.length) return [[], []];
  let best: [ProgramRoom[], ProgramRoom[]] | null = null, bestBalance = Infinity;
  for (let attempt = 0; attempt < 16; attempt++) {
    const used = [0, 0], placed: [ProgramRoom[], ProgramRoom[]] = [[], []];
    const noise = new Map<ProgramRoom, number>(); rooms.forEach(r => noise.set(r, rng()));
    const order = rooms.slice().sort((a, b) => {
      const ao = [minAlong(a, bins[0].cross), minAlong(a, bins[1].cross)].filter(x => x != null).length;
      const bo = [minAlong(b, bins[0].cross), minAlong(b, bins[1].cross)].filter(x => x != null).length;
      const ar = Math.max(minAlong(a, bins[0].cross) || 0, minAlong(a, bins[1].cross) || 0);
      const br = Math.max(minAlong(b, bins[0].cross) || 0, minAlong(b, bins[1].cross) || 0);
      return ao - bo || br - ar || noise.get(a)! - noise.get(b)!;
    });
    let failed = false;
    for (const room of order) {
      const forced = force ? force(room) : null;
      const opts: { bin: 0 | 1; need: number; cost: number }[] = [];
      ([0, 1] as const).forEach(bin => {
        if (forced != null && forced !== bin) return;
        const need = minAlong(room, bins[bin].cross);
        if (need == null || used[bin] + need > bins[bin].capacity + EPS) return;
        const fill = (used[bin] + need) / bins[bin].capacity;
        opts.push({ bin, need, cost: fill + rng() * (attempt ? 0.2 : 0.04) });
      });
      if (!opts.length) { failed = true; break; }
      opts.sort((a, b) => a.cost - b.cost);
      const pick = opts[0]; used[pick.bin] += pick.need; placed[pick.bin].push(room);
    }
    if (!failed) {
      const balance = Math.abs(used[0] / bins[0].capacity - used[1] / bins[1].capacity) + rng() * 0.01;
      if (balance < bestBalance) { bestBalance = balance; best = [placed[0].slice(), placed[1].slice()]; }
    }
  }
  if (best) return best;

  // Greedy balancing is fast and gives useful variety, but dense programmes
  // occasionally require a non-obvious packing. Fall back to an exact,
  // memoised two-bin search before declaring the geometry infeasible.
  const tie = new Map<ProgramRoom, number>(); rooms.forEach(r => tie.set(r, rng()));
  const exactOrder = rooms.slice().sort((a, b) => {
    const a0 = minAlong(a, bins[0].cross), a1 = minAlong(a, bins[1].cross);
    const b0 = minAlong(b, bins[0].cross), b1 = minAlong(b, bins[1].cross);
    const ao = (a0 == null ? 0 : 1) + (a1 == null ? 0 : 1), bo = (b0 == null ? 0 : 1) + (b1 == null ? 0 : 1);
    return ao - bo || Math.max(b0 || 0, b1 || 0) - Math.max(a0 || 0, a1 || 0) || tie.get(a)! - tie.get(b)!;
  });
  const exactPlaced: [ProgramRoom[], ProgramRoom[]] = [[], []], memo = new Set<string>();
  const search = (at: number, used0: number, used1: number): boolean => {
    if (at === exactOrder.length) return true;
    const key = at + '|' + Math.round(used0 * 100) + '|' + Math.round(used1 * 100);
    if (memo.has(key)) return false;
    const room = exactOrder[at], forced = force ? force(room) : null;
    const options: { bin: 0 | 1; need: number; score: number }[] = [];
    ([0, 1] as const).forEach(bin => {
      if (forced != null && forced !== bin) return;
      const need = minAlong(room, bins[bin].cross), used = bin === 0 ? used0 : used1;
      if (need != null && used + need <= bins[bin].capacity + EPS) options.push({ bin, need, score: (used + need) / bins[bin].capacity + rng() * 0.08 });
    });
    options.sort((a, b) => a.score - b.score);
    for (const option of options) {
      exactPlaced[option.bin].push(room);
      if (search(at + 1, used0 + (option.bin === 0 ? option.need : 0), used1 + (option.bin === 1 ? option.need : 0))) return true;
      exactPlaced[option.bin].pop();
    }
    memo.add(key); return false;
  };
  return search(0, 0, 0) ? [exactPlaced[0].slice(), exactPlaced[1].slice()] : null;
}
function allocatedSegments(rooms: ProgramRoom[], cross: number, total: number, rng: Rng, garageLast: boolean): { room: ProgramRoom; length: number }[] | null {
  if (!rooms.length) return [];
  let ordered = shuffled(rooms, rng);
  if (garageLast) ordered = ordered.filter(r => r.type !== 'garage').concat(ordered.filter(r => r.type === 'garage'));
  // Frequently keep kitchen and dining contiguous without making every seed identical.
  const ki = ordered.findIndex(r => r.type === 'kitchen'), di = ordered.findIndex(r => r.type === 'dining');
  if (ki >= 0 && di >= 0 && Math.abs(ki - di) > 1 && rng() > 0.25) {
    const dining = ordered.splice(di, 1)[0]; const kitchenAt = ordered.findIndex(r => r.type === 'kitchen'); ordered.splice(kitchenAt + 1, 0, dining);
  }
  const needs = ordered.map(r => minAlong(r, cross));
  if (needs.some(n => n == null)) return null;
  const base = (needs as number[]).reduce((s, n) => s + n, 0);
  if (base > total + EPS) return null;
  const extra = Math.max(0, total - base);
  const weights = ordered.map((r, i) => {
    if (r.type === 'bathroom') return 0.04 + rng() * 0.04;
    if (r.type === 'room' && r.targetArea <= 9) return 0.08 + rng() * 0.08;
    return Math.max(0.18, r.targetArea / cross - (needs[i] as number)) + 0.15 + rng() * 0.3;
  });
  const weightSum = weights.reduce((s, n) => s + n, 0);
  const out = ordered.map((room, i) => {
    const raw = (needs[i] as number) + extra * weights[i] / weightSum;
    if (room.type === 'bathroom') {
      const cap = Math.max((needs[i] as number) + 0.35, Math.min(3.1, 11.8 / Math.max(1.5, cross)));
      return { room, length: Math.min(raw, cap) };
    }
    return { room, length: raw };
  });
  // Absorb any leftover length into a non-bathroom room, or leave >1.25m for a gallery when only bathrooms exist.
  const nonBath = out.filter(x => x.room.type !== 'bathroom');
  const leftover = total - out.reduce((s, x) => s + x.length, 0);
  if (Math.abs(leftover) > 1e-6) {
    if (nonBath.length) nonBath[nonBath.length - 1].length += leftover;
    else if (leftover <= 1.25) out[out.length - 1].length += leftover;
  }
  return out;
}

function addProgramRoom(floor: Floor, p: ProgramRoom, x: number, y: number, w: number, h: number, doorSide: Side): void {
  const room = mk(p.type, p.name, x, y, w, h);
  const along = doorSide === 'left' || doorSide === 'right' ? y + h / 2 : x + w / 2;
  setDoor(room, doorSide, along, Math.min(DOOR, (doorSide === 'left' || doorSide === 'right' ? h : w) - 0.3));
  floor.rooms.push(room);
}
function addOpenCorridor(floor: Floor, name: string, x: number, y: number, w: number, h: number, side: Side): Room {
  const hall = mk('corridor', name, x, y, w, h);
  setDoor(hall, side, side === 'left' || side === 'right' ? y + h / 2 : x + w / 2, Math.min(1.2, (side === 'left' || side === 'right' ? h : w) - 0.2));
  floor.rooms.push(hall);
  return hall;
}

function verticalFloor(fi: number, assigned: ProgramRoom[], c: Spec, foot: Rect, cw: number, ratio: number, rng: Rng): Floor | null {
  const leftW = (foot.w - cw) * ratio, rightW = foot.w - cw - leftW;
  if (leftW < MIN.corridor.w || rightW < MIN.corridor.w) return null;
  const narrowBin: 0 | 1 | null = Math.abs(leftW - rightW) > 0.45 ? (leftW < rightW ? 0 : 1) : null;
  const split = (narrowBin != null
    ? splitBins(assigned, [{ capacity: foot.h, cross: leftW }, { capacity: foot.h, cross: rightW }], rng,
        r => (r.type === 'bathroom' && Math.min(leftW, rightW) >= r.minW) ? narrowBin : null)
    : null) || splitBins(assigned, [{ capacity: foot.h, cross: leftW }, { capacity: foot.h, cross: rightW }], rng);
  if (!split) return null;
  const floor: Floor = { index: fi, rooms: [], corridor: null, entrance: null, stairs: null };
  const hallX = foot.x + leftW;
  const main = mk('corridor', fi ? 'Landing' : 'Main Hall', hallX, foot.y, cw, foot.h); floor.rooms.push(main);
  floor.corridor = { x: hallX, y: foot.y, w: cw, h: foot.h };
  const left = allocatedSegments(split[0], leftW, foot.h, rng, true), right = allocatedSegments(split[1], rightW, foot.h, rng, true);
  if (!left || !right) return null;
  if (!left.length) addOpenCorridor(floor, 'West Gallery', foot.x, foot.y, leftW, foot.h, 'right');
  else {
    let y = foot.y;
    left.forEach(s => { addProgramRoom(floor, s.room, foot.x, y, leftW, s.length, 'right'); y += s.length; });
    if (foot.y + foot.h - y > 1.2) addOpenCorridor(floor, 'West Gallery', foot.x, y, leftW, foot.y + foot.h - y, 'right');
  }
  if (!right.length) addOpenCorridor(floor, 'East Gallery', hallX + cw, foot.y, rightW, foot.h, 'left');
  else {
    let y = foot.y;
    right.forEach(s => { addProgramRoom(floor, s.room, hallX + cw, y, rightW, s.length, 'left'); y += s.length; });
    if (foot.y + foot.h - y > 1.2) addOpenCorridor(floor, 'East Gallery', hallX + cw, y, rightW, foot.y + foot.h - y, 'left');
  }
  if (fi === 0) floor.entrance = { x: hallX + cw / 2, y: foot.y + foot.h, width: FRONT };
  if (c.floors > 1) floor.stairs = { x: hallX + 0.1, y: foot.y + 0.25, w: cw - 0.2, h: Math.min(2.7, foot.h - 0.5) };
  applyWindows(floor.rooms, foot.x, foot.y, foot.w, foot.h);
  return floor;
}

function horizontalFloor(fi: number, assigned: ProgramRoom[], c: Spec, foot: Rect, cw: number, ratio: number, entryLeft: boolean, entryW: number, rng: Rng): Floor | null {
  const topH = (foot.h - cw) * ratio, bottomH = foot.h - cw - topH;
  if (topH < MIN.corridor.w || bottomH < MIN.corridor.w || entryW >= foot.w - MIN.corridor.w) return null;
  if (c.floors > 1 && bottomH < 2.1) return null;
  const split = splitBins(assigned, [{ capacity: foot.w, cross: topH }, { capacity: foot.w - entryW, cross: bottomH }], rng, r => r.type === 'garage' ? 1 : null);
  if (!split) return null;
  const floor: Floor = { index: fi, rooms: [], corridor: null, entrance: null, stairs: null };
  const hallY = foot.y + topH, entryX = entryLeft ? foot.x : foot.x + foot.w - entryW;
  const main = mk('corridor', fi ? 'Landing' : 'Main Hall', foot.x, hallY, foot.w, cw); floor.rooms.push(main);
  floor.corridor = { x: foot.x, y: hallY, w: foot.w, h: cw };
  addOpenCorridor(floor, fi ? 'Stair Hall' : 'Entry Hall', entryX, hallY + cw, entryW, bottomH, 'top');
  const top = allocatedSegments(split[0], topH, foot.w, rng, false);
  const bottom = allocatedSegments(split[1], bottomH, foot.w - entryW, rng, false);
  if (!top || !bottom) return null;
  if (!top.length) addOpenCorridor(floor, 'North Gallery', foot.x, foot.y, foot.w, topH, 'bottom');
  else {
    let x = foot.x;
    top.forEach(s => { addProgramRoom(floor, s.room, x, foot.y, s.length, topH, 'bottom'); x += s.length; });
    if (foot.x + foot.w - x > 1.2) addOpenCorridor(floor, 'North Gallery', x, foot.y, foot.x + foot.w - x, topH, 'bottom');
  }
  const bottomX = entryLeft ? foot.x + entryW : foot.x;
  if (!bottom.length) addOpenCorridor(floor, 'South Gallery', bottomX, hallY + cw, foot.w - entryW, bottomH, 'top');
  else {
    let x = bottomX;
    bottom.forEach(s => { addProgramRoom(floor, s.room, x, hallY + cw, s.length, bottomH, 'top'); x += s.length; });
    if (bottomX + (foot.w - entryW) - x > 1.2) addOpenCorridor(floor, 'South Gallery', x, hallY + cw, bottomX + (foot.w - entryW) - x, bottomH, 'top');
  }
  if (fi === 0) floor.entrance = { x: entryX + entryW / 2, y: foot.y + foot.h, width: Math.min(FRONT, entryW - 0.1) };
  if (c.floors > 1) floor.stairs = { x: entryX + 0.1, y: hallY + cw + 0.12, w: entryW - 0.2, h: bottomH - 0.24 };
  applyWindows(floor.rooms, foot.x, foot.y, foot.w, foot.h);
  return floor;
}

function candidateQuality(layout: Layout, program: ProgramRoom[], rng: Rng): number {
  const fa = layout.foot.w * layout.foot.h * layout.floors.length;
  const corridors = layout.floors.flatMap(f => f.rooms).filter(r => r.type === 'corridor').reduce((s, r) => s + r.area, 0);
  let score = coverage(layout) * 72 - (corridors / Math.max(1, fa)) * 18;
  const habitable = layout.floors.flatMap(f => f.rooms).filter(r => ['living', 'bedroom', 'kitchen', 'dining'].includes(r.type));
  score += habitable.filter(r => r.windows.length > 0).length / Math.max(1, habitable.length) * 12;
  layout.floors.forEach((fl, fi) => {
    const kitchen = fl.rooms.find(r => r.type === 'kitchen'), dining = fl.rooms.find(r => r.type === 'dining'), living = fl.rooms.find(r => r.type === 'living');
    if (kitchen && dining && sharedSpan(kitchen, dining)) score += 6;
    if (living && dining && sharedSpan(living, dining)) score += 4;
    if (living && Math.abs(living.y + living.h - (layout.foot.y + layout.foot.h)) < EPS * 4) score += 3;
    const garage = fl.rooms.find(r => r.type === 'garage');
    if (garage) {
      if (fi === 0 && Math.abs(garage.y + garage.h - (layout.foot.y + layout.foot.h)) < EPS * 4) score += 8;
      else score -= 18;
    }
    const master = fl.rooms.find(r => r.type === 'bedroom' && /master/i.test(r.name));
    const bath = fl.rooms.find(r => r.type === 'bathroom');
    if (master && bath && sharedSpan(master, bath)) score += 4;
    fl.rooms.filter(r => r.type !== 'corridor').forEach(r => {
      const aspect = Math.max(r.w, r.h) / Math.max(0.5, Math.min(r.w, r.h));
      if (aspect > 2.35) score -= (aspect - 2.35) * 4;
      if (r.type === 'bathroom' && r.area > 11.5) score -= (r.area - 11.5) * 1.6;
    });
  });
  const actual = new Map<string, number>(); layout.floors.flatMap(f => f.rooms).forEach(r => actual.set(r.name, r.area));
  program.forEach(r => { const a = actual.get(r.name) || 0; score -= Math.min(3, Math.abs(a - r.targetArea) / Math.max(1, r.targetArea)); });
  return clamp(score + rng() * 2, 0, 100);
}

function makeCandidate(c: Spec, foot: Rect, seed: number, index: number): Candidate | null {
  const rng = seededRng(mixSeed(seed, index));
  const program = roomProgram(c), assigned = assignProgramToFloors(program, c, foot, rng);
  const cw = 1.2 + rng() * 0.25;
  const vertical = ((index + (seed & 1)) % 2) === 0;
  const floors: Floor[] = [];
  let corridorX = foot.x + foot.w / 2, corridorW = cw;
  if (vertical) {
    const variants = [0.35, 0.40, 0.45, 0.48, 0.52, 0.55, 0.60, 0.65];
    const ratio = clamp(variants[(index + (seed % variants.length)) % variants.length] + (rng() - 0.5) * 0.035, 0.33, 0.67);
    for (let fi = 0; fi < c.floors; fi++) { const fl = verticalFloor(fi, assigned[fi], c, foot, cw, ratio, rng); if (!fl) return null; floors.push(fl); }
    corridorX = floors[0].corridor!.x; corridorW = floors[0].corridor!.w;
  } else {
    const variants = [0.34, 0.41, 0.48, 0.55, 0.62, 0.68];
    const ratio = clamp(variants[(index + (seed % variants.length)) % variants.length] + (rng() - 0.5) * 0.035, 0.28, 0.72);
    const entryW = clamp(1.22 + rng() * 0.28, 1.2, Math.min(1.55, foot.w * 0.25));
    const entryLeft = ((index + ((seed >>> 3) & 1)) % 2) === 0;
    for (let fi = 0; fi < c.floors; fi++) { const fl = horizontalFloor(fi, assigned[fi], c, foot, cw, ratio, entryLeft, entryW, rng); if (!fl) return null; floors.push(fl); }
    const stairHall = floors[0].rooms.find(r => r.name === 'Entry Hall'); corridorX = stairHall ? stairHall.x : foot.x; corridorW = entryW;
  }
  const layout: Layout = {
    plotW: c.plotW, plotD: c.plotD, foot, corridorX, CW: corridorW, floors, partitions: true,
    planSource: 'procedural', planSeed: seed, planCandidates: 0,
    planConcept: vertical ? 'Seeded split-hall plan with direct room circulation.' : 'Seeded cross-hall plan with a dedicated entry and stair core.'
  };
  const validation = validateLayout(layout, c);
  const quality = candidateQuality(layout, program, rng);
  return { layout, validation, quality };
}

function legacyProcedural(c: Spec): Layout {
  const { fw, fh, fx, fy } = sizedFootprint(c);
  const floors = [layoutGround(c, fx, fy, fw, fh)];
  let corridorX = fx + (fw - 1.25) / 2, CW = 1.25;
  for (let fi = 1; fi < c.floors; fi++) { const up = layoutUpper(c, fx, fy, fw, fh, fi); floors.push(up.floor); corridorX = up.corridorX; CW = up.CW; }
  const layout: Layout = { plotW: c.plotW, plotD: c.plotD, foot: { x: fx, y: fy, w: fw, h: fh }, corridorX, CW, floors, partitions: true, planSource: 'legacy-procedural' };
  alignStairs(layout); repair(layout, c); return layout;
}

/** Last-ditch count-preserving subdivision for genuinely over-constrained
 * briefs. It deliberately keeps every requested room and full connectivity;
 * the strict validator can still flag rooms whose minimum size is physically
 * impossible on the supplied footprint. */
function relaxedCountLayout(c: Spec, foot: Rect, seed: number): Layout {
  const rng = seededRng(mixSeed(seed, 0xFFFF)), assigned = assignProgramToFloors(roomProgram(c), c, foot, rng);
  const cw = 1.2, leftW = (foot.w - cw) / 2, hallX = foot.x + leftW, floors: Floor[] = [];
  for (let fi = 0; fi < c.floors; fi++) {
    const floor: Floor = { index: fi, rooms: [], corridor: { x: hallX, y: foot.y, w: cw, h: foot.h }, entrance: null, stairs: null };
    floor.rooms.push(mk('corridor', fi ? 'Landing' : 'Main Hall', hallX, foot.y, cw, foot.h));
    const sides: [ProgramRoom[], ProgramRoom[]] = [[], []];
    shuffled(assigned[fi], rng).sort((a, b) => b.targetArea - a.targetArea).forEach((r, i) => sides[i % 2].push(r));
    sides.forEach(side => { const gi = side.findIndex(r => r.type === 'garage'); if (gi >= 0) side.push(side.splice(gi, 1)[0]); });
    if (!sides[0].length) addOpenCorridor(floor, 'West Gallery', foot.x, foot.y, leftW, foot.h, 'right');
    else {
      let y = foot.y; sides[0].forEach((r, i) => { const h = i === sides[0].length - 1 ? foot.y + foot.h - y : foot.h / sides[0].length; addProgramRoom(floor, r, foot.x, y, leftW, h, 'right'); y += h; });
    }
    const rightW = foot.w - cw - leftW;
    if (!sides[1].length) addOpenCorridor(floor, 'East Gallery', hallX + cw, foot.y, rightW, foot.h, 'left');
    else {
      let y = foot.y; sides[1].forEach((r, i) => { const h = i === sides[1].length - 1 ? foot.y + foot.h - y : foot.h / sides[1].length; addProgramRoom(floor, r, hallX + cw, y, rightW, h, 'left'); y += h; });
    }
    if (fi === 0) floor.entrance = { x: hallX + cw / 2, y: foot.y + foot.h, width: FRONT };
    if (c.floors > 1) floor.stairs = { x: hallX + 0.1, y: foot.y + 0.25, w: cw - 0.2, h: Math.min(2.7, foot.h - 0.5) };
    applyWindows(floor.rooms, foot.x, foot.y, foot.w, foot.h); floors.push(floor);
  }
  return {
    plotW: c.plotW, plotD: c.plotD, foot, corridorX: hallX, CW: cw, floors, partitions: true,
    planSource: 'procedural-relaxed', planSeed: seed, planCandidates: 56,
    planConcept: 'Count-preserving compact plan; review highlighted minimum-size constraints.'
  };
}

export function computeLayout(c: Spec, seedOverride?: number): Layout {
  const requestedSeed = seedOverride ?? c.seed;
  const seed = Number.isFinite(requestedSeed) ? (Math.floor(requestedSeed as number) >>> 0) : (Math.floor(Math.random() * 4294967296) >>> 0);
  const { fw, fh, fx, fy } = sizedFootprint(c), foot = { x: fx, y: fy, w: fw, h: fh };
  const attempts = 72, valid: Candidate[] = [];
  let bestAny: Candidate | null = null;
  for (let i = 0; i < attempts; i++) {
    const cand = makeCandidate(c, foot, seed, i);
    if (!cand) continue;
    if (!bestAny || cand.validation.score + cand.quality * 0.05 > bestAny.validation.score + bestAny.quality * 0.05) bestAny = cand;
    if (cand.validation.ok) valid.push(cand);
  }
  if (valid.length) {
    valid.sort((a, b) => b.quality - a.quality);
    const chosen = valid[0].layout;
    chosen.planScore = Math.round(valid[0].quality * 10) / 10;
    chosen.planCandidates = attempts;
    return chosen;
  }

  if (bestAny) {
    bestAny.layout.planScore = Math.round(bestAny.quality * 10) / 10; bestAny.layout.planCandidates = attempts;
    return bestAny.layout;
  }
  const relaxed = relaxedCountLayout(c, foot, seed); relaxed.planCandidates = attempts; relaxed.planScore = validateLayout(relaxed, c).score;
  return relaxed;
}

const VALID_TYPES: Record<string, 1> = { living: 1, bedroom: 1, kitchen: 1, bathroom: 1, dining: 1, garage: 1, corridor: 1, room: 1 };

/* Convert an untrusted AI plan into a layout + a validation report (never throws). */
export function fromAIReport(raw: RawPlan, c: Spec): AIReport {
  if (!raw || !Array.isArray(raw.floors) || !raw.floors.length) return { layout: null, validation: { ok: false, score: 0, issues: ['no floors'] }, coverage: 0 };
  if (raw.floors.length !== c.floors) return { layout: null, validation: { ok: false, score: 0, issues: ['floor count: expected ' + c.floors + ', got ' + raw.floors.length] }, coverage: 0 };
  const { fw, fh, fx, fy } = sizedFootprint(c);
  const floors: Floor[] = [];
  let corridorX = fx + (fw - 1.25) / 2, CW = 1.25;
  const finite = (v: unknown, fallback = Number.NaN): number => { const n = Number(v); return Number.isFinite(n) ? n : fallback; };

  for (let fi = 0; fi < raw.floors.length; fi++) {
    const src = raw.floors[fi];
    const floor: Floor = { index: fi, rooms: [], corridor: null, entrance: null, stairs: null };
    (src.rooms || []).forEach(r => {
      if (!r.type || !VALID_TYPES[r.type]) return;
      const x = fx + finite(r.x), y = fy + finite(r.y);
      const w = finite(r.w), h = finite(r.h);
      const rm = mk(r.type as RoomType, r.name || r.type, x, y, w, h);
      if (r.door && r.door.side && ['left', 'right', 'top', 'bottom'].includes(r.door.side)) {
        const dp = finite(r.door.pos, 0);
        let pos: number;
        if (r.door.side === 'left' || r.door.side === 'right') pos = dp <= h + 0.01 ? y + clamp(dp, 0.3, h - 0.3) : dp;
        else pos = dp <= w + 0.01 ? x + clamp(dp, 0.3, w - 0.3) : dp;
        setDoor(rm, r.door.side as Side, pos, r.door.width);
      }
      floor.rooms.push(rm);
    });
    if (src.corridor) {
      floor.corridor = { x: fx + finite(src.corridor.x, 0), y: fy + finite(src.corridor.y, 0), w: finite(src.corridor.w, 1.2), h: finite(src.corridor.h, fh) };
      corridorX = floor.corridor.x; CW = floor.corridor.w;
    }
    else {
      const cr = floor.rooms.find(r => r.type === 'corridor');
      if (cr) { floor.corridor = { x: cr.x, y: cr.y, w: cr.w, h: cr.h }; corridorX = cr.x; CW = cr.w; }
    }
    if (src.entrance) floor.entrance = { x: fx + finite(src.entrance.x, fw / 2), y: fy + finite(src.entrance.y, fh), width: finite(src.entrance.width, FRONT) };
    if (src.stairs) floor.stairs = { x: fx + finite(src.stairs.x, 0), y: fy + finite(src.stairs.y, 0), w: finite(src.stairs.w, 1.5), h: finite(src.stairs.h, 2.5) };
    applyWindows(floor.rooms, fx, fy, fw, fh);
    if (floor.rooms.length) floors.push(floor);
  }
  if (floors.length !== c.floors) return { layout: null, validation: { ok: false, score: 0, issues: ['floor count: expected ' + c.floors + ', got ' + floors.length] }, coverage: 0 };
  // Ground floor must have an entrance on the front edge
  if (!floors[0].entrance) floors[0].entrance = { x: fx + fw / 2, y: fy + fh, width: FRONT };
  const layout: Layout = {
    plotW: c.plotW, plotD: c.plotD, foot: { x: fx, y: fy, w: fw, h: fh },
    corridorX, CW, floors, partitions: true,
    planSource: 'ai', planConcept: raw.concept || '', planInspiration: raw.inspiration || ''
  };
  repair(layout, c);
  const validation = validateLayout(layout, c);
  return { layout, validation, coverage: coverage(layout) };
}

export function fromAI(raw: RawPlan, c: Spec): Layout | null {
  const rep = fromAIReport(raw, c);
  return rep.validation.ok ? rep.layout : null;
}

export const HouseLayout = { computeLayout, fromAI, fromAIReport, inferSpecFromPrompt, validateLayout, repair, coverage, MIN, MIN_COVERAGE };
export default HouseLayout;
