/* ForthHome — front-end. Walkable 3D model (house3d.js) is the main view;
 * accurate 2D plan + photoreal AI renders are extra tabs. */
(function () {
'use strict';
var $ = function (id) { return document.getElementById(id); };
var fmt = function (n) { return Math.round(n).toLocaleString(); };
var M2FT = 10.7639;
var cfg = null, L = null, currentFloor = 0, brief = null, refs = [], viewer = null, cut = false, planMeta = null, aiPlansOn = true;

var FILL = { living:'#e9f0f7', bedroom:'#eef1ea', kitchen:'#f5efe5', bathroom:'#e5f1f1', dining:'#f1edf6', garage:'#ededed', corridor:'#e1e5ea', room:'#eef0f2' };
var WALL = '#1f242c', FURN = '#7b8694', LBL = '#252b33', WIN = '#3f7bbf';

function readForm() {
  var n = function (id, d) { var v = parseFloat($(id).value); return isNaN(v) ? d : v; };
  return { plotW: Math.max(6, n('plotW', 18)), plotD: Math.max(6, n('plotD', 14)),
    floors: Math.min(4, Math.max(1, Math.round(n('floors', 2)))),
    bedrooms: Math.max(0, Math.round(n('bedrooms', 3))), bathrooms: Math.max(0, Math.round(n('bathrooms', 2))),
    kitchens: Math.max(0, Math.round(n('kitchens', 1))), living: Math.max(0, Math.round(n('living', 1))),
    dining: $('dining').checked, garage: $('garage').checked, style: $('style').value };
}
function applyLayout(layout, meta) {
  L = layout; planMeta = meta || null; currentFloor = 0;
  $('welcome').style.display = 'none'; $('stage').style.display = 'flex';
  buildFloorBars(); updateArea(); drawPlan(); tab('three');
  if (viewer) { viewer._resize(); viewer.build(L, cfg); }
  else { view3dMsg('The 3D engine (Three.js) did not load. Run <b>node server.js</b> and open <b>http://localhost:3000</b> in a modern browser.'); }
}
async function generate(silent) {
  cfg = readForm();
  var btn = $('generateBtn'); btn.disabled = true;
  if (!silent) toast('Designing floor plan…');
  try {
    var usedAI = false;
    if (aiPlansOn) {
      try {
        var r = await fetch('/api/ai/floor-plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cfg) });
        var d = await r.json();
        if (r.ok && d.layout) {
          applyLayout(d.layout, { concept: d.concept, inspiration: d.inspiration, source: d.source, hits: d.researchHits, templateId: d.templateId });
          usedAI = true;
          if (!silent) toast((d.source === 'pro-template' ? 'Pro floor plan (' + (d.templateId || 'template') + ')' : 'Floor plan ready') + (d.researchHits ? ' · ' + d.researchHits + ' web refs' : ''));
        }
      } catch (e) { /* fall through */ }
    }
    if (!usedAI) {
      applyLayout(window.HouseLayout.computeLayout(cfg), { source: 'pro-template' });
      if (!silent) toast('Pro floor plan ready');
    }
  } finally { btn.disabled = false; }
}
function buildFloorBars() {
  var defs = [['floorBar', function (i) { currentFloor = i; drawPlan(); }], ['floorBar3d', function (i) { if (viewer) viewer.setFloor(i); }]];
  defs.forEach(function (pair) {
    var bar = $(pair[0]); if (!bar) return; bar.innerHTML = '';
    for (var f = 0; f < cfg.floors; f++) {
      var b = document.createElement('button'); b.className = 'fbtn' + (f === 0 ? ' active' : ''); b.textContent = 'Level ' + (f + 1);
      (function (i, btn, fn, barEl) { btn.onclick = function () { fn(i); barEl.querySelectorAll('.fbtn').forEach(function (x) { x.classList.remove('active'); }); btn.classList.add('active'); }; })(f, b, pair[1], bar);
      bar.appendChild(b);
    }
  });
}
function updateArea() { var a = (parseFloat($('plotW').value) || 0) * (parseFloat($('plotD').value) || 0); $('areaStat').textContent = fmt(a) + ' m²'; $('areaFt').textContent = fmt(a * M2FT) + ' ft²'; }

/* ---------------- SVG floor plan ---------------- */
function R(x, y, w, h, fill, stroke, sw) { return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" fill="' + (fill || 'none') + '"' + (stroke ? ' stroke="' + stroke + '" stroke-width="' + sw + '"' : '') + '/>'; }
function Line(x1, y1, x2, y2, stroke, sw) { return '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" stroke="' + stroke + '" stroke-width="' + sw + '" stroke-linecap="round"/>'; }
function T(x, y, s, size, color, anchor, weight) { return '<text x="' + x + '" y="' + y + '" font-size="' + size + '" fill="' + (color || LBL) + '" text-anchor="' + (anchor || 'middle') + '" font-family="Inter,Segoe UI,sans-serif"' + (weight ? ' font-weight="' + weight + '"' : '') + '>' + s + '</text>'; }
function doorSVG(rm) { var d = rm.door; if (!d) return ''; var hw = d.width, s = '';
  if (d.side === 'right' || d.side === 'left') { var x = d.side === 'right' ? rm.x + rm.w : rm.x, y0 = d.pos - hw / 2, dir = d.side === 'right' ? 1 : -1;
    s += R(x - 0.13, y0, 0.26, hw, '#fff') + Line(x, y0, x + dir * hw, y0, '#5a6573', 0.05);
    s += '<path d="M ' + x + ' ' + y0 + ' A ' + hw + ' ' + hw + ' 0 0 ' + (dir > 0 ? 1 : 0) + ' ' + (x + dir * hw) + ' ' + (y0 + hw) + '" fill="none" stroke="#9aa3af" stroke-width="0.03"/>';
  } else { var yb = d.side === 'bottom' ? rm.y + rm.h : rm.y, x0 = d.pos - hw / 2;
    s += R(x0, yb - 0.13, hw, 0.26, '#fff') + Line(x0, yb, x0, yb - hw, '#5a6573', 0.05);
    s += '<path d="M ' + x0 + ' ' + yb + ' A ' + hw + ' ' + hw + ' 0 0 1 ' + (x0 + hw) + ' ' + (yb - hw) + '" fill="none" stroke="#9aa3af" stroke-width="0.03"/>'; }
  return s; }
function windowSVG(rm) { var s = ''; rm.windows.forEach(function (w) {
  if (w.side === 'left' || w.side === 'right') { var x = w.side === 'left' ? rm.x : rm.x + rm.w, y0 = w.pos - w.len / 2; s += R(x - 0.1, y0, 0.2, w.len, '#fff') + Line(x, y0, x, y0 + w.len, WIN, 0.06); }
  else { var y = w.side === 'top' ? rm.y : rm.y + rm.h, x0 = w.pos - w.len / 2; s += R(x0, y - 0.1, w.len, 0.2, '#fff') + Line(x0, y, x0 + w.len, y, WIN, 0.06); } }); return s; }
function furnitureSVG(rm) { var x = rm.x, y = rm.y, w = rm.w, h = rm.h, cx = x + w / 2, cy = y + h / 2, s = '';
  var st = ' stroke="' + FURN + '" stroke-width="0.05" fill="none"';
  function box(bx, by, bw, bh, r) { return '<rect x="' + bx + '" y="' + by + '" width="' + bw + '" height="' + bh + '" rx="' + (r || 0.05) + '"' + st + '/>'; }
  function circ(a, b, r) { return '<circle cx="' + a + '" cy="' + b + '" r="' + r + '"' + st + '/>'; }
  if (w < 1.4 || h < 1.4) return '';
  switch (rm.type) {
    case 'bedroom': { var bw = Math.min(1.6, w * 0.5), bl = Math.min(2.0, h * 0.55), bx = x + 0.35, by = cy - bl / 2; s += box(bx, by, bw, bl, 0.08) + box(bx + 0.12, by + 0.12, bw - 0.24, 0.4, 0.06) + box(bx + bw + 0.12, by, 0.5, 0.5); break; }
    case 'living': { var sw = Math.min(2.6, w * 0.62); s += box(cx - sw / 2, y + h - 1.1, sw, 0.85, 0.1) + box(cx - sw / 2, y + h - 1.15, sw, 0.22, 0.06) + box(cx - 0.6, cy - 0.3, 1.2, 0.6, 0.08) + box(cx - 0.8, y + 0.2, 1.6, 0.12, 0.03); break; }
    case 'kitchen': { s += box(x + 0.25, y + 0.25, w - 0.5, 0.6, 0.04) + circ(x + 0.9, y + 0.55, 0.16) + circ(x + 1.35, y + 0.55, 0.16) + box(cx - 0.8, cy + 0.1, 1.6, 0.7, 0.05); break; }
    case 'bathroom': { s += box(x + 0.25, y + 0.25, Math.min(1.6, w * 0.7), 0.75, 0.18) + circ(x + w - 0.55, y + 0.55, 0.22) + box(x + w - 0.85, y + h - 0.75, 0.6, 0.45, 0.05); break; }
    case 'dining': { var tw = Math.min(2.0, w * 0.5), tl = Math.min(1.1, h * 0.4); s += box(cx - tw / 2, cy - tl / 2, tw, tl, 0.06); for (var i = -1; i <= 1; i += 2) for (var j = -1; j <= 1; j += 2) s += box(cx + i * tw * 0.32 - 0.2, cy + j * (tl / 2 + 0.18) - 0.2, 0.4, 0.4, 0.04); break; }
    case 'garage': { s += box(cx - 0.9, cy - 2.0, 1.8, 4.0, 0.3) + circ(cx - 0.9, cy - 1.2, 0.18) + circ(cx + 0.9, cy - 1.2, 0.18) + circ(cx - 0.9, cy + 1.2, 0.18) + circ(cx + 0.9, cy + 1.2, 0.18); break; }
  } return s; }
function dimSVG(L) { var f = L.foot, s = '', o = 0.9, yb = f.y + f.h + o;
  s += Line(f.x, yb, f.x + f.w, yb, '#9aa3af', 0.03) + Line(f.x, yb - 0.2, f.x, yb + 0.2, '#9aa3af', 0.03) + Line(f.x + f.w, yb - 0.2, f.x + f.w, yb + 0.2, '#9aa3af', 0.03) + T(f.x + f.w / 2, yb - 0.18, f.w.toFixed(1) + ' m', 0.5, '#5a6573');
  var xl = f.x - o; s += Line(xl, f.y, xl, f.y + f.h, '#9aa3af', 0.03) + Line(xl - 0.2, f.y, xl + 0.2, f.y, '#9aa3af', 0.03) + Line(xl - 0.2, f.y + f.h, xl + 0.2, f.y + f.h, '#9aa3af', 0.03);
  s += '<text x="' + (xl - 0.25) + '" y="' + (f.y + f.h / 2) + '" font-size="0.5" fill="#5a6573" text-anchor="middle" transform="rotate(-90 ' + (xl - 0.25) + ' ' + (f.y + f.h / 2) + ')" font-family="Inter,sans-serif">' + f.h.toFixed(1) + ' m</text>'; return s; }
function drawPlan() {
  if (!L) return; var f = L.foot, fl = L.floors[currentFloor];
  var vbX = f.x - 2.4, vbY = f.y - 2.2, vbW = f.w + 4.8, vbH = f.h + 5.6;
  var p = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + vbX + ' ' + vbY + ' ' + vbW + ' ' + vbH + '" style="width:100%;height:100%">'];
  p.push(R(vbX, vbY, vbW, vbH, '#ffffff'));
  p.push(R(f.x, f.y, f.w, f.h, '#f4f6f8', WALL, 0.22));
  if (fl.corridor) { p.push(R(fl.corridor.x, fl.corridor.y, fl.corridor.w, fl.corridor.h, FILL.corridor)); p.push(T(fl.corridor.x + fl.corridor.w / 2, fl.corridor.y + fl.corridor.h / 2, fl.corridor.h > 2 ? 'HALL' : 'ENTRY', 0.42, '#7b8694')); }
  fl.rooms.forEach(function (rm) {
    if (rm.type === 'corridor' && fl.corridor && Math.abs(rm.x - fl.corridor.x) < 0.05 && Math.abs(rm.y - fl.corridor.y) < 0.05) return;
    if (rm.type === 'corridor') {
      var fill = rm.name === 'Hall' ? FILL.living : FILL.corridor;
      p.push(R(rm.x, rm.y, rm.w, rm.h, fill, rm.name === 'Hall' ? 'none' : WALL, rm.name === 'Hall' ? 0 : 0.1));
      if (rm.name !== 'Hall') p.push(T(rm.x + rm.w / 2, rm.y + rm.h / 2, rm.name, 0.42, '#7b8694'));
      return;
    }
    p.push(R(rm.x, rm.y, rm.w, rm.h, FILL[rm.type] || FILL.room, WALL, 0.12) + furnitureSVG(rm) + doorSVG(rm) + windowSVG(rm));
    if (rm.w > 1.6 && rm.h > 1.1) { p.push(T(rm.x + rm.w / 2, rm.y + rm.h / 2, rm.name, Math.min(0.6, rm.w / 8), LBL, 'middle', '600')); p.push(T(rm.x + rm.w / 2, rm.y + rm.h / 2 + 0.6, rm.area.toFixed(1) + ' m²', 0.42, '#7b8694')); }
  });
  if (fl.entrance) { p.push(R(fl.entrance.x - fl.entrance.width / 2, fl.entrance.y - 0.13, fl.entrance.width, 0.26, '#fff')); p.push(T(fl.entrance.x, fl.entrance.y + 0.7, '▲ ENTRANCE', 0.4, '#34a07a')); }
  if (fl.stairs) {
    var st = fl.stairs;
    p.push(R(st.x, st.y, st.w, st.h, '#ddd8cf', WALL, 0.08));
    for (var si = 0; si < 5; si++) p.push(R(st.x + 0.08, st.y + 0.08 + si * (st.h / 5), st.w - 0.16, st.h / 5 - 0.04, 'none', '#b8b0a4', 0.04));
    p.push(T(st.x + st.w / 2, st.y + st.h / 2, 'STAIRS', 0.38, '#7b8694'));
  }
  p.push(dimSVG(L));
  var nx = f.x + f.w + 1.4, ny = f.y + 0.2;
  p.push('<circle cx="' + nx + '" cy="' + ny + '" r="0.6" fill="none" stroke="#9aa3af" stroke-width="0.04"/><path d="M ' + nx + ' ' + (ny - 0.5) + ' L ' + (nx - 0.22) + ' ' + (ny + 0.2) + ' L ' + nx + ' ' + (ny - 0.05) + ' L ' + (nx + 0.22) + ' ' + (ny + 0.2) + ' z" fill="#5a6573"/>' + T(nx, ny + 0.9, 'N', 0.45, '#5a6573'));
  var ty = f.y + f.h + 2.2;
  var title = (cfg.style.charAt(0).toUpperCase() + cfg.style.slice(1)) + ' house — Level ' + (currentFloor + 1);
  if (planMeta && (planMeta.source === 'pro-template' || planMeta.source === 'template')) title += ' (pro plan)';
  p.push(T(f.x, ty, title, 0.62, LBL, 'start', '700'));
  p.push(T(f.x, ty + 0.85, cfg.bedrooms + ' bed · ' + cfg.bathrooms + ' bath · ' + cfg.floors + ' floor(s) · ' + fmt(cfg.plotW * cfg.plotD) + ' m² plot', 0.46, '#7b8694', 'start'));
  if (planMeta && planMeta.concept) p.push(T(f.x, ty + 1.55, planMeta.concept.slice(0, 120), 0.42, '#5a6573', 'start'));
  p.push('</svg>'); $('planHost').innerHTML = p.join('');
}
function downloadPlanSVG() { dl(new Blob([$('planHost').innerHTML], { type: 'image/svg+xml' }), 'floorplan-L' + (currentFloor + 1) + '.svg'); }
function downloadPlanPNG() { var svg = $('planHost').querySelector('svg'); if (!svg) return; var xml = new XMLSerializer().serializeToString(svg); var img = new Image();
  img.onload = function () { var c = document.createElement('canvas'); c.width = 1600; c.height = Math.round(1600 * (svg.viewBox.baseVal.height / svg.viewBox.baseVal.width)); var g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height); c.toBlob(function (b) { dl(b, 'floorplan-L' + (currentFloor + 1) + '.png'); }); };
  img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(xml))); }
