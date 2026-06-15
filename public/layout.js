/* Realistic house-layout engine (browser + Node).
 * Coordinates: metres, origin top-left, x right, y down (front/street = bottom).
 * Ground: garage side wing, living facing street, kitchen+dining adjacent, entry hall.
 * Upper: central landing with properly sized bedrooms and bathrooms. */
(function (global) {
  'use strict';
  var DOOR = 0.9, FRONT = 1.2, WIN = 1.4, EPS = 0.02;

  var MIN = {
    living: { w: 3.6, h: 4.0 },
    dining: { w: 2.8, h: 3.0 },
    kitchen: { w: 2.6, h: 3.0 },
    bedroom: { w: 3.0, h: 3.2 },
    master: { w: 3.4, h: 3.8 },
    bathroom: { w: 2.0, h: 2.2 },
    garage: { w: 3.0, h: 5.5 },
    corridor: { w: 1.1, h: 1.2 }
  };

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function mk(type, name, x, y, w, h) {
    w = Math.max(0.5, w); h = Math.max(0.5, h);
    return { type: type, name: name, x: x, y: y, w: w, h: h, area: w * h, door: null, windows: [] };
  }
  function setDoor(rm, side, pos, width) {
    rm.door = { side: side, pos: pos, width: width || DOOR };
  }

  function windows(rm, fx, fy, fw, fh) {
    if (rm.type === 'corridor') return;
    if (Math.abs(rm.x - fx) < EPS) rm.windows.push({ side: 'left', pos: rm.y + rm.h / 2, len: Math.min(WIN, rm.h - 0.9) });
    if (Math.abs(rm.x + rm.w - (fx + fw)) < EPS) rm.windows.push({ side: 'right', pos: rm.y + rm.h / 2, len: Math.min(WIN, rm.h - 0.9) });
    if (Math.abs(rm.y - fy) < EPS) rm.windows.push({ side: 'top', pos: rm.x + rm.w / 2, len: Math.min(WIN, rm.w - 0.9) });
    if (Math.abs(rm.y + rm.h - (fy + fh)) < EPS) rm.windows.push({ side: 'bottom', pos: rm.x + rm.w / 2, len: Math.min(WIN, rm.w - 0.9) });
  }

  function applyWindows(rooms, fx, fy, fw, fh) {
    rooms.forEach(function (rm) { windows(rm, fx, fy, fw, fh); });
  }

  function splitHeights(total, count, firstLarger) {
    if (count <= 0) return [];
    if (count === 1) return [clamp(total, MIN.bedroom.h, total)];
    if (firstLarger) {
      var first = clamp(total * 0.36, MIN.master.h, total - MIN.bedroom.h * (count - 1));
      var rest = (total - first) / (count - 1);
      var out = [first];
      for (var i = 1; i < count; i++) out.push(clamp(rest, MIN.bedroom.h, total));
      return out;
    }
    var each = total / count;
    var arr = [];
    for (var j = 0; j < count; j++) arr.push(clamp(each, MIN.bedroom.h, total));
    return arr;
  }

  function capDepth(w, h, maxArea, minH) {
    var area = w * h;
    if (area <= maxArea) return h;
    return Math.max(minH, maxArea / w);
  }

  function layoutPublicZone(c, floor, x, y, w, h, hallD, withStairs, footArea) {
    var hallD2 = clamp(hallD, MIN.corridor.h, Math.min(2.0, h * 0.18));
    var pubH = h - hallD2;
    var svcW = clamp(Math.max(MIN.kitchen.w, w * 0.34), MIN.kitchen.w, w - MIN.living.w);
    var livingW = w - svcW;
    var sx = x + livingW;
    var maxLiving = clamp(footArea * 0.16, 20, 38);

    var livingD = clamp(maxLiving / livingW, MIN.living.h, Math.min(5.2, pubH - hallD2 - 1.2));
    var living = mk('living', c.living > 1 ? 'Living 1' : 'Living Room', x, y, livingW, livingD);
    setDoor(living, 'bottom', x + livingW * 0.5);
    floor.rooms.push(living);

    var connD = pubH - livingD - hallD2;
    if (connD > 1.0) {
      floor.rooms.push(mk('corridor', 'Hall', x, y + livingD, livingW, connD));
    }

    var svcY = y, svcRem = pubH, bathH = 0;
    var groundBath = c.floors === 1 ? c.bathrooms > 0 : c.bathrooms > 0;

    if (groundBath && pubH > MIN.kitchen.h + MIN.bathroom.h + (c.dining ? MIN.dining.h : 0)) {
      bathH = MIN.bathroom.h + 0.25;
      var bath = mk('bathroom', c.bathrooms > 1 ? 'WC' : 'Bathroom', sx, svcY, svcW, bathH);
      setDoor(bath, 'left', svcY + bathH / 2);
      floor.rooms.push(bath);
      svcY += bathH; svcRem -= bathH;
    }

    var kH, dH = 0;
    if (c.dining && svcRem > MIN.kitchen.h + MIN.dining.h) {
      kH = clamp(svcRem * 0.46, MIN.kitchen.h, svcRem - MIN.dining.h);
      dH = svcRem - kH;
    } else {
      kH = svcRem;
    }

    var kitchen = mk('kitchen', c.kitchens > 1 ? 'Kitchen 1' : 'Kitchen', sx, svcY, svcW, kH);
    setDoor(kitchen, 'left', svcY + kH * 0.5);
    floor.rooms.push(kitchen);

    if (c.dining && dH >= MIN.dining.h * 0.85) {
      var dining = mk('dining', 'Dining', sx, svcY + kH, svcW, dH);
      setDoor(dining, 'left', svcY + kH + dH * 0.45);
      floor.rooms.push(dining);
    }

    var hallW = clamp(livingW * 0.4, 1.5, 2.8);
    var hallX = x + (livingW - hallW) / 2;
    var hallY = y + pubH;
    floor.rooms.push(mk('corridor', 'Entry Hall', hallX, hallY, hallW, hallD2));
    floor.corridor = { x: hallX, y: hallY, w: hallW, h: hallD2 };
    floor.entrance = { x: hallX + hallW / 2, y: y + h, width: FRONT };

    if (withStairs) {
      floor.stairs = { x: sx, y: y + pubH - clamp(2.6, 2.2, pubH * 0.28), w: svcW, h: clamp(2.6, 2.2, pubH * 0.28) };
    }

    return { livingW: livingW, svcW: svcW };
  }

  function layoutBedRow(floor, names, x, y, w, h, doorSide) {
    var n = names.length;
    if (n === 0) return;
    var cols = n <= 2 ? n : (n <= 4 ? 2 : 3);
    var rows = Math.ceil(n / cols);
    var cellW = w / cols;
    var cellH = h / rows;
    cellW = Math.max(cellW, MIN.bedroom.w);
    cellH = Math.max(cellH, MIN.bedroom.h);
    var idx = 0, r, c;
    for (r = 0; r < rows; r++) {
      for (c = 0; c < cols && idx < n; c++) {
        var isMaster = /master/i.test(names[idx]);
        var rw = Math.min(cellW, w - c * cellW);
        var rh = Math.min(cellH, h - r * cellH);
        if (isMaster && cols > 1) { rw = Math.min(w * 0.55, Math.max(rw, MIN.master.w)); }
        var bx = x + c * cellW, by = y + r * cellH;
        var rm = mk('bedroom', names[idx], bx, by, rw, rh);
        var doorPos = doorSide === 'bottom' ? bx + rw / 2 : (doorSide === 'right' ? by + rh / 2 : by + rh / 2);
        setDoor(rm, doorSide, doorPos);
        floor.rooms.push(rm);
        idx++;
      }
    }
  }

  function layoutGround(c, fx, fy, fw, fh) {
    var floor = { index: 0, rooms: [], corridor: null, entrance: null, stairs: null };
    var x = fx, y = fy, w = fw, h = fh;
    var footArea = fw * fh;

    if (c.garage) {
      var gw = clamp(Math.min(3.8, w * 0.22), MIN.garage.w, 3.8);
      var gr = mk('garage', 'Garage', x, y, gw, h);
      setDoor(gr, 'right', y + h * 0.72);
      floor.rooms.push(gr);
      x += gw; w -= gw;
    }

    if (c.floors === 1 && c.bedrooms > 0) {
      var bedBand = clamp(h * 0.4, MIN.bedroom.h * 1.2, h * 0.5);
      var pubH = h - bedBand;
      layoutPublicZone(c, floor, x, y + bedBand, w, pubH, 1.5, false, fw * fh);
      var bedNames = [];
      for (var i = 0; i < c.bedrooms; i++) bedNames.push(i === 0 ? 'Master Bedroom' : 'Bedroom ' + (i + 1));
      layoutBedRow(floor, bedNames, x, y, w, bedBand, 'bottom');
    } else {
      layoutPublicZone(c, floor, x, y, w, h, 1.5, c.floors > 1, fw * fh);
    }

    applyWindows(floor.rooms, fx, fy, fw, fh);
    return floor;
  }

  function bedsForUpperFloor(c, floorIndex) {
    if (c.floors <= 1) return 0;
    var upper = c.floors - 1;
    var base = Math.floor(c.bedrooms / upper);
    var extra = c.bedrooms % upper;
    var idx = floorIndex - 1;
    return base + (idx < extra ? 1 : 0);
  }

  function bathsForUpperFloor(c, floorIndex) {
    if (c.bathrooms <= 0) return 0;
    if (c.floors <= 1) return 0;
    if (c.bathrooms === 1) return floorIndex === c.floors - 1 ? 0 : 0;
    var upper = c.floors - 1;
    var groundBath = c.bathrooms > 0 ? 1 : 0;
    var rem = Math.max(0, c.bathrooms - groundBath);
    if (rem === 0) return 0;
    var base = Math.floor(rem / upper);
    var extra = rem % upper;
    return base + (floorIndex - 1 < extra ? 1 : 0);
  }

  function layoutUpper(c, fx, fy, fw, fh, floorIndex) {
    var floor = { index: floorIndex, rooms: [], corridor: null, entrance: null, stairs: null };
    var CW = clamp(1.25, MIN.corridor.w, 1.4);
    var corridorX = fx + (fw - CW) / 2;
    var leftW = corridorX - fx;
    var rightW = fx + fw - corridorX - CW;
    var stairH = clamp(2.6, 2.2, fh * 0.2);

    floor.corridor = { x: corridorX, y: fy, w: CW, h: fh };
    floor.stairs = { x: corridorX, y: fy + fh - stairH, w: CW, h: stairH };
    floor.rooms.push(mk('corridor', 'Landing', corridorX, fy, CW, fh));

    var bedsOnFloor = bedsForUpperFloor(c, floorIndex);
    var bathsOnFloor = bathsForUpperFloor(c, floorIndex);
    if (floorIndex === 1 && c.bathrooms === 1 && c.floors > 1) bathsOnFloor = 0;

    var bathH = MIN.bathroom.h + 0.25;
    var bathW = Math.min(MIN.bathroom.w + 0.35, leftW - 0.1, rightW - 0.1);
    var availH = fh - stairH;

    var leftN = Math.ceil(bedsOnFloor / 2);
    var rightN = bedsOnFloor - leftN;
    var leftBathSlots = Math.ceil(bathsOnFloor / 2);
    var rightBathSlots = bathsOnFloor - leftBathSlots;

    var leftBedH = availH - leftBathSlots * bathH;
    var rightBedH = availH - rightBathSlots * bathH;
    var leftHs = splitHeights(leftBedH, leftN, floorIndex === 1);
    var rightHs = splitHeights(rightBedH, rightN, false);

    var footArea = fw * fh;
    var maxBed = clamp(footArea * 0.07, 11, 20);
    var maxMaster = clamp(footArea * 0.09, 14, 24);
    var names = [], nk;
    for (nk = 0; nk < bedsOnFloor; nk++) {
      var num = (floorIndex - 1) * 2 + nk + 1;
      names.push(floorIndex === 1 && nk === 0 ? 'Master Bedroom' : 'Bedroom ' + num);
    }

    function capBed(rm, isMaster) {
      var cap = isMaster ? maxMaster : maxBed;
      if (rm.area > cap) { rm.h = Math.max(MIN.bedroom.h, cap / rm.w); rm.area = rm.w * rm.h; }
      return rm;
    }

    var k, cy, idx = 0;
    cy = fy;
    for (k = 0; k < leftN; k++) {
      var lh = leftHs[k] || MIN.bedroom.h;
      var lb = capBed(mk('bedroom', names[idx++] || ('Bedroom ' + (k + 1)), fx, cy, leftW, lh), floorIndex === 1 && k === 0);
      setDoor(lb, 'right', cy + lb.h / 2);
      floor.rooms.push(lb); cy += lb.h;
    }
    for (k = 0; k < leftBathSlots; k++) {
      var lbath = mk('bathroom', c.bathrooms > 1 ? 'Bath ' + (k + 2) : 'Bathroom', fx + leftW - bathW, fy + stairH + k * bathH, bathW, bathH);
      setDoor(lbath, 'right', fy + stairH + k * bathH + bathH / 2);
      floor.rooms.push(lbath);
    }

    cy = fy;
    for (k = 0; k < rightN; k++) {
      var rh = rightHs[k] || MIN.bedroom.h;
      var rb = capBed(mk('bedroom', names[idx++] || ('Bedroom ' + (k + 1)), corridorX + CW, cy, rightW, rh), false);
      setDoor(rb, 'left', cy + rb.h / 2);
      floor.rooms.push(rb); cy += rb.h;
    }
    for (k = 0; k < rightBathSlots; k++) {
      var rbath = mk('bathroom', 'Bath ' + (leftBathSlots + k + 2), corridorX + CW, fy + stairH + k * bathH, bathW, bathH);
      setDoor(rbath, 'left', fy + stairH + k * bathH + bathH / 2);
      floor.rooms.push(rbath);
    }

    applyWindows(floor.rooms, fx, fy, fw, fh);
    return { floor: floor, corridorX: corridorX, CW: CW };
  }

  function getPT() {
    if (typeof PlanTemplates !== 'undefined') return PlanTemplates;
    if (typeof require !== 'undefined') try { return require('./plan-templates.js'); } catch (_) {}
    return null;
  }

  function placeNorm(floor, s, fx, fy, fw, fh) {
    var x = fx + s.x * fw, y = fy + s.y * fh, w = s.w * fw, h = s.h * fh;
    var rm = mk(s.type, s.name, x, y, w, h);
    if (s.door && s.door.side) {
      var pos = s.door.rel
        ? ((s.door.side === 'left' || s.door.side === 'right') ? y + s.door.pos * h : x + s.door.pos * w)
        : (+s.door.pos || x + w / 2);
      setDoor(rm, s.door.side, pos, s.door.width);
    }
    floor.rooms.push(rm);
    return rm;
  }

  function buildFromTemplate(c, templateId) {
    var PT = getPT(); if (!PT) return null;
    var tpl = PT.CATALOG[templateId] || PT.CATALOG[PT.pickTemplate(c)]; if (!tpl) return null;
    var margin = clamp(Math.min(c.plotW, c.plotD) * 0.08, 0.8, 2.0);
    var fw = Math.max(8, c.plotW - 2 * margin), fh = Math.max(7, c.plotD - 2 * margin);
    var fx = (c.plotW - fw) / 2, fy = (c.plotD - fh) / 2;
    if (tpl.floors.length !== c.floors) return null;

    var floors = [], fi, corridorX = fx + fw / 2 - 0.6, CW = 1.25;
    for (fi = 0; fi < tpl.floors.length; fi++) {
      var src = tpl.floors[fi], floor = { index: fi, rooms: [], corridor: null, entrance: null, stairs: null };
      var bedCount = 0, bathCount = 0;
      src.rooms.forEach(function (s) {
        if (s.type === 'bedroom') { bedCount++; if (bedCount > c.bedrooms) return; s = Object.assign({}, s, { name: bedCount === 1 ? 'Master Bedroom' : 'Bedroom ' + bedCount }); }
        if (s.type === 'bathroom') { bathCount++; if (bathCount > c.bathrooms) return; }
        if (s.type === 'kitchen' && c.kitchens < 1) return;
        if (s.type === 'dining' && !c.dining) return;
        if (s.type === 'garage' && !c.garage) return;
        placeNorm(floor, s, fx, fy, fw, fh);
      });
      if (src.corridor) {
        var cr = src.corridor;
        floor.corridor = { x: fx + cr.x * fw, y: fy + cr.y * fh, w: cr.w * fw, h: cr.h * fh };
        corridorX = floor.corridor.x; CW = floor.corridor.w;
      }
      if (src.entrance) {
        var en = src.entrance;
        floor.entrance = { x: fx + (en.rel ? en.x * fw : en.x), y: fy + (en.rel ? fh : en.y), width: en.width || FRONT };
      }
      if (src.stairs && fi < c.floors - 1) {
        var st = src.stairs;
        floor.stairs = { x: fx + st.x * fw, y: fy + st.y * fh, w: st.w * fw, h: st.h * fh };
      }
      applyWindows(floor.rooms, fx, fy, fw, fh);
      floors.push(floor);
    }
    return {
      plotW: c.plotW, plotD: c.plotD, foot: { x: fx, y: fy, w: fw, h: fh },
      corridorX: corridorX, CW: CW, floors: floors, partitions: true,
      planSource: 'template', templateId: templateId, planConcept: tpl.concept || ''
    };
  }

  function overlaps(a, b) {
    return a.x < b.x + b.w - EPS && a.x + a.w > b.x + EPS && a.y < b.y + b.h - EPS && a.y + a.h > b.y + EPS;
  }

  function validateLayout(layout, c) {
    if (!layout || !layout.floors || layout.floors.length !== c.floors) return { ok: false, score: 0, issues: ['floor count'] };
    var issues = [], f = layout.foot, score = 100;
    layout.floors.forEach(function (fl, i) {
      var rooms = fl.rooms.filter(function (r) { return r.type !== 'corridor' || r.name !== 'Hall'; });
      for (var a = 0; a < fl.rooms.length; a++) {
        for (var b = a + 1; b < fl.rooms.length; b++) {
          if (fl.rooms[a].name === 'Hall' || fl.rooms[b].name === 'Hall') continue;
          if (overlaps(fl.rooms[a], fl.rooms[b])) { issues.push('overlap F' + (i + 1)); score -= 25; }
        }
        var r = fl.rooms[a];
        if (r.x < f.x - EPS || r.y < f.y - EPS || r.x + r.w > f.x + f.w + EPS || r.y + r.h > f.y + f.h + EPS) {
          issues.push('out of bounds ' + r.name); score -= 15;
        }
      }
    });
    return { ok: issues.length === 0 && score >= 60, score: Math.max(0, score), issues: issues };
  }

  function computeLayout(c) {
    var PT = getPT();
    if (PT) {
      var tid = PT.pickTemplate(c);
      var built = buildFromTemplate(c, tid);
      if (built) return built;
    }
    var margin = clamp(Math.min(c.plotW, c.plotD) * 0.08, 0.8, 2.0);
    var fw = Math.max(8, c.plotW - 2 * margin);
    var fh = Math.max(7, c.plotD - 2 * margin);
    var fx = (c.plotW - fw) / 2, fy = (c.plotD - fh) / 2;

    var floors = [layoutGround(c, fx, fy, fw, fh)];
    var corridorX = fx + (fw - 1.25) / 2, CW = 1.25;
    for (var fi = 1; fi < c.floors; fi++) {
      var up = layoutUpper(c, fx, fy, fw, fh, fi);
      floors.push(up.floor);
      corridorX = up.corridorX;
      CW = up.CW;
    }

    return { plotW: c.plotW, plotD: c.plotD, foot: { x: fx, y: fy, w: fw, h: fh }, corridorX: corridorX, CW: CW, floors: floors, partitions: true };
  }

  var VALID_TYPES = { living: 1, bedroom: 1, kitchen: 1, bathroom: 1, dining: 1, garage: 1, corridor: 1, room: 1 };

  function fromAI(raw, c) {
    if (!raw || !Array.isArray(raw.floors) || !raw.floors.length) return null;
    var margin = clamp(Math.min(c.plotW, c.plotD) * 0.08, 0.8, 2.0);
    var fw = Math.max(8, c.plotW - 2 * margin), fh = Math.max(7, c.plotD - 2 * margin);
    var fx = (c.plotW - fw) / 2, fy = (c.plotD - fh) / 2;
    var floors = [], fi, corridorX = fx + (fw - 1.25) / 2, CW = 1.25;

    for (fi = 0; fi < raw.floors.length && fi < c.floors; fi++) {
      var src = raw.floors[fi], floor = { index: fi, rooms: [], corridor: null, entrance: null, stairs: null };
      (src.rooms || []).forEach(function (r) {
        if (!VALID_TYPES[r.type]) return;
        var x = fx + clamp(+r.x || 0, 0, fw - 0.5);
        var y = fy + clamp(+r.y || 0, 0, fh - 0.5);
        var w = clamp(+r.w || 2, 0.8, fw - (x - fx));
        var h = clamp(+r.h || 2, 0.8, fh - (y - fy));
        if (r.type === 'bathroom') { w = clamp(w, MIN.bathroom.w, fw); h = clamp(h, MIN.bathroom.h, fh); }
        var rm = mk(r.type, r.name || r.type, x, y, w, h);
        if (r.door && r.door.side) {
          var dp = +r.door.pos || 0;
          var pos;
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
    var v = validateLayout({ foot: { x: fx, y: fy, w: fw, h: fh }, floors: floors }, c);
    if (!v.ok) return null;
    return {
      plotW: c.plotW, plotD: c.plotD, foot: { x: fx, y: fy, w: fw, h: fh },
      corridorX: corridorX, CW: CW, floors: floors, partitions: true,
      planSource: 'ai', planConcept: raw.concept || '', planInspiration: raw.inspiration || ''
    };
  }

  var api = { computeLayout: computeLayout, buildFromTemplate: buildFromTemplate, fromAI: fromAI, validateLayout: validateLayout, MIN: MIN };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.HouseLayout = api;
})(typeof window !== 'undefined' ? window : globalThis);
