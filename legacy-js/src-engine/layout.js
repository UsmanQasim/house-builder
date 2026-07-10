/* Realistic house-layout engine (browser + Node, ESM).
 * Coordinates: metres, origin top-left, x right, y down (front/street = bottom).
 *
 * Architectural invariants enforced by validate()/repair():
 *  - rooms never overlap and stay inside the footprint
 *  - every room is reachable from the entrance / stairs via doors
 *  - rooms respect minimum dimensions per type
 *  - windows only on exterior walls
 *  - stairs occupy the same rect on every connected floor
 */
import { PlanTemplates } from './plan-templates.js';

const DOOR = 0.9, FRONT = 1.2, WIN = 1.4, EPS = 0.02;

export const MIN = {
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

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function sizedFootprint(c) {
  const margin = clamp(Math.min(c.plotW, c.plotD) * 0.05, 0.4, 1.0);
  const fw = Math.max(6, c.plotW - 2 * margin), fh = Math.max(6, c.plotD - 2 * margin);
  return { fw, fh, fx: (c.plotW - fw) / 2, fy: (c.plotD - fh) / 2 };
}
function mk(type, name, x, y, w, h) {
  w = Math.max(0.5, w); h = Math.max(0.5, h);
  return { type, name, x, y, w, h, area: w * h, door: null, windows: [] };
}
function setDoor(rm, side, pos, width) { rm.door = { side, pos, width: width || DOOR }; }

function windows(rm, fx, fy, fw, fh) {
  if (rm.type === 'corridor') return;
  rm.windows = [];
  if (Math.abs(rm.x - fx) < EPS && rm.h > 1.4) rm.windows.push({ side: 'left', pos: rm.y + rm.h / 2, len: Math.min(WIN, rm.h - 0.9) });
  if (Math.abs(rm.x + rm.w - (fx + fw)) < EPS && rm.h > 1.4) rm.windows.push({ side: 'right', pos: rm.y + rm.h / 2, len: Math.min(WIN, rm.h - 0.9) });
  if (Math.abs(rm.y - fy) < EPS && rm.w > 1.4) rm.windows.push({ side: 'top', pos: rm.x + rm.w / 2, len: Math.min(WIN, rm.w - 0.9) });
  if (Math.abs(rm.y + rm.h - (fy + fh)) < EPS && rm.w > 1.4) rm.windows.push({ side: 'bottom', pos: rm.x + rm.w / 2, len: Math.min(WIN, rm.w - 0.9) });
}
function applyWindows(rooms, fx, fy, fw, fh) { rooms.forEach(rm => windows(rm, fx, fy, fw, fh)); }

function splitHeights(total, count, firstLarger) {
  if (count <= 0) return [];
  if (count === 1) return [clamp(total, MIN.bedroom.h, total)];
  if (firstLarger) {
    const first = clamp(total * 0.36, MIN.master.h, total - MIN.bedroom.h * (count - 1));
    const rest = (total - first) / (count - 1);
    const out = [first];
    for (let i = 1; i < count; i++) out.push(clamp(rest, MIN.bedroom.h, total));
    return out;
  }
  const each = total / count, arr = [];
  for (let j = 0; j < count; j++) arr.push(clamp(each, MIN.bedroom.h, total));
  return arr;
}

function layoutPublicZone(c, floor, x, y, w, h, hallD, withStairs, footArea) {
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

  let svcY = y, svcRem = pubH, bathH = 0;
  const groundBath = c.bathrooms > 0;
  if (groundBath && pubH > MIN.kitchen.h + MIN.bathroom.h + (c.dining ? MIN.dining.h : 0)) {
    bathH = MIN.bathroom.h + 0.25;
    const bath = mk('bathroom', c.bathrooms > 1 ? 'WC' : 'Bathroom', sx, svcY, svcW, bathH);
    setDoor(bath, 'left', svcY + bathH / 2);
    floor.rooms.push(bath);
    svcY += bathH; svcRem -= bathH;
  }

  let kH, dH = 0;
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
  return { livingW, svcW };
}

function layoutBedRow(floor, names, x, y, w, h, doorSide) {
  const n = names.length;
  if (n === 0) return;
  const cols = n <= 2 ? n : (n <= 4 ? 2 : 3);
  const rows = Math.ceil(n / cols);
  let cellW = Math.max(w / cols, MIN.bedroom.w);
  let cellH = Math.max(h / rows, MIN.bedroom.h);
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

function layoutGround(c, fx, fy, fw, fh) {
  const floor = { index: 0, rooms: [], corridor: null, entrance: null, stairs: null };
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
    const bedNames = [];
    for (let i = 0; i < c.bedrooms; i++) bedNames.push(i === 0 ? 'Master Bedroom' : 'Bedroom ' + (i + 1));
    layoutBedRow(floor, bedNames, x, y, w, bedBand, 'bottom');
  } else {
    layoutPublicZone(c, floor, x, y, w, h, 1.5, c.floors > 1, fw * fh);
  }

  applyWindows(floor.rooms, fx, fy, fw, fh);
  return floor;
}

function bedsForUpperFloor(c, floorIndex) {
  if (c.floors <= 1) return 0;
  const upper = c.floors - 1;
  const base = Math.floor(c.bedrooms / upper);
  const extra = c.bedrooms % upper;
  return base + ((floorIndex - 1) < extra ? 1 : 0);
}
function bathsForUpperFloor(c, floorIndex) {
  if (c.bathrooms <= 1 || c.floors <= 1) return 0;
  const upper = c.floors - 1;
  const rem = Math.max(0, c.bathrooms - 1);
  const base = Math.floor(rem / upper);
  const extra = rem % upper;
  return base + ((floorIndex - 1) < extra ? 1 : 0);
}

function layoutUpper(c, fx, fy, fw, fh, floorIndex) {
  const floor = { index: floorIndex, rooms: [], corridor: null, entrance: null, stairs: null };
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

  // side columns run the full depth: bedrooms stacked from the back, baths fill the remainder
  const leftBedH = fh - leftBathSlots * bathH;
  const rightBedH = fh - rightBathSlots * bathH;
  const leftHs = splitHeights(leftBedH, leftN, floorIndex === 1);
  const rightHs = splitHeights(rightBedH, rightN, false);

  const footArea = fw * fh;
  const maxBed = clamp(footArea * 0.07, 11, 20);
  const maxMaster = clamp(footArea * 0.09, 14, 24);
  const names = [];
  for (let nk = 0; nk < bedsOnFloor; nk++) {
    const num = (floorIndex - 1) * 2 + nk + 1;
    names.push(floorIndex === 1 && nk === 0 ? 'Master Bedroom' : 'Bedroom ' + num);
  }
  function capBed(rm, isMaster) {
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

function placeNorm(floor, s, fx, fy, fw, fh) {
  const x = fx + s.x * fw, y = fy + s.y * fh, w = s.w * fw, h = s.h * fh;
  const rm = mk(s.type, s.name, x, y, w, h);
  if (s.door && s.door.side) {
    const pos = s.door.rel
      ? ((s.door.side === 'left' || s.door.side === 'right') ? y + s.door.pos * h : x + s.door.pos * w)
      : (+s.door.pos || x + w / 2);
    setDoor(rm, s.door.side, pos, s.door.width);
  }
  floor.rooms.push(rm);
  return rm;
}

export function buildFromTemplate(c, templateId) {
  const PT = PlanTemplates;
  const tpl = PT.CATALOG[templateId] || PT.CATALOG[PT.pickTemplate(c)];
  if (!tpl) return null;
  const { fw, fh, fx, fy } = sizedFootprint(c);
  if (tpl.floors.length !== c.floors) return null;

  const floors = [];
  let corridorX = fx + fw / 2 - 0.6, CW = 1.25;
  for (let fi = 0; fi < tpl.floors.length; fi++) {
    const src = tpl.floors[fi];
    const floor = { index: fi, rooms: [], corridor: null, entrance: null, stairs: null };
    let bedCount = 0, bathCount = 0;
    src.rooms.forEach(s => {
      if (s.type === 'bedroom') { bedCount++; if (bedCount > c.bedrooms) return; s = Object.assign({}, s, { name: bedCount === 1 ? 'Master Bedroom' : 'Bedroom ' + bedCount }); }
      if (s.type === 'bathroom') { bathCount++; if (bathCount > c.bathrooms) return; }
      if (s.type === 'kitchen' && c.kitchens < 1) return;
      if (s.type === 'dining' && !c.dining) return;
      if (s.type === 'garage' && !c.garage) return;
      placeNorm(floor, s, fx, fy, fw, fh);
    });
    if (src.corridor) {
      const cr = src.corridor;
      floor.corridor = { x: fx + cr.x * fw, y: fy + cr.y * fh, w: cr.w * fw, h: cr.h * fh };
      corridorX = floor.corridor.x; CW = floor.corridor.w;
    }
    if (src.entrance) {
      const en = src.entrance;
      floor.entrance = { x: fx + (en.rel ? en.x * fw : en.x), y: fy + (en.rel ? fh : en.y), width: en.width || FRONT };
    }
    if (src.stairs && fi < c.floors - 1) {
      const st = src.stairs;
      floor.stairs = { x: fx + st.x * fw, y: fy + st.y * fh, w: st.w * fw, h: st.h * fh };
    }
    applyWindows(floor.rooms, fx, fy, fw, fh);
    floors.push(floor);
  }
  const layout = {
    plotW: c.plotW, plotD: c.plotD, foot: { x: fx, y: fy, w: fw, h: fh },
    corridorX, CW, floors, partitions: true,
    planSource: 'template', templateId, planConcept: tpl.concept || ''
  };
  repair(layout, c);
  return layout;
}

/* ----------------------------- validity engine ----------------------------- */

function overlaps(a, b) {
  return a.x < b.x + b.w - EPS && a.x + a.w > b.x + EPS && a.y < b.y + b.h - EPS && a.y + a.h > b.y + EPS;
}
function sharedSpan(A, B) {
  // Returns { side (of A facing B), from, to } if A and B share a wall segment.
  const T = 0.08;
  let lo, hi;
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
function opposite(side) { return side === 'left' ? 'right' : side === 'right' ? 'left' : side === 'top' ? 'bottom' : 'top'; }
function doorConnects(A, B) {
  const s = sharedSpan(A, B);
  if (!s) return false;
  // open plan: living <-> 'Hall' connector, corridor <-> corridor are passable without a door
  const openA = A.type === 'corridor', openB = B.type === 'corridor';
  if ((openA && openB) ||
      (A.type === 'living' && openB && B.name === 'Hall') ||
      (B.type === 'living' && openA && A.name === 'Hall')) return true;
  const inSpan = (d) => d && d.pos >= s.from - 0.15 && d.pos <= s.to + 0.15;
  if (A.door && A.door.side === s.side && inSpan(A.door)) return true;
  if (B.door && B.door.side === opposite(s.side) && inSpan(B.door)) return true;
  return false;
}

function reachable(floor, foot, isGround) {
  const rooms = floor.rooms;
  const seen = new Array(rooms.length).fill(false);
  const queue = [];
  rooms.forEach((r, i) => {
    if (r.type === 'corridor') { seen[i] = true; queue.push(i); }
    if (isGround && floor.entrance &&
        floor.entrance.x >= r.x - 0.1 && floor.entrance.x <= r.x + r.w + 0.1 &&
        Math.abs(r.y + r.h - (foot.y + foot.h)) < 0.1) { if (!seen[i]) { seen[i] = true; queue.push(i); } }
  });
  if (!queue.length && rooms.length) { seen[0] = true; queue.push(0); }
  while (queue.length) {
    const i = queue.shift();
    for (let j = 0; j < rooms.length; j++) {
      if (seen[j]) continue;
      if (doorConnects(rooms[i], rooms[j])) { seen[j] = true; queue.push(j); }
    }
  }
  return rooms.map((r, i) => ({ room: r, ok: seen[i] }));
}

function ensureDoors(floor, foot, isGround) {
  // Give every unreachable room a door toward an adjacent reachable room (prefer corridors).
  for (let pass = 0; pass < 4; pass++) {
    const state = reachable(floor, foot, isGround);
    const bad = state.filter(s => !s.ok);
    if (!bad.length) return true;
    let fixed = false;
    bad.forEach(({ room }) => {
      const candidates = state.filter(s => s.ok).map(s => s.room)
        .map(o => ({ o, span: sharedSpan(room, o) })).filter(c => c.span)
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

function clampRooms(floor, foot) {
  floor.rooms.forEach(r => {
    r.x = clamp(r.x, foot.x, foot.x + foot.w - 0.5);
    r.y = clamp(r.y, foot.y, foot.y + foot.h - 0.5);
    r.w = clamp(r.w, 0.5, foot.x + foot.w - r.x);
    r.h = clamp(r.h, 0.5, foot.y + foot.h - r.y);
    r.area = r.w * r.h;
  });
}

function fixOverlaps(floor) {
  // Trim the smaller room along the axis of least intrusion; corridors named 'Hall' are open connectors.
  const rooms = floor.rooms;
  for (let a = 0; a < rooms.length; a++) {
    for (let b = a + 1; b < rooms.length; b++) {
      const A = rooms[a], B = rooms[b];
      if (A.name === 'Hall' || B.name === 'Hall') continue;
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

function alignStairs(layout) {
  const floors = layout.floors;
  if (floors.length < 2) { if (floors[0]) floors[0].stairs = null; return; }
  // Canonical stair rect: first upper floor's (sits in its landing), else ground's.
  const rect = (floors[1] && floors[1].stairs) || floors[0].stairs;
  if (!rect) return;
  for (let i = 0; i < floors.length; i++) {
    floors[i].stairs = { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
  }
}

export function repair(layout, c) {
  const foot = layout.foot;
  layout.floors.forEach((fl, i) => {
    clampRooms(fl, foot);
    fixOverlaps(fl, foot);
    clampRooms(fl, foot);
    applyWindows(fl.rooms, foot.x, foot.y, foot.w, foot.h);
    ensureDoors(fl, foot, i === 0);
  });
  alignStairs(layout);
  return layout;
}

export function validateLayout(layout, c) {
  if (!layout || !layout.floors || layout.floors.length !== c.floors) return { ok: false, score: 0, issues: ['floor count'] };
  const issues = [], f = layout.foot;
  let score = 100;
  layout.floors.forEach((fl, i) => {
    for (let a = 0; a < fl.rooms.length; a++) {
      for (let b = a + 1; b < fl.rooms.length; b++) {
        if (fl.rooms[a].name === 'Hall' || fl.rooms[b].name === 'Hall') continue;
        if (overlaps(fl.rooms[a], fl.rooms[b])) { issues.push('overlap F' + (i + 1) + ': ' + fl.rooms[a].name + '/' + fl.rooms[b].name); score -= 25; }
      }
      const r = fl.rooms[a];
      if (r.x < f.x - EPS || r.y < f.y - EPS || r.x + r.w > f.x + f.w + EPS || r.y + r.h > f.y + f.h + EPS) {
        issues.push('out of bounds ' + r.name); score -= 15;
      }
      const lim = MIN[r.type] || MIN.room;
      if (r.type !== 'corridor' && (Math.min(r.w, r.h) < Math.min(lim.w, lim.h) * 0.6)) {
        issues.push('too small ' + r.name); score -= 5;
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
  });
  for (let i = 0; i + 1 < layout.floors.length; i++) {
    const a = layout.floors[i].stairs, b = layout.floors[i + 1].stairs;
    if (!a || !b) { issues.push('missing stairs F' + (i + 1)); score -= 15; }
    else if (Math.abs(a.x - b.x) > 0.15 || Math.abs(a.y - b.y) > 0.15) { issues.push('stairs misaligned F' + (i + 1) + '/F' + (i + 2)); score -= 15; }
  }
  return { ok: issues.length === 0 && score >= 60, score: Math.max(0, score), issues };
}

export function computeLayout(c) {
  const tid = PlanTemplates.pickTemplate(c);
  const built = buildFromTemplate(c, tid);
  if (built) return built;

  const { fw, fh, fx, fy } = sizedFootprint(c);
  const floors = [layoutGround(c, fx, fy, fw, fh)];
  let corridorX = fx + (fw - 1.25) / 2, CW = 1.25;
  for (let fi = 1; fi < c.floors; fi++) {
    const up = layoutUpper(c, fx, fy, fw, fh, fi);
    floors.push(up.floor);
    corridorX = up.corridorX;
    CW = up.CW;
  }
  const layout = { plotW: c.plotW, plotD: c.plotD, foot: { x: fx, y: fy, w: fw, h: fh }, corridorX, CW, floors, partitions: true };
  repair(layout, c);
  return layout;
}

const VALID_TYPES = { living: 1, bedroom: 1, kitchen: 1, bathroom: 1, dining: 1, garage: 1, corridor: 1, room: 1 };

export function fromAI(raw, c) {
  if (!raw || !Array.isArray(raw.floors) || !raw.floors.length) return null;
  const { fw, fh, fx, fy } = sizedFootprint(c);
  const floors = [];
  let corridorX = fx + (fw - 1.25) / 2, CW = 1.25;

  for (let fi = 0; fi < raw.floors.length && fi < c.floors; fi++) {
    const src = raw.floors[fi];
    const floor = { index: fi, rooms: [], corridor: null, entrance: null, stairs: null };
    (src.rooms || []).forEach(r => {
      if (!VALID_TYPES[r.type]) return;
      const x = fx + clamp(+r.x || 0, 0, fw - 0.5);
      const y = fy + clamp(+r.y || 0, 0, fh - 0.5);
      let w = clamp(+r.w || 2, 0.8, fw - (x - fx));
      let h = clamp(+r.h || 2, 0.8, fh - (y - fy));
      if (r.type === 'bathroom') { w = clamp(w, MIN.bathroom.w, fw); h = clamp(h, MIN.bathroom.h, fh); }
      const rm = mk(r.type, r.name || r.type, x, y, w, h);
      if (r.door && r.door.side) {
        const dp = +r.door.pos || 0;
        let pos;
        if (r.door.side === 'left' || r.door.side === 'right') pos = dp <= h + 0.01 ? y + clamp(dp, 0.3, h - 0.3) : dp;
        else pos = dp <= w + 0.01 ? x + clamp(dp, 0.3, w - 0.3) : dp;
        setDoor(rm, r.door.side, pos, r.door.width);
      }
      floor.rooms.push(rm);
    });
    if (src.corridor) {
      floor.corridor = { x: fx + (+src.corridor.x || 0), y: fy + (+src.corridor.y || 0), w: +src.corridor.w || 1.2, h: +src.corridor.h || fh };
      corridorX = floor.corridor.x; CW = floor.corridor.w;
    }
    if (src.entrance) floor.entrance = { x: fx + (+src.entrance.x || fw / 2), y: fy + (+src.entrance.y || fh), width: +src.entrance.width || FRONT };
    if (src.stairs) floor.stairs = { x: fx + (+src.stairs.x || 0), y: fy + (+src.stairs.y || 0), w: +src.stairs.w || 1.5, h: +src.stairs.h || 2.5 };
    applyWindows(floor.rooms, fx, fy, fw, fh);
    if (floor.rooms.length) floors.push(floor);
  }
  if (floors.length !== c.floors) return null;
  const layout = {
    plotW: c.plotW, plotD: c.plotD, foot: { x: fx, y: fy, w: fw, h: fh },
    corridorX, CW, floors, partitions: true,
    planSource: 'ai', planConcept: raw.concept || '', planInspiration: raw.inspiration || ''
  };
  repair(layout, c);
  const v = validateLayout(layout, c);
  if (!v.ok) return null;
  return layout;
}

export const HouseLayout = { computeLayout, buildFromTemplate, fromAI, validateLayout, repair, MIN };
export default HouseLayout;
