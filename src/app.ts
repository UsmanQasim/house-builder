/* ForthHome — front-end (TypeScript). Walkable 3D model is the main view;
 * accurate 2D plan + photoreal AI renders are extra tabs. */
import { HouseLayout } from './engine/layout.js';
import { Viewer } from './engine/viewer.js';
import type { Layout, Room, RoomType, Spec } from './engine/types.js';

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const $i = (id: string) => document.getElementById(id) as HTMLInputElement;
const fmt = (n: number) => Math.round(n).toLocaleString();
const M2FT = 10.7639;

interface Brief { concept?: string; palette?: { name?: string; hex?: string }[]; rooms?: Partial<Record<string, { notes?: string; accentHex?: string }>>; }
interface PlanMeta { concept?: string; inspiration?: string; source?: string; hits?: number; templateId?: string; }

let cfg: Spec | null = null, L: Layout | null = null, currentFloor = 0, brief: Brief | null = null,
  viewer: Viewer | null = null, cut = false, night = false, planMeta: PlanMeta | null = null, aiPlansOn = true;
const refs: { b64: string; type: string }[] = [];

const FILL: Record<string, string> = { living:'#e9f0f7', bedroom:'#eef1ea', kitchen:'#f5efe5', bathroom:'#e5f1f1', dining:'#f1edf6', garage:'#ededed', corridor:'#e1e5ea', room:'#eef0f2' };
const WALL = '#1f242c', FURNC = '#7b8694', LBL = '#252b33', WINC = '#3f7bbf';

