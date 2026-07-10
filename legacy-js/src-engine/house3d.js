/* ForthHome 3D — walkable house description built from HouseLayout (ESM, pure data).
 * describeHouse() has no Three.js dependency (Node-testable). viewer.js renders it.
 * Plan coords (m, origin top-left, y=down) map to world (x, z=y). */

export const WALLH = 2.8, SLAB = 0.12, WT = 0.1, DOORH = 2.05, SILL = 0.9, WINH = 1.25, EYE = 1.6, PR = 0.3;

export const STYLES = {
  modern:      { wall:'#ece9e2', ext:'#d8d4cb', extTex:'plaster', wood:'#c8a06a', tile:'#e3e6e8', carpet:'#d6cdbe', concrete:'#9a9a98', roof:'#33373e', roofTex:'membrane', trim:'#2e333b', roofType:'flat' },
  traditional: { wall:'#efe6d4', ext:'#b06a40', extTex:'brick', wood:'#a9763f', tile:'#d8dccf', carpet:'#c8b79a', concrete:'#9a9590', roof:'#7a4326', roofTex:'shingle', trim:'#5a3a22', roofType:'pitch' },
  minimalist:  { wall:'#ececea', ext:'#e3e3e1', extTex:'plaster', wood:'#d7d6d2', tile:'#e4e4e2', carpet:'#d2cfc9', concrete:'#9c9c9a', roof:'#222428', roofTex:'membrane', trim:'#2b2e33', roofType:'flat' },
  scandinavian:{ wall:'#f4f1ea', ext:'#e6ddd0', extTex:'siding', wood:'#e3cba0', tile:'#e8eae6', carpet:'#e0d4c2', concrete:'#a6a39e', roof:'#46505a', roofTex:'shingle', trim:'#6b5a45', roofType:'pitch' },
  industrial:  { wall:'#bdb8b2', ext:'#9a6a4a', extTex:'brick', wood:'#7a6a55', tile:'#9a9794', carpet:'#8a8480', concrete:'#8a8784', roof:'#1e2024', roofTex:'membrane', trim:'#2a2d33', roofType:'flat' }
};
const FURN = { wood:'#8a5a32', woodL:'#caa06a', fab:'#5b6678', fabL:'#94a0b2', wht:'#eef0f2', drk:'#2a2e35', met:'#9aa0a8', black:'#1f2329', green:'#4f7a4a', steel:'#b8bdc4', rug:'#6d7f95', lamp:'#ffe9c0', glassc:'#cfe6f2' };
function floorKind(t){ return (t==='kitchen'||t==='bathroom')?'tile':t==='garage'?'concrete':t==='bedroom'?'carpet':'wood'; }