function dl(blob, name) { var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000); }

/* ---------------- tabs ---------------- */
function tab(name) { ['three', 'plan', 'renders', 'scheme'].forEach(function (t) { $('tab-' + t).classList.toggle('active', t === name); $('panel-' + t).style.display = t === name ? 'flex' : 'none'; }); if (name === 'three' && viewer) viewer._resize(); }

/* ---------------- AI ---------------- */
function view3dMsg(m){var v=document.getElementById('view3d');if(v)v.innerHTML='<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;color:#cdd6e4;background:#12151c;padding:26px;font:14px Inter,sans-serif;line-height:1.7">'+m+'</div>';}
function toast(m) { var t = $('toast'); t.textContent = m; t.style.opacity = '1'; clearTimeout(t._t); t._t = setTimeout(function () { t.style.opacity = '0'; }, 3600); }
function paletteText() { if (!brief || !brief.palette) return ''; return brief.palette.map(function (p) { return (p.name || '') + ' ' + p.hex; }).join(', '); }
async function checkAI() { try { var r = await fetch('/api/ai/status'); var d = await r.json();
  if ($('aiPlanChip')) $('aiPlanChip').classList.toggle('on', true);
  setAIBanner('ok', 'Pro floor plans (' + (d.templates || 3) + ' templates). GPT-4o picks the best layout using <b>free DuckDuckGo</b> web research — no extra API key needed.');
  } catch (e) { setAIBanner('warn', 'Run via the server (node server.js).'); } }