function readForm(): Spec {
  const n = (id: string, d: number) => { const v = parseFloat($i(id).value); return isNaN(v) ? d : v; };
  return { plotW: Math.max(6, n('plotW', 18)), plotD: Math.max(6, n('plotD', 14)),
    floors: Math.min(4, Math.max(1, Math.round(n('floors', 2)))),
    bedrooms: Math.max(0, Math.round(n('bedrooms', 3))), bathrooms: Math.max(0, Math.round(n('bathrooms', 2))),
    kitchens: Math.max(0, Math.round(n('kitchens', 1))), living: Math.max(0, Math.round(n('living', 1))),
    dining: $i('dining').checked, garage: $i('garage').checked, style: ($i('style') as unknown as HTMLSelectElement).value };
}
function briefAccents(): Partial<Record<RoomType, string>> {
  const out: Partial<Record<RoomType, string>> = {};
  if (brief && brief.rooms) {
    (['living', 'bedroom', 'kitchen', 'bathroom', 'dining'] as RoomType[]).forEach(k => {
      const r = brief!.rooms![k];
      if (r && r.accentHex && /^#[0-9a-fA-F]{6}$/.test(r.accentHex)) out[k] = r.accentHex;
    });
  }
  return out;
}
function setBusy(b: boolean, label?: string): void {
  const btn = $('generateBtn') as HTMLButtonElement;
  btn.disabled = b;
  btn.innerHTML = b ? '<span class="spin btnspin"></span> ' + (label || 'Designing…') : 'Generate house';
}
function rebuild3D(): void {
  if (viewer && L && cfg) { viewer._resize(); viewer.build(L, { ...cfg, accents: briefAccents() }); }
}
function applyLayout(layout: Layout, meta?: PlanMeta): void {
  L = layout; planMeta = meta || null; currentFloor = 0;
  $('welcome').style.display = 'none'; $('stage').style.display = 'flex';
  buildFloorBars(); updateArea(); drawPlan(); tab('three');
  if (viewer) rebuild3D();
  else view3dMsg('The 3D engine could not start. Your browser may not support WebGL.');
}
async function generate(silent: boolean): Promise<void> {
  cfg = readForm();
  const p = ($i('promptText')?.value || '').trim();
  const useP = !!p && (!$i('aiPromptToggle') || $i('aiPromptToggle').checked);
  if (useP) cfg.prompt = p;
  setBusy(true, useP ? 'Designing from your description…' : 'AI is drafting your plan…');
  if (!silent) toast(useP ? 'Designing from your description…' : 'AI is designing a bespoke floor plan…');
  try {
    let usedAI = false;
    if (aiPlansOn || useP) {
      try {
        const r = await fetch('/api/ai/floor-plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cfg) });
        const d = await r.json();
        if (r.ok && d.layout) {
          if (useP && d.spec) applySpecToForm(d.spec);
          applyLayout(d.layout, { concept: d.concept, inspiration: d.inspiration, source: d.source, hits: d.researchHits, templateId: d.templateId });
          usedAI = true;
          if (!silent) {
            const msg = d.source === 'ai-generated' ? '✨ Bespoke AI floor plan — newly designed for you'
              : d.source === 'ai-custom' ? '✨ Custom plan from your description'
              : 'Offline plan (add an AI key for bespoke designs)';
            toast(msg + (d.researchHits ? ' · ' + d.researchHits + ' web refs' : ''));
          }
        }
      } catch { /* fall through to local engine */ }
    }
    if (!usedAI) {
      applyLayout(HouseLayout.computeLayout(cfg), { source: 'pro-template' });
      if (!silent) toast('Offline floor plan ready');
    }
  } finally { setBusy(false); }
}
function applySpecToForm(s: Partial<Spec>): void {
  if (!s) return;
  (['plotW', 'plotD', 'floors', 'bedrooms', 'bathrooms', 'kitchens', 'living'] as const).forEach(k => { if (s[k] != null && $i(k)) $i(k).value = String(s[k]); });
  if (typeof s.dining === 'boolean') $i('dining').checked = s.dining;
  if (typeof s.garage === 'boolean') $i('garage').checked = s.garage;
  if (s.style && $i('style')) ($i('style') as unknown as HTMLSelectElement).value = s.style;
  syncChips(); updateArea();
}
function buildFloorBars(): void {
  const defs: [string, (i: number) => void][] = [['floorBar', i => { currentFloor = i; drawPlan(); }], ['floorBar3d', i => { if (viewer) viewer.setFloor(i); }]];
  defs.forEach(pair => {
    const bar = $(pair[0]); if (!bar || !cfg) return; bar.innerHTML = '';
    for (let f = 0; f < cfg.floors; f++) {
      const b = document.createElement('button'); b.className = 'fbtn' + (f === 0 ? ' active' : ''); b.textContent = 'Level ' + (f + 1);
      ((i: number, btn: HTMLButtonElement, fn: (i: number) => void, barEl: HTMLElement) => {
        btn.onclick = () => { fn(i); barEl.querySelectorAll('.fbtn').forEach(x => x.classList.remove('active')); btn.classList.add('active'); };
      })(f, b, pair[1], bar);
      bar.appendChild(b);
    }
  });
}
function updateArea(): void { const a = (parseFloat($i('plotW').value) || 0) * (parseFloat($i('plotD').value) || 0); $('areaStat').textContent = fmt(a) + ' m²'; $('areaFt').textContent = fmt(a * M2FT) + ' ft²'; }

/* ---------------- SVG floor plan ---------------- */
function R(x: number, y: number, w: number, h: number, fill?: string, stroke?: string, sw?: number): string { return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" fill="' + (fill || 'none') + '"' + (stroke ? ' stroke="' + stroke + '" stroke-width="' + sw + '"' : '') + '/>'; }
function Line(x1: number, y1: number, x2: number, y2: number, stroke: string, sw: number): string { return '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" stroke="' + stroke + '" stroke-width="' + sw + '" stroke-linecap="round"/>'; }
function T(x: number, y: number, s: string, size: number, color?: string, anchor?: string, weight?: string): string { return '<text x="' + x + '" y="' + y + '" font-size="' + size + '" fill="' + (color || LBL) + '" text-anchor="' + (anchor || 'middle') + '" font-family="Inter,Segoe UI,sans-serif"' + (weight ? ' font-weight="' + weight + '"' : '') + '>' + s + '</text>'; }
function doorSVG(rm: Room): string {
  const d = rm.door; if (!d) return ''; const hw = d.width; let s = '';
  if (d.side === 'right' || d.side === 'left') {
    const x = d.side === 'right' ? rm.x + rm.w : rm.x, y0 = d.pos - hw / 2, dir = d.side === 'right' ? 1 : -1;
    s += R(x - 0.13, y0, 0.26, hw, '#fff') + Line(x, y0, x + dir * hw, y0, '#5a6573', 0.05);
    s += '<path d="M ' + x + ' ' + y0 + ' A ' + hw + ' ' + hw + ' 0 0 ' + (dir > 0 ? 1 : 0) + ' ' + (x + dir * hw) + ' ' + (y0 + hw) + '" fill="none" stroke="#9aa3af" stroke-width="0.03"/>';
  } else {
    const yb = d.side === 'bottom' ? rm.y + rm.h : rm.y, x0 = d.pos - hw / 2;
    s += R(x0, yb - 0.13, hw, 0.26, '#fff') + Line(x0, yb, x0, yb - hw, '#5a6573', 0.05);
    s += '<path d="M ' + x0 + ' ' + yb + ' A ' + hw + ' ' + hw + ' 0 0 1 ' + (x0 + hw) + ' ' + (yb - hw) + '" fill="none" stroke="#9aa3af" stroke-width="0.03"/>';
  }
  return s;
}
function windowSVG(rm: Room): string {
  let s = '';
  rm.windows.forEach(w => {
    if (w.side === 'left' || w.side === 'right') { const x = w.side === 'left' ? rm.x : rm.x + rm.w, y0 = w.pos - w.len / 2; s += R(x - 0.1, y0, 0.2, w.len, '#fff') + Line(x, y0, x, y0 + w.len, WINC, 0.06); }
    else { const y = w.side === 'top' ? rm.y : rm.y + rm.h, x0 = w.pos - w.len / 2; s += R(x0, y - 0.1, w.len, 0.2, '#fff') + Line(x0, y, x0 + w.len, y, WINC, 0.06); }
  });
  return s;
}
function furnitureSVG(rm: Room): string {
  const x = rm.x, y = rm.y, w = rm.w, h = rm.h, cx = x + w / 2, cy = y + h / 2; let s = '';
  const st = ' stroke="' + FURNC + '" stroke-width="0.05" fill="none"';
  const box = (bx: number, by: number, bw: number, bh: number, r?: number) => '<rect x="' + bx + '" y="' + by + '" width="' + bw + '" height="' + bh + '" rx="' + (r || 0.05) + '"' + st + '/>';
  const circ = (a: number, b: number, r: number) => '<circle cx="' + a + '" cy="' + b + '" r="' + r + '"' + st + '/>';
  if (w < 1.4 || h < 1.4) return '';
  switch (rm.type) {
    case 'bedroom': { const bw = Math.min(1.6, w * 0.5), bl = Math.min(2.0, h * 0.55), bx = x + 0.35, by = cy - bl / 2; s += box(bx, by, bw, bl, 0.08) + box(bx + 0.12, by + 0.12, bw - 0.24, 0.4, 0.06) + box(bx + bw + 0.12, by, 0.5, 0.5); break; }
    case 'living': { const sw = Math.min(2.6, w * 0.62); s += box(cx - sw / 2, y + h - 1.1, sw, 0.85, 0.1) + box(cx - sw / 2, y + h - 1.15, sw, 0.22, 0.06) + box(cx - 0.6, cy - 0.3, 1.2, 0.6, 0.08) + box(cx - 0.8, y + 0.2, 1.6, 0.12, 0.03); break; }
    case 'kitchen': { s += box(x + 0.25, y + 0.25, w - 0.5, 0.6, 0.04) + circ(x + 0.9, y + 0.55, 0.16) + circ(x + 1.35, y + 0.55, 0.16) + box(cx - 0.8, cy + 0.1, 1.6, 0.7, 0.05); break; }
    case 'bathroom': { s += box(x + 0.25, y + 0.25, Math.min(1.6, w * 0.7), 0.75, 0.18) + circ(x + w - 0.55, y + 0.55, 0.22) + box(x + w - 0.85, y + h - 0.75, 0.6, 0.45, 0.05); break; }
    case 'dining': { const tw = Math.min(2.0, w * 0.5), tl = Math.min(1.1, h * 0.4); s += box(cx - tw / 2, cy - tl / 2, tw, tl, 0.06); for (let i = -1; i <= 1; i += 2) for (let j = -1; j <= 1; j += 2) s += box(cx + i * tw * 0.32 - 0.2, cy + j * (tl / 2 + 0.18) - 0.2, 0.4, 0.4, 0.04); break; }
    case 'garage': { s += box(cx - 0.9, cy - 2.0, 1.8, 4.0, 0.3) + circ(cx - 0.9, cy - 1.2, 0.18) + circ(cx + 0.9, cy - 1.2, 0.18) + circ(cx - 0.9, cy + 1.2, 0.18) + circ(cx + 0.9, cy + 1.2, 0.18); break; }
  }
  return s;
}
function dimSVG(L2: Layout): string {
  const f = L2.foot; let s = ''; const o = 0.9, yb = f.y + f.h + o;
  s += Line(f.x, yb, f.x + f.w, yb, '#9aa3af', 0.03) + Line(f.x, yb - 0.2, f.x, yb + 0.2, '#9aa3af', 0.03) + Line(f.x + f.w, yb - 0.2, f.x + f.w, yb + 0.2, '#9aa3af', 0.03) + T(f.x + f.w / 2, yb - 0.18, f.w.toFixed(1) + ' m', 0.5, '#5a6573');
  const xl = f.x - o; s += Line(xl, f.y, xl, f.y + f.h, '#9aa3af', 0.03) + Line(xl - 0.2, f.y, xl + 0.2, f.y, '#9aa3af', 0.03) + Line(xl - 0.2, f.y + f.h, xl + 0.2, f.y + f.h, '#9aa3af', 0.03);
  s += '<text x="' + (xl - 0.25) + '" y="' + (f.y + f.h / 2) + '" font-size="0.5" fill="#5a6573" text-anchor="middle" transform="rotate(-90 ' + (xl - 0.25) + ' ' + (f.y + f.h / 2) + ')" font-family="Inter,sans-serif">' + f.h.toFixed(1) + ' m</text>';
  return s;
}
function drawPlan(): void {
  if (!L || !cfg) return; const f = L.foot, fl = L.floors[currentFloor];
  const vbX = f.x - 2.4, vbY = f.y - 2.2, vbW = f.w + 4.8, vbH = f.h + 5.6;
  const p = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + vbX + ' ' + vbY + ' ' + vbW + ' ' + vbH + '" style="width:100%;height:100%">'];
  p.push(R(vbX, vbY, vbW, vbH, '#ffffff'));
  p.push(R(f.x, f.y, f.w, f.h, '#f4f6f8', WALL, 0.22));
  if (fl.corridor) { p.push(R(fl.corridor.x, fl.corridor.y, fl.corridor.w, fl.corridor.h, FILL.corridor)); p.push(T(fl.corridor.x + fl.corridor.w / 2, fl.corridor.y + fl.corridor.h / 2, fl.corridor.h > 2 ? 'HALL' : 'ENTRY', 0.42, '#7b8694')); }
  fl.rooms.forEach(rm => {
    if (rm.type === 'corridor' && fl.corridor && Math.abs(rm.x - fl.corridor.x) < 0.05 && Math.abs(rm.y - fl.corridor.y) < 0.05) return;
    if (rm.type === 'corridor') {
      const fill = rm.name === 'Hall' ? FILL.living : FILL.corridor;
      p.push(R(rm.x, rm.y, rm.w, rm.h, fill, rm.name === 'Hall' ? undefined : WALL, rm.name === 'Hall' ? 0 : 0.1));
      if (rm.name !== 'Hall') p.push(T(rm.x + rm.w / 2, rm.y + rm.h / 2, rm.name, 0.42, '#7b8694'));
      return;
    }
    p.push(R(rm.x, rm.y, rm.w, rm.h, FILL[rm.type] || FILL.room, WALL, 0.12) + furnitureSVG(rm) + doorSVG(rm) + windowSVG(rm));
    if (rm.w > 1.6 && rm.h > 1.1) { p.push(T(rm.x + rm.w / 2, rm.y + rm.h / 2, rm.name, Math.min(0.6, rm.w / 8), LBL, 'middle', '600')); p.push(T(rm.x + rm.w / 2, rm.y + rm.h / 2 + 0.6, rm.area.toFixed(1) + ' m²', 0.42, '#7b8694')); }
  });
  if (fl.entrance) { p.push(R(fl.entrance.x - fl.entrance.width / 2, fl.entrance.y - 0.13, fl.entrance.width, 0.26, '#fff')); p.push(T(fl.entrance.x, fl.entrance.y + 0.7, '▲ ENTRANCE', 0.4, '#34a07a')); }
  if (fl.stairs) {
    const st = fl.stairs;
    p.push(R(st.x, st.y, st.w, st.h, '#ddd8cf', WALL, 0.08));
    for (let si = 0; si < 5; si++) p.push(R(st.x + 0.08, st.y + 0.08 + si * (st.h / 5), st.w - 0.16, st.h / 5 - 0.04, 'none', '#b8b0a4', 0.04));
    p.push(T(st.x + st.w / 2, st.y + st.h / 2, 'STAIRS', 0.38, '#7b8694'));
  }
  p.push(dimSVG(L));
  const nx = f.x + f.w + 1.4, ny = f.y + 0.2;
  p.push('<circle cx="' + nx + '" cy="' + ny + '" r="0.6" fill="none" stroke="#9aa3af" stroke-width="0.04"/><path d="M ' + nx + ' ' + (ny - 0.5) + ' L ' + (nx - 0.22) + ' ' + (ny + 0.2) + ' L ' + nx + ' ' + (ny - 0.05) + ' L ' + (nx + 0.22) + ' ' + (ny + 0.2) + ' z" fill="#5a6573"/>' + T(nx, ny + 0.9, 'N', 0.45, '#5a6573'));
  const ty = f.y + f.h + 2.2;
  let title = (String(cfg.style).charAt(0).toUpperCase() + String(cfg.style).slice(1)) + ' house — Level ' + (currentFloor + 1);
  if (planMeta && planMeta.source === 'ai-generated') title += ' (bespoke AI design)';
  else if (planMeta && (planMeta.source === 'pro-template' || planMeta.source === 'template')) title += ' (offline plan)';
  p.push(T(f.x, ty, title, 0.62, LBL, 'start', '700'));
  p.push(T(f.x, ty + 0.85, cfg.bedrooms + ' bed · ' + cfg.bathrooms + ' bath · ' + cfg.floors + ' floor(s) · ' + fmt(cfg.plotW * cfg.plotD) + ' m² plot', 0.46, '#7b8694', 'start'));
  if (planMeta && planMeta.concept) p.push(T(f.x, ty + 1.55, planMeta.concept.slice(0, 120), 0.42, '#5a6573', 'start'));
  p.push('</svg>');
  $('planHost').innerHTML = p.join('');
}
function downloadPlanSVG(): void { dl(new Blob([$('planHost').innerHTML], { type: 'image/svg+xml' }), 'floorplan-L' + (currentFloor + 1) + '.svg'); }
function planToDataURL(): Promise<string> {
  return new Promise((resolve, reject) => {
    const svg = $('planHost').querySelector('svg'); if (!svg) return reject(new Error('Generate a house first'));
    const xml = new XMLSerializer().serializeToString(svg); const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = 1280; c.height = Math.round(1280 * (svg.viewBox.baseVal.height / svg.viewBox.baseVal.width));
      const g = c.getContext('2d')!; g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('Could not rasterize the plan'));
    img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(xml)));
  });
}
async function aiRenderPlan(): Promise<void> {
  if (!L || !cfg) { toast('Generate a house first'); return; }
  const btn = $('aiPlanRenderBtn') as HTMLButtonElement, lbl = btn.textContent;
  btn.disabled = true; btn.innerHTML = '<span class="spin btnspin"></span> Rendering…';
  const label = 'Floor plan — Level ' + (currentFloor + 1);
  tab('renders');
  const cell = document.createElement('div'); cell.className = 'shot'; cell.innerHTML = '<div class="spin"></div><div class="cap">' + label + '…</div>'; $('gallery').prepend(cell);
  try {
    const image = await planToDataURL();
    const r = await fetch('/api/ai/plan-image', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image, style: cfg.style, level: currentFloor + 1 }) });
    const d = await r.json(); if (!r.ok) throw new Error((d.error || 'Failed') + (d.hint ? '\n' + d.hint : ''));
    const src = d.b64 ? 'data:image/png;base64,' + d.b64 : d.url;
    cell.innerHTML = '<img src="' + src + '" alt="' + label + '"><div class="cap"><span>' + label + '</span><a class="dlink" download="floorplan-render-L' + (currentFloor + 1) + '.png" href="' + src + '">↓ save</a></div>';
    (cell.querySelector('img') as HTMLImageElement).onclick = () => window.open(src, '_blank');
    toast('AI plan render ready (' + (d.provider || 'AI') + ')');
  } catch (e) {
    cell.className = 'shot err'; cell.innerHTML = '<div class="cap">⚠ ' + label + '</div><div class="emsg">' + (e as Error).message + '</div>';
    toast('Plan render failed — see card');
  } finally { btn.disabled = false; btn.textContent = lbl; }
}
function downloadPlanPNG(): void {
  const svg = $('planHost').querySelector('svg'); if (!svg) return;
  const xml = new XMLSerializer().serializeToString(svg); const img = new Image();
  img.onload = () => { const c = document.createElement('canvas'); c.width = 1600; c.height = Math.round(1600 * (svg.viewBox.baseVal.height / svg.viewBox.baseVal.width)); const g = c.getContext('2d')!; g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height); c.toBlob(b => { if (b) dl(b, 'floorplan-L' + (currentFloor + 1) + '.png'); }); };
  img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(xml)));
}
function dl(blob: Blob, name: string): void { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }

