/* ForthHome 3D — walkable house built from the proven HouseLayout.
 * describeHouse() is PURE data (Node-testable). Viewer turns it into Three.js.
 * Plan coords (m, origin top-left, y=down) map to world (x, z=y). */
(function (global) {
'use strict';
var WALLH = 2.8, SLAB = 0.12, WT = 0.1, DOORH = 2.05, SILL = 0.9, WINH = 1.25, EYE = 1.6, PR = 0.3;

var STYLES = {
  modern:      { wall:'#ece9e2', ext:'#d8d4cb', extTex:'plaster', wood:'#c8a06a', tile:'#e3e6e8', carpet:'#d6cdbe', concrete:'#9a9a98', roof:'#33373e', roofTex:'membrane', trim:'#2e333b', roofType:'flat' },
  traditional: { wall:'#efe6d4', ext:'#b06a40', extTex:'brick', wood:'#a9763f', tile:'#d8dccf', carpet:'#c8b79a', concrete:'#9a9590', roof:'#7a4326', roofTex:'shingle', trim:'#5a3a22', roofType:'pitch' },
  minimalist:  { wall:'#ececea', ext:'#e3e3e1', extTex:'plaster', wood:'#d7d6d2', tile:'#e4e4e2', carpet:'#d2cfc9', concrete:'#9c9c9a', roof:'#222428', roofTex:'membrane', trim:'#2b2e33', roofType:'flat' },
  scandinavian:{ wall:'#f4f1ea', ext:'#e6ddd0', extTex:'siding', wood:'#e3cba0', tile:'#e8eae6', carpet:'#e0d4c2', concrete:'#a6a39e', roof:'#46505a', roofTex:'shingle', trim:'#6b5a45', roofType:'pitch' },
  industrial:  { wall:'#bdb8b2', ext:'#9a6a4a', extTex:'brick', wood:'#7a6a55', tile:'#9a9794', carpet:'#8a8480', concrete:'#8a8784', roof:'#1e2024', roofTex:'membrane', trim:'#2a2d33', roofType:'flat' }
};
var FURN = { wood:'#8a5a32', woodL:'#caa06a', fab:'#5b6678', fabL:'#94a0b2', wht:'#eef0f2', drk:'#2a2e35', met:'#9aa0a8', black:'#1f2329', green:'#4f7a4a', steel:'#b8bdc4', rug:'#6d7f95', lamp:'#ffe9c0', glassc:'#cfe6f2' };
function floorKind(t){ return (t==='kitchen'||t==='bathroom')?'tile':t==='garage'?'concrete':t==='bedroom'?'carpet':'wood'; }

function describeHouse(L, cfg) {
  var P = STYLES[cfg.style] || STYLES.modern;
  var items = [], collision = [], pw = cfg.plotW, pd = cfg.plotD;
  var WX = function (x) { return x - pw / 2; }, WZ = function (y) { return y - pd / 2; };
  function box(t, x, y, z, w, h, d, color, tex, fl, ry) { items.push({ t: t, x: x, y: y, z: z, w: w, h: h, d: d, color: color, tex: tex || null, floor: (fl == null ? -1 : fl), ry: ry || 0 }); }
  function col(fl, a, b, c, d) { collision.push({ floor: fl, minX: Math.min(a, b), maxX: Math.max(a, b), minZ: Math.min(c, d), maxZ: Math.max(c, d) }); }

  // ground, foundation slab, plinth band, path
  var yard = 10, gw = pw + yard, gd = pd + yard;
  box('ground', 0, -0.06, 0, gw, 0.12, gd, '#ffffff', 'grass', -1);
  box('slabwall', 0, -0.2, 0, L.foot.w + 0.7, 0.3, L.foot.h + 0.7, '#8f8a82', 'concrete', -1);
  var F0 = L.foot, pl = 0.22;
  box('plinth', 0, pl / 2, WZ(F0.y + F0.h) + 0.12, F0.w + 0.36, pl, 0.24, '#7d786f', 'concrete', -1);
  box('plinth', 0, pl / 2, WZ(F0.y) - 0.12, F0.w + 0.36, pl, 0.24, '#7d786f', 'concrete', -1);
  box('plinth', WX(F0.x) - 0.12, pl / 2, 0, 0.24, pl, F0.h + 0.36, '#7d786f', 'concrete', -1);
  box('plinth', WX(F0.x + F0.w) + 0.12, pl / 2, 0, 0.24, pl, F0.h + 0.36, '#7d786f', 'concrete', -1);
  box('path', 0, 0.02, WZ(F0.y + F0.h) + 1.6, 2.0, 0.08, 3.0, '#c4c0b6', 'concrete', -1);

  function emitSpan(fl, orient, fixed, a, b, y0, y1, kind, color, collide, tex) {
    var len = b - a; if (len < 0.02) return; var h = y1 - y0, cy = y0 + h / 2, cc = (a + b) / 2;
    if (orient === 'v') { box(kind === 'glass' ? 'glass' : 'wall', fixed, cy, cc, WT, h, len, color, tex, fl); if (collide) col(fl, fixed - WT / 2, fixed + WT / 2, a, b); }
    else { box(kind === 'glass' ? 'glass' : 'wall', cc, cy, fixed, len, h, WT, color, tex, fl); if (collide) col(fl, a, b, fixed - WT / 2, fixed + WT / 2); }
  }
  function frame(fl, orient, fixed, a, b, y0, y1) {
    var t = 0.07, fo = WT / 2 + 0.01, tr = P.trim;
    function fb(ca, cb, yy0, yy1) { var ln = cb - ca, hh = yy1 - yy0; if (ln < 0.01 || hh < 0.01) return;
      if (orient === 'v') box('trim', fixed, yy0 + hh / 2, (ca + cb) / 2, t, hh, ln, tr, null, fl);
      else box('trim', (ca + cb) / 2, yy0 + hh / 2, fixed, ln, hh, t, tr, null, fl); }
    fb(a - 0.03, a + 0.03, y0, y1); fb(b - 0.03, b + 0.03, y0, y1);        // jambs
    fb(a, b, y0 - 0.03, y0 + 0.03); fb(a, b, y1 - 0.03, y1 + 0.03);        // sill + head
    var mc = (a + b) / 2; fb(mc - 0.02, mc + 0.02, y0, y1);                // mullion
    void fo;
  }
  function wall(fl, orient, fixed, from, to, openings, yBase, wtex, wcolor) {
    wtex = wtex || 'plaster'; wcolor = wcolor || P.wall;
    openings = (openings || []).slice().sort(function (p, q) { return p.c - q.c; });
    var cursor = from;
    for (var i = 0; i < openings.length; i++) {
      var o = openings[i], a = o.c - o.w / 2, b = o.c + o.w / 2;
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
    var o = []; if (!rm.door || rm.door.side !== side) return o;
    if (side === 'left' || side === 'right') { if (rm.door.pos >= z0 - 0.05 && rm.door.pos <= z1 + 0.05) o.push({ c: WZ(rm.door.pos), w: rm.door.width, kind: 'door' }); }
    else { if (rm.door.pos >= x0 - 0.05 && rm.door.pos <= x1 + 0.05) o.push({ c: WX(rm.door.pos), w: rm.door.width, kind: 'door' }); }
    return o;
  }
  function isOpenPlan(A, B) { return (A.type === 'living' && B.type === 'corridor' && B.name === 'Hall') || (B.type === 'living' && A.type === 'corridor' && A.name === 'Hall'); }
  function buildPartitions(rooms, fi, yB) {
    var EPS2 = 0.06, i, j, A, B, z0, z1, x0, x1, ops;
    for (i = 0; i < rooms.length; i++) for (j = i + 1; j < rooms.length; j++) {
      A = rooms[i]; B = rooms[j]; if (isOpenPlan(A, B)) continue;
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

  for (var fi = 0; fi < L.floors.length; fi++) {
    var fl = L.floors[fi], yB = fi * (WALLH + SLAB), F = L.foot;
    fl.rooms.forEach(function (rm) {
      var k = rm.type === 'corridor' ? 'wood' : floorKind(rm.type);
      box('floor', WX(rm.x + rm.w / 2), yB - SLAB / 2, WZ(rm.y + rm.h / 2), rm.w, SLAB, rm.h, P[k], k, fi);
      if (rm.type !== 'corridor') { furnish(rm, yB, fi); lamp(rm, yB, fi); }
    });
    box('ceil', 0, yB + WALLH + SLAB / 2, 0, F.w, SLAB, F.h, '#f4f4f2', null, fi);

    var ow = { front: [], back: [], left: [], right: [] };
    fl.rooms.forEach(function (rm) { rm.windows.forEach(function (w) {
      if (w.side === 'bottom') ow.front.push({ c: WX(w.pos), w: w.len, kind: 'window' });
      else if (w.side === 'top') ow.back.push({ c: WX(w.pos), w: w.len, kind: 'window' });
      else if (w.side === 'left') ow.left.push({ c: WZ(w.pos), w: w.len, kind: 'window' });
      else if (w.side === 'right') ow.right.push({ c: WZ(w.pos), w: w.len, kind: 'window' });
    }); });
    if (fl.entrance) ow.front.push({ c: WX(fl.entrance.x), w: fl.entrance.width, kind: 'door' });
    wall(fi, 'h', WZ(F.y + F.h), WX(F.x), WX(F.x + F.w), ow.front, yB, P.extTex, P.ext);
    wall(fi, 'h', WZ(F.y), WX(F.x), WX(F.x + F.w), ow.back, yB, P.extTex, P.ext);
    wall(fi, 'v', WX(F.x), WZ(F.y), WZ(F.y + F.h), ow.left, yB, P.extTex, P.ext);
    wall(fi, 'v', WX(F.x + F.w), WZ(F.y), WZ(F.y + F.h), ow.right, yB, P.extTex, P.ext);

    if (fi === 0 && fl.entrance) { // entrance frame + canopy + steps
      var ex = WX(fl.entrance.x), ez = WZ(F.y + F.h), ew = fl.entrance.width;
      box('trim', ex - ew / 2, DOORH / 2, ez, 0.12, DOORH, 0.16, P.trim, null, 0);
      box('trim', ex + ew / 2, DOORH / 2, ez, 0.12, DOORH, 0.16, P.trim, null, 0);
      box('trim', ex, DOORH + 0.06, ez, ew + 0.24, 0.12, 0.16, P.trim, null, 0);
      box('door', ex - ew * 0.02, DOORH / 2, ez + 0.02, ew - 0.16, DOORH - 0.06, 0.06, '#6a4a32', null, 0); // leaf
      box('roof', ex, DOORH + 0.34, ez + 0.55, ew + 1.0, 0.12, 1.2, P.trim, null, -1); // canopy
      box('furn', ex, 0.12, ez + 0.55, ew + 0.6, 0.16, 0.5, '#b8b3a8', 'concrete', -1); // step
    }

    if (L.partitions) buildPartitions(fl.rooms, fi, yB);
    else if (fl.corridor) {
      var leftR = fl.rooms.filter(function (r) { return r.door && r.door.side === 'right'; }).sort(function (a, b) { return a.y - b.y; });
      var rightR = fl.rooms.filter(function (r) { return r.door && r.door.side === 'left'; }).sort(function (a, b) { return a.y - b.y; });
      wall(fi, 'v', WX(L.corridorX), WZ(F.y), WZ(F.y + F.h), leftR.map(function (r) { return { c: WZ(r.door.pos), w: r.door.width, kind: 'door' }; }), yB);
      wall(fi, 'v', WX(L.corridorX + L.CW), WZ(F.y), WZ(F.y + F.h), rightR.map(function (r) { return { c: WZ(r.door.pos), w: r.door.width, kind: 'door' }; }), yB);
      for (var i2 = 0; i2 < leftR.length - 1; i2++) wall(fi, 'h', WZ(leftR[i2].y + leftR[i2].h), WX(F.x), WX(L.corridorX), [], yB);
      for (var j2 = 0; j2 < rightR.length - 1; j2++) wall(fi, 'h', WZ(rightR[j2].y + rightR[j2].h), WX(L.corridorX + L.CW), WX(F.x + F.w), [], yB);
    }
    if (fl.stairs && fi < L.floors.length - 1) { var st = fl.stairs, n = 9, sh = (WALLH + SLAB) / n;
      for (var s = 0; s < n; s++) box('furn', WX(st.x + st.w / 2), yB + sh / 2 + s * sh, WZ(st.y + 0.35 + s * (st.h - 0.4) / n), st.w - 0.2, sh, (st.h - 0.4) / n + 0.04, FURN.woodL, 'wood', fi); }
  }

  // roof with eaves + fascia
  var yTop = L.floors.length * (WALLH + SLAB), F2 = L.foot, ov = 0.6;
  if (P.roofType === 'pitch') {
    items.push({ t: 'roofpitch', x: 0, y: yTop, z: 0, w: F2.w + 2 * ov, h: Math.min(F2.w, F2.h) * 0.36, d: F2.h + 2 * ov, color: P.roof, tex: P.roofTex, floor: -1, ry: 0 });
    box('trim', 0, yTop - 0.04, WZ(F2.y) - ov, F2.w + 2 * ov, 0.16, 0.12, P.trim, null, -1);
    box('trim', 0, yTop - 0.04, WZ(F2.y + F2.h) + ov, F2.w + 2 * ov, 0.16, 0.12, P.trim, null, -1);
  } else {
    box('roof', 0, yTop + 0.13, 0, F2.w + 2 * ov, 0.26, F2.h + 2 * ov, P.roof, P.roofTex, -1);
    var t = 0.18, h = 0.5, ph = F2.w / 2 + ov, pd2 = F2.h / 2 + ov;
    box('trim', 0, yTop + 0.3 + h / 2, pd2, F2.w + 2 * ov, h, t, P.trim, null, -1);
    box('trim', 0, yTop + 0.3 + h / 2, -pd2, F2.w + 2 * ov, h, t, P.trim, null, -1);
    box('trim', ph, yTop + 0.3 + h / 2, 0, t, h, F2.h + 2 * ov, P.trim, null, -1);
    box('trim', -ph, yTop + 0.3 + h / 2, 0, t, h, F2.h + 2 * ov, P.trim, null, -1);
  }

  // trees + driveway for nicer surroundings
  [[-(gw / 2) + 2.2, gd / 2 - 2.4], [gw / 2 - 2.4, gd / 2 - 3.0]].forEach(function (p) {
    box('furn', p[0], 0.9, p[1], 0.32, 1.8, 0.32, '#6b4a2f', null, -1);
    items.push({ t: 'tree', x: p[0], y: 2.8, z: p[1], w: 1.5, h: 2.4, d: 1.5, color: '#3f6b3a', tex: null, floor: -1, ry: 0 });
  });

  var e0 = L.floors[0].entrance;
  return { items: items, collision: collision, floors: L.floors.length, wallH: WALLH, slab: SLAB, eye: EYE, pr: PR,
    spawn: { x: WX(e0 ? e0.x : pw / 2), z: WZ(F2.y + F2.h) + 3.0 }, plotW: pw, plotD: pd };

  function lamp(rm, yB, fi) { box('lamp', WX(rm.x + rm.w / 2), yB + WALLH - 0.12, WZ(rm.y + rm.h / 2), 0.34, 0.1, 0.34, FURN.lamp, null, fi); }

  function furnish(rm, yB, fi) {
    var cx = WX(rm.x + rm.w / 2), cz = WZ(rm.y + rm.h / 2), w = rm.w, d = rm.h, cl = 0.18;
    // place against walls: ox/oz are offsets from room centre
    function P3(bw, bh, bd, color, ox, oz, oy, tex, ry) { box('furn', cx + ox, yB + (oy == null ? bh / 2 : oy), cz + oz, bw, bh, bd, color, tex || null, fi, ry || 0); }
    function rug(rw, rd, color) { box('furn', cx, yB + 0.012, cz, rw, 0.02, rd, color, null, fi); }
    var backZ = function (id) { return -d / 2 + id / 2 + cl; };     // against back (-z) wall
    var frontZ = function (id) { return d / 2 - id / 2 - cl; };     // against front (+z) wall
    var leftX = function (iw) { return -w / 2 + iw / 2 + cl; };     // against left (-x) wall
    var rightX = function (iw) { return w / 2 - iw / 2 - cl; };     // against right (+x) wall
    if (w < 1.3 || d < 1.3) { if (rm.type !== 'bathroom') return; }
    switch (rm.type) {
      case 'bedroom': {
        var bw = Math.min(1.7, w * 0.62), bl = Math.min(2.1, d * 0.6);
        rug(Math.min(w - 0.5, bw + 1.2), Math.min(d - 0.5, bl + 0.8), FURN.rug);
        P3(bw, 0.4, bl, FURN.wood, 0, backZ(bl), 0.2, 'wood');                 // bed base (head to back wall)
        P3(bw - 0.1, 0.16, bl * 0.7, FURN.wht, 0, backZ(bl) + 0.12, 0.5);      // duvet
        P3(bw * 0.4, 0.14, 0.34, FURN.fabL, -bw * 0.24, -d / 2 + 0.4, 0.62); P3(bw * 0.4, 0.14, 0.34, FURN.fabL, bw * 0.24, -d / 2 + 0.4, 0.62);
        P3(bw + 0.2, 1.0, 0.1, FURN.woodL, 0, -d / 2 + cl + 0.05, 0.55);       // headboard
        P3(0.45, 0.45, 0.4, FURN.woodL, -bw / 2 - 0.35, -d / 2 + 0.4, 0.24); P3(0.45, 0.45, 0.4, FURN.woodL, bw / 2 + 0.35, -d / 2 + 0.4, 0.24);
        P3(Math.min(2.0, d * 0.55), 2.1, 0.58, FURN.drk, rightX(0.58), frontZ(Math.min(2.0, d * 0.55)) - 0.1, 1.05, 'wood', Math.PI / 2); // wardrobe on side wall
        break; }
      case 'living': {
        var sw = Math.min(2.8, w * 0.62);
        rug(Math.min(w - 0.6, 3.2), Math.min(d - 0.6, 2.2), FURN.rug);
        P3(sw, 0.4, 0.92, FURN.fab, 0, backZ(0.92), 0.2);                      // sofa seat against back wall
        P3(sw, 0.55, 0.2, FURN.fab, 0, -d / 2 + cl + 0.1, 0.48);               // sofa back
        P3(0.24, 0.55, 0.92, FURN.fabL, -sw / 2 - 0.12, backZ(0.92), 0.3); P3(0.24, 0.55, 0.92, FURN.fabL, sw / 2 + 0.12, backZ(0.92), 0.3);
        P3(Math.min(1.3, sw * 0.6), 0.34, 0.6, FURN.woodL, 0, backZ(0.92) + 1.0, 0.17, 'wood'); // coffee table
        P3(Math.min(2.0, w * 0.6), 0.45, 0.42, FURN.wood, 0, frontZ(0.42), 0.22, 'wood');       // TV console front wall
        P3(Math.min(1.8, w * 0.55), 0.95, 0.06, FURN.black, 0, frontZ(0.06) - 0.02, 1.1);       // TV screen
        P3(0.7, 1.1, 0.7, FURN.green, leftX(0.7), frontZ(0.7), 0); P3(0.34, 0.5, 0.34, '#7a5a3a', leftX(0.34), frontZ(0.34), 0.25, null); // plant
        break; }
      case 'kitchen': {
        var run = Math.min(w - 0.4, 3.6);
        P3(run, 0.9, 0.6, FURN.wht, 0, backZ(0.6), 0.45);                      // base run back wall
        P3(run, 0.05, 0.64, FURN.steel, 0, backZ(0.64), 0.92);                 // worktop
        P3(run, 0.7, 0.34, FURN.wood, 0, backZ(0.34), 2.05, 'wood');           // upper cabinets
        P3(0.6, 0.06, 0.5, FURN.black, -run * 0.22, backZ(0.5), 0.95);         // hob
        P3(Math.min(d - 0.6, 2.6), 0.9, 0.6, FURN.wht, leftX(0.6), 0.4, 0.45, null, Math.PI / 2); // side counter (L)
        P3(0.78, 1.85, 0.72, FURN.met, rightX(0.72), backZ(0.72) + 0.1, 0.95);  // fridge
        P3(Math.min(1.7, w * 0.5), 0.9, Math.min(1.0, d * 0.4), FURN.woodL, 0, 0.2, 0.45, 'wood'); // island
        P3(Math.min(1.7, w * 0.5), 0.05, Math.min(1.0, d * 0.4), '#d9d2c4', 0, 0.2, 0.92, 'marble'); // island top
        break; }
      case 'bathroom': {
        P3(Math.min(1.6, w * 0.7), 0.55, 0.74, FURN.wht, 0, backZ(0.74), 0.28);   // tub back wall
        P3(0.55, 0.45, 0.42, FURN.wht, rightX(0.42), 0, 0.22, null, Math.PI / 2); // toilet right wall
        P3(0.8, 0.82, 0.5, FURN.woodL, leftX(0.5), frontZ(0.8) - 0.2, 0.41, 'wood', Math.PI / 2); // vanity left
        P3(0.06, 0.7, 0.6, FURN.glassc, leftX(0.06), frontZ(0.6) - 0.2, 1.45);   // mirror
        break; }
      case 'dining': {
        var tw = Math.min(2.2, w * 0.5), tl = Math.min(1.2, d * 0.45);
        rug(Math.min(w - 0.5, tw + 1.4), Math.min(d - 0.5, tl + 1.4), FURN.rug);
        P3(tw, 0.06, tl, FURN.woodL, 0, 0, 0.75, 'wood');
        for (var ai = -1; ai <= 1; ai += 2) for (var bj = -1; bj <= 1; bj += 2) P3(0.42, 0.86, 0.42, FURN.wood, ai * tw * 0.34, bj * (tl / 2 + 0.28), 0.43, 'wood');
        P3(Math.min(1.8, w * 0.55), 0.85, 0.45, FURN.wood, 0, backZ(0.45), 0.42, 'wood'); // sideboard
        break; }
      case 'garage': {
        P3(Math.min(1.9, w * 0.5), 0.55, Math.min(4.2, d * 0.72), '#3a4654', 0, 0, 0.5); P3(Math.min(1.65, w * 0.45), 0.5, Math.min(2.0, d * 0.34), '#222a33', 0, -d * 0.04, 1.0);
        P3(Math.min(2.4, w * 0.7), 0.9, 0.4, FURN.drk, 0, backZ(0.4), 0.6, 'wood'); break; }
    }
  }
}

global.House3D = global.House3D || {};
global.House3D.describeHouse = describeHouse;
if (typeof module !== 'undefined' && module.exports) module.exports = { describeHouse: describeHouse };

/* ----------------------- Browser viewer (needs THREE) ----------------------- */
if (typeof THREE !== 'undefined') {
  var S = 512;
  function mkCanvas(draw) { var c = document.createElement('canvas'); c.width = c.height = S; draw(c.getContext('2d')); var t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; return t; }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function tex(kind) {
    if (kind === 'wood') return mkCanvas(function (g) { for (var y = 0; y < S; y += 48) { var v = rnd(150, 195); g.fillStyle = 'rgb(' + v + ',' + (v - 8) + ',' + (v - 18) + ')'; g.fillRect(0, y, S, 48);
      g.fillStyle = 'rgba(40,30,20,.5)'; g.fillRect(0, y, S, 2); g.fillStyle = 'rgba(255,255,255,.06)'; g.fillRect(0, y + 2, S, 2);
      for (var k = 0; k < 26; k++) { g.strokeStyle = 'rgba(70,50,35,' + rnd(.05, .16) + ')'; g.lineWidth = rnd(.5, 1.5); g.beginPath(); var yy = y + rnd(4, 44); g.moveTo(0, yy); g.bezierCurveTo(S / 3, yy + rnd(-3, 3), 2 * S / 3, yy + rnd(-3, 3), S, yy + rnd(-4, 4)); g.stroke(); } } });
    if (kind === 'tile' || kind === 'marble') return mkCanvas(function (g) { var ts = kind === 'tile' ? 128 : S; g.fillStyle = '#dadada'; g.fillRect(0, 0, S, S);
      for (var x = 0; x < S; x += ts) for (var y = 0; y < S; y += ts) { var v = rnd(205, 240); g.fillStyle = 'rgb(' + v + ',' + v + ',' + (v - 3) + ')'; g.fillRect(x + 2, y + 2, ts - 4, ts - 4);
        if (kind === 'marble') for (var k = 0; k < 6; k++) { g.strokeStyle = 'rgba(150,150,160,' + rnd(.05, .2) + ')'; g.lineWidth = rnd(.5, 2); g.beginPath(); g.moveTo(rnd(0, S), 0); g.bezierCurveTo(rnd(0, S), S / 3, rnd(0, S), 2 * S / 3, rnd(0, S), S); g.stroke(); } }
      if (kind === 'tile') { g.strokeStyle = '#9a9a9a'; g.lineWidth = 4; for (var i = 0; i <= S; i += ts) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, S); g.moveTo(0, i); g.lineTo(S, i); g.stroke(); } } });
    if (kind === 'brick') return mkCanvas(function (g) { g.fillStyle = '#cac6bf'; g.fillRect(0, 0, S, S); var bh = 36, bw = 86;
      for (var r = 0, row = 0; r < S; r += bh, row++) { var off = (row % 2) * bw / 2; for (var x = -bw; x < S; x += bw) { var v = rnd(120, 175); g.fillStyle = 'rgb(' + v + ',' + (v - 18) + ',' + (v - 30) + ')'; g.fillRect(x + off + 3, r + 3, bw - 6, bh - 6); } } });
    if (kind === 'siding') return mkCanvas(function (g) { for (var y = 0; y < S; y += 34) { var v = rnd(185, 210); g.fillStyle = 'rgb(' + v + ',' + v + ',' + (v - 6) + ')'; g.fillRect(0, y, S, 34); g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(0, y + 30, S, 4); } });
    if (kind === 'shingle') return mkCanvas(function (g) { g.fillStyle = '#7d7d80'; g.fillRect(0, 0, S, S); var sh = 30, sw = 52;
      for (var r = 0, row = 0; r < S; r += sh, row++) { var off = (row % 2) * sw / 2; for (var x = -sw; x < S; x += sw) { var v = rnd(95, 140); g.fillStyle = 'rgb(' + v + ',' + v + ',' + (v + 4) + ')'; g.fillRect(x + off + 1, r + 1, sw - 2, sh + 6); g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(x + off + 1, r + sh + 4, sw - 2, 3); } } });
    if (kind === 'carpet') return mkCanvas(function (g) { g.fillStyle = '#cfcfcf'; g.fillRect(0, 0, S, S); for (var k = 0; k < 9000; k++) { g.fillStyle = 'rgba(' + rnd(150, 210) + ',' + rnd(150, 210) + ',' + rnd(150, 210) + ',.4)'; g.fillRect(Math.random() * S, Math.random() * S, 2, 2); } });
    if (kind === 'concrete') return mkCanvas(function (g) { g.fillStyle = '#c2c2c0'; g.fillRect(0, 0, S, S); for (var k = 0; k < 5000; k++) { g.fillStyle = 'rgba(120,120,118,' + rnd(0, .18) + ')'; g.fillRect(Math.random() * S, Math.random() * S, rnd(1, 3), rnd(1, 3)); } for (var c2 = 0; c2 < 5; c2++) { g.strokeStyle = 'rgba(90,90,88,.25)'; g.beginPath(); g.moveTo(rnd(0, S), 0); g.lineTo(rnd(0, S), S); g.stroke(); } });
    if (kind === 'grass') return mkCanvas(function (g) { g.fillStyle = '#5f8a4a'; g.fillRect(0, 0, S, S); for (var k = 0; k < 14000; k++) { g.strokeStyle = 'rgba(' + rnd(50, 90) + ',' + rnd(110, 160) + ',' + rnd(45, 80) + ',.7)'; g.lineWidth = 1; var x = Math.random() * S, y = Math.random() * S; g.beginPath(); g.moveTo(x, y); g.lineTo(x + rnd(-1, 1), y - rnd(3, 6)); g.stroke(); } });
    return mkCanvas(function (g) { g.fillStyle = '#ededeb'; g.fillRect(0, 0, S, S); for (var k = 0; k < 2600; k++) { g.fillStyle = 'rgba(150,150,150,' + rnd(0, .08) + ')'; g.fillRect(Math.random() * S, Math.random() * S, 3, 3); } }); // plaster
  }
  var ROUGH = { wood: 0.62, tile: 0.32, marble: 0.28, brick: 0.95, siding: 0.8, shingle: 0.85, carpet: 1, concrete: 0.9, grass: 1, plaster: 0.95 };

  function Viewer(container) {
    this.container = container; this.mode = 'orbit'; this.floor = 0; this.cut = false; this.noclip = false; this.keys = {};
    this.texCache = {}; this.matCache = {}; this.matsByKind = {}; this.realTex = {}; this.coll = []; this.floorGroups = {}; this.ceil = []; this.roof = null;
    try { this._init(); } catch (e) { this._err('3D init failed: ' + e.message); }
  }
  Viewer.prototype._err = function (m) { var d = this.container.querySelector('.gl-err') || document.createElement('div'); d.className = 'gl-err'; d.textContent = m; d.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;color:#ffb4b4;background:#161019;padding:20px;font:13px Inter,sans-serif;z-index:9'; this.container.appendChild(d); };
  Viewer.prototype._t = function (k) { return this.texCache[k] || (this.texCache[k] = tex(k)); };
  Viewer.prototype._applyReal = function (kind, e) { var tx = this.realTex[kind]; if (!tx || tx === 'failed' || tx === 'pending') return; var t = tx.clone(); t.needsUpdate = true; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(e.rep, e.rep); if (t.encoding !== undefined) t.encoding = THREE.sRGBEncoding; e.mat.map = t; e.mat.bumpMap = t; e.mat.needsUpdate = true; };
  Viewer.prototype._register = function (kind, mat, rep) { if (mat._reg) return; mat._reg = true; (this.matsByKind[kind] = this.matsByKind[kind] || []).push({ mat: mat, rep: rep }); if (this.realTex[kind] && this.realTex[kind] !== 'failed' && this.realTex[kind] !== 'pending') this._applyReal(kind, { mat: mat, rep: rep }); };
  Viewer.prototype._mat = function (item) {
    if (item.t === 'glass') return this.matCache.glass || (this.matCache.glass = new THREE.MeshStandardMaterial({ color: 0xbfe0f5, transparent: true, opacity: 0.28, roughness: 0.05, metalness: 0.1 }));
    if (item.t === 'lamp') return this.matCache.lamp || (this.matCache.lamp = new THREE.MeshStandardMaterial({ color: 0xffe9c0, emissive: 0xffe2a8, emissiveIntensity: 0.8, roughness: 0.5 }));
    var key = (item.tex || 's') + item.color, rep = item.t === 'floor' ? Math.max(1, Math.round(Math.max(item.w, item.d) / 1.5)) : (item.t === 'ground' ? 8 : item.tex === 'brick' || item.tex === 'siding' || item.tex === 'shingle' ? Math.max(2, Math.round(Math.max(item.w, item.d) / 1.5)) : 2);
    if (this.matCache[key]) { if (item.tex) this._register(item.tex, this.matCache[key], rep); return this.matCache[key]; }
    var o = { color: new THREE.Color(item.color), roughness: item.tex ? (ROUGH[item.tex] || 0.8) : 0.7, metalness: 0.02 };
    if (item.tex) { var t = this._t(item.tex).clone(); t.needsUpdate = true; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep, rep); if (t.encoding !== undefined) t.encoding = THREE.sRGBEncoding; o.map = t; o.bumpMap = t; o.bumpScale = 0.04; }
    var mat = new THREE.MeshStandardMaterial(o); this.matCache[key] = mat; if (item.tex) this._register(item.tex, mat, rep); return mat;
  };
  Viewer.prototype._enhance = function () { var self = this; Object.keys(this.matsByKind).forEach(function (kind) { if (self.realTex[kind]) return; self.realTex[kind] = 'pending';
    new THREE.TextureLoader().load('/api/texture?name=' + kind, function (tx) { self.realTex[kind] = tx; (self.matsByKind[kind] || []).forEach(function (e) { self._applyReal(kind, e); }); }, undefined, function () { self.realTex[kind] = 'failed'; }); }); };
  Viewer.prototype._init = function () {
    var w = this.container.clientWidth, h = this.container.clientHeight || 400;
    this.scene = new THREE.Scene(); this.scene.background = new THREE.Color(0xaecbe6); this.scene.fog = new THREE.Fog(0xaecbe6, 60, 200);
    this.camera = new THREE.PerspectiveCamera(58, w / h, 0.1, 2000); this.camera.position.set(20, 18, 26);
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); this.renderer.setSize(w, h);
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    if (this.renderer.outputColorSpace !== undefined) this.renderer.outputColorSpace = THREE.SRGBColorSpace; else this.renderer.outputEncoding = THREE.sRGBEncoding;
    if (THREE.ACESFilmicToneMapping) { this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.05; }
    this.container.appendChild(this.renderer.domElement);
    this.scene.add(new THREE.HemisphereLight(0xdcecff, 0x6a6258, 0.85));
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.28));
    var sun = new THREE.DirectionalLight(0xfff3e0, 1.45); sun.position.set(34, 52, 22); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048); var s = sun.shadow.camera; s.left = -50; s.right = 50; s.top = 50; s.bottom = -50; s.near = 1; s.far = 220; sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02; this.scene.add(sun);
    if (THREE.OrbitControls) { this.orbit = new THREE.OrbitControls(this.camera, this.renderer.domElement); this.orbit.enableDamping = true; this.orbit.maxPolarAngle = Math.PI * 0.49; this.orbit.target.set(0, 2, 0); }
    if (THREE.PointerLockControls) { this.pl = new THREE.PointerLockControls(this.camera, this.renderer.domElement); this.scene.add(this.pl.getObject()); }
    var self = this; this.container.addEventListener('click', function () { if (self.mode === 'walk' && self.pl) self.pl.lock(); });
    window.addEventListener('keydown', function (e) { self.keys[e.code] = true; if (e.code === 'KeyC' && self.mode === 'walk') self.noclip = !self.noclip; });
    window.addEventListener('keyup', function (e) { self.keys[e.code] = false; });
    window.addEventListener('resize', function () { self._resize(); });
    this.clock = new THREE.Clock(); this._animate();
  };
  Viewer.prototype._resize = function () { if (!this.renderer) return; var w = this.container.clientWidth, h = this.container.clientHeight || 400; this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); this.renderer.setSize(w, h); };
  Viewer.prototype._treeMesh = function (it) { var g = new THREE.Group();
    var c1 = new THREE.Mesh(new THREE.ConeGeometry(it.w / 2, it.h, 9), new THREE.MeshStandardMaterial({ color: new THREE.Color(it.color), roughness: 1 })); c1.position.y = 0; c1.castShadow = true;
    var c2 = new THREE.Mesh(new THREE.ConeGeometry(it.w / 2.6, it.h * 0.7, 9), new THREE.MeshStandardMaterial({ color: 0x4a8048, roughness: 1 })); c2.position.y = it.h * 0.5; c2.castShadow = true;
    g.add(c1); g.add(c2); g.position.set(it.x, it.y, it.z); return g; };
  Viewer.prototype.build = function (L, cfg) {
    try {
      if (this.root) this.scene.remove(this.root);
      this.root = new THREE.Group(); this.scene.add(this.root); this.floorGroups = {}; this.ceil = []; this.roof = new THREE.Group(); this.root.add(this.roof);
      var d = window.House3D.describeHouse(L, cfg); this.desc = d; this.coll = d.collision;
      for (var i = 0; i < d.items.length; i++) { var it = d.items[i], m;
        if (it.t === 'roofpitch') m = this._pyramid(it);
        else if (it.t === 'tree') m = this._treeMesh(it);
        else { m = new THREE.Mesh(new THREE.BoxGeometry(it.w, it.h, it.d), this._mat(it)); m.position.set(it.x, it.y, it.z); if (it.ry) m.rotation.y = it.ry; }
        var cast = (it.t === 'wall' || it.t === 'furn' || it.t === 'roof' || it.t === 'roofpitch' || it.t === 'trim' || it.t === 'tree' || it.t === 'door' || it.t === 'plinth');
        m.castShadow = cast; m.receiveShadow = (it.t !== 'glass' && it.t !== 'lamp' && it.t !== 'tree');
        if (it.t === 'roof' || it.t === 'roofpitch') this.roof.add(m);
        else if (it.t === 'ceil') { m.userData.floor = it.floor; this.ceil.push(m); this.root.add(m); }
        else if (it.floor >= 0) { (this.floorGroups[it.floor] || (this.floorGroups[it.floor] = (function () { var g = new THREE.Group(); this.root.add(g); return g; }).call(this))).add(m); }
        else this.root.add(m);
      }
      this._enhance();
      this.cfg = cfg; this.floor = 0; this._spawn(); this._frame(); this._vis();
      var e = this.container.querySelector('.gl-err'); if (e) e.remove();
    } catch (err) { this._err('3D build failed: ' + err.message); }
  };
  Viewer.prototype._pyramid = function (it) {
    var hw = it.w / 2, hd = it.d / 2, H = it.h;
    var v = [-hw, 0, -hd, hw, 0, -hd, hw, 0, hd, -hw, 0, hd, 0, H, 0], idx = [0, 1, 4, 1, 2, 4, 2, 3, 4, 3, 0, 4];
    var uv = [0, 0, 1, 0, 1, 1, 0, 1, 0.5, 1];
    var g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    var o = { color: new THREE.Color(it.color), roughness: 0.9, side: THREE.DoubleSide };
    if (it.tex) { var t = this._t(it.tex).clone(); t.needsUpdate = true; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(4, 4); o.map = t; o.bumpMap = t; o.bumpScale = 0.05; this._register(it.tex, null, 4); }
    var m = new THREE.Mesh(g, new THREE.MeshStandardMaterial(o)); m.position.set(it.x, it.y, it.z); return m;
  };
  Viewer.prototype._spawn = function () { if (!this.pl) return; var sp = this.desc.spawn; this.pl.getObject().position.set(sp.x, this.floor * (this.desc.wallH + this.desc.slab) + this.desc.eye, sp.z); this.camera.rotation.set(0, 0, 0); };
  Viewer.prototype._frame = function () { var span = Math.max(this.desc.plotW, this.desc.plotD), h = this.desc.wallH * this.desc.floors * 0.4; this.camera.position.set(span * 0.95, span * 0.8, span * 1.15); this.camera.lookAt(0, h, 0); if (this.orbit) { this.orbit.target.set(0, h, 0); this.orbit.update(); } };
  Viewer.prototype.setMode = function (m) { this.mode = m; if (this.orbit) this.orbit.enabled = (m === 'orbit'); if (m === 'walk') { this._spawn(); } else if (this.pl && this.pl.isLocked) this.pl.unlock(); this._vis(); if (m === 'orbit') this._frame(); };
  Viewer.prototype.setFloor = function (f) { this.floor = f; if (this.mode === 'walk') this._spawn(); this._vis(); };
  Viewer.prototype.setCutaway = function (b) { this.cut = b; this._vis(); };
  Viewer.prototype._vis = function () { var ob = this.mode === 'orbit', self = this;
    if (this.roof) this.roof.visible = ob && !this.cut;
    this.ceil.forEach(function (c) { c.visible = ob && !self.cut; });
    Object.keys(this.floorGroups).forEach(function (k) { self.floorGroups[k].visible = (ob && self.cut) ? (+k <= self.floor) : true; });
  };
  Viewer.prototype._animate = function () {
    var self = this; requestAnimationFrame(function () { self._animate(); });
    if (this._dead) return;
    try {
      var dt = Math.min(this.clock.getDelta(), 0.05);
      if (this.mode === 'walk' && this.pl && this.pl.isLocked) {
        var sp = ((this.keys.ShiftLeft || this.keys.ShiftRight) ? 6.5 : 3.4) * dt;
        var fwd = (this.keys.KeyW || this.keys.ArrowUp ? 1 : 0) - (this.keys.KeyS || this.keys.ArrowDown ? 1 : 0);
        var str = (this.keys.KeyD || this.keys.ArrowRight ? 1 : 0) - (this.keys.KeyA || this.keys.ArrowLeft ? 1 : 0);
        if (fwd || str) { var dir = new THREE.Vector3(); this.camera.getWorldDirection(dir); dir.y = 0; dir.normalize();
          var right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
          var mx = dir.x * fwd + right.x * str, mz = dir.z * fwd + right.z * str, l = Math.hypot(mx, mz) || 1; mx = mx / l * sp; mz = mz / l * sp;
          var o = this.pl.getObject(), bx = this.coll, fl = this.floor;
          var nx = o.position.x + mx; if (!this.noclip && this._hit(nx, o.position.z, bx, fl)) nx = o.position.x;
          var nz = o.position.z + mz; if (!this.noclip && this._hit(nx, nz, bx, fl)) nz = o.position.z;
          o.position.x = nx; o.position.z = nz; o.position.y = fl * (this.desc.wallH + this.desc.slab) + this.desc.eye;
        }
      } else if (this.orbit) this.orbit.update();
      this.renderer.render(this.scene, this.camera);
    } catch (e) { this._dead = true; this._err('3D render error: ' + e.message); }
  };
  Viewer.prototype._hit = function (x, z, b, fl) { for (var i = 0; i < b.length; i++) { var w = b[i]; if (w.floor === fl && x > w.minX - PR && x < w.maxX + PR && z > w.minZ - PR && z < w.maxZ + PR) return true; } return false; };
  global.House3D.Viewer = Viewer;
}
})(typeof window !== 'undefined' ? window : globalThis);
