/* ForthHome — AI House Designer (front-end).
 * Accurate 2D architectural floor plan (SVG) + photoreal AI renders.
 * No WebGL. Uses HouseLayout (layout.js) for the proven-correct plan. */
(function () {
'use strict';
var $ = function (id) { return document.getElementById(id); };
var fmt = function (n) { return Math.round(n).toLocaleString(); };
var M2FT = 10.7639;

var cfg = null, L = null, currentFloor = 0, brief = null, refs = [];

/* room fills + plan colors */
var FILL = { living:'#e9f0f7', bedroom:'#eef1ea', kitchen:'#f5efe5', bathroom:'#e5f1f1', dining:'#f1edf6', garage:'#ededed', corridor:'#e1e5ea', room:'#eef0f2' };
var WALL = '#1f242c', FURN = '#7b8694', LBL = '#252b33', WIN = '#3f7bbf';

/* ---------------- form + generate ---------------- */
function readForm() {
  var n = function (id, d) { var v = parseFloat($(id).value); return isNaN(v) ? d : v; };
  return { plotW: Math.max(6, n('plotW', 18)), plotD: Math.max(6, n('plotD', 14)),
    floors: Math.min(4, Math.max(1, Math.round(n('floors', 2)))),
    bedrooms: Math.max(0, Math.round(n('bedrooms', 3))), bathrooms: Math.max(0, Math.round(n('bathrooms', 2))),
    kitchens: Math.max(0, Math.round(n('kitchens', 1))), living: Math.max(0, Math.round(n('living', 1))),
    dining: $('dining').checked, garage: $('garage').checked, style: $('style').value };
}
function generate() {
  cfg = readForm(); L = window.HouseLayout.computeLayout(cfg); currentFloor = 0;
  $('welcome').style.display = 'none'; $('planArea').style.display = 'block';
  var bar = $('floorBar'); bar.innerHTML = '';
  for (var f = 0; f < cfg.floors; f++) {
    var b = document.createElement('button'); b.className = 'fbtn' + (f === 0 ? ' active' : ''); b.textContent = 'Level ' + (f + 1);
    (function (i, btn) { btn.onclick = function () { currentFloor = i; document.querySelectorAll('#floorBar .fbtn').forEach(function (x) { x.classList.remove('active'); }); btn.classList.add('active'); drawPlan(); }; })(f, b);
    bar.appendChild(b);
  }
  updateArea(); drawPlan();
}
function updateArea() {
  var a = (parseFloat($('plotW').value) || 0) * (parseFloat($('plotD').value) || 0);
  $('areaStat').textContent = fmt(a) + ' m²'; $('areaFt').textContent = fmt(a * M2FT) + ' ft²';
}

/* ---------------- SVG floor plan ---------------- */
function R(x, y, w, h, fill, stroke, sw) { return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" fill="' + (fill || 'none') + '"' + (stroke ? ' stroke="' + stroke + '" stroke-width="' + sw + '"' : '') + '/>'; }
function Line(x1, y1, x2, y2, stroke, sw, dash) { return '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" stroke="' + stroke + '" stroke-width="' + sw + '"' + (dash ? ' stroke-dasharray="' + dash + '"' : '') + ' stroke-linecap="round"/>'; }
function T(x, y, s, size, color, anchor, weight) { return '<text x="' + x + '" y="' + y + '" font-size="' + size + '" fill="' + (color || LBL) + '" text-anchor="' + (anchor || 'middle') + '" font-family="Inter,Segoe UI,sans-serif"' + (weight ? ' font-weight="' + weight + '"' : '') + '>' + s + '</text>'; }

function doorSVG(rm) {
  var d = rm.door; if (!d) return '';
  var hw = d.width, s = '';
  if (d.side === 'right' || d.side === 'left') {
    var x = d.side === 'right' ? rm.x + rm.w : rm.x, y0 = d.pos - hw / 2;
    s += R(x - 0.13, y0, 0.26, hw, '#fff'); // gap
    var dir = d.side === 'right' ? 1 : -1;
    s += Line(x, y0, x + dir * hw, y0, '#5a6573', 0.05); // leaf
    s += '<path d="M ' + x + ' ' + y0 + ' A ' + hw + ' ' + hw + ' 0 0 ' + (dir > 0 ? 1 : 0) + ' ' + (x + dir * hw) + ' ' + (y0 + hw) + '" fill="none" stroke="#9aa3af" stroke-width="0.03"/>';
  } else {
    var yb = d.side === 'bottom' ? rm.y + rm.h : rm.y, x0 = d.pos - hw / 2;
    s += R(x0, yb - 0.13, hw, 0.26, '#fff');
    s += Line(x0, yb, x0, yb - hw, '#5a6573', 0.05);
    s += '<path d="M ' + x0 + ' ' + yb + ' A ' + hw + ' ' + hw + ' 0 0 1 ' + (x0 + hw) + ' ' + (yb - hw) + '" fill="none" stroke="#9aa3af" stroke-width="0.03"/>';
  }
  return s;
}
function windowSVG(rm) {
  var s = '';
  rm.windows.forEach(function (w) {
    if (w.side === 'left' || w.side === 'right') {
      var x = w.side === 'left' ? rm.x : rm.x + rm.w, y0 = w.pos - w.len / 2;
      s += R(x - 0.1, y0, 0.2, w.len, '#fff') + Line(x, y0, x, y0 + w.len, WIN, 0.06);
    } else {
      var y = w.side === 'top' ? rm.y : rm.y + rm.h, x0 = w.pos - w.len / 2;
      s += R(x0, y - 0.1, w.len, 0.2, '#fff') + Line(x0, y, x0 + w.len, y, WIN, 0.06);
    }
  });
  return s;
}
function furnitureSVG(rm) {
  var x = rm.x, y = rm.y, w = rm.w, h = rm.h, cx = x + w / 2, cy = y + h / 2, s = '';
  var st = ' stroke="' + FURN + '" stroke-width="0.05" fill="none"';
  function box(bx, by, bw, bh, r) { return '<rect x="' + bx + '" y="' + by + '" width="' + bw + '" height="' + bh + '" rx="' + (r || 0.05) + '"' + st + '/>'; }
  function circ(ccx, ccy, rr) { return '<circle cx="' + ccx + '" cy="' + ccy + '" r="' + rr + '"' + st + '/>'; }
  if (w < 1.4 || h < 1.4) return '';
  switch (rm.type) {
    case 'bedroom': { var bw = Math.min(1.6, w * 0.5), bl = Math.min(2.0, h * 0.55); var bx = x + 0.35, by = cy - bl / 2;
      s += box(bx, by, bw, bl, 0.08) + box(bx + 0.12, by + 0.12, bw - 0.24, 0.4, 0.06);
      s += box(bx + bw + 0.12, by, 0.5, 0.5); break; }
    case 'living': { var sw = Math.min(2.6, w * 0.62); s += box(cx - sw / 2, y + h - 1.1, sw, 0.85, 0.1) + box(cx - sw / 2, y + h - 1.15, sw, 0.22, 0.06);
      s += box(cx - 0.6, cy - 0.3, 1.2, 0.6, 0.08); s += box(cx - 0.8, y + 0.2, 1.6, 0.12, 0.03); break; }
    case 'kitchen': { s += box(x + 0.25, y + 0.25, w - 0.5, 0.6, 0.04); s += circ(x + 0.9, y + 0.55, 0.16) + circ(x + 1.35, y + 0.55, 0.16);
      s += box(cx - 0.8, cy + 0.1, 1.6, 0.7, 0.05); break; }
    case 'bathroom': { s += box(x + 0.25, y + 0.25, Math.min(1.6, w * 0.7), 0.75, 0.18); s += circ(x + w - 0.55, y + 0.55, 0.22); s += box(x + w - 0.85, y + h - 0.75, 0.6, 0.45, 0.05); break; }
    case 'dining': { var tw = Math.min(2.0, w * 0.5), tl = Math.min(1.1, h * 0.4); s += box(cx - tw / 2, cy - tl / 2, tw, tl, 0.06);
      for (var i = -1; i <= 1; i += 2) for (var j = -1; j <= 1; j += 2) s += box(cx + i * tw * 0.32 - 0.2, cy + j * (tl / 2 + 0.18) - 0.2, 0.4, 0.4, 0.04); break; }
    case 'garage': { s += box(cx - 0.9, cy - 2.0, 1.8, 4.0, 0.3); s += circ(cx - 0.9, cy - 1.2, 0.18) + circ(cx + 0.9, cy - 1.2, 0.18) + circ(cx - 0.9, cy + 1.2, 0.18) + circ(cx + 0.9, cy + 1.2, 0.18); break; }
  }
  return s;
}
function stairsSVG(st) {
  if (!st) return ''; var s = R(st.x, st.y, st.w, st.h, '#d7dce2', WALL, 0.06), n = 7;
  for (var i = 1; i < n; i++) s += Line(st.x, st.y + st.h * i / n, st.x + st.w, st.y + st.h * i / n, '#9aa3af', 0.04);
  s += '<path d="M ' + (st.x + st.w / 2) + ' ' + (st.y + st.h - 0.3) + ' L ' + (st.x + st.w / 2) + ' ' + (st.y + 0.3) + '" stroke="#5a6573" stroke-width="0.06" marker-end="url(#arr)"/>';
  s += T(st.x + st.w / 2, st.y + st.h + 0.5, 'UP', 0.4, '#5a6573'); return s;
}
function dimSVG(L) {
  var f = L.foot, s = '', o = 0.9;
  // bottom width
  var yb = f.y + f.h + o;
  s += Line(f.x, yb, f.x + f.w, yb, '#9aa3af', 0.03) + Line(f.x, yb - 0.2, f.x, yb + 0.2, '#9aa3af', 0.03) + Line(f.x + f.w, yb - 0.2, f.x + f.w, yb + 0.2, '#9aa3af', 0.03);
  s += T(f.x + f.w / 2, yb - 0.18, f.w.toFixed(1) + ' m', 0.5, '#5a6573');
  // left depth
  var xl = f.x - o;
  s += Line(xl, f.y, xl, f.y + f.h, '#9aa3af', 0.03) + Line(xl - 0.2, f.y, xl + 0.2, f.y, '#9aa3af', 0.03) + Line(xl - 0.2, f.y + f.h, xl + 0.2, f.y + f.h, '#9aa3af', 0.03);
  s += '<text x="' + (xl - 0.25) + '" y="' + (f.y + f.h / 2) + '" font-size="0.5" fill="#5a6573" text-anchor="middle" transform="rotate(-90 ' + (xl - 0.25) + ' ' + (f.y + f.h / 2) + ')" font-family="Inter,sans-serif">' + f.h.toFixed(1) + ' m</text>';
  return s;
}
function drawPlan() {
  var f = L.foot, fl = L.floors[currentFloor];
  var vbX = f.x - 2.4, vbY = f.y - 2.2, vbW = f.w + 4.8, vbH = f.h + 5.6;
  var p = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + vbX + ' ' + vbY + ' ' + vbW + ' ' + vbH + '" style="width:100%;height:100%">'];
  p.push('<defs><marker id="arr" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 z" fill="#5a6573"/></marker></defs>');
  p.push(R(vbX, vbY, vbW, vbH, '#ffffff')); // paper
  // footprint slab + outer wall
  p.push(R(f.x, f.y, f.w, f.h, '#f4f6f8', WALL, 0.22));
  // corridor
  if (fl.corridor) { p.push(R(fl.corridor.x, fl.corridor.y, fl.corridor.w, fl.corridor.h, FILL.corridor)); p.push(T(fl.corridor.x + fl.corridor.w / 2, fl.corridor.y + fl.corridor.h - 0.4, 'HALL', 0.42, '#7b8694')); }
  // rooms
  fl.rooms.forEach(function (rm) {
    p.push(R(rm.x, rm.y, rm.w, rm.h, FILL[rm.type] || FILL.room, WALL, 0.12));
    p.push(furnitureSVG(rm));
    p.push(doorSVG(rm)); p.push(windowSVG(rm));
    if (rm.w > 1.6 && rm.h > 1.1) { p.push(T(rm.x + rm.w / 2, rm.y + rm.h / 2, rm.name, Math.min(0.6, rm.w / 8), LBL, 'middle', '600'));
      p.push(T(rm.x + rm.w / 2, rm.y + rm.h / 2 + 0.6, rm.area.toFixed(1) + ' m²', 0.42, '#7b8694')); }
  });
  p.push(stairsSVG(fl.stairs));
  // entrance marker
  if (fl.entrance) { p.push(R(fl.entrance.x - fl.entrance.width / 2, fl.entrance.y - 0.13, fl.entrance.width, 0.26, '#fff')); p.push(T(fl.entrance.x, fl.entrance.y + 0.7, '▲ ENTRANCE', 0.4, '#34a07a')); }
  p.push(dimSVG(L));
  // north arrow
  var nx = f.x + f.w + 1.4, ny = f.y + 0.2;
  p.push('<g><circle cx="' + nx + '" cy="' + ny + '" r="0.6" fill="none" stroke="#9aa3af" stroke-width="0.04"/><path d="M ' + nx + ' ' + (ny - 0.5) + ' L ' + (nx - 0.22) + ' ' + (ny + 0.2) + ' L ' + nx + ' ' + (ny - 0.05) + ' L ' + (nx + 0.22) + ' ' + (ny + 0.2) + ' z" fill="#5a6573"/>' + T(nx, ny + 0.9, 'N', 0.45, '#5a6573') + '</g>');
  // title block
  var ty = f.y + f.h + 2.2;
  p.push(T(f.x, ty, (cfg.style.charAt(0).toUpperCase() + cfg.style.slice(1)) + ' house — Level ' + (currentFloor + 1), 0.62, LBL, 'start', '700'));
  p.push(T(f.x, ty + 0.85, cfg.bedrooms + ' bed · ' + cfg.bathrooms + ' bath · ' + cfg.floors + ' floor(s) · ' + fmt(cfg.plotW * cfg.plotD) + ' m² plot', 0.46, '#7b8694', 'start'));
  p.push('</svg>');
  $('planHost').innerHTML = p.join('');
}

/* ---------------- exports ---------------- */
function downloadPlanSVG() { var blob = new Blob([$('planHost').innerHTML], { type: 'image/svg+xml' }); dl(blob, 'floorplan-L' + (currentFloor + 1) + '.svg'); }
function downloadPlanPNG() {
  var svg = $('planHost').querySelector('svg'); var xml = new XMLSerializer().serializeToString(svg);
  var img = new Image(); img.onload = function () { var c = document.createElement('canvas'); c.width = 1600; c.height = Math.round(1600 * (svg.viewBox.baseVal.height / svg.viewBox.baseVal.width));
    var g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height); c.toBlob(function (b) { dl(b, 'floorplan-L' + (currentFloor + 1) + '.png'); }); };
  img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(xml)));
}
function dl(blob, name) { var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000); }