/* ---------------- tabs ---------------- */
function tab(name: string): void { ['three', 'plan', 'renders', 'scheme'].forEach(t => { $('tab-' + t).classList.toggle('active', t === name); $('panel-' + t).style.display = t === name ? 'flex' : 'none'; }); if (name === 'three' && viewer) viewer._resize(); }

/* ---------------- AI ---------------- */
function view3dMsg(m: string): void { const v = $('view3d'); if (v) v.innerHTML = '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;color:#cdd6e4;background:#12151c;padding:26px;font:14px Inter,sans-serif;line-height:1.7">' + m + '</div>'; }
function toast(m: string): void { const t = $('toast') as HTMLElement & { _t?: number }; t.textContent = m; t.style.opacity = '1'; clearTimeout(t._t); t._t = window.setTimeout(() => { t.style.opacity = '0'; }, 3600); }
function paletteText(): string { if (!brief || !brief.palette) return ''; return brief.palette.map(p => (p.name || '') + ' ' + p.hex).join(', '); }
async function checkAI(): Promise<void> {
  try {
    const r = await fetch('/api/ai/status'); const d = await r.json();
    if ($('aiPlanChip')) $('aiPlanChip').classList.toggle('on', true);
    if (d.openai) setAIBanner('ok', 'AI connected (' + (d.imageProvider || 'openai') + '). Every floor plan is a bespoke AI design — validated for overlaps, reachability and stairs before it reaches you.');
    else setAIBanner('warn', 'No AI key configured — the 3D model and floor plans work fully offline (template mode). Add <code>OPENAI_API_KEY</code> to <code>.env</code> and restart to unlock bespoke AI floor plans, schemes and renders.');
  } catch { setAIBanner('warn', 'Run via the server (npm run dev), not by opening the file directly.'); }
}
async function diagnoseAI(silent: boolean): Promise<void> {
  try { const r = await fetch('/api/ai/diagnose'); const d = await r.json(); setAIBanner(d.ok ? 'ok' : 'warn', d.message); if (!silent) toast(d.message); }
  catch (e) { setAIBanner('warn', 'Could not reach the AI provider: ' + (e as Error).message); }
}
function setAIBanner(kind: string, msg: string): void { const b = $('aiBanner'); b.className = 'aibanner ' + kind; b.innerHTML = msg; }
async function genScheme(): Promise<void> {
  if (!cfg) return; const btn = $('schemeBtn') as HTMLButtonElement; btn.disabled = true;
  try {
    const r = await fetch('/api/ai/design-brief', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ style: cfg.style, area: Math.round(cfg.plotW * cfg.plotD), floors: cfg.floors, bedrooms: cfg.bedrooms, bathrooms: cfg.bathrooms, kitchens: cfg.kitchens, living: cfg.living, dining: cfg.dining, garage: cfg.garage }) });
    const d = await r.json(); if (!r.ok) throw new Error((d.error || 'Failed') + (d.hint ? ' — ' + d.hint : ''));
    brief = d.brief; renderScheme(brief!); tab('scheme'); toast('Design scheme ready — applying colors to the 3D model');
    rebuild3D(); // apply per-room accent colors to the walkable model
  } catch (e) { toast('Scheme: ' + (e as Error).message); } finally { btn.disabled = false; }
}
function renderScheme(b: Brief): void {
  let h = '<div class="concept">' + (b.concept || '') + '</div><div class="swatches">';
  (b.palette || []).forEach(p => { if (!/^#?[0-9a-f]{6}$/i.test(p.hex || '')) return; h += '<div class="sw" style="background:' + p.hex + '" title="' + (p.name || '') + ' ' + p.hex + '"><span>' + (p.name || '').slice(0, 9) + '</span></div>'; });
  h += '</div>';
  const rooms = b.rooms || {};
  Object.keys(rooms).forEach(k => { const r = rooms[k]; if (r && r.notes) h += '<div class="rnote"><b>' + k + '</b> ' + r.notes + '</div>'; });
  h += '<div class="hint" style="margin-top:14px">Accent colors are applied to the 3D model automatically — flip to the 3D tab.</div>';
  $('schemeOut').innerHTML = h;
}
async function renderView(view: string, label: string): Promise<void> {
  if (!cfg) return;
  tab('renders'); const cell = document.createElement('div'); cell.className = 'shot'; cell.innerHTML = '<div class="spin"></div><div class="cap">' + label + '…</div>'; $('gallery').prepend(cell);
  try {
    const key = view.split(' ').pop() as string;
    const body = { style: cfg.style, view, floors: cfg.floors, bedrooms: cfg.bedrooms, area: Math.round(cfg.plotW * cfg.plotD), palette: paletteText(), notes: brief && brief.rooms && brief.rooms[key] ? brief.rooms[key]!.notes : '', references: refs.slice(0, 3) };
    const r = await fetch('/api/ai/render', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const d = await r.json(); if (!r.ok) throw new Error((d.error || 'Failed') + (d.hint ? '\n' + d.hint : ''));
    const src = d.b64 ? 'data:image/png;base64,' + d.b64 : d.url;
    cell.innerHTML = '<img src="' + src + '" alt="' + label + '"><div class="cap"><span>' + label + '</span><a class="dlink" download="' + view.replace(/\s+/g, '-') + '.png" href="' + src + '">↓ save</a></div>';
    (cell.querySelector('img') as HTMLImageElement).onclick = () => window.open(src, '_blank');
  } catch (e) { cell.className = 'shot err'; cell.innerHTML = '<div class="cap">⚠ ' + label + '</div><div class="emsg">' + (e as Error).message + '</div>'; toast('Render failed — see card'); }
}

/* ---------------- references ---------------- */
function addRef(b64: string, type: string, durl: string): void {
  refs.push({ b64, type });
  const im = document.createElement('div'); im.className = 'refthumb'; im.innerHTML = '<img src="' + durl + '"><button>×</button>';
  (im.querySelector('button') as HTMLButtonElement).onclick = () => { const i = refs.findIndex(x => x.b64 === b64); if (i > -1) refs.splice(i, 1); im.remove(); };
  $('refStrip').appendChild(im);
}
function handleFiles(files: FileList | null): void {
  if (!files) return;
  Array.prototype.forEach.call(files, (file: File) => {
    const rd = new FileReader();
    rd.onload = () => {
      const img = new Image();
      img.onload = () => { const mx = 768, sc = Math.min(1, mx / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc); c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height); const durl = c.toDataURL('image/png'); addRef(durl.split(',')[1], 'image/png', durl); };
      img.src = rd.result as string;
    };
    rd.readAsDataURL(file);
  });
}
function pickWebImage(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const img = new Image(); img.crossOrigin = 'anonymous';
    img.onload = () => { const mx = 768, sc = Math.min(1, mx / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc); c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height); const durl = c.toDataURL('image/png'); addRef(durl.split(',')[1], 'image/png', durl); resolve(); };
    img.onerror = () => reject(new Error('Could not load image'));
    img.src = url;
  });
}
async function searchWeb(): Promise<void> {
  const q = ($i('webQuery').value || '').trim() || (cfg ? cfg.style + ' house interior' : 'modern house interior');
  const btn = $('webSearchBtn') as HTMLButtonElement; btn.disabled = true; $('webGrid').innerHTML = '<div class="hint">Searching…</div>';
  try {
    const r = await fetch('/api/reference-images?q=' + encodeURIComponent(q)); const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Search failed');
    if (!d.images || !d.images.length) { $('webGrid').innerHTML = '<div class="hint">No results for that query.</div>'; return; }
    $('webGrid').innerHTML = '';
    d.images.forEach((im: { thumb: string; full: string; alt?: string }) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'webpick'; b.title = im.alt || q;
      b.innerHTML = '<img src="' + im.thumb + '" alt="">';
      b.onclick = () => pickWebImage(im.full).then(() => toast('Reference added')).catch(e => toast((e as Error).message));
      $('webGrid').appendChild(b);
    });
  } catch (e) { $('webGrid').innerHTML = '<div class="hint">' + (e as Error).message + '</div>'; }
  finally { btn.disabled = false; }
}
function syncChips(): void { $('diningChip').classList.toggle('on', $i('dining').checked); $('garageChip').classList.toggle('on', $i('garage').checked); }