export function describeHouse(L, cfg) {
  const P = STYLES[cfg.style] || STYLES.modern;
  const items = [], collision = [], pw = cfg.plotW, pd = cfg.plotD;
  const WX = x => x - pw / 2, WZ = y => y - pd / 2;
  function box(t, x, y, z, w, h, d, color, tex, fl, ry, geo, slot) { items.push({ t, x, y, z, w, h, d, color, tex: tex || null, floor: (fl == null ? -1 : fl), ry: ry || 0, geo: geo || 'box', slot: slot || null }); }
  function col(fl, a, b, c, d) { collision.push({ floor: fl, minX: Math.min(a, b), maxX: Math.max(a, b), minZ: Math.min(c, d), maxZ: Math.max(c, d) }); }

  // ground, foundation slab, plinth band, path
  const yard = 10, gw = pw + yard, gd = pd + yard;
  box('ground', 0, -0.06, 0, gw, 0.12, gd, '#ffffff', 'grass', -1);
  box('slabwall', 0, -0.2, 0, L.foot.w + 0.7, 0.3, L.foot.h + 0.7, '#8f8a82', 'concrete', -1);
  const F0 = L.foot, pl = 0.22;
  box('plinth', 0, pl / 2, WZ(F0.y + F0.h) + 0.12, F0.w + 0.36, pl, 0.24, '#7d786f', 'concrete', -1);
  box('plinth', 0, pl / 2, WZ(F0.y) - 0.12, F0.w + 0.36, pl, 0.24, '#7d786f', 'concrete', -1);
  box('plinth', WX(F0.x) - 0.12, pl / 2, 0, 0.24, pl, F0.h + 0.36, '#7d786f', 'concrete', -1);
  box('plinth', WX(F0.x + F0.w) + 0.12, pl / 2, 0, 0.24, pl, F0.h + 0.36, '#7d786f', 'concrete', -1);
  box('path', 0, 0.02, WZ(F0.y + F0.h) + 1.6, 2.0, 0.08, 3.0, '#c4c0b6', 'concrete', -1);

  function emitSpan(fl, orient, fixed, a, b, y0, y1, kind, color, collide, tex) {
    const len = b - a; if (len < 0.02) return; const h = y1 - y0, cy = y0 + h / 2, cc = (a + b) / 2;
    if (orient === 'v') { box(kind === 'glass' ? 'glass' : 'wall', fixed, cy, cc, WT, h, len, color, tex, fl); if (collide) col(fl, fixed - WT / 2, fixed + WT / 2, a, b); }
    else { box(kind === 'glass' ? 'glass' : 'wall', cc, cy, fixed, len, h, WT, color, tex, fl); if (collide) col(fl, a, b, fixed - WT / 2, fixed + WT / 2); }
  }
  function frame(fl, orient, fixed, a, b, y0, y1) {
    const t = 0.07, tr = P.trim;
    function fb(ca, cb, yy0, yy1) { const ln = cb - ca, hh = yy1 - yy0; if (ln < 0.01 || hh < 0.01) return;
      if (orient === 'v') box('trim', fixed, yy0 + hh / 2, (ca + cb) / 2, t, hh, ln, tr, null, fl);
      else box('trim', (ca + cb) / 2, yy0 + hh / 2, fixed, ln, hh, t, tr, null, fl); }
    fb(a - 0.03, a + 0.03, y0, y1); fb(b - 0.03, b + 0.03, y0, y1);
    fb(a, b, y0 - 0.03, y0 + 0.03); fb(a, b, y1 - 0.03, y1 + 0.03);
    const mc = (a + b) / 2; fb(mc - 0.02, mc + 0.02, y0, y1);
  }
  function wall(fl, orient, fixed, from, to, openings, yBase, wtex, wcolor) {
    wtex = wtex || 'plaster'; wcolor = wcolor || P.wall;
    openings = (openings || []).slice().sort((p, q) => p.c - q.c);
    let cursor = from;
    for (let i = 0; i < openings.length; i++) {
      const o = openings[i], a = o.c - o.w / 2, b = o.c + o.w / 2;
      emitSpan(fl, orient, fixed, cursor, a, yBase, yBase + WALLH, 'wall', wcolor, true, wtex);
      if (o.kind === 'door') { emitSpan(fl, orient, fixed, a, b, yBase + DOORH, yBase + WALLH, 'wall', wcolor, false, wtex); }
      else { emitSpan(fl, orient, fixed, a, b, yBase, yBase + SILL, 'wall', wcolor, true, wtex);
        emitSpan(fl, orient, fixed, a, b, yBase + SILL + WINH, yBase + WALLH, 'wall', wcolor, true, wtex);
        emitSpan(fl, orient, fixed, a, b, yBase + SILL, yBase + SILL + WINH, 'glass', '#bfe0f5', true, null);
        frame(fl, orient, fixed, a, b, yBase + SILL, yBase + SILL + WINH); }
      cursor = b;
    }
    emitSpan(fl, orient, fixed, cursor, to, yBase, yBase + WALLH, 'wall', wcolor, true, wtex);
  }

  function doorOpenings(rm, side, z0, z1, x0, x1) {
    const o = []; if (!rm.door || rm.door.side !== side) return o;
    if (side === 'left' || side === 'right') { if (rm.door.pos >= z0 - 0.05 && rm.door.pos <= z1 + 0.05) o.push({ c: WZ(rm.door.pos), w: rm.door.width, kind: 'door' }); }
    else { if (rm.door.pos >= x0 - 0.05 && rm.door.pos <= x1 + 0.05) o.push({ c: WX(rm.door.pos), w: rm.door.width, kind: 'door' }); }
    return o;
  }
  function isOpenPlan(A, B) { return (A.type === 'living' && B.type === 'corridor' && B.name === 'Hall') || (B.type === 'living' && A.type === 'corridor' && A.name === 'Hall'); }
  function buildPartitions(rooms, fi, yB) {
    const EPS2 = 0.06;
    for (let i = 0; i < rooms.length; i++) for (let j = i + 1; j < rooms.length; j++) {
      const A = rooms[i], B = rooms[j]; if (isOpenPlan(A, B)) continue;
      let z0, z1, x0, x1, ops;
      if (Math.abs(A.x + A.w - B.x) < EPS2) { z0 = Math.max(A.y, B.y); z1 = Math.min(A.y + A.h, B.y + B.h);
        if (z1 - z0 > 0.35) { ops = doorOpenings(A, 'right', z0, z1).concat(doorOpenings(B, 'left', z0, z1)); wall(fi, 'v', WX(A.x + A.w), WZ(z0), WZ(z1), ops, yB); } }
      if (Math.abs(A.x - (B.x + B.w)) < EPS2) { z0 = Math.max(A.y, B.y); z1 = Math.min(A.y + A.h, B.y + B.h);
        if (z1 - z0 > 0.35) { ops = doorOpenings(A, 'left', z0, z1).concat(doorOpenings(B, 'right', z0, z1)); wall(fi, 'v', WX(A.x), WZ(z0), WZ(z1), ops, yB); } }
      if (Math.abs(A.y + A.h - B.y) < EPS2) { x0 = Math.max(A.x, B.x); x1 = Math.min(A.x + A.w, B.x + B.w);
        if (x1 - x0 > 0.35) { ops = doorOpenings(A, 'bottom', 0, 0, x0, x1).concat(doorOpenings(B, 'top', 0, 0, x0, x1)); wall(fi, 'h', WZ(A.y + A.h), WX(x0), WX(x1), ops, yB); } }
      if (Math.abs(A.y - (B.y + B.h)) < EPS2) { x0 = Math.max(A.x, B.x); x1 = Math.min(A.x + A.w, B.x + B.w);
        if (x1 - x0 > 0.35) { ops = doorOpenings(A, 'top', 0, 0, x0, x1).concat(doorOpenings(B, 'bottom', 0, 0, x0, x1)); wall(fi, 'h', WZ(A.y), WX(x0), WX(x1), ops, yB); } }
    }
  }

  for (let fi = 0; fi < L.floors.length; fi++) {
    const fl = L.floors[fi], yB = fi * (WALLH + SLAB), F = L.foot;
    fl.rooms.forEach(rm => {
      const k = rm.type === 'corridor' ? 'wood' : floorKind(rm.type);
      box('floor', WX(rm.x + rm.w / 2), yB - SLAB / 2, WZ(rm.y + rm.h / 2), rm.w, SLAB, rm.h, P[k], k, fi);
      if (rm.type !== 'corridor') { furnish(rm, yB, fi); lamp(rm, yB, fi); decor(rm, yB, fi); }
      else lamp(rm, yB, fi);
    });
    box('ceil', 0, yB + WALLH + SLAB / 2, 0, F.w, SLAB, F.h, '#f4f4f2', null, fi);

    const ow = { front: [], back: [], left: [], right: [] };
    fl.rooms.forEach(rm => rm.windows.forEach(w => {
      if (w.side === 'bottom') ow.front.push({ c: WX(w.pos), w: w.len, kind: 'window' });
      else if (w.side === 'top') ow.back.push({ c: WX(w.pos), w: w.len, kind: 'window' });
      else if (w.side === 'left') ow.left.push({ c: WZ(w.pos), w: w.len, kind: 'window' });
      else if (w.side === 'right') ow.right.push({ c: WZ(w.pos), w: w.len, kind: 'window' });
    }));
    if (fl.entrance) ow.front.push({ c: WX(fl.entrance.x), w: fl.entrance.width, kind: 'door' });
    wall(fi, 'h', WZ(F.y + F.h), WX(F.x), WX(F.x + F.w), ow.front, yB, P.extTex, P.ext);
    wall(fi, 'h', WZ(F.y), WX(F.x), WX(F.x + F.w), ow.back, yB, P.extTex, P.ext);
    wall(fi, 'v', WX(F.x), WZ(F.y), WZ(F.y + F.h), ow.left, yB, P.extTex, P.ext);
    wall(fi, 'v', WX(F.x + F.w), WZ(F.y), WZ(F.y + F.h), ow.right, yB, P.extTex, P.ext);

    if (fi === 0 && fl.entrance) { // entrance frame + canopy + steps
      const ex = WX(fl.entrance.x), ez = WZ(F.y + F.h), ew = fl.entrance.width;
      box('trim', ex - ew / 2, DOORH / 2, ez, 0.12, DOORH, 0.16, P.trim, null, 0);
      box('trim', ex + ew / 2, DOORH / 2, ez, 0.12, DOORH, 0.16, P.trim, null, 0);
      box('trim', ex, DOORH + 0.06, ez, ew + 0.24, 0.12, 0.16, P.trim, null, 0);
      box('door', ex - ew * 0.02, DOORH / 2, ez + 0.02, ew - 0.16, DOORH - 0.06, 0.06, '#6a4a32', null, 0);
      box('roof', ex, DOORH + 0.34, ez + 0.55, ew + 1.0, 0.12, 1.2, P.trim, null, -1);
      box('furn', ex, 0.12, ez + 0.55, ew + 0.6, 0.16, 0.5, '#b8b3a8', 'concrete', -1);
    }

    if (L.partitions) buildPartitions(fl.rooms, fi, yB);
    if (fl.stairs && fi < L.floors.length - 1) { const st = fl.stairs, n = 9, sh = (WALLH + SLAB) / n;
      for (let s = 0; s < n; s++) box('furn', WX(st.x + st.w / 2), yB + sh / 2 + s * sh, WZ(st.y + 0.35 + s * (st.h - 0.4) / n), st.w - 0.2, sh, (st.h - 0.4) / n + 0.04, FURN.woodL, 'wood', fi); }
  }

  // roof with eaves + fascia
  const yTop = L.floors.length * (WALLH + SLAB), F2 = L.foot, ov = 0.6;
  if (P.roofType === 'pitch') {
    items.push({ t: 'roofpitch', x: 0, y: yTop, z: 0, w: F2.w + 2 * ov, h: Math.min(F2.w, F2.h) * 0.36, d: F2.h + 2 * ov, color: P.roof, tex: P.roofTex, floor: -1, ry: 0, geo: 'box', slot: null });
    box('trim', 0, yTop - 0.04, WZ(F2.y) - ov, F2.w + 2 * ov, 0.16, 0.12, P.trim, null, -1);
    box('trim', 0, yTop - 0.04, WZ(F2.y + F2.h) + ov, F2.w + 2 * ov, 0.16, 0.12, P.trim, null, -1);
  } else {
    box('roof', 0, yTop + 0.13, 0, F2.w + 2 * ov, 0.26, F2.h + 2 * ov, P.roof, P.roofTex, -1);
    const t = 0.18, h = 0.5, ph = F2.w / 2 + ov, pd2 = F2.h / 2 + ov;
    box('trim', 0, yTop + 0.3 + h / 2, pd2, F2.w + 2 * ov, h, t, P.trim, null, -1);
    box('trim', 0, yTop + 0.3 + h / 2, -pd2, F2.w + 2 * ov, h, t, P.trim, null, -1);
    box('trim', ph, yTop + 0.3 + h / 2, 0, t, h, F2.h + 2 * ov, P.trim, null, -1);
    box('trim', -ph, yTop + 0.3 + h / 2, 0, t, h, F2.h + 2 * ov, P.trim, null, -1);
  }

  // landscaping: trees, hedge, shrubs, driveway to the garage
  [[-(gw / 2) + 2.4, -(gd / 2) + 2.4], [gw / 2 - 2.4, -(gd / 2) + 2.6], [-(gw / 2) + 2.6, gd / 2 - 2.6], [gw / 2 - 2.4, gd / 2 - 3.0]].forEach(p => {
    items.push({ t: 'tree', x: p[0], y: 0, z: p[1], w: 1.9, h: 4.6, d: 1.9, color: '#3f6b3a', tex: null, floor: -1, ry: Math.random() * Math.PI, geo: 'box', slot: null });
  });
  const hgw = pw + yard - 1.4, hgd = pd + yard - 1.4, hh = 0.7, hts = 0.32;
  box('hedge', 0, hh / 2, -hgd / 2, hgw, hh, hts, '#43743f', null, -1); box('hedge', 0, hh / 2, hgd / 2, hgw, hh, hts, '#43743f', null, -1);
  box('hedge', -hgw / 2, hh / 2, 0, hts, hh, hgd, '#43743f', null, -1); box('hedge', hgw / 2, hh / 2, 0, hts, hh, hgd, '#43743f', null, -1);
  for (let bi = 0; bi < 4; bi++) box('shrub', WX(F0.x) + 1.0 + bi * (F0.w / 4), 0.32, WZ(F0.y + F0.h) + 0.7, 0.55, 0.5, 0.55, '#4f8048', null, -1);
  const garageRoom = L.floors[0].rooms.find(r => r.type === 'garage');
  if (garageRoom) {
    const dx = WX(garageRoom.x + garageRoom.w / 2);
    const dz0 = WZ(F0.y + F0.h), dz1 = gd / 2;
    box('path', dx, 0.015, (dz0 + dz1) / 2, Math.min(3.2, garageRoom.w), 0.07, dz1 - dz0, '#b3aea6', 'concrete', -1);
  }
  if (P.roofType === 'pitch') { const ch = Math.min(F2.w, F2.h) * 0.36; box('furn', WX(F0.x) + F0.w * 0.72, yTop + ch * 0.55, WZ(F0.y) + F0.h * 0.3, 0.7, 1.5, 0.7, '#6e4636', 'brick', -1); }

  const e0 = L.floors[0].entrance;
  return { items, collision, floors: L.floors.length, wallH: WALLH, slab: SLAB, eye: EYE, pr: PR,
    spawn: { x: WX(e0 ? e0.x : pw / 2), z: WZ(F2.y + F2.h) + 3.0 }, plotW: pw, plotD: pd };

  function lamp(rm, yB, fi) { box('lamp', WX(rm.x + rm.w / 2), yB + WALLH - 0.12, WZ(rm.y + rm.h / 2), 0.34, 0.1, 0.34, FURN.lamp, null, fi); }
  function decor(rm, yB, fi) { const cx = WX(rm.x + rm.w / 2), cz = WZ(rm.y + rm.h / 2), w = rm.w, d = rm.h; if (w < 1.6 || d < 1.6) return;
    function B(bw, bh, bd, color, ox, oz, oy, tex) { box('furn', cx + ox, yB + (oy == null ? bh / 2 : oy), cz + oz, bw, bh, bd, color, tex || null, fi); }
    if (rm.type === 'living' || rm.type === 'bedroom' || rm.type === 'dining') { const lx = -w / 2 + 0.35, lz = -d / 2 + 0.35;
      B(0.08, 1.5, 0.08, '#7a6a52', lx, lz, 0.75); box('lamp', cx + lx, yB + 1.55, cz + lz, 0.32, 0.18, 0.32, FURN.lamp, null, fi);
      const px = w / 2 - 0.45, pz = -d / 2 + 0.45; B(0.32, 0.3, 0.32, '#9c6b3f', px, pz, 0.15); B(0.46, 1.1, 0.46, '#3f7a48', px, pz, 0.75); }
    if (rm.type === 'dining') { box('lamp', cx, yB + WALLH - 0.5, cz, 0.5, 0.18, 0.5, FURN.lamp, null, fi); B(0.04, 0.34, 0.04, '#444', 0, 0, WALLH - 0.66); }
    if (rm.type === 'kitchen') { B(0.7, 0.4, 0.5, '#cacfd4', -w * 0.22, -d / 2 + 0.4, 1.65); }
    if (rm.type === 'bathroom') { B(0.6, 0.06, 0.12, '#e8e8e8', w / 2 - 0.4, 0, 1.3); } }

  function furnish(rm, yB, fi) {
    const cx = WX(rm.x + rm.w / 2), cz = WZ(rm.y + rm.h / 2), w = rm.w, d = rm.h, cl = 0.18, rid = fi + '_' + Math.round(Math.abs(rm.x * 7 + rm.y * 13));
    function P3(bw, bh, bd, color, ox, oz, oy, tex, ry, slot) { box('furn', cx + ox, yB + (oy == null ? bh / 2 : oy), cz + oz, bw, bh, bd, color, tex || null, fi, ry || 0, 'box', slot || null); }
    function CY(dia, bh, color, ox, oz, oy, geo, slot) { box('furn', cx + ox, yB + (oy == null ? bh / 2 : oy), cz + oz, dia, bh, dia, color, null, fi, 0, geo || 'cyl', slot || null); }
    function MS(id, model, ox, oz, mw, mh, md, ry) { items.push({ t: 'modelslot', slot: id, model, x: cx + ox, y: yB + mh / 2, z: cz + oz, w: mw, h: mh, d: md, color: '#ffffff', tex: null, floor: fi, ry: ry || 0, geo: 'box' }); }
    function rug(rw, rd, color) { box('furn', cx, yB + 0.012, cz, rw, 0.02, rd, color, null, fi); }
    const backZ = id => -d / 2 + id / 2 + cl;
    const frontZ = id => d / 2 - id / 2 - cl;
    const leftX = iw => -w / 2 + iw / 2 + cl;
    const rightX = iw => w / 2 - iw / 2 - cl;
    if (w < 1.3 || d < 1.3) { if (rm.type !== 'bathroom') return; }
    switch (rm.type) {
      case 'bedroom': {
        const bw = Math.min(1.7, w * 0.62), bl = Math.min(2.1, d * 0.6), bz = backZ(bl), bs = 'bed' + rid;
        rug(Math.min(w - 0.5, bw + 1.2), Math.min(d - 0.5, bl + 0.8), FURN.rug);
        P3(bw, 0.4, bl, FURN.wood, 0, bz, 0.2, 'wood', 0, bs);
        P3(bw - 0.1, 0.16, bl * 0.7, FURN.wht, 0, bz + 0.12, 0.5, null, 0, bs);
        P3(bw * 0.4, 0.14, 0.34, FURN.fabL, -bw * 0.24, -d / 2 + 0.4, 0.62, null, 0, bs); P3(bw * 0.4, 0.14, 0.34, FURN.fabL, bw * 0.24, -d / 2 + 0.4, 0.62, null, 0, bs);
        P3(bw + 0.2, 1.0, 0.1, FURN.woodL, 0, -d / 2 + cl + 0.05, 0.55, null, 0, bs);
        MS(bs, 'Bed', 0, bz, bw, 0.95, bl, 0);
        P3(0.45, 0.45, 0.4, FURN.woodL, -bw / 2 - 0.35, -d / 2 + 0.4, 0.24); P3(0.45, 0.45, 0.4, FURN.woodL, bw / 2 + 0.35, -d / 2 + 0.4, 0.24);
        const wdt = Math.min(2.0, d * 0.55), wz = frontZ(wdt) - 0.1, ws = 'wr' + rid;
        P3(wdt, 2.1, 0.58, FURN.drk, rightX(0.58), wz, 1.05, 'wood', Math.PI / 2, ws); MS(ws, 'Wardrobe', rightX(0.58), wz, 0.58, 2.1, wdt, Math.PI / 2);
        break; }
      case 'living': {
        const sw = Math.min(2.8, w * 0.62), sz = backZ(0.92), ss = 'sofa' + rid;
        rug(Math.min(w - 0.6, 3.2), Math.min(d - 0.6, 2.2), FURN.rug);
        P3(sw, 0.4, 0.92, FURN.fab, 0, sz, 0.2, null, 0, ss); P3(sw, 0.55, 0.2, FURN.fab, 0, -d / 2 + cl + 0.1, 0.48, null, 0, ss);
        P3(0.24, 0.55, 0.92, FURN.fabL, -sw / 2 - 0.12, sz, 0.3, null, 0, ss); P3(0.24, 0.55, 0.92, FURN.fabL, sw / 2 + 0.12, sz, 0.3, null, 0, ss);
        MS(ss, 'Sofa', 0, sz, sw + 0.5, 0.85, 0.95, 0);
        const ct = Math.min(1.3, sw * 0.6), cs = 'cof' + rid;
        P3(ct, 0.34, 0.6, FURN.woodL, 0, sz + 1.0, 0.17, 'wood', 0, cs); MS(cs, 'Coffee Table', 0, sz + 1.0, ct, 0.4, 0.6, 0);
        P3(Math.min(2.0, w * 0.6), 0.45, 0.42, FURN.wood, 0, frontZ(0.42), 0.22, 'wood');
        P3(Math.min(1.8, w * 0.55), 0.95, 0.06, FURN.black, 0, frontZ(0.06) - 0.02, 1.1);
        const ps = 'plt' + rid; CY(0.36, 0.42, '#9c6b3f', leftX(0.55), frontZ(0.55), 0.21, 'cyl', ps); box('furn', cx + leftX(0.55), yB + 0.85, cz + frontZ(0.55), 0.85, 0.95, 0.85, FURN.green, null, fi, 0, 'sphere', ps); MS(ps, 'Potted Plant', leftX(0.55), frontZ(0.55), 0.85, 1.35, 0.85, 0);
        break; }
      case 'kitchen': {
        const run = Math.min(w - 0.4, 3.6);
        P3(run, 0.9, 0.6, FURN.wht, 0, backZ(0.6), 0.45); P3(run, 0.05, 0.64, FURN.steel, 0, backZ(0.64), 0.92);
        P3(run, 0.7, 0.34, FURN.wood, 0, backZ(0.34), 2.05, 'wood'); P3(0.6, 0.06, 0.5, FURN.black, -run * 0.22, backZ(0.5), 0.95);
        P3(Math.min(d - 0.6, 2.6), 0.9, 0.6, FURN.wht, leftX(0.6), 0.4, 0.45, null, Math.PI / 2);
        const fs = 'frg' + rid; P3(0.78, 1.85, 0.72, FURN.met, rightX(0.72), backZ(0.72) + 0.1, 0.95, null, 0, fs); MS(fs, 'Refrigerator', rightX(0.72), backZ(0.72) + 0.1, 0.78, 1.85, 0.72, 0);
        P3(Math.min(1.7, w * 0.5), 0.9, Math.min(1.0, d * 0.4), FURN.woodL, 0, 0.2, 0.45, 'wood'); P3(Math.min(1.7, w * 0.5), 0.05, Math.min(1.0, d * 0.4), '#d9d2c4', 0, 0.2, 0.92, 'marble');
        break; }
      case 'bathroom': {
        const bts = 'tub' + rid, tos = 'toi' + rid;
        P3(Math.min(1.6, w * 0.7), 0.55, 0.74, FURN.wht, 0, backZ(0.74), 0.28, null, 0, bts); MS(bts, 'Bathtub', 0, backZ(0.74), Math.min(1.6, w * 0.7), 0.6, 0.74, 0);
        P3(0.55, 0.45, 0.42, FURN.wht, rightX(0.42), 0, 0.22, null, Math.PI / 2, tos); MS(tos, 'Toilet', rightX(0.42), 0, 0.42, 0.7, 0.55, Math.PI / 2);
        P3(0.8, 0.82, 0.5, FURN.woodL, leftX(0.5), frontZ(0.8) - 0.2, 0.41, 'wood', Math.PI / 2);
        P3(0.06, 0.7, 0.6, FURN.glassc, leftX(0.06), frontZ(0.6) - 0.2, 1.45);
        break; }
      case 'dining': {
        const tw = Math.min(2.2, w * 0.5), tl = Math.min(1.2, d * 0.45), dts = 'dtb' + rid;
        rug(Math.min(w - 0.5, tw + 1.4), Math.min(d - 0.5, tl + 1.4), FURN.rug);
        P3(tw, 0.06, tl, FURN.woodL, 0, 0, 0.75, 'wood', 0, dts);
        CY(0.08, 0.74, FURN.wood, -tw * 0.42, -tl * 0.4, 0.37); CY(0.08, 0.74, FURN.wood, tw * 0.42, -tl * 0.4, 0.37); CY(0.08, 0.74, FURN.wood, -tw * 0.42, tl * 0.4, 0.37); CY(0.08, 0.74, FURN.wood, tw * 0.42, tl * 0.4, 0.37);
        MS(dts, 'Dining Table', 0, 0, tw, 0.78, tl, 0);
        let ci = 0; for (let ai = -1; ai <= 1; ai += 2) for (let bj = -1; bj <= 1; bj += 2) { const chs = 'ch' + rid + (ci++); P3(0.42, 0.86, 0.42, FURN.wood, ai * tw * 0.34, bj * (tl / 2 + 0.28), 0.43, 'wood', 0, chs); MS(chs, 'Chair', ai * tw * 0.34, bj * (tl / 2 + 0.28), 0.48, 0.9, 0.48, bj < 0 ? 0 : Math.PI); }
        P3(Math.min(1.8, w * 0.55), 0.85, 0.45, FURN.wood, 0, backZ(0.45), 0.42, 'wood');
        break; }
      case 'garage': {
        const crs = 'car' + rid;
        P3(Math.min(1.9, w * 0.5), 0.55, Math.min(4.2, d * 0.72), '#3a4654', 0, 0, 0.5, null, 0, crs); P3(Math.min(1.65, w * 0.45), 0.5, Math.min(2.0, d * 0.34), '#222a33', 0, -d * 0.04, 1.0, null, 0, crs);
        MS(crs, 'Car', 0, 0, Math.min(1.9, w * 0.5), 1.4, Math.min(4.2, d * 0.72), 0);
        P3(Math.min(2.4, w * 0.7), 0.9, 0.4, FURN.drk, 0, backZ(0.4), 0.6, 'wood'); break; }
    }
  }
}

export const House3D = { describeHouse };
export default House3D;