/* ---------------- tabs ---------------- */
function tab(name) {
  ['plan', 'renders', 'scheme'].forEach(function (t) { $('tab-' + t).classList.toggle('active', t === name); $('panel-' + t).style.display = t === name ? 'flex' : 'none'; });
}

/* ---------------- AI ---------------- */
function toast(m) { var t = $('toast'); t.textContent = m; t.style.opacity = '1'; clearTimeout(t._t); t._t = setTimeout(function () { t.style.opacity = '0'; }, 3400); }
function paletteText() { if (!brief || !brief.palette) return ''; return brief.palette.map(function (p) { return p.name + ' ' + p.hex; }).join(', '); }
async function checkAI() {
  try { var r = await fetch('/api/ai/status'); var d = await r.json();
    if (!d.openai) { setAIBanner('warn', 'No OpenAI key found in .env. Add OPENAI_API_KEY and restart to enable AI renders.'); return; }
    setAIBanner('', 'Checking OpenAI access…'); diagnoseAI(true);
  } catch (e) { setAIBanner('warn', 'Start the server (node server.js) and open http://localhost:3000 to enable AI.'); }
}
async function diagnoseAI(silent) {
  try { var r = await fetch('/api/ai/diagnose'); var d = await r.json();
    if (d.ok) setAIBanner('ok', d.message); else setAIBanner('warn', d.message);
    if (!silent) toast(d.message);
  } catch (e) { setAIBanner('warn', 'Could not reach OpenAI: ' + e.message); }
}
function setAIBanner(kind, msg) { var b = $('aiBanner'); b.className = 'aibanner ' + kind; b.innerHTML = msg; }
async function genScheme() {
  if (!cfg) return; showBusy($('schemeBtn'), true);
  try {
    var r = await fetch('/api/ai/design-brief', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ style: cfg.style, area: Math.round(cfg.plotW * cfg.plotD), floors: cfg.floors, bedrooms: cfg.bedrooms, bathrooms: cfg.bathrooms, kitchens: cfg.kitchens, living: cfg.living, dining: cfg.dining, garage: cfg.garage }) });
    var d = await r.json(); if (!r.ok) throw new Error((d.error || 'Failed') + (d.hint ? ' — ' + d.hint : ''));
    brief = d.brief; renderScheme(brief); tab('scheme'); toast('Design scheme ready');
  } catch (e) { toast('Scheme: ' + e.message); } finally { showBusy($('schemeBtn'), false); }
}
function renderScheme(b) {
  var h = '<div class="concept">' + (b.concept || '') + '</div><div class="swatches">';
  (b.palette || []).forEach(function (p) { if (!/^#?[0-9a-f]{6}$/i.test(p.hex || '')) return; h += '<div class="sw" style="background:' + p.hex + '" title="' + (p.name || '') + ' ' + p.hex + '"><span>' + (p.name || '').slice(0, 9) + '</span></div>'; });
  h += '</div>'; var rooms = b.rooms || {};
  Object.keys(rooms).forEach(function (k) { if (rooms[k] && rooms[k].notes) h += '<div class="rnote"><b>' + k + '</b> ' + rooms[k].notes + '</div>'; });
  $('schemeOut').innerHTML = h;
}
async function renderView(view, label) {
  tab('renders');
  var cell = document.createElement('div'); cell.className = 'shot loading'; cell.innerHTML = '<div class="spin"></div><div class="cap">' + label + '…</div>';
  $('gallery').prepend(cell);
  try {
    var body = { style: cfg.style, view: view, floors: cfg.floors, bedrooms: cfg.bedrooms, area: Math.round(cfg.plotW * cfg.plotD), palette: paletteText(), notes: brief && brief.rooms && brief.rooms[view.split(' ')[0]] ? brief.rooms[view.split(' ')[0]].notes : '', references: refs.slice(0, 3).map(function (r) { return { b64: r.b64, type: r.type }; }) };
    var r = await fetch('/api/ai/render', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    var d = await r.json(); if (!r.ok) throw new Error((d.error || 'Failed') + (d.hint ? '\n' + d.hint : ''));
    var src = d.b64 ? 'data:image/png;base64,' + d.b64 : d.url;
    cell.className = 'shot'; cell.innerHTML = '<img src="' + src + '" alt="' + label + '"><div class="cap">' + label + ' <a class="dlink" download="' + view.replace(/\s+/g, '-') + '.png" href="' + src + '">↓</a></div>';
    cell.querySelector('img').onclick = function () { window.open(src, '_blank'); };
  } catch (e) { cell.className = 'shot err'; cell.innerHTML = '<div class="cap">⚠ ' + label + '</div><div class="emsg">' + e.message + '</div>'; toast('Render failed — see card'); }
}
function showBusy(btn, on) { if (!btn) return; btn.disabled = on; btn.dataset.label = btn.dataset.label || btn.textContent; btn.innerHTML = on ? '<span class="spin sm"></span> Working…' : btn.dataset.label; }

/* ---------------- reference images ---------------- */
function addRef(b64, type, dataURL) { refs.push({ b64: b64, type: type }); var im = document.createElement('div'); im.className = 'refthumb'; im.innerHTML = '<img src="' + dataURL + '"><button>×</button>';
  im.querySelector('button').onclick = function () { var i = refs.findIndex(function (x) { return x.b64 === b64; }); if (i > -1) refs.splice(i, 1); im.remove(); };
  $('refStrip').appendChild(im); }
function handleFiles(files) {
  Array.prototype.forEach.call(files, function (file) {
    var rd = new FileReader(); rd.onload = function () {
      var img = new Image(); img.onload = function () { var max = 768, sc = Math.min(1, max / Math.max(img.width, img.height));
        var c = document.createElement('canvas'); c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); var durl = c.toDataURL('image/png');
        addRef(durl.split(',')[1], 'image/png', durl); };
      img.src = rd.result; }; rd.readAsDataURL(file);
  });
}

/* ---------------- boot ---------------- */
function boot() {
  $('generateBtn').onclick = generate;
  $('randomBtn').onclick = function () {
    $('plotW').value = 12 + Math.floor(Math.random() * 16); $('plotD').value = 10 + Math.floor(Math.random() * 12);
    $('floors').value = 1 + Math.floor(Math.random() * 3); $('bedrooms').value = 1 + Math.floor(Math.random() * 5);
    $('bathrooms').value = 1 + Math.floor(Math.random() * 3); $('kitchens').value = 1; $('living').value = 1;
    $('style').value = ['modern', 'traditional', 'minimalist', 'scandinavian', 'industrial'][Math.floor(Math.random() * 5)];
    $('dining').checked = true; $('garage').checked = Math.random() > 0.4; syncChips(); updateArea(); generate();
  };
  ['plotW', 'plotD'].forEach(function (id) { $(id).addEventListener('input', updateArea); });
  $('dining').onchange = syncChips; $('garage').onchange = syncChips;
  $('tab-plan').onclick = function () { tab('plan'); }; $('tab-renders').onclick = function () { tab('renders'); }; $('tab-scheme').onclick = function () { tab('scheme'); };
  $('dlSvg').onclick = downloadPlanSVG; $('dlPng').onclick = downloadPlanPNG;
  $('schemeBtn').onclick = genScheme; $('diagBtn').onclick = function () { diagnoseAI(false); };
  document.querySelectorAll('[data-view]').forEach(function (b) { b.onclick = function () { if (!cfg) { toast('Generate a house first'); return; } renderView(b.dataset.view, b.textContent); }; });
  $('uploadBtn').onclick = function () { $('fileInput').click(); }; $('fileInput').onchange = function (e) { handleFiles(e.target.files); };
  syncChips(); updateArea(); generate(); checkAI();
}
function syncChips() { $('diningChip').classList.toggle('on', $('dining').checked); $('garageChip').classList.toggle('on', $('garage').checked); }
boot();
})();