/* ---------------- build from a real floor-plan image (AI vision) ---------------- */
function buildFromImageFile(file: File | undefined): void {
  if (!file) return;
  const rd = new FileReader();
  rd.onload = () => {
    const img = new Image();
    img.onload = () => {
      const mx = 1500, sc = Math.min(1, mx / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc);
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      planImgUpload(c.toDataURL('image/png'));
    };
    img.onerror = () => toast('Could not read that image file');
    img.src = rd.result as string;
  };
  rd.readAsDataURL(file);
}
async function planImgUpload(dataUrl: string): Promise<void> {
  const btn = $('planImgBtn') as HTMLButtonElement | null, lbl = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = 'Reading plan…'; }
  toast('Reading your floor plan with AI vision…');
  try {
    cfg = readForm();
    const r = await fetch('/api/ai/plan-from-image', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: dataUrl, plotW: cfg.plotW, plotD: cfg.plotD, floors: cfg.floors, style: cfg.style }) });
    const d = await r.json();
    if (!r.ok || !d.layout) throw new Error((d && (d.error || d.hint)) || 'Could not read the plan');
    showPlanConfirm(d);
  } catch (e) { toast('Plan image: ' + (e as Error).message); }
  finally { if (btn) { btn.disabled = false; btn.textContent = lbl; } }
}
function showPlanConfirm(d: { layout: Layout; concept?: string; source?: string }): void {
  const L2 = d.layout; let blocks = '';
  (L2.floors || []).forEach((fl, i) => {
    const names = (fl.rooms || []).filter(r => r.type !== 'corridor').map(r =>
      '<span style="display:inline-block;background:#1c2533;border:1px solid #2b3550;border-radius:7px;padding:3px 8px;margin:3px 4px 0 0;font-size:12px">' + r.name + ' <span style="color:#7b8694">' + r.w.toFixed(1) + '×' + r.h.toFixed(1) + 'm</span></span>');
    blocks += '<div style="margin:8px 0"><b style="color:#9fd0ff">Floor ' + (i + 1) + '</b><div>' + (names.join('') || '—') + '</div></div>';
  });
  const ov = document.createElement('div');
  ov.style.cssText = 'position:absolute;inset:0;background:rgba(8,10,14,.74);display:flex;align-items:center;justify-content:center;z-index:40;backdrop-filter:blur(3px);padding:24px';
  ov.innerHTML = '<div style="background:#161b24;border:1px solid #2b3340;border-radius:14px;max-width:540px;width:100%;padding:20px;box-shadow:0 24px 70px rgba(0,0,0,.55)">' +
    '<h3 style="margin:0 0 10px;color:#fff;font-size:17px;font-weight:800">Detected from your floor plan</h3>' +
    (d.source !== 'from-image' ? '<div style="background:#211a12;border:1px solid #7a5a2a;color:#ffd9a3;padding:8px 10px;border-radius:8px;font-size:12.5px;margin-bottom:10px">⚠ This plan was hard to read — the result is a close match, not an exact copy. A cleaner, single-floor image reads best.</div>' : '') +
    (d.concept ? '<div style="color:#cdd6e4;font-size:13px;line-height:1.5;margin-bottom:8px">' + d.concept + '</div>' : '') +
    '<div style="color:#dbe2ec;max-height:260px;overflow:auto">' + blocks + '</div>' +
    '<div style="display:flex;gap:10px;margin-top:18px;justify-content:flex-end">' +
    '<button id="pcfCancel" style="background:#1c212b;border:1px solid #2b3340;color:#eef1f6;border-radius:9px;padding:10px 14px;cursor:pointer;font-weight:600;font-family:inherit">Try another image</button>' +
    '<button id="pcfBuild" style="background:linear-gradient(180deg,#37c98a,#21a76e);border:0;color:#fff;border-radius:9px;padding:10px 16px;cursor:pointer;font-weight:700;font-family:inherit">Build this house ✓</button>' +
    '</div></div>';
  document.querySelector('main')!.appendChild(ov);
  (document.getElementById('pcfBuild') as HTMLButtonElement).onclick = () => { ov.remove(); applyLayout(d.layout, { concept: d.concept, source: d.source }); toast('Built from your floor plan ✓'); };
  (document.getElementById('pcfCancel') as HTMLButtonElement).onclick = () => { ov.remove(); toast('Cancelled — upload another plan image'); };
  ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
}

