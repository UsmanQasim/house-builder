/* Pure house-layout engine. Works in the browser (window.HouseLayout) and in
 * Node (module.exports) so it can be unit-tested. Central-corridor scheme:
 * a hallway links the entrance + stairs, rooms are double-loaded off it,
 * doors open to the corridor, windows sit only on exterior walls.
 * Coordinates: metres, origin top-left, x = right, y = down (front = bottom). */
(function (global) {
  'use strict';
  var DOOR = 0.9, FRONT = 1.5, WIN = 1.4;

  function distribute(c) {
    var floors = [], i, f;
    for (i = 0; i < c.floors; i++) floors.push([]);
    function add(fl, type, name, w) { floors[fl].push({ type: type, name: name, weight: w }); }
    for (i = 0; i < c.living; i++) add(0, 'living', c.living > 1 ? 'Living ' + (i + 1) : 'Living Room', 3.4);
    if (c.dining) add(0, 'dining', 'Dining', 2.3);
    for (i = 0; i < c.kitchens; i++) add(0, 'kitchen', c.kitchens > 1 ? 'Kitchen ' + (i + 1) : 'Kitchen', 2.4);
    if (c.garage) add(0, 'garage', 'Garage', 2.7);
    var bedStart = c.floors > 1 ? 1 : 0, upper = Math.max(1, c.floors - bedStart);
    for (i = 0; i < c.bedrooms; i++) add(bedStart + (i % upper), 'bedroom', i === 0 ? 'Master Bedroom' : 'Bedroom ' + (i + 1), i === 0 ? 3.3 : 2.6);
    for (i = 0; i < c.bathrooms; i++) { f = i === 0 ? 0 : bedStart + ((i - 1) % upper); add(f, 'bathroom', c.bathrooms > 1 ? 'Bath ' + (i + 1) : 'Bathroom', 1.2); }
    for (f = 0; f < floors.length; f++) if (floors[f].length === 0) add(f, 'room', 'Room', 2.2);
    return floors;
  }

  function room(r, x, y, w, h) { return { type: r.type, name: r.name, x: x, y: y, w: w, h: h, area: w * h, door: null, windows: [] }; }

  function windows(rm, fx, fy, fw, fh) {
    var e = 0.001;
    if (Math.abs(rm.x - fx) < e) rm.windows.push({ side: 'left', pos: rm.y + rm.h / 2, len: Math.min(WIN, rm.h - 0.9) });
    if (Math.abs(rm.x + rm.w - (fx + fw)) < e) rm.windows.push({ side: 'right', pos: rm.y + rm.h / 2, len: Math.min(WIN, rm.h - 0.9) });
    if (Math.abs(rm.y - fy) < e) rm.windows.push({ side: 'top', pos: rm.x + rm.w / 2, len: Math.min(WIN, rm.w - 0.9) });
    if (Math.abs(rm.y + rm.h - (fy + fh)) < e) rm.windows.push({ side: 'bottom', pos: rm.x + rm.w / 2, len: Math.min(WIN, rm.w - 0.9) });
  }

  function stack(list, x0, y0, w, h, zone, floor, fx, fy, fw, fh) {
    var tot = 0, i, cy = y0;
    for (i = 0; i < list.length; i++) tot += list[i].weight;
    for (i = 0; i < list.length; i++) {
      var rh = h * list[i].weight / tot, rm = room(list[i], x0, cy, w, rh);
      rm.door = { side: zone === 'left' ? 'right' : 'left', pos: cy + rh / 2, width: Math.max(0.7, Math.min(DOOR, rh - 0.5)) };
      windows(rm, fx, fy, fw, fh);
      floor.rooms.push(rm); cy += rh;
    }
  }

  function computeLayout(c) {
    var margin = Math.max(1.0, Math.min(2.4, Math.min(c.plotW, c.plotD) * 0.12));
    var fw = Math.max(5, c.plotW - 2 * margin), fh = Math.max(5, c.plotD - 2 * margin);
    var fx = (c.plotW - fw) / 2, fy = (c.plotD - fh) / 2;
    var CW = Math.max(1.1, Math.min(1.7, fw * 0.12)); if ((fw - CW) / 2 < 1.9) CW = Math.max(1.0, fw - 3.8);
    var sideW = (fw - CW) / 2, corridorX = fx + sideW;
    var rf = distribute(c), floors = [], fi;
    for (fi = 0; fi < rf.length; fi++) {
      var rooms = rf[fi], floor = { index: fi, rooms: [], corridor: null, entrance: null, stairs: null };
      if (rooms.length <= 1) {
        var only = room(rooms[0] || { type: 'room', name: 'Room' }, fx, fy, fw, fh);
        only.door = { side: 'bottom', pos: fx + fw / 2, width: FRONT };
        windows(only, fx, fy, fw, fh); floor.rooms.push(only);
        floor.entrance = { x: fx + fw / 2, y: fy + fh, width: FRONT };
        floors.push(floor); continue;
      }
      var left = [], right = [], i;
      for (i = 0; i < rooms.length; i++) (i % 2 === 0 ? left : right).push(rooms[i]);
      if (right.length === 0) right.push(left.pop());
      stack(left, fx, fy, sideW, fh, 'left', floor, fx, fy, fw, fh);
      stack(right, corridorX + CW, fy, sideW, fh, 'right', floor, fx, fy, fw, fh);
      floor.corridor = { x: corridorX, y: fy, w: CW, h: fh };
      floor.entrance = { x: corridorX + CW / 2, y: fy + fh, width: FRONT };
      if (c.floors > 1) floor.stairs = { x: corridorX, y: fy, w: CW, h: Math.min(3.2, fh * 0.32) };
      floors.push(floor);
    }
    return { plotW: c.plotW, plotD: c.plotD, foot: { x: fx, y: fy, w: fw, h: fh }, corridorX: corridorX, CW: CW, floors: floors };
  }

  var api = { computeLayout: computeLayout };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.HouseLayout = api;
})(typeof window !== 'undefined' ? window : globalThis);