async function diagnoseAI(silent) { try { var r = await fetch('/api/ai/diagnose'); var d = await r.json(); setAIBanner(d.ok ? 'ok' : 'warn', d.message); if (!silent) toast(d.message); } catch (e) { setAIBanner('warn', 'Could not reach OpenAI: ' + e.message); } }
function setAIBanner(kind, msg) { var b = $('aiBanner'); b.className = 'aibanner ' + kind; b.innerHTML = msg; }
async function genScheme() { if (!cfg) return; var btn = $('schemeBtn'); btn.disabled = true;
  try { var r = await fetch('/api/ai/design-brief', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ style: cfg.style, area: Math.round(cfg.plotW * cfg.plotD), floors: cfg.floors, bedrooms: cfg.bedrooms, bathrooms: cfg.bathrooms, kitchens: cfg.kitchens, living: cfg.living, dining: cfg.dining, garage: cfg.garage }) });
    var d = await r.json(); if (!r.ok) throw new Error((d.error || 'Failed') + (d.hint ? ' — ' + d.hint : '')); brief = d.brief; renderScheme(brief); tab('scheme'); toast('Design scheme ready');
  } catch (e) { toast('Scheme: ' + e.message); } finally { btn.disabled = false; } }
function renderScheme(b) { var h = '<div class="concept">' + (b.concept || '') + '</div><div class="swatches">';
  (b.palette || []).forEach(function (p) { if (!/^#?[0-9a-f]{6}$/i.test(p.hex || '')) return; h += '<div class="sw" style="background:' + p.hex + '" title="' + (p.name || '') + ' ' + p.hex + '"><span>' + (p.name || '').slice(0, 9) + '</span></div>'; });
  h += '</div>'; var rooms = b.rooms || {}; Object.keys(rooms).forEach(function (k) { if (rooms[k] && rooms[k].notes) h += '<div class="rnote"><b>' + k + '</b> ' + rooms[k].notes + '</div>'; }); $('schemeOut').innerHTML = h; }
async function renderView(view, label) { tab('renders'); var cell = document.createElement('div'); cell.className = 'shot'; cell.innerHTML = '<div class="spin"></div><div class="cap">' + label + '…</div>'; $('gallery').prepend(cell);
  try { var key = view.split(' ').pop(); var body = { style: cfg.style, view: view, floors: cfg.floors, bedrooms: cfg.bedrooms, area: Math.round(cfg.plotW * cfg.plotD), palette: paletteText(), notes: brief && brief.rooms && brief.rooms[key] ? brief.rooms[key].notes : '', references: refs.slice(0, 3).map(function (r) { return { b64: r.b64, type: r.type }; }) };
    var r = await fetch('/api/ai/render', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); var d = await r.json(); if (!r.ok) throw new Error((d.error || 'Failed') + (d.hint ? '\n' + d.hint : ''));
    var src = d.b64 ? 'data:image/png;base64,' + d.b64 : d.url; cell.innerHTML = '<img src="' + src + '" alt="' + label + '"><div class="cap"><span>' + label + '</span><a class="dlink" download="' + view.replace(/\s+/g, '-') + '.png" href="' + src + '">↓ save</a></div>'; cell.querySelector('img').onclick = function () { window.open(src, '_blank'); };
  } catch (e) { cell.className = 'shot err'; cell.innerHTML = '<div class="cap">⚠ ' + label + '</div><div class="emsg">' + e.message + '</div>'; toast('Render failed — see card'); } }

/* ---------------- references ---------------- */
function addRef(b64, type, durl) { refs.push({ b64: b64, type: type }); var im = document.createElement('div'); im.className = 'refthumb'; im.innerHTML = '<img src="' + durl + '"><button>×</button>'; im.querySelector('button').onclick = function () { var i = refs.findIndex(function (x) { return x.b64 === b64; }); if (i > -1) refs.splice(i, 1); im.remove(); }; $('refStrip').appendChild(im); }
function handleFiles(files) { Array.prototype.forEach.call(files, function (file) { var rd = new FileReader(); rd.onload = function () { var img = new Image(); img.onload = function () { var mx = 768, sc = Math.min(1, mx / Math.max(img.width, img.height)); var c = document.createElement('canvas'); c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); var durl = c.toDataURL('image/png'); addRef(durl.split(',')[1], 'image/png', durl); }; img.src = rd.result; }; rd.readAsDataURL(file); }); }
function pickWebImage(url) {
  return new Promise(function (resolve, reject) {
    var img = new Image(); img.crossOrigin = 'anonymous';
    img.onload = function () { var mx = 768, sc = Math.min(1, mx / Math.max(img.width, img.height)); var c = document.createElement('canvas'); c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); var durl = c.toDataURL('image/png'); addRef(durl.split(',')[1], 'image/png', durl); resolve(); };
    img.onerror = function () { reject(new Error('Could not load image')); }; img.src = url;
  });
}
async function searchWeb() {
  var q = ($('webQuery').value || '').trim() || (cfg ? cfg.style + ' house interior' : 'modern house interior');
  var btn = $('webSearchBtn'); btn.disabled = true; $('webGrid').innerHTML = '<div class="hint">Searching…</div>';
  try {
    var r = await fetch('/api/reference-images?q=' + encodeURIComponent(q)); var d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Search failed');
    if (!d.images || !d.images.length) { $('webGrid').innerHTML = '<div class="hint">No results for that query.</div>'; return; }
    $('webGrid').innerHTML = '';
    d.images.forEach(function (im) {
      var b = document.createElement('button'); b.type = 'button'; b.className = 'webpick'; b.title = im.alt || q;
      b.innerHTML = '<img src="' + im.thumb + '" alt="">';
      b.onclick = function () { pickWebImage(im.full).then(function () { toast('Reference added'); }).catch(function (e) { toast(e.message); }); };
      $('webGrid').appendChild(b);
    });
  } catch (e) { $('webGrid').innerHTML = '<div class="hint">' + e.message + '</div>'; }
  finally { btn.disabled = false; }
}
function syncChips() { $('diningChip').classList.toggle('on', $('dining').checked); $('garageChip').classList.toggle('on', $('garage').checked); }

/* ---------------- boot ---------------- */
function randomize() { $('plotW').value = 12 + Math.floor(Math.random() * 16); $('plotD').value = 10 + Math.floor(Math.random() * 12); $('floors').value = 1 + Math.floor(Math.random() * 3); $('bedrooms').value = 1 + Math.floor(Math.random() * 5); $('bathrooms').value = 1 + Math.floor(Math.random() * 3); $('kitchens').value = 1; $('living').value = 1; $('style').value = ['modern', 'traditional', 'minimalist', 'scandinavian', 'industrial'][Math.floor(Math.random() * 5)]; $('dining').checked = true; $('garage').checked = Math.random() > 0.4; syncChips(); generate(false); }
function boot() {
  try { if (window.House3D && window.House3D.Viewer) viewer = new window.House3D.Viewer($('view3d')); } catch (e) {}
  $('generateBtn').onclick = function () { generate(false); }; $('randomBtn').onclick = randomize;
  ['plotW', 'plotD'].forEach(function (id) { $(id).addEventListener('input', updateArea); });
  $('dining').onchange = syncChips; $('garage').onchange = syncChips;
  $('aiPlans').onchange = function () { aiPlansOn = $('aiPlans').checked; $('aiPlanChip').classList.toggle('on', aiPlansOn); };
  ['three', 'plan', 'renders', 'scheme'].forEach(function (t) { $('tab-' + t).onclick = function () { tab(t); }; });
  $('dlSvg').onclick = downloadPlanSVG; $('dlPng').onclick = downloadPlanPNG;
  $('schemeBtn').onclick = genScheme; $('diagBtn').onclick = function () { diagnoseAI(false); };
  document.querySelectorAll('[data-view]').forEach(function (b) { b.onclick = function () { if (!cfg) { toast('Generate a house first'); return; } renderView(b.dataset.view, b.textContent); }; });
  $('uploadBtn').onclick = function () { $('fileInput').click(); }; $('fileInput').onchange = function (e) { handleFiles(e.target.files); };
  $('webSearchBtn').onclick = searchWeb; $('webQuery').addEventListener('keydown', function (e) { if (e.key === 'Enter') searchWeb(); });
  document.querySelectorAll('#mode3d button').forEach(function (b) { b.onclick = function () { if (viewer) viewer.setMode(b.dataset.m); document.querySelectorAll('#mode3d button').forEach(function (x) { x.classList.remove('active'); }); b.classList.add('active'); }; });
  $('cutBtn').onclick = function () { cut = !cut; $('cutBtn').textContent = 'Cutaway: ' + (cut ? 'on' : 'off'); if (viewer) viewer.setCutaway(cut); };
  syncChips(); updateArea(); generate(true); checkAI();
}
boot();
})();