/* ---------------- boot ---------------- */
function randomize(): void {
  $i('plotW').value = String(12 + Math.floor(Math.random() * 16)); $i('plotD').value = String(10 + Math.floor(Math.random() * 12));
  $i('floors').value = String(1 + Math.floor(Math.random() * 3)); $i('bedrooms').value = String(1 + Math.floor(Math.random() * 5));
  $i('bathrooms').value = String(1 + Math.floor(Math.random() * 3)); $i('kitchens').value = '1'; $i('living').value = '1';
  ($i('style') as unknown as HTMLSelectElement).value = ['modern', 'traditional', 'minimalist', 'scandinavian', 'industrial'][Math.floor(Math.random() * 5)];
  $i('dining').checked = true; $i('garage').checked = Math.random() > 0.4;
  syncChips(); generate(false);
}
function boot(): void {
  try { viewer = new Viewer($('view3d')); } catch { viewer = null; }
  ($('generateBtn') as HTMLButtonElement).onclick = () => generate(false);
  ($('randomBtn') as HTMLButtonElement).onclick = randomize;
  if ($i('promptText')) $i('promptText').addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') generate(false); });
  if ($i('aiPromptToggle')) $i('aiPromptToggle').onchange = () => { const c = $('aiChip'); if (c) c.classList.toggle('on', $i('aiPromptToggle').checked); };
  ['plotW', 'plotD'].forEach(id => $i(id).addEventListener('input', updateArea));
  $i('dining').onchange = syncChips; $i('garage').onchange = syncChips;
  $i('aiPlans').onchange = () => { aiPlansOn = $i('aiPlans').checked; $('aiPlanChip').classList.toggle('on', aiPlansOn); };
  ['three', 'plan', 'renders', 'scheme'].forEach(t => { ($('tab-' + t) as HTMLButtonElement).onclick = () => tab(t); });
  ($('dlSvg') as HTMLButtonElement).onclick = downloadPlanSVG;
  if ($('aiPlanRenderBtn')) ($('aiPlanRenderBtn') as HTMLButtonElement).onclick = aiRenderPlan;
  ($('dlPng') as HTMLButtonElement).onclick = downloadPlanPNG;
  ($('schemeBtn') as HTMLButtonElement).onclick = genScheme;
  ($('diagBtn') as HTMLButtonElement).onclick = () => diagnoseAI(false);
  document.querySelectorAll('[data-view]').forEach(b => { (b as HTMLButtonElement).onclick = () => { if (!cfg) { toast('Generate a house first'); return; } renderView((b as HTMLElement).dataset.view!, b.textContent || ''); }; });
  ($('uploadBtn') as HTMLButtonElement).onclick = () => $i('fileInput').click();
  $i('fileInput').onchange = e => handleFiles((e.target as HTMLInputElement).files);
  if ($i('planImgBtn')) { ($('planImgBtn') as HTMLButtonElement).onclick = () => $i('planImgInput').click(); $i('planImgInput').onchange = e => { const t = e.target as HTMLInputElement; buildFromImageFile(t.files?.[0]); t.value = ''; }; }
  ($('webSearchBtn') as HTMLButtonElement).onclick = searchWeb;
  $i('webQuery').addEventListener('keydown', e => { if (e.key === 'Enter') searchWeb(); });
  document.querySelectorAll('#mode3d button').forEach(b => { (b as HTMLButtonElement).onclick = () => { if (viewer) viewer.setMode((b as HTMLElement).dataset.m as 'orbit' | 'walk'); document.querySelectorAll('#mode3d button').forEach(x => x.classList.remove('active')); b.classList.add('active'); }; });
  ($('cutBtn') as HTMLButtonElement).onclick = () => { cut = !cut; $('cutBtn').textContent = 'Cutaway: ' + (cut ? 'on' : 'off'); if (viewer) viewer.setCutaway(cut); };
  if ($('nightBtn')) ($('nightBtn') as HTMLButtonElement).onclick = () => { night = !night; $('nightBtn').textContent = night ? '☀ Day' : '🌙 Night'; if (viewer) viewer.setDayNight(night); };
  syncChips(); updateArea(); generate(true); checkAI();
}
boot();
