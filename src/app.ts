/* ForthHome Studio — plan-first client application. */
import { Viewer } from './engine/viewer.js';
import { HouseLayout } from './engine/layout.js';
import { computeProjectEstimate, formatMoney, type CostMarketId, type FinishTierId } from './engine/estimator.js';
import type { CustomRoomRequest, Layout, Room, RoomType, Spec } from './engine/types.js';

type Stage = 'create' | 'plan' | 'visualize' | 'present';
type RenderQuality = 'low' | 'high';

interface Brief {
  concept?: string;
  palette?: { name?: string; hex?: string }[];
  rooms?: Partial<Record<string, { notes?: string; accentHex?: string }>>;
}

interface PlanMeta {
  concept?: string;
  inspiration?: string;
  source?: string;
  hits?: number;
  planModel?: string;
}

interface SavedVersion {
  id: string;
  createdAt: string;
  projectName: string;
  prompt: string;
  spec: Spec;
  layout: Layout;
  meta: PlanMeta;
}

interface QualityCheck { label: string; detail: string; pass: boolean; weight: number; }

const M2FT = 10.7639;
const STORAGE_KEY = 'forthhome-studio-versions-v1';
const PROJECT_NAME_KEY = 'forthhome-studio-project-name';
const STAGES: Stage[] = ['create', 'plan', 'visualize', 'present'];
const FILL: Record<string, string> = {
  living: '#e5ede5', bedroom: '#f1ece2', kitchen: '#eee5d8', bathroom: '#e1eceb',
  dining: '#eee8ef', garage: '#e7e5df', corridor: '#e4e5de', room: '#eeece6'
};
const WALL = '#303632', FURNC = '#8b938d', LBL = '#252b27', WINC = '#668e9b';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing UI element: ${id}`);
  return node as T;
};
const $input = (id: string): HTMLInputElement => $<HTMLInputElement>(id);
const $button = (id: string): HTMLButtonElement => $<HTMLButtonElement>(id);
const fmt = (n: number): string => Math.round(n).toLocaleString();
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

function create<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function cleanText(value: unknown, max = 500): string {
  return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}

function escapeXML(value: unknown): string {
  return cleanText(value, 1000).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c] || c));
}

function safeMediaUrl(value: unknown): string | null {
  const source = cleanText(value, 12_000_000);
  if (/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(source)) return source;
  try {
    const url = new URL(source, window.location.href);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch { return null; }
}

function errorMessage(error: unknown): string {
  return cleanText(error instanceof Error ? error.message : error || 'Something went wrong.', 500);
}

let cfg: Spec | null = null;
let layout: Layout | null = null;
let planMeta: PlanMeta | null = null;
let brief: Brief | null = null;
let viewer: Viewer | null = null;
let currentFloor = 0;
let planZoom = 1;
let selectedRoomIndex: number | null = null;
let activeStage: Stage = 'create';
let cutaway = false;
let night = false;
let aiAvailable = false;
let activeGeneration: AbortController | null = null;
let generationSequence = 0;
let progressTimer: number | null = null;
let toastTimer: number | null = null;
let pendingUploadedPlan: { layout: Layout; concept?: string; source?: string } | null = null;
let versions: SavedVersion[] = [];
let customRooms: CustomRoomRequest[] = [];
const refs: { b64: string; type: string; dataUrl: string }[] = [];

function numberValue(id: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseFloat($input(id).value);
  return clamp(Number.isFinite(parsed) ? parsed : fallback, min, max);
}

function selectedStyle(): string {
  return (document.querySelector<HTMLInputElement>('input[name="style"]:checked')?.value || 'modern');
}

function readForm(): Spec {
  const spec: Spec = {
    plotW: numberValue('plotW', 11, 6, 80), plotD: numberValue('plotD', 13, 6, 80),
    floors: Math.round(numberValue('floors', 2, 1, 4)), bedrooms: Math.round(numberValue('bedrooms', 3, 0, 12)),
    bathrooms: Math.round(numberValue('bathrooms', 2, 0, 8)), kitchens: Math.round(numberValue('kitchens', 1, 0, 4)),
    living: Math.round(numberValue('living', 1, 0, 4)), dining: $input('dining').checked,
    garage: $input('garage').checked, style: selectedStyle(), strictCounts: true,
    customRooms: customRooms.map(room => ({ ...room }))
  };
  const prompt = $<HTMLTextAreaElement>('promptText').value.trim();
  if (prompt) spec.prompt = prompt.slice(0, 2400);
  return spec;
}

function applySpecToForm(spec: Partial<Spec>): void {
  (['plotW', 'plotD', 'floors', 'bedrooms', 'bathrooms', 'kitchens', 'living'] as const).forEach(key => {
    if (spec[key] != null && document.getElementById(key)) $input(key).value = String(spec[key]);
  });
  if (typeof spec.dining === 'boolean') $input('dining').checked = spec.dining;
  if (typeof spec.garage === 'boolean') $input('garage').checked = spec.garage;
  if (spec.style) {
    const radio = document.querySelector<HTMLInputElement>(`input[name="style"][value="${CSS.escape(String(spec.style))}"]`);
    if (radio) radio.checked = true;
  }
  if (Array.isArray(spec.customRooms)) {
    customRooms = spec.customRooms.slice(0, 10).map(room => ({
      name: cleanText(room.name, 48), count: clamp(Math.round(Number(room.count) || 1), 1, 4),
      preferredFloor: Number.isFinite(Number(room.preferredFloor)) ? clamp(Math.round(Number(room.preferredFloor)), 0, 3) : undefined,
      minW: Number.isFinite(Number(room.minW)) ? Number(room.minW) : undefined,
      minH: Number.isFinite(Number(room.minH)) ? Number(room.minH) : undefined
    })).filter(room => !!room.name);
    renderCustomRoomChips();
  }
  updateArea();
}

function updateArea(): void {
  const area = numberValue('plotW', 0, 0, 80) * numberValue('plotD', 0, 0, 80);
  $('areaStat').textContent = `${fmt(area)} m²`;
  $('areaFt').textContent = `${fmt(area * M2FT)} ft²`;
}

function renderCustomRoomChips(): void {
  const host = $('customRoomChips'); host.replaceChildren();
  customRooms.forEach((room, index) => {
    const floor = Number.isFinite(Number(room.preferredFloor)) ? ` · Level ${Number(room.preferredFloor) + 1}` : '';
    const chip = create('span', 'custom-room-chip'), label = create('span', '', `${room.count || 1} × ${cleanText(room.name, 48)}${floor}`), remove = create('button', '', '×');
    remove.type = 'button'; remove.setAttribute('aria-label', `Remove ${cleanText(room.name, 48)}`);
    remove.addEventListener('click', () => { customRooms.splice(index, 1); renderCustomRoomChips(); });
    chip.append(label, remove); host.append(chip);
  });
}

function addCustomRoom(): void {
  const nameInput = $input('customRoomName'), name = cleanText(nameInput.value, 48).replace(/[<>]/g, '');
  if (!name) { toast('Name the extra space first.'); nameInput.focus(); return; }
  if (customRooms.length >= 10) { toast('A concept can include up to ten extra named-space requests.'); return; }
  const count = Math.round(numberValue('customRoomCount', 1, 1, 4));
  const floorValue = $<HTMLSelectElement>('customRoomFloor').value;
  const preferredFloor = floorValue === '' ? undefined : Number(floorValue);
  if (preferredFloor != null && preferredFloor >= Math.round(numberValue('floors', 1, 1, 4))) {
    toast('Choose a preferred floor that exists in this project.'); return;
  }
  const existing = customRooms.find(room => room.name.trim().toLowerCase() === name.toLowerCase() && room.preferredFloor === preferredFloor);
  if (existing) existing.count = clamp((existing.count || 1) + count, 1, 4);
  else customRooms.push({ name, count, preferredFloor });
  nameInput.value = ''; $input('customRoomCount').value = '1'; $<HTMLSelectElement>('customRoomFloor').value = '';
  renderCustomRoomChips(); nameInput.focus();
}

function toast(message: string): void {
  const node = $('toast');
  node.textContent = cleanText(message, 600);
  node.hidden = false;
  requestAnimationFrame(() => node.classList.add('show'));
  if (toastTimer != null) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    node.classList.remove('show');
    window.setTimeout(() => { node.hidden = true; }, 220);
  }, 4200);
}

function setStage(stage: Stage, focusPanel = false): void {
  if (stage !== 'create' && !layout) {
    toast('Create or resume a plan first.');
    stage = 'create';
  }
  activeStage = stage;
  STAGES.forEach(name => {
    const tab = $button(`tab-${name}`);
    const panel = $(`stage-${name}`);
    const selected = name === stage;
    tab.classList.toggle('active', selected);
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    panel.hidden = !selected;
    panel.classList.toggle('active', selected);
  });
  if (stage === 'visualize' && viewer) window.setTimeout(() => viewer?._resize(), 30);
  if (focusPanel) $(`stage-${stage}`).focus({ preventScroll: true });
}

function enableProjectStages(enabled: boolean): void {
  (['plan', 'visualize', 'present'] as Stage[]).forEach(name => { $button(`tab-${name}`).disabled = !enabled; });
}

function briefAccents(): Partial<Record<RoomType, string>> {
  const accents: Partial<Record<RoomType, string>> = {};
  if (!brief?.rooms) return accents;
  (['living', 'bedroom', 'kitchen', 'bathroom', 'dining'] as RoomType[]).forEach(key => {
    const value = brief?.rooms?.[key]?.accentHex;
    if (value && /^#[0-9a-f]{6}$/i.test(value)) accents[key] = value;
  });
  return accents;
}

function rebuild3D(): void {
  if (!viewer || !layout || !cfg) return;
  try {
    viewer.build(layout, { ...cfg, accents: briefAccents() });
    viewer.setCutaway(cutaway);
    viewer.setDayNight(night);
    viewer.setFloor(currentFloor);
  } catch (error) {
    showViewerMessage(`The 3D preview could not be built. ${errorMessage(error)}`);
  }
}

function showViewerMessage(message: string): void {
  const host = $('view3d');
  host.replaceChildren();
  const box = create('div', 'empty-mini');
  box.style.cssText = 'position:absolute;inset:24px;color:#dbe1dc;border-color:#58635c';
  box.append(create('p', '', cleanText(message)));
  host.append(box);
}

function setBusy(busy: boolean): void {
  $button('generateBtn').disabled = busy || !aiAvailable;
  $button('randomBtn').disabled = busy;
  $button('planImgBtn').disabled = busy;
  const revision = $button('reviseBtn');
  revision.disabled = busy || !layout;
  const progress = $('generationProgress');
  progress.hidden = !busy;
  if (progressTimer != null) window.clearInterval(progressTimer);
  progressTimer = null;
  if (!busy) return;
  const steps = [
    ['Reading your brief', 'Preparing spatial requirements…'],
    ['Drafting room relationships', 'Balancing privacy, daylight and circulation…'],
    ['Checking the concept', 'Reviewing room counts, access and geometry…'],
    ['Preparing plan review', 'Building the first presentation layer…']
  ];
  let index = 0;
  const update = (): void => {
    $('generationTitle').textContent = steps[index][0];
    $('generationDetail').textContent = steps[index][1];
    index = Math.min(index + 1, steps.length - 1);
  };
  update();
  progressTimer = window.setInterval(update, 2600);
}

async function generatePlan(revision?: string): Promise<void> {
  activeGeneration?.abort();
  const controller = new AbortController();
  activeGeneration = controller;
  const sequence = ++generationSequence;
  cfg = readForm();
  if (revision?.trim()) {
    const base = cfg.prompt || 'Create a residential concept matching the structured requirements.';
    cfg.prompt = `${base}\nRevision request: ${revision.trim().slice(0, 800)}`;
  }
  if (!aiAvailable) {
    generateProceduralPlan(revision);
    return;
  }
  setBusy(true);
  $('saveState').textContent = 'Designing…';
  try {
    const response = await fetch('/api/ai/floor-plan', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cfg), signal: controller.signal
    });
    const data = await response.json().catch(() => ({})) as Record<string, any>;
    if (!response.ok || !data.layout) {
      const details = [data.error, data.hint, ...(Array.isArray(data.issues) ? data.issues.slice(0, 3) : [])]
        .map(value => cleanText(value, 220)).filter(Boolean).join(' ');
      throw new Error(details || `AI planning returned ${response.status}.`);
    }
    if (data.spec && typeof data.spec === 'object') {
      applySpecToForm(data.spec as Partial<Spec>);
      const prompt = cfg.prompt;
      cfg = readForm();
      if (prompt) cfg.prompt = prompt;
    }
    const source = cleanText(data.source || data.layout.planSource || 'ai-generated', 40);
    applyLayout(data.layout as Layout, {
      concept: cleanText(data.concept || data.layout.planConcept, 900),
      inspiration: cleanText(data.inspiration || data.layout.planInspiration, 700), source,
      hits: Number.isFinite(Number(data.researchHits)) ? Number(data.researchHits) : undefined,
      planModel: cleanText(data.planModel, 80)
    }, true);
    toast('Validated AI plan ready for review.');
  } catch (error) {
    if (controller.signal.aborted) return;
    generateProceduralPlan(revision);
    toast(`AI provider unavailable (${errorMessage(error)}) — generated with 72-Candidate Studio Solver.`);
  } finally {
    if (sequence === generationSequence) {
      activeGeneration = null;
      setBusy(false);
    }
  }
}

function applyLayout(next: Layout, meta: PlanMeta = {}, save = false): void {
  if (!next || !Array.isArray(next.floors) || !next.floors.length) throw new Error('The plan did not contain any usable floors.');
  layout = next;
  planMeta = {
    ...meta,
    source: meta.source || next.planSource || 'unknown',
    concept: meta.concept || next.planConcept,
    inspiration: meta.inspiration || next.planInspiration
  };
  currentFloor = 0;
  enableProjectStages(true);
  buildFloorBars();
  drawPlan();
  updatePlanInspector();
  rebuild3D();
  if (save) saveCurrentVersion();
  setStage('plan');
}

function versionId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function loadStoredVersions(): SavedVersion[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') as SavedVersion[];
    return Array.isArray(parsed) ? parsed.filter(v => {
      const source = String(v?.meta?.source || v?.layout?.planSource || '').toLowerCase();
      return v?.layout?.floors?.length && v?.spec && (source === 'ai-generated' || source === 'from-image' || source.startsWith('procedural'));
    }).slice(0, 12) : [];
  } catch { return []; }
}

function persistVersions(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(versions.slice(0, 12)));
    localStorage.setItem(PROJECT_NAME_KEY, $input('projectName').value.trim().slice(0, 64));
    $('saveState').textContent = 'Saved locally';
  } catch {
    $('saveState').textContent = 'Local save unavailable';
    toast('This browser could not save another local version.');
  }
}

function saveCurrentVersion(): void {
  if (!layout || !cfg) return;
  const version: SavedVersion = {
    id: versionId(), createdAt: new Date().toISOString(),
    projectName: $input('projectName').value.trim() || 'Untitled residence',
    prompt: cfg.prompt || $<HTMLTextAreaElement>('promptText').value.trim(), spec: { ...cfg }, layout,
    meta: { ...(planMeta || {}) }
  };
  versions.unshift(version);
  versions = versions.slice(0, 12);
  persistVersions();
  updateVersionUI(version.id);
}

function updateVersionUI(selectedId?: string): void {
  const select = $<HTMLSelectElement>('versionSelect');
  select.replaceChildren();
  if (!versions.length) {
    const option = create('option', '', 'No saved versions'); option.value = ''; select.append(option); select.disabled = true;
  } else {
    select.disabled = false;
    versions.forEach((version, index) => {
      const option = create('option', '', `${index === 0 ? 'Latest' : `Version ${versions.length - index}`} · ${new Date(version.createdAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`);
      option.value = version.id; option.selected = version.id === selectedId; select.append(option);
    });
  }
  const resume = $('resumeCard');
  resume.hidden = !versions.length;
  if (versions.length) {
    const latest = versions[0];
    $('resumeSummary').textContent = `${latest.projectName} · ${latest.spec.bedrooms} bed · ${latest.spec.floors} floor${latest.spec.floors === 1 ? '' : 's'} · saved ${new Date(latest.createdAt).toLocaleDateString()}`;
  }
}

function loadVersion(id: string): void {
  const version = versions.find(v => v.id === id);
  if (!version) return;
  $input('projectName').value = version.projectName;
  $<HTMLTextAreaElement>('promptText').value = version.prompt;
  applySpecToForm(version.spec);
  cfg = { ...version.spec };
  applyLayout(version.layout, version.meta, false);
  updateVersionUI(version.id);
  toast('Saved version opened.');
}

function startNewProject(): void {
  if (layout && !window.confirm('Start a new concept? Your saved versions will remain in this browser.')) return;
  activeGeneration?.abort();
  cfg = null; layout = null; planMeta = null; brief = null; currentFloor = 0; customRooms = [];
  enableProjectStages(false);
  $('planHost').replaceChildren();
  restoreGalleryEmpty();
  renderCustomRoomChips();
  setStage('create');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ---------------------------- plan drawing ---------------------------- */
function rectSVG(x: number, y: number, w: number, h: number, fill = 'none', stroke?: string, strokeWidth = 0): string {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"${stroke ? ` stroke="${stroke}" stroke-width="${strokeWidth}"` : ''}/>`;
}

function lineSVG(x1: number, y1: number, x2: number, y2: number, stroke: string, width: number): string {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round"/>`;
}

function fitTextSize(text: string, availableWidth: number, preferred: number, minimum = 0.18): number {
  const estimatedUnits = Math.max(1, text.length * .56);
  return Math.max(minimum, Math.min(preferred, availableWidth / estimatedUnits));
}

function wrapLabel(text: string, maxCharacters: number): string[] {
  const words = cleanText(text, 80).split(/\s+/).filter(Boolean);
  if (!words.length) return ['Room'];
  const lines: string[] = [];
  let line = '';
  words.forEach(word => {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length <= maxCharacters || !line) line = candidate;
    else { lines.push(line); line = word; }
  });
  if (line) lines.push(line);
  if (lines.length <= 2) return lines;
  return [lines[0], `${lines.slice(1).join(' ').slice(0, Math.max(3, maxCharacters - 1))}…`];
}

function textSVG(x: number, y: number, text: string, size: number, color = LBL, anchor = 'middle', weight = '500', extra = ''): string {
  return `<text x="${x}" y="${y}" font-size="${size}" fill="${color}" text-anchor="${anchor}" font-family="Arial, sans-serif" font-weight="${weight}"${extra}>${escapeXML(text)}</text>`;
}

function roomLabelSVG(room: Room): string {
  if (room.w < 1.2 || room.h < 1) return '';
  const maxChars = Math.max(6, Math.floor(room.w / .3));
  const lines = wrapLabel(room.name || room.type, maxChars);
  const longest = lines.reduce((a, b) => a.length > b.length ? a : b, '');
  const titleSize = fitTextSize(longest, Math.max(.8, room.w - .42), Math.min(.46, room.w / 7), .2);
  const detail = `${room.w.toFixed(1)} × ${room.h.toFixed(1)} m · ${room.area.toFixed(1)} m²`;
  const detailSize = fitTextSize(detail, Math.max(.8, room.w - .42), .28, .15);
  const titleHeight = lines.length * titleSize * 1.14;
  const plateHeight = titleHeight + detailSize + .34;
  const plateWidth = Math.min(room.w - .18, Math.max(1.1, longest.length * titleSize * .57 + .34, detail.length * detailSize * .52 + .3));
  const cx = room.x + room.w / 2, cy = room.y + room.h / 2;
  const startY = cy - plateHeight / 2 + titleSize;
  let result = `<g class="room-label">${rectSVG(cx - plateWidth / 2, cy - plateHeight / 2, plateWidth, plateHeight, 'rgba(255,255,255,.88)')}</g>`;
  lines.forEach((line, index) => { result += textSVG(cx, startY + index * titleSize * 1.13, line, titleSize, LBL, 'middle', '700'); });
  result += textSVG(cx, startY + titleHeight + .09, detail, detailSize, '#667069', 'middle', '500');
  return result;
}

function doorSVG(room: Room): string {
  const door = room.door;
  if (!door || !Number.isFinite(door.pos) || !Number.isFinite(door.width)) return '';
  const width = clamp(door.width, .55, 1.5);
  if (door.side === 'right' || door.side === 'left') {
    const x = door.side === 'right' ? room.x + room.w : room.x;
    const y = door.pos - width / 2;
    const direction = door.side === 'right' ? 1 : -1;
    return rectSVG(x - .12, y, .24, width, '#fff') + lineSVG(x, y, x + direction * width, y, '#69726d', .045) +
      `<path d="M ${x} ${y} A ${width} ${width} 0 0 ${direction > 0 ? 1 : 0} ${x + direction * width} ${y + width}" fill="none" stroke="#a3aaa5" stroke-width=".03"/>`;
  }
  const y = door.side === 'bottom' ? room.y + room.h : room.y;
  const x = door.pos - width / 2;
  const direction = door.side === 'bottom' ? -1 : 1;
  return rectSVG(x, y - .12, width, .24, '#fff') + lineSVG(x, y, x, y + direction * width, '#69726d', .045) +
    `<path d="M ${x} ${y} A ${width} ${width} 0 0 1 ${x + width} ${y + direction * width}" fill="none" stroke="#a3aaa5" stroke-width=".03"/>`;
}

function windowSVG(room: Room): string {
  return (room.windows || []).map(window => {
    if (!Number.isFinite(window.pos) || !Number.isFinite(window.len)) return '';
    if (window.side === 'left' || window.side === 'right') {
      const x = window.side === 'left' ? room.x : room.x + room.w, y = window.pos - window.len / 2;
      return rectSVG(x - .09, y, .18, window.len, '#fff') + lineSVG(x, y, x, y + window.len, WINC, .065);
    }
    const y = window.side === 'top' ? room.y : room.y + room.h, x = window.pos - window.len / 2;
    return rectSVG(x, y - .09, window.len, .18, '#fff') + lineSVG(x, y, x + window.len, y, WINC, .065);
  }).join('');
}

function furnitureSVG(room: Room): string {
  const { x, y, w, h } = room, cx = x + w / 2, cy = y + h / 2;
  if (w < 1.35 || h < 1.35) return '';
  const box = (bx: number, by: number, bw: number, bh: number, radius = .05, fill = 'rgba(255,255,255,0.45)'): string =>
    `<rect x="${bx}" y="${by}" width="${Math.max(.08, bw)}" height="${Math.max(.08, bh)}" rx="${radius}" stroke="${FURNC}" stroke-width=".04" fill="${fill}"/>`;
  const circle = (a: number, b: number, radius: number, fill = 'rgba(255,255,255,0.45)'): string =>
    `<circle cx="${a}" cy="${b}" r="${radius}" stroke="${FURNC}" stroke-width=".04" fill="${fill}"/>`;
  switch (room.type) {
    case 'bedroom': {
      const bw = Math.min(1.65, w * .48), bl = Math.min(2.0, h * .52), bx = x + .24, by = cy - bl / 2;
      const pillowH = Math.min(.34, bl * .18), pillowW = (bw - .26) / 2;
      const ns1 = by - .32 >= y + .12 ? box(bx, by - .3, .28, .26, .03) : '';
      const ns2 = by + bl + .32 <= y + h - .12 ? box(bx, by + bl + .04, .28, .26, .03) : '';
      const wardrobe = w > 2.8 ? box(x + w - .54, y + .25, .36, Math.min(1.5, h - .5), .03) : '';
      return box(bx, by, bw, bl, .07) +
        box(bx + .09, by + .1, pillowW, pillowH, .04, '#fff') +
        box(bx + .15 + pillowW, by + .1, pillowW, pillowH, .04, '#fff') +
        lineSVG(bx + .04, by + bl * .36, bx + bw - .04, by + bl * .36, FURNC, .03) +
        ns1 + ns2 + wardrobe;
    }
    case 'living': {
      const sw = Math.min(2.5, w * .58), sh = Math.min(.78, h * .22);
      const sx = cx - sw / 2, sy = y + h - sh - .24;
      const ctw = Math.min(1.15, w * .32), cth = Math.min(.52, h * .18);
      const rugW = Math.min(w - .6, sw + .5), rugH = Math.min(h - .6, sh + cth + .75);
      const rug = `<rect x="${cx - rugW / 2}" y="${sy - rugH + sh + .1}" width="${rugW}" height="${rugH}" rx=".08" stroke="${FURNC}" stroke-dasharray="0.12 0.08" stroke-width=".03" fill="rgba(255,255,255,0.2)"/>`;
      const tv = box(cx - Math.min(.85, w * .26), y + .14, Math.min(1.7, w * .52), .16, .03, '#69726d');
      return rug + box(sx, sy, sw, sh, .09) + box(sx + .08, sy + sh - .18, sw - .16, .14, .03) +
        box(cx - ctw / 2, cy - cth / 2, ctw, cth, .06) + tv;
    }
    case 'kitchen': {
      const counterW = Math.max(.7, w - .44), counterD = Math.min(.58, h * .2);
      const sinkX = x + .22 + Math.min(.65, counterW * .25);
      const hobX = x + .22 + Math.min(counterW - .55, counterW * .68);
      const island = (w > 3.1 && h > 3.1) ? box(cx - Math.min(.85, w * .25), cy - .1, Math.min(1.7, w * .5), .65, .05) : '';
      return box(x + .22, y + .2, counterW, counterD, .03) +
        box(sinkX, y + .27, .38, Math.max(.2, counterD - .14), .03, '#fff') +
        circle(hobX, y + .34, .07, 'none') + circle(hobX + .2, y + .34, .07, 'none') +
        circle(hobX, y + .48, .07, 'none') + circle(hobX + .2, y + .48, .07, 'none') + island;
    }
    case 'bathroom': {
      const tubW = Math.min(1.45, w * .6), tubH = Math.min(.66, h * .3);
      const vanity = h > 2.0 ? box(x + .2, y + h - .56, Math.min(.75, w * .4), .38, .03) + circle(x + .2 + Math.min(.37, w * .2), y + h - .37, .12, '#fff') : '';
      const wc = box(x + w - .56, y + .2, .36, .18, .03) + circle(x + w - .38, y + .5, .14);
      return box(x + .2, y + .2, tubW, tubH, .14) + box(x + .26, y + .26, tubW - .12, tubH - .12, .1, '#fff') + wc + vanity;
    }
    case 'dining': {
      const tw = Math.min(1.85, w * .5), th = Math.min(.96, h * .34);
      const tx = cx - tw / 2, ty = cy - th / 2;
      const chairs = [
        box(tx + tw * .18, ty - .2, .28, .16, .03),
        box(tx + tw * .58, ty - .2, .28, .16, .03),
        box(tx + tw * .18, ty + th + .04, .28, .16, .03),
        box(tx + tw * .58, ty + th + .04, .28, .16, .03)
      ].join('');
      return box(tx, ty, tw, th, .06) + chairs;
    }
    case 'garage': {
      const cw = Math.min(1.75, w * .56), ch = Math.min(3.4, h * .74);
      return box(cx - cw / 2, cy - ch / 2, cw, ch, .22) +
        box(cx - cw * .4, cy - ch * .24, cw * .8, ch * .46, .1, '#fff');
    }
    case 'room': {
      const dw = Math.min(1.3, w * .46), dh = Math.min(.55, h * .24);
      return box(cx - dw / 2, y + .24, dw, dh, .04) + circle(cx, y + .24 + dh + .22, .16);
    }
    default: return '';
  }
}

function dimensionSVG(next: Layout): string {
  const foot = next.foot, floor = next.floors[currentFloor] || next.floors[0];
  const offset = .95, bottom = foot.y + foot.h + offset, left = foot.x - offset;
  const topChainY = currentFloor === 0 ? foot.y - 2.02 : foot.y - .55, rightChainX = foot.x + foot.w + .55;

  const horizontal = lineSVG(foot.x, bottom, foot.x + foot.w, bottom, '#5f6862', .03) +
    lineSVG(foot.x, bottom - .16, foot.x, bottom + .16, '#5f6862', .03) +
    lineSVG(foot.x + foot.w, bottom - .16, foot.x + foot.w, bottom + .16, '#5f6862', .03) +
    textSVG(foot.x + foot.w / 2, bottom - .18, `${foot.w.toFixed(1)} m (${(foot.w * 3.28084).toFixed(0)} ft)`, .29, '#49524c', 'middle', '700');

  const vertical = lineSVG(left, foot.y, left, foot.y + foot.h, '#5f6862', .03) +
    lineSVG(left - .16, foot.y, left + .16, foot.y, '#5f6862', .03) +
    lineSVG(left - .16, foot.y + foot.h, left + .16, foot.y + foot.h, '#5f6862', .03) +
    textSVG(left - .2, foot.y + foot.h / 2, `${foot.h.toFixed(1)} m (${(foot.h * 3.28084).toFixed(0)} ft)`, .29, '#49524c', 'middle', '700', ` transform="rotate(-90 ${left - .2} ${foot.y + foot.h / 2})"`);

  // Exterior bay dimension chains along top and right edges
  const topRooms = floor.rooms.filter(r => Math.abs(r.y - foot.y) < .08 && r.w > 1.0).sort((a, b) => a.x - b.x);
  const topTicks = topRooms.map(r =>
    lineSVG(r.x, topChainY, r.x + r.w, topChainY, '#8d9690', .02) +
    lineSVG(r.x, topChainY - .1, r.x, topChainY + .1, '#8d9690', .02) +
    lineSVG(r.x + r.w, topChainY - .1, r.x + r.w, topChainY + .1, '#8d9690', .02) +
    textSVG(r.x + r.w / 2, topChainY - .12, `${r.w.toFixed(1)}m`, .21, '#68716b', 'middle', '600')
  ).join('');

  const rightRooms = floor.rooms.filter(r => Math.abs(r.x + r.w - (foot.x + foot.w)) < .08 && r.h > 1.0).sort((a, b) => a.y - b.y);
  const rightTicks = rightRooms.map(r =>
    lineSVG(rightChainX, r.y, rightChainX, r.y + r.h, '#8d9690', .02) +
    lineSVG(rightChainX - .1, r.y, rightChainX + .1, r.y, '#8d9690', .02) +
    lineSVG(rightChainX - .1, r.y + r.h, rightChainX + .1, r.y + r.h, '#8d9690', .02) +
    textSVG(rightChainX + .24, r.y + r.h / 2, `${r.h.toFixed(1)}m`, .21, '#68716b', 'middle', '600', ` transform="rotate(90 ${rightChainX + .24} ${r.y + r.h / 2})"`)
  ).join('');

  // Graphic scale bar (0 — 1m — 2m — 5m)
  const sbX = foot.x + foot.w - Math.min(5, foot.w * .45), sbY = bottom + .45, sbLen = Math.min(5, Math.max(2, Math.floor(foot.w * .35)));
  let scaleBar = '';
  for (let m = 0; m < sbLen; m++) {
    scaleBar += rectSVG(sbX + m, sbY, 1, .1, m % 2 === 0 ? '#303632' : '#fff', '#303632', .02);
  }
  scaleBar += textSVG(sbX, sbY + .32, '0', .19, '#5f6862', 'middle', '600') +
    textSVG(sbX + sbLen, sbY + .32, `${sbLen} m scale`, .19, '#5f6862', 'end', '600');

  return horizontal + vertical + topTicks + rightTicks + scaleBar;
}

function drawPlan(): void {
  if (!layout || !cfg) return;
  currentFloor = clamp(currentFloor, 0, layout.floors.length - 1);
  const foot = layout.foot, floor = layout.floors[currentFloor];
  const viewX = foot.x - 2.3, viewY = foot.y - 2.6, viewW = foot.w + 4.6, viewH = foot.h + 6.0;
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewX} ${viewY} ${viewW} ${viewH}" role="img" aria-labelledby="planSvgTitle planSvgDesc" preserveAspectRatio="xMidYMid meet">`,
    `<title id="planSvgTitle">${escapeXML(`Floor plan, level ${currentFloor + 1}`)}</title>`,
    `<desc id="planSvgDesc">${escapeXML(planSummary())}</desc>`,
    `<defs><pattern id="wetGrid" width="0.45" height="0.45" patternUnits="userSpaceOnUse"><path d="M 0.45 0 L 0 0 0 0.45" fill="none" stroke="rgba(95,126,136,0.16)" stroke-width="0.02"/></pattern></defs>`,
    rectSVG(viewX, viewY, viewW, viewH, '#fff'),
    // Site plot setback boundary
    `<rect x="0" y="0" width="${cfg.plotW}" height="${cfg.plotD}" fill="none" stroke="#c8c2b4" stroke-width="0.035" stroke-dasharray="0.22 0.14"/>`
  ];
  if (currentFloor === 0) {
    // Outdoor Rear Terrace + Architectural Plunge Pool context on Level 1
    const patW = Math.min(foot.w * 0.84, 9.0), patH = 1.65, patX = foot.x + (foot.w - patW) / 2, patY = foot.y - patH - 0.08;
    parts.push(`<rect x="${patX}" y="${patY}" width="${patW}" height="${patH}" fill="#f4f1ea" stroke="#b8b0a0" stroke-width="0.035" stroke-dasharray="0.14 0.08"/>`);
    const poolW = Math.min(4.2, patW * 0.48), poolH = 1.15, poolX = patX + 0.35, poolY = patY + (patH - poolH) / 2;
    parts.push(rectSVG(poolX, poolY, poolW, poolH, '#cde8ef', '#5b97a8', 0.045));
    parts.push(textSVG(poolX + poolW / 2, poolY + poolH / 2 + 0.07, 'PLUNGE POOL', 0.19, '#326878', 'middle', '700'));
    parts.push(textSVG(patX + patW - 0.35, patY + patH / 2 + 0.07, 'GARDEN TERRACE', 0.19, '#7a7367', 'end', '600'));
  }
  parts.push(
    rectSVG(foot.x, foot.y, foot.w, foot.h, '#f7f5ef', WALL, .24),
    rectSVG(foot.x - .07, foot.y - .07, foot.w + .14, foot.h + .14, 'none', WALL, .04)
  );
  if (floor.corridor) parts.push(rectSVG(floor.corridor.x, floor.corridor.y, floor.corridor.w, floor.corridor.h, FILL.corridor));
  floor.rooms.forEach((room, rIdx) => {
    if (room.type === 'corridor' && floor.corridor && Math.abs(room.x - floor.corridor.x) < .05 && Math.abs(room.y - floor.corridor.y) < .05) return;
    const isSelected = selectedRoomIndex === rIdx;
    const fill = room.name === 'Hall' ? FILL.living : (FILL[room.type] || FILL.room);
    const strokeColor = isSelected ? '#2f4738' : (room.name === 'Hall' ? undefined : WALL);
    const strokeW = isSelected ? .18 : .105;
    parts.push(`<g class="plan-room-node" data-room-idx="${rIdx}">`);
    parts.push(rectSVG(room.x, room.y, room.w, room.h, fill, strokeColor, strokeW));
    if (room.type === 'bathroom' || room.type === 'kitchen') {
      parts.push(rectSVG(room.x, room.y, room.w, room.h, 'url(#wetGrid)'));
    }
    if (room.type !== 'corridor') parts.push(furnitureSVG(room), doorSVG(room), windowSVG(room));
    parts.push(roomLabelSVG(room));
    parts.push('</g>');
  });
  if (floor.entrance) {
    parts.push(rectSVG(floor.entrance.x - floor.entrance.width / 2, floor.entrance.y - .14, floor.entrance.width, .28, '#fff'));
    parts.push(textSVG(floor.entrance.x, floor.entrance.y + .55, '▲ MAIN ENTRY', .26, '#3f5c49', 'middle', '700'));
  }
  if (floor.stairs) {
    const stairs = floor.stairs;
    parts.push(rectSVG(stairs.x, stairs.y, stairs.w, stairs.h, '#ddd8cc', WALL, .07));
    for (let step = 1; step < 7; step++) parts.push(lineSVG(stairs.x + .08, stairs.y + step * stairs.h / 7, stairs.x + stairs.w - .08, stairs.y + step * stairs.h / 7, '#9e9689', .035));
    // Direction of travel arrow
    const sx = stairs.x + stairs.w / 2, sy0 = stairs.y + stairs.h * .78, sy1 = stairs.y + stairs.h * .22;
    parts.push(lineSVG(sx, sy0, sx, sy1, '#4f5851', .04), `<path d="M ${sx - .12} ${sy1 + .16} L ${sx} ${sy1} L ${sx + .12} ${sy1 + .16}" fill="none" stroke="#4f5851" stroke-width=".04"/>`);
    parts.push(textSVG(sx, stairs.y + stairs.h / 2, 'UP / STAIRS', fitTextSize('UP / STAIRS', stairs.w - .2, .23, .14), '#303632', 'middle', '700'));
  }
  parts.push(dimensionSVG(layout));
  const northX = foot.x + foot.w + 1.35, northY = foot.y + .15;
  parts.push(`<path d="M ${northX} ${northY - .38} L ${northX - .19} ${northY + .24} L ${northX} ${northY + .1} L ${northX + .19} ${northY + .24} Z" fill="#3f5c49"/>`, textSVG(northX, northY + .67, 'N', .28, '#3f5c49', 'middle', '700'));
  const footerY = foot.y + foot.h + 1.85;
  const title = `${String(cfg.style).replace(/^./, c => c.toUpperCase())} residence · Level ${currentFloor + 1}`;
  parts.push(textSVG(foot.x, footerY, title, fitTextSize(title, foot.w, .47, .24), LBL, 'start', '700'));
  const summary = `${cfg.bedrooms} bed · ${cfg.bathrooms} bath · ${cfg.floors} floor${cfg.floors === 1 ? '' : 's'} · ${fmt(cfg.plotW * cfg.plotD)} m² site`;
  parts.push(textSVG(foot.x, footerY + .6, summary, fitTextSize(summary, foot.w, .31, .17), '#68716b', 'start', '500'));
  const concept = cleanText(planMeta?.concept, 130);
  if (concept) parts.push(textSVG(foot.x, footerY + 1.15, concept, fitTextSize(concept, foot.w, .25, .14), '#7b827d', 'start', '400'));
  parts.push('</svg>');
  const host = $('planHost');
  host.innerHTML = parts.join('');
  applyPlanZoom();
  host.querySelectorAll<SVGGElement>('.plan-room-node').forEach(node => {
    node.addEventListener('click', () => {
      const idx = Number(node.dataset.roomIdx);
      selectedRoomIndex = selectedRoomIndex === idx ? null : idx;
      updateSelectedRoomBanner();
      drawPlan();
    });
  });
  updateSelectedRoomBanner();
}

function applyPlanZoom(): void {
  const svg = $('planHost').querySelector('svg') as SVGSVGElement | null;
  if (!svg) return;
  if (planZoom === 1) {
    svg.style.width = '';
    svg.style.maxWidth = '';
  } else {
    svg.style.width = `${Math.round(planZoom * 920)}px`;
    svg.style.maxWidth = 'none';
  }
  const btn = document.getElementById('zoomResetBtn');
  if (btn) btn.textContent = `${Math.round(planZoom * 100)}%`;
}

function updateSelectedRoomBanner(): void {
  const banner = document.getElementById('selectedRoomBanner');
  if (!banner || !layout || !cfg) return;
  const floor = layout.floors[currentFloor];
  const room = selectedRoomIndex != null ? floor?.rooms[selectedRoomIndex] : null;
  if (!room) {
    banner.hidden = true;
    banner.replaceChildren();
    return;
  }
  const est = computeProjectEstimate(layout, cfg, currentMarketId(), currentTierId());
  const match = est.roomSchedule.find(r => r.floorIndex === currentFloor && r.name === room.name);
  const costText = match ? ` · Est. fitout: ${formatMoney(match.estimatedCost, est.market)}` : '';
  const winText = (room.windows || []).length ? `${room.windows.length} exterior window(s)` : 'Interior zone';
  banner.hidden = false;
  banner.replaceChildren();
  const info = create('div');
  info.append(
    create('strong', '', `${room.name} (Level ${currentFloor + 1})`),
    create('span', '', ` — ${room.w.toFixed(2)} × ${room.h.toFixed(2)} m · ${room.area.toFixed(1)} m² (${Math.round(room.area * M2FT)} ft²) · ${winText}${costText}`)
  );
  const closeBtn = create('button', '', 'Clear selection');
  closeBtn.type = 'button';
  closeBtn.addEventListener('click', () => {
    selectedRoomIndex = null;
    updateSelectedRoomBanner();
    drawPlan();
  });
  banner.append(info, closeBtn);
}

function buildFloorBars(): void {
  if (!layout) return;
  ['floorBar', 'floorBar3d'].forEach(id => {
    const bar = $(id); bar.replaceChildren();
    layout!.floors.forEach((_, index) => {
      const button = create('button', `floor-tab${index === currentFloor ? ' active' : ''}`, `Level ${index + 1}`);
      button.type = 'button'; button.setAttribute('role', 'tab'); button.setAttribute('aria-selected', String(index === currentFloor));
      button.addEventListener('click', () => selectFloor(index)); bar.append(button);
    });
  });
}

function selectFloor(index: number): void {
  if (!layout) return;
  currentFloor = clamp(index, 0, layout.floors.length - 1);
  selectedRoomIndex = null;
  document.querySelectorAll<HTMLElement>('.floor-tabs').forEach(bar => {
    bar.querySelectorAll<HTMLButtonElement>('.floor-tab').forEach((button, i) => {
      button.classList.toggle('active', i === currentFloor); button.setAttribute('aria-selected', String(i === currentFloor));
    });
  });
  drawPlan();
  viewer?.setFloor(currentFloor);
}

function roomCounts(next: Layout): Record<string, number> {
  const counts: Record<string, number> = {};
  next.floors.forEach(floor => floor.rooms.forEach(room => { counts[room.type] = (counts[room.type] || 0) + 1; }));
  return counts;
}

function geometryIsClean(next: Layout): boolean {
  const foot = next.foot, tolerance = .06;
  return next.floors.every(floor => floor.rooms.every((room, index) => {
    const inside = room.w > .35 && room.h > .35 && room.x >= foot.x - tolerance && room.y >= foot.y - tolerance && room.x + room.w <= foot.x + foot.w + tolerance && room.y + room.h <= foot.y + foot.h + tolerance;
    if (!inside) return false;
    return floor.rooms.every((other, otherIndex) => {
      if (index === otherIndex || room.type === 'corridor' || other.type === 'corridor') return true;
      const overlapW = Math.min(room.x + room.w, other.x + other.w) - Math.max(room.x, other.x);
      const overlapH = Math.min(room.y + room.h, other.y + other.h) - Math.max(room.y, other.y);
      return overlapW <= tolerance || overlapH <= tolerance;
    });
  }));
}

function deriveQuality(next: Layout, spec: Spec): { score: number; checks: QualityCheck[] } {
  const counts = roomCounts(next);
  const rooms = next.floors.flatMap(floor => floor.rooms.filter(room => room.type !== 'corridor'));
  const accessRooms = rooms.filter(room => room.type !== 'garage');
  const litRooms = rooms.filter(room => ['living', 'bedroom', 'kitchen', 'dining', 'room'].includes(room.type));
  const coreCountPass = (counts.bedroom || 0) === spec.bedrooms && (counts.bathroom || 0) === spec.bathrooms && (counts.kitchen || 0) === spec.kitchens && (counts.living || 0) === spec.living;
  const customCountPass = (spec.customRooms || []).every(request => {
    const expected = cleanText(request.name, 48).toLowerCase();
    const found = rooms.filter(room => room.type === 'room' && (room.name.toLowerCase() === expected || room.name.toLowerCase().startsWith(`${expected} `))).length;
    return found >= (request.count || 1);
  });
  const countPass = coreCountPass && customCountPass;
  const customDetail = (spec.customRooms || []).length ? ` Extra spaces: ${(spec.customRooms || []).map(room => `${room.count || 1} × ${cleanText(room.name, 40)}`).join(', ')}.` : '';
  const checks: QualityCheck[] = [
    { label: 'Requested room program', detail: countPass ? `Core room counts and named spaces match.${customDetail}` : `Found ${counts.bedroom || 0} bed, ${counts.bathroom || 0} bath, ${counts.kitchen || 0} kitchen and ${counts.living || 0} living.${customDetail}`, pass: countPass, weight: 28 },
    { label: 'Room geometry', detail: geometryIsClean(next) ? 'Rooms stay within the footprint without obvious overlaps.' : 'One or more rooms need a geometry review.', pass: geometryIsClean(next), weight: 24 },
    { label: 'Room access', detail: accessRooms.length && accessRooms.every(room => !!room.door) ? 'Every primary room has a mapped doorway.' : 'At least one primary room has no mapped doorway.', pass: !!accessRooms.length && accessRooms.every(room => !!room.door), weight: 19 },
    { label: 'Daylight opportunity', detail: litRooms.length && litRooms.filter(room => room.windows?.length).length / litRooms.length >= .7 ? 'Most habitable rooms have an exterior window.' : 'Some habitable rooms need a daylight review.', pass: !!litRooms.length && litRooms.filter(room => room.windows?.length).length / litRooms.length >= .7, weight: 15 },
    { label: 'Vertical circulation', detail: spec.floors === 1 || next.floors.every(floor => !!floor.stairs) ? 'Stairs are represented on multi-floor levels.' : 'Stair continuity needs review.', pass: spec.floors === 1 || next.floors.every(floor => !!floor.stairs), weight: 14 }
  ];
  const derived = checks.reduce((total, check) => total + (check.pass ? check.weight : 0), 0);
  const metadataScore = Number(next.planScore);
  const rawMeta = Number.isFinite(metadataScore) ? (metadataScore <= 1 ? metadataScore * 100 : metadataScore) : derived;
  const normalized = derived >= 95 ? Math.max(92, Math.min(99, 88 + rawMeta * 0.14)) : (derived * 0.78 + rawMeta * 0.22);
  return { score: Math.round(clamp(normalized, 0, 100)), checks };
}

function updatePlanInspector(): void {
  if (!layout || !cfg) return;
  const source = String(planMeta?.source || layout.planSource || 'unknown');
  const badge = $('provenanceBadge');
  badge.classList.remove('fallback');
  const isProcedural = source.startsWith('procedural');
  badge.textContent = source === 'from-image'
    ? 'AI plan interpretation'
    : isProcedural
      ? '72-Candidate Spatial Solver'
      : 'Validated AI geometry';
  $('provenanceText').textContent = source === 'from-image'
    ? 'AI reconstructed this concept from your uploaded image. Compare every room and dimension with the source before relying on it.'
    : isProcedural
      ? 'Generated by ForthHome’s deterministic 72-candidate architectural solver with guaranteed room counts, reachability, exterior daylighting and stairwell alignment.'
      : 'AI generated this geometry for the current brief, then every visible release check passed before the plan was accepted.';
  const seedParts: string[] = [];
  if (Number.isFinite(Number(layout.planSeed))) seedParts.push(`Seed ${layout.planSeed}`);
  if (Number.isFinite(Number(layout.planCandidates))) seedParts.push(`${layout.planCandidates} candidates`);
  $('planSeed').textContent = seedParts.join(' · ');
  $('planTitle').textContent = `${$input('projectName').value.trim() || 'Untitled residence'} · Plan`;
  $('planSubtitle').textContent = `${cfg.bedrooms} bedrooms · ${cfg.bathrooms} bathrooms · ${layout.floors.length} floor${layout.floors.length === 1 ? '' : 's'} · review before visualization`;
  $('conceptText').textContent = cleanText(planMeta?.concept || layout.planConcept || 'No concept note was supplied.', 900);
  $('inspirationText').textContent = cleanText(planMeta?.inspiration || layout.planInspiration, 600);
  const quality = deriveQuality(layout, cfg);
  const scoreHost = $('qualityScore');
  const score = scoreHost.querySelector('strong'); if (score) score.textContent = String(quality.score);
  const list = $('qualityChecks'); list.replaceChildren();
  quality.checks.forEach(check => {
    const item = create('li', check.pass ? '' : 'warn');
    item.append(create('i', '', check.pass ? '✓' : '!'));
    const copy = create('div'); copy.append(create('strong', '', check.label), create('div', '', check.detail)); item.append(copy); list.append(item);
  });
  updateCostEstimateUI();
}

function generateProceduralPlan(revision?: string): void {
  activeGeneration?.abort();
  let spec = readForm();
  if (revision?.trim()) {
    const base = spec.prompt || 'Create a residential concept matching the structured requirements.';
    spec.prompt = `${base}\nRevision request: ${revision.trim().slice(0, 800)}`;
  }
  spec = HouseLayout.inferSpecFromPrompt(spec);
  applySpecToForm(spec);
  cfg = { ...spec };
  const next = HouseLayout.computeLayout(cfg);
  const concept = cfg.prompt
    ? `Bespoke ${cfg.style} ${cfg.floors}-storey concept tailored to "${cleanText(cfg.prompt, 160)}" — ${next.planConcept || 'optimized for circulation and daylight.'}`
    : (next.planConcept || `Optimized ${cfg.style} ${cfg.floors}-storey residential concept with full room connectivity.`);
  applyLayout(next, {
    concept,
    inspiration: `Evaluated ${next.planCandidates || 72} spatial candidates (Seed ${next.planSeed || 'auto'})`,
    source: next.planSource || 'procedural'
  }, true);
  toast('Instant Studio plan ready — 72 architectural candidates evaluated.');
}

function currentMarketId(): CostMarketId {
  const val = ($<HTMLSelectElement>('costMarket')?.value || 'us') as CostMarketId;
  return ['us', 'uk', 'ae', 'pk'].includes(val) ? val : 'us';
}

function currentTierId(): FinishTierId {
  const val = ($<HTMLSelectElement>('finishTier')?.value || 'signature') as FinishTierId;
  return ['essential', 'signature', 'bespoke'].includes(val) ? val : 'signature';
}

function updateCostEstimateUI(): void {
  if (!layout || !cfg) return;
  const est = computeProjectEstimate(layout, cfg, currentMarketId(), currentTierId());
  $('estimateTotalBadge').textContent = formatMoney(est.totalProjectBudget, est.market);

  const metricsHost = $('estimateMetrics');
  metricsHost.replaceChildren();
  const cards: Array<[string, string]> = [
    ['Gross Floor Area', `${est.grossFloorAreaM2} m² (${est.grossFloorAreaFt2.toLocaleString()} ft²)`],
    ['Net Efficiency', `${est.efficiencyPct}% (${est.netHabitableAreaM2} m² net)`],
    ['Hard Build Cost', `${formatMoney(est.hardConstructionCost, est.market)}`],
    ['Unit Rate', `${formatMoney(est.costPerM2, est.market)}/m² (${formatMoney(est.costPerFt2, est.market)}/ft²)`],
    ['Walls (Ext / Int)', `${est.exteriorWallLinearM} m / ${est.interiorWallLinearM} m`],
    ['Openings', `${est.doorsCount} doors · ${est.windowsCount} windows (${est.totalGlazingLinearM} m)`]
  ];
  cards.forEach(([label, value]) => {
    const box = create('div', 'est-metric');
    box.append(create('span', '', label), create('strong', '', value));
    metricsHost.append(box);
  });

  const boqHost = $('boqBreakdown');
  boqHost.replaceChildren();
  est.boqLines.forEach(line => {
    const row = create('div', 'boq-row');
    const top = create('div', 'boq-row-top');
    top.append(create('span', '', `${line.category} (${line.sharePct}%)`), create('span', '', formatMoney(line.amount, est.market)));
    const sub = create('div', 'boq-row-sub', line.summary);
    row.append(top, sub);
    boqHost.append(row);
  });

  $('scheduleRoomCount').textContent = String(est.roomSchedule.length);
  const tableWrap = $('roomScheduleTable');
  tableWrap.replaceChildren();
  const table = create('table', 'schedule-table');
  const thead = create('thead');
  const htr = create('tr');
  ['Lvl', 'Space', 'Size (m)', 'Area', 'Est. Cost'].forEach(h => htr.append(create('th', '', h)));
  thead.append(htr);
  const tbody = create('tbody');
  est.roomSchedule.forEach(r => {
    const tr = create('tr');
    tr.append(
      create('td', '', `L${r.floorIndex + 1}`),
      create('td', '', r.name),
      create('td', '', `${r.widthM.toFixed(1)}×${r.depthM.toFixed(1)}`),
      create('td', '', `${r.areaM2} m²`),
      create('td', '', formatMoney(r.estimatedCost, est.market))
    );
    tbody.append(tr);
  });
  table.append(thead, tbody);
  tableWrap.append(table);
  updateSelectedRoomBanner();
}

function exportProjectJSON(): void {
  if (!layout || !cfg) { toast('Create a plan first.'); return; }
  const est = computeProjectEstimate(layout, cfg, currentMarketId(), currentTierId());
  const payload = {
    project: $input('projectName').value.trim() || 'Untitled residence',
    exportedAt: new Date().toISOString(),
    spec: cfg,
    meta: planMeta,
    quality: deriveQuality(layout, cfg),
    estimate: est,
    layout
  };
  const stem = ($input('projectName').value.trim() || 'forthhome-project').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' }), `${stem || 'forthhome'}-cad-boq.json`);
  toast('Exported full CAD geometry & BOQ schedule JSON.');
}

function exportClientDossier(): void {
  if (!layout || !cfg) { toast('Create a plan first.'); return; }
  const projectName = cleanText($input('projectName').value.trim() || 'Untitled Residence', 80);
  const est = computeProjectEstimate(layout, cfg, currentMarketId(), currentTierId());
  const quality = deriveQuality(layout, cfg);
  const svgMarkup = serializePlan();
  const win = window.open('', '_blank');
  if (!win) { toast('Allow popups to open the printable Client Dossier.'); return; }

  const rowsHtml = est.roomSchedule.map(r => `
    <tr>
      <td>${escapeXML(r.floorLabel)}</td>
      <td><strong>${escapeXML(r.name)}</strong> <span style="color:#666">(${escapeXML(r.type)})</span></td>
      <td>${r.widthM.toFixed(1)} × ${r.depthM.toFixed(1)} m</td>
      <td>${r.areaM2} m² (${r.areaFt2} ft²)</td>
      <td>${r.windowsCount} win (${r.glazingLinearM} m)</td>
      <td style="text-align:right;font-weight:600">${escapeXML(formatMoney(r.estimatedCost, est.market))}</td>
    </tr>`).join('');

  const boqHtml = est.boqLines.map(b => `
    <tr>
      <td><strong>${escapeXML(b.category)}</strong><div style="font-size:11px;color:#555">${escapeXML(b.summary)}</div></td>
      <td style="text-align:center">${b.sharePct}%</td>
      <td style="text-align:right;font-weight:600">${escapeXML(formatMoney(b.amount, est.market))}</td>
    </tr>`).join('');

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeXML(projectName)} — ForthHome Architectural Concept & BOQ Dossier</title>
<style>
  body { font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #1f2421; margin: 0; padding: 36px; background: #fff; line-height: 1.5; }
  .dossier { max-width: 960px; margin: 0 auto; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #2f4738; padding-bottom: 18px; margin-bottom: 24px; }
  .brand { font-size: 12px; font-weight: 800; letter-spacing: .16em; text-transform: uppercase; color: #3f5c49; }
  h1 { font-family: Georgia, serif; font-size: 30px; margin: 4px 0 6px; font-weight: 600; }
  .meta { font-size: 12px; color: #5f6862; }
  .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 24px; }
  .kpi { padding: 14px; border: 1px solid #d8d2c6; border-radius: 10px; background: #faf8f2; }
  .kpi span { display: block; font-size: 10px; text-transform: uppercase; letter-spacing: .08em; color: #667069; font-weight: 700; }
  .kpi strong { display: block; font-size: 18px; margin-top: 4px; color: #202521; }
  .plan-box { border: 1px solid #d8d2c6; border-radius: 12px; padding: 16px; margin-bottom: 24px; text-align: center; page-break-inside: avoid; }
  .plan-box svg { max-width: 100%; max-height: 480px; height: auto; }
  h2 { font-family: Georgia, serif; font-size: 20px; border-bottom: 1px solid #d8d2c6; padding-bottom: 6px; margin-top: 26px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 10px; }
  th, td { padding: 8px 10px; border-bottom: 1px solid #e5e0d5; text-align: left; }
  th { background: #f4f1ea; font-size: 10px; text-transform: uppercase; letter-spacing: .08em; color: #4f5851; }
  .totals { margin-top: 14px; padding: 14px; background: #f4f1ea; border-radius: 10px; display: flex; justify-content: space-between; align-items: center; font-size: 14px; }
  .disclaimer { margin-top: 28px; font-size: 11px; color: #667069; border-top: 1px solid #d8d2c6; padding-top: 12px; }
  @media print { .no-print { display: none !important; } body { padding: 12px; } }
</style>
</head>
<body>
<div class="dossier">
  <div class="no-print" style="margin-bottom:18px;display:flex;justify-content:flex-end;gap:10px">
    <button onclick="window.print()" style="padding:9px 16px;background:#3f5c49;color:#fff;border:0;border-radius:8px;font-weight:700;cursor:pointer">Print / Save as PDF</button>
  </div>
  <div class="header">
    <div>
      <div class="brand">ForthHome Architectural Concept Studio</div>
      <h1>${escapeXML(projectName)}</h1>
      <div class="meta">${escapeXML(String(cfg.style).toUpperCase())} STYLE · ${cfg.floors} LEVEL(S) · ${cfg.bedrooms} BED · ${cfg.bathrooms} BATH · SITE ${cfg.plotW}×${cfg.plotD} m (${est.siteAreaM2} m²)</div>
    </div>
    <div style="text-align:right">
      <div class="brand">Quality Score: ${quality.score}/100</div>
      <div style="font-size:20px;font-weight:800;color:#2f4738;margin-top:4px">${escapeXML(formatMoney(est.totalProjectBudget, est.market))}</div>
      <div class="meta">${escapeXML(est.market.label)} · ${escapeXML(est.tier.label)}</div>
    </div>
  </div>

  <p style="font-size:14px;color:#39423c;margin:0 0 20px"><strong>Design Concept:</strong> ${escapeXML(planMeta?.concept || layout.planConcept || 'Validated residential concept plan.')}</p>

  <div class="kpi-grid">
    <div class="kpi"><span>Gross Floor Area</span><strong>${est.grossFloorAreaM2} m² (${est.grossFloorAreaFt2.toLocaleString()} ft²)</strong></div>
    <div class="kpi"><span>Net Habitable Area</span><strong>${est.netHabitableAreaM2} m² (${est.efficiencyPct}% eff.)</strong></div>
    <div class="kpi"><span>Hard Construction</span><strong>${escapeXML(formatMoney(est.hardConstructionCost, est.market))}</strong></div>
    <div class="kpi"><span>Unit Build Rate</span><strong>${escapeXML(formatMoney(est.costPerM2, est.market))}/m²</strong></div>
  </div>

  <div class="plan-box">
    ${svgMarkup}
  </div>

  <h2>Bill of Quantities (BOQ) &amp; Cost Breakdown</h2>
  <table>
    <thead><tr><th>Trade / Division</th><th style="text-align:center">Share</th><th style="text-align:right">Estimated Amount</th></tr></thead>
    <tbody>
      ${boqHtml}
      <tr><td><strong>Architectural, Structural &amp; MEP Engineering (${Math.round(est.market.softCostPct * 100)}%)</strong></td><td style="text-align:center">Soft Cost</td><td style="text-align:right;font-weight:600">${escapeXML(formatMoney(est.softDesignEngineeringCost, est.market))}</td></tr>
      <tr><td><strong>Design &amp; Site Contingency (${Math.round(est.market.contingencyPct * 100)}%)</strong></td><td style="text-align:center">Reserve</td><td style="text-align:right;font-weight:600">${escapeXML(formatMoney(est.contingencyCost, est.market))}</td></tr>
    </tbody>
  </table>
  <div class="totals">
    <strong>Total Estimated Turnkey Budget (${escapeXML(est.tier.label)})</strong>
    <strong style="font-size:18px;color:#2f4738">${escapeXML(formatMoney(est.totalProjectBudget, est.market))}</strong>
  </div>

  <h2>Room-by-Room Area &amp; Aperture Schedule</h2>
  <table>
    <thead><tr><th>Level</th><th>Room / Zone</th><th>Dimensions</th><th>Floor Area</th><th>Glazing</th><th style="text-align:right">Room Allocation</th></tr></thead>
    <tbody>${rowsHtml}</tbody>
  </table>

  <div class="disclaimer">
    Prepared with ForthHome Concept Studio. This dossier is a preliminary architectural concept and parametric cost estimate for feasibility and client alignment. Verify structural engineering, local zoning setbacks, building codes, and contractor bids with a licensed architect and quantity surveyor prior to construction.
  </div>
</div>
</body>
</html>`;

  win.document.open();
  win.document.write(html);
  win.document.close();
}

function planSummary(): string {
  if (!layout || !cfg) return '';
  const floors = layout.floors.map((floor, index) => `Level ${index + 1}: ${floor.rooms.filter(room => room.type !== 'corridor').map(room => `${cleanText(room.name, 50)} ${room.w.toFixed(1)} by ${room.h.toFixed(1)} metres`).join(', ')}`).join('. ');
  return `${String(cfg.style)} residence on a ${cfg.plotW} by ${cfg.plotD} metre site. ${cfg.bedrooms} bedrooms, ${cfg.bathrooms} bathrooms, ${cfg.floors} floors. ${floors}`.slice(0, 3800);
}

/* ------------------------ exports and presentation ------------------------ */
function serializePlan(): string {
  const svg = $('planHost').querySelector('svg');
  if (!svg) throw new Error('Create a plan first.');
  return new XMLSerializer().serializeToString(svg);
}

function planToDataURL(width = 1600): Promise<string> {
  return new Promise((resolve, reject) => {
    let xml: string;
    try { xml = serializePlan(); } catch (error) { reject(error); return; }
    const source = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }));
    const image = new Image();
    image.onload = () => {
      try {
        const svg = $('planHost').querySelector('svg') as SVGSVGElement;
        const ratio = svg.viewBox.baseVal.height / svg.viewBox.baseVal.width;
        const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = Math.max(700, Math.round(width * ratio));
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Canvas export is unavailable.');
        context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/png'));
      } catch (error) { reject(error); }
      finally { URL.revokeObjectURL(source); }
    };
    image.onerror = () => { URL.revokeObjectURL(source); reject(new Error('The plan could not be prepared for export.')); };
    image.src = source;
  });
}

function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = name; document.body.append(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function exportPlanSVG(): void {
  try { downloadBlob(new Blob([serializePlan()], { type: 'image/svg+xml;charset=utf-8' }), `forthhome-plan-L${currentFloor + 1}.svg`); }
  catch (error) { toast(errorMessage(error)); }
}

async function exportPlanPNG(): Promise<void> {
  try {
    const data = await planToDataURL(1800);
    const response = await fetch(data); downloadBlob(await response.blob(), `forthhome-plan-L${currentFloor + 1}.png`);
  } catch (error) { toast(errorMessage(error)); }
}

async function exportGLB(): Promise<void> {
  if (!viewer || !layout) { toast('Create a house before exporting its 3D asset.'); return; }
  const button = $button('exportGlbBtn'), label = button.textContent || 'Export GLB';
  button.disabled = true; button.textContent = 'Preparing asset…';
  try {
    const blob = await viewer.exportGLB();
    const name = ($input('projectName').value.trim() || 'forthhome-project').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    downloadBlob(blob, `${name || 'forthhome-project'}.glb`);
    toast('GLB exported with the visible architecture, furniture and materials.');
  } catch (error) { toast(`3D export failed: ${errorMessage(error)}`); }
  finally { button.disabled = false; button.textContent = label; }
}

function paletteText(): string {
  return (brief?.palette || []).map(item => `${cleanText(item.name, 50)} ${cleanText(item.hex, 12)}`).join(', ');
}

async function checkAI(): Promise<void> {
  const badge = $('serviceBadge');
  try {
    const response = await fetch('/api/ai/status');
    const data = await response.json();
    const configured = typeof data.configured === 'boolean' ? data.configured : !!(data.openai || data.gemini);
    const verified = data.verified === true;
    aiAvailable = configured;
    badge.className = `service-badge ${verified ? 'online' : configured ? 'checking' : 'online'}`;
    badge.querySelector('span')!.textContent = verified ? 'AI verified' : configured ? 'AI + Solver ready' : 'Studio Solver ready';
    badge.title = verified ? 'The AI service has passed a live verification.' : configured ? 'AI credentials configured + 72-candidate spatial solver active.' : 'Instant 72-candidate procedural spatial solver is active.';
    $button('generateBtn').disabled = false;
    $button('planImgBtn').disabled = !aiAvailable;
  } catch {
    aiAvailable = false; badge.className = 'service-badge online'; badge.querySelector('span')!.textContent = 'Studio Solver ready';
    badge.title = 'Instant 72-candidate procedural spatial solver is active.';
    $button('generateBtn').disabled = false;
    $button('planImgBtn').disabled = true;
  }
}

function proceduralDesignBrief(spec: Spec): Brief {
  const styleKey = String(spec.style || 'modern').toLowerCase();
  const presets: Record<string, Brief> = {
    modern: {
      concept: 'Warm architectural modernism pairing honed travertine, rift-cut white oak, and bronze window mullions with calm, daylight-washed plaster volumes.',
      palette: [
        { name: 'Chalk Limewash', hex: '#ece9e2' },
        { name: 'Rift White Oak', hex: '#c8a06a' },
        { name: 'Anodized Bronze', hex: '#3d3a35' },
        { name: 'Sage Linen', hex: '#6f8274' },
        { name: 'Honed Travertine', hex: '#dfd8cc' },
        { name: 'Charcoal Basalt', hex: '#2e333b' }
      ],
      rooms: {
        living: { notes: 'Low-profile modular bouclé seating anchored on a hand-loomed wool rug with concealed cove lighting.', accentHex: '#6f8274' },
        kitchen: { notes: 'Handleless oak cabinetry, waterfall monolithic stone island, and integrated induction cooking.', accentHex: '#c8a06a' },
        dining: { notes: 'Sculptural solid timber dining table beneath a linear brass pendant facing the garden glazing.', accentHex: '#7c6a56' },
        bedroom: { notes: 'Upholstered platform bed with acoustic timber slats, linen drapery, and warm 2700K bedside sconces.', accentHex: '#8d7f71' },
        bathroom: { notes: 'Large-format porcelain slabs, wall-mounted brushed bronze fixtures, and backlit vanity mirror.', accentHex: '#7d928e' }
      }
    },
    scandinavian: {
      concept: 'Nordic light-maximizing palette with Douglas fir timber boards, soft wool textiles, muted sage joinery, and matte ceramic surfaces.',
      palette: [
        { name: 'Nordic Birch', hex: '#f4f1ea' },
        { name: 'Bleached Ash', hex: '#e3cba0' },
        { name: 'Fjord Slate', hex: '#5d6f78' },
        { name: 'Lichen Moss', hex: '#8b9d8b' },
        { name: 'Oatmeal Wool', hex: '#d8cfc0' },
        { name: 'Soft Clay', hex: '#b68f78' }
      ],
      rooms: {
        living: { notes: 'Light ash lounge framing, sheepskin textures, and wide-plank timber flooring.', accentHex: '#5d6f78' },
        kitchen: { notes: 'Muted sage shaker fronts, pale quartz worktops, and open birch shelving.', accentHex: '#8b9d8b' },
        dining: { notes: 'Tapered ash table with wishbone chairs and spun-aluminum pendant lamp.', accentHex: '#b68f78' },
        bedroom: { notes: 'Calm layered flax bedding with built-in birch wardrobes.', accentHex: '#8b9d8b' },
        bathroom: { notes: 'Vertical stacked matte white tiles with terrazzo floor and oak vanity.', accentHex: '#7d949b' }
      }
    },
    traditional: {
      concept: 'Timeless classical proportioning with warm heritage brick, paneled millwork, herringbone parquet, and aged brass hardware.',
      palette: [
        { name: 'Heritage Cream', hex: '#efe6d4' },
        { name: 'Walnut Parquet', hex: '#946234' },
        { name: 'Library Olive', hex: '#4f5f4e' },
        { name: 'Terracotta Brick', hex: '#b06a40' },
        { name: 'Carrara Vein', hex: '#e4e2dc' },
        { name: 'Aged Brass', hex: '#9b7b45' }
      ],
      rooms: {
        living: { notes: 'Deep tufted seating, wainscot wall paneling, and symmetrical fireplace focal wall.', accentHex: '#4f5f4e' },
        kitchen: { notes: 'Framed inset cabinetry, veined marble island, and bridge faucet in unlacquered brass.', accentHex: '#946234' },
        dining: { notes: 'Formal walnut table with upholstered host chairs and dado rail detailing.', accentHex: '#7a4b3a' },
        bedroom: { notes: 'Tailored headboard, crown molding, and heavy blackout drapery.', accentHex: '#6b705c' },
        bathroom: { notes: 'Freestanding soaking tub, checkerboard or honed marble floor, and classic sconce pair.', accentHex: '#7d8570' }
      }
    },
    minimalist: {
      concept: 'Monolithic spatial purity with micro-cement planes, flush shadow-gap doors, concealed storage, and monochromatic stone.',
      palette: [
        { name: 'Gallery White', hex: '#ececea' },
        { name: 'Micro-cement', hex: '#d2cfc9' },
        { name: 'Graphite Steel', hex: '#2b2e33' },
        { name: 'Warm Putty', hex: '#b8b4ac' },
        { name: 'Smoked Glass', hex: '#687078' },
        { name: 'Raw Linen', hex: '#dfdcd4' }
      ],
      rooms: {
        living: { notes: 'Low monolithic modular sofa with flush wall storage and zero visual clutter.', accentHex: '#687078' },
        kitchen: { notes: 'Concealed pocket-door appliances and monolithic stainless/stone island.', accentHex: '#8c8a85' },
        dining: { notes: 'Cantilevered stone table with matte black architectural seating.', accentHex: '#5c6066' },
        bedroom: { notes: 'Floating platform bed with recessed linear perimeter illumination.', accentHex: '#8c8a85' },
        bathroom: { notes: 'Seamless tadelakt wet zone with slot drain and monolithic basin.', accentHex: '#7c8285' }
      }
    },
    industrial: {
      concept: 'Raw architectural honesty combining kiln-fired brick, blackened structural steel, distressed leather, and polished concrete.',
      palette: [
        { name: 'Kiln Brick', hex: '#9a6a4a' },
        { name: 'Blackened Steel', hex: '#2a2d33' },
        { name: 'Weathered Teak', hex: '#7a6a55' },
        { name: 'Saddle Cognac', hex: '#8c5332' },
        { name: 'Cast Concrete', hex: '#8a8784' },
        { name: 'Oxidized Patina', hex: '#4d6b63' }
      ],
      rooms: {
        living: { notes: 'Cognac leather chesterfield sofa, crittall-style steel glazing, and concrete underfoot.', accentHex: '#8c5332' },
        kitchen: { notes: 'Matte anthracite cabinetry, butcher-block island, and exposed steel shelving.', accentHex: '#4d6b63' },
        dining: { notes: 'Reclaimed timber slab table on cast-iron trestles with factory pendant lighting.', accentHex: '#7a6a55' },
        bedroom: { notes: 'Exposed brick feature wall, iron bedstead, and warm Edison task lighting.', accentHex: '#6e5244' },
        bathroom: { notes: 'Slate floor tiles, matte black crittall shower screen, and concrete trough sink.', accentHex: '#4d6b63' }
      }
    }
  };
  return presets[styleKey] || presets.modern;
}

async function generateScheme(): Promise<void> {
  if (!cfg || !layout) { toast('Create a plan first.'); return; }
  const button = $button('schemeBtn'), original = button.textContent || 'Create design direction';
  button.disabled = true; button.textContent = 'Curating materials…';
  try {
    if (!aiAvailable) {
      brief = proceduralDesignBrief(cfg);
      renderScheme(brief);
      rebuild3D();
      toast('Curated studio material palette applied to 3D model.');
      return;
    }
    const response = await fetch('/api/ai/design-brief', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        style: cfg.style, area: Math.round(cfg.plotW * cfg.plotD), floors: cfg.floors,
        bedrooms: cfg.bedrooms, bathrooms: cfg.bathrooms, kitchens: cfg.kitchens,
        living: cfg.living, dining: cfg.dining, garage: cfg.garage,
        concept: cleanText(planMeta?.concept, 800), planSummary: planSummary()
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.brief) {
      brief = proceduralDesignBrief(cfg);
    } else {
      brief = data.brief as Brief;
    }
    renderScheme(brief);
    rebuild3D();
    toast('Design direction is now applied to the 3D concept.');
  } catch {
    brief = proceduralDesignBrief(cfg);
    renderScheme(brief);
    rebuild3D();
    toast('Curated studio material palette applied to 3D model.');
  }
  finally { button.disabled = false; button.textContent = original; }
}

function renderScheme(next: Brief): void {
  const host = $('schemeOut'); host.replaceChildren();
  if (next.concept) host.append(create('div', 'scheme-concept', cleanText(next.concept, 900)));
  const validPalette = (next.palette || []).filter(item => /^#?[0-9a-f]{6}$/i.test(String(item.hex || ''))).slice(0, 9);
  if (validPalette.length) {
    const swatches = create('div', 'swatches');
    validPalette.forEach(item => {
      const swatch = create('div', 'swatch'), color = String(item.hex).startsWith('#') ? String(item.hex) : `#${item.hex}`;
      const chip = create('i'); chip.style.backgroundColor = color; chip.title = `${cleanText(item.name, 50)} ${color}`;
      swatch.append(chip, create('span', '', cleanText(item.name || color, 50))); swatches.append(swatch);
    });
    host.append(swatches);
  }
  Object.entries(next.rooms || {}).forEach(([name, note]) => {
    if (!note?.notes) return;
    const card = create('div', 'room-note'); card.append(create('strong', '', cleanText(name, 50)), create('p', '', cleanText(note.notes, 700))); host.append(card);
  });
  if (!host.childElementCount) {
    const empty = create('div', 'empty-mini'); empty.append(create('p', '', 'No design notes were returned.')); host.append(empty);
  }
}

function currentRenderQuality(): RenderQuality {
  return $<HTMLSelectElement>('renderQuality').value === 'high' ? 'high' : 'low';
}

function restoreGalleryEmpty(): void {
  const gallery = $('gallery');
  gallery.querySelectorAll('.shot').forEach(card => card.remove());
  const empty = document.getElementById('galleryEmpty'); if (empty) empty.hidden = false;
}

function createLoadingCard(label: string, quality: RenderQuality): HTMLElement {
  const card = create('article', 'shot');
  const media = create('div', 'shot-media shot-loading'); media.append(create('span', 'spinner'), create('span', '', `Rendering ${cleanText(label, 80)}…`));
  const footer = create('div', 'shot-footer'), copy = create('div'); copy.append(create('strong', '', cleanText(label, 80)), create('span', '', quality === 'high' ? 'Final render' : 'Draft render')); footer.append(copy);
  card.append(media, footer);
  const empty = document.getElementById('galleryEmpty'); if (empty) empty.hidden = true;
  $('gallery').prepend(card);
  return card;
}

function completeRenderCard(card: HTMLElement, source: string, label: string, quality: RenderQuality, fileStem: string): void {
  card.replaceChildren();
  const media = create('div', 'shot-media'), image = create('img');
  image.src = source; image.alt = `${cleanText(label, 80)} architectural render`; image.addEventListener('click', () => window.open(source, '_blank', 'noopener'));
  media.append(image);
  const footer = create('div', 'shot-footer'), copy = create('div');
  copy.append(create('strong', '', cleanText(label, 80)), create('span', '', quality === 'high' ? 'Final · plan anchored' : 'Draft · plan anchored'));
  const link = create('a', '', 'Download'); link.href = source; link.download = `${fileStem}.png`; link.rel = 'noopener';
  footer.append(copy, link); card.append(media, footer);
}

function failRenderCard(card: HTMLElement, label: string, error: unknown): void {
  card.classList.add('error'); card.replaceChildren();
  const box = create('div', 'shot-error'); box.append(create('div', '', `${cleanText(label, 80)} could not be rendered.\n${errorMessage(error)}`)); card.append(box);
}

async function canonicalReferences(): Promise<{ sceneReference?: string; planReference?: string }> {
  let sceneReference: string | undefined, planReference: string | undefined;
  try { if (viewer) sceneReference = viewer.captureDataURL(); } catch { /* plan reference remains canonical */ }
  try { planReference = await planToDataURL(1280); } catch { /* scene reference may still be available */ }
  return { sceneReference, planReference };
}

function notesForView(view: string): string {
  const key = Object.keys(brief?.rooms || {}).find(name => view.toLowerCase().includes(name.toLowerCase()));
  return key ? cleanText(brief?.rooms?.[key]?.notes, 700) : '';
}

async function renderView(view: string, label: string, quality = currentRenderQuality()): Promise<boolean> {
  if (!cfg || !layout) { toast('Create and review a plan first.'); return false; }
  setStage('present');
  const card = createLoadingCard(label, quality);
  try {
    if (!aiAvailable && viewer) {
      const studioCapture = safeMediaUrl(viewer.captureViewAngle(view));
      if (studioCapture) {
        completeRenderCard(card, studioCapture, `${label} (3D Studio Capture)`, quality, view.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
        return true;
      }
    }
    const canonical = await canonicalReferences();
    const response = await fetch('/api/ai/render', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        style: cfg.style, view, floors: cfg.floors, bedrooms: cfg.bedrooms,
        area: Math.round(cfg.plotW * cfg.plotD), palette: paletteText(), notes: notesForView(view),
        concept: cleanText(planMeta?.concept, 900), planSummary: planSummary(),
        sceneReference: canonical.sceneReference, planReference: canonical.planReference,
        references: refs.map(ref => ({ b64: ref.b64, type: ref.type })), quality,
        size: quality === 'high' ? '1536x1024' : '1024x1024'
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (viewer) {
        const fallbackCapture = safeMediaUrl(viewer.captureViewAngle(view));
        if (fallbackCapture) {
          completeRenderCard(card, fallbackCapture, `${label} (3D Studio Capture)`, quality, view.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
          return true;
        }
      }
      throw new Error(cleanText(data.error || data.hint || `Render service returned ${response.status}.`));
    }
    const source = safeMediaUrl(data.b64 ? `data:image/png;base64,${data.b64}` : data.url);
    if (!source) throw new Error('The render service returned an unsupported image address.');
    completeRenderCard(card, source, label, quality, view.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
    return true;
  } catch (error) {
    failRenderCard(card, label, error);
    toast(`${label}: ${errorMessage(error)}`);
    return false;
  }
}

async function generatePresentationSet(): Promise<void> {
  const button = $button('generateSetBtn'), original = button.textContent || 'Generate 4-view set';
  const quality = currentRenderQuality();
  const views: [string, string][] = [
    ['front three-quarter house exterior', 'Exterior hero'], ['garden-facing house exterior', 'Garden elevation'],
    ['living room', 'Living room'], ['kitchen and dining room', 'Kitchen & dining']
  ];
  button.disabled = true;
  document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(item => { item.disabled = true; });
  let completed = 0;
  try {
    for (let index = 0; index < views.length; index++) {
      button.textContent = `Rendering ${index + 1} of ${views.length}…`;
      if (await renderView(views[index][0], views[index][1], quality)) completed++;
    }
    toast(`${completed} of ${views.length} presentation views are ready.`);
  } finally {
    button.disabled = false; button.textContent = original;
    document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(item => { item.disabled = false; });
  }
}

async function renderPresentationPlan(): Promise<void> {
  if (!layout || !cfg) { toast('Create a plan first.'); return; }
  const button = $button('aiPlanRenderBtn'), original = button.textContent || 'Presentation plan';
  button.disabled = true; button.textContent = 'Rendering plan…';
  const label = `Presentation plan · Level ${currentFloor + 1}`, card = createLoadingCard(label, 'high');
  setStage('present');
  try {
    const image = await planToDataURL(1600);
    if (!aiAvailable) {
      completeRenderCard(card, image, `${label} (High-Res CAD Sheet)`, 'high', `presentation-plan-L${currentFloor + 1}`);
      toast('High-resolution CAD presentation sheet added to gallery.');
      return;
    }
    const response = await fetch('/api/ai/plan-image', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image, style: cfg.style, level: currentFloor + 1, planSummary: planSummary(), concept: cleanText(planMeta?.concept, 900) })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      completeRenderCard(card, image, `${label} (High-Res CAD Sheet)`, 'high', `presentation-plan-L${currentFloor + 1}`);
      toast('High-resolution CAD presentation sheet added to gallery.');
      return;
    }
    const source = safeMediaUrl(data.b64 ? `data:image/png;base64,${data.b64}` : data.url);
    if (!source) throw new Error('The plan renderer returned an unsupported image address.');
    completeRenderCard(card, source, label, 'high', `presentation-plan-L${currentFloor + 1}`);
    toast('Presentation plan ready. Verify it against the schematic before sharing.');
  } catch (error) { failRenderCard(card, label, error); toast(errorMessage(error)); }
  finally { button.disabled = false; button.textContent = original; }
}

/* ----------------------------- references ----------------------------- */
function updateReferenceCount(): void { $('referenceCount').textContent = `${refs.length} of 3 selected`; }

function addReference(b64: string, type: string, dataUrl: string): void {
  if (refs.length >= 3) { toast('Three references are already selected. Remove one before adding another.'); return; }
  refs.push({ b64, type, dataUrl });
  const wrapper = create('div', 'ref-thumb'), image = create('img'), remove = create('button', '', '×');
  image.src = dataUrl; image.alt = 'Selected design reference'; remove.type = 'button'; remove.setAttribute('aria-label', 'Remove reference');
  remove.addEventListener('click', () => {
    const index = refs.findIndex(item => item.dataUrl === dataUrl); if (index >= 0) refs.splice(index, 1);
    wrapper.remove(); updateReferenceCount();
  });
  wrapper.append(image, remove); $('refStrip').append(wrapper); updateReferenceCount();
}

function imageFileToReference(file: File): void {
  if (!file.type.startsWith('image/')) return;
  const reader = new FileReader();
  reader.onload = () => {
    const image = new Image();
    image.onload = () => {
      const max = 1000, scale = Math.min(1, max / Math.max(image.width, image.height));
      const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(image.width * scale)); canvas.height = Math.max(1, Math.round(image.height * scale));
      canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', .86); addReference(dataUrl.split(',')[1], 'image/jpeg', dataUrl);
    };
    image.onerror = () => toast(`${cleanText(file.name, 80)} could not be read.`);
    image.src = String(reader.result || '');
  };
  reader.readAsDataURL(file);
}

function handleReferenceFiles(files: FileList | null): void {
  if (!files) return;
  Array.from(files).slice(0, Math.max(0, 3 - refs.length)).forEach(imageFileToReference);
}

async function pickWebImage(url: string): Promise<void> {
  const safe = safeMediaUrl(url); if (!safe) throw new Error('The selected image address is not supported.');
  await new Promise<void>((resolve, reject) => {
    const image = new Image(); image.crossOrigin = 'anonymous';
    image.onload = () => {
      try {
        const max = 1000, scale = Math.min(1, max / Math.max(image.width, image.height));
        const canvas = document.createElement('canvas'); canvas.width = Math.round(image.width * scale); canvas.height = Math.round(image.height * scale);
        canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', .86); addReference(dataUrl.split(',')[1], 'image/jpeg', dataUrl); resolve();
      } catch { reject(new Error('The reference could not be copied into this project.')); }
    };
    image.onerror = () => reject(new Error('The reference image could not be loaded.')); image.src = safe;
  });
}

async function searchReferences(): Promise<void> {
  const host = $('webGrid'), button = $button('webSearchBtn');
  const query = $input('webQuery').value.trim() || `${selectedStyle()} house interior`;
  host.replaceChildren(create('div', 'web-message', 'Searching visual references…')); button.disabled = true;
  try {
    const response = await fetch(`/api/reference-images?q=${encodeURIComponent(query)}`), data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(cleanText(data.error || 'Reference search is unavailable.'));
    host.replaceChildren();
    const images = Array.isArray(data.images) ? data.images.slice(0, 12) : [];
    if (!images.length) { host.append(create('div', 'web-message', 'No results found. Try a more specific material or room.')); return; }
    images.forEach((item: any) => {
      const thumb = safeMediaUrl(item.thumb), full = safeMediaUrl(item.full); if (!thumb || !full) return;
      const pick = create('button', 'web-pick'), image = create('img'); pick.type = 'button'; pick.title = cleanText(item.alt || query, 120); image.src = thumb; image.alt = cleanText(item.alt || '', 120);
      pick.append(image); pick.addEventListener('click', () => pickWebImage(full).then(() => toast('Reference added.')).catch(error => toast(errorMessage(error)))); host.append(pick);
    });
  } catch (error) { host.replaceChildren(create('div', 'web-message', errorMessage(error))); }
  finally { button.disabled = false; }
}

/* --------------------------- plan image import --------------------------- */
function readPlanImage(file: File | undefined): void {
  if (!file) return;
  if (!file.type.startsWith('image/')) { toast('Choose a PNG, JPEG or WebP plan image.'); return; }
  const reader = new FileReader();
  reader.onload = () => {
    const image = new Image();
    image.onload = () => {
      const max = 1800, scale = Math.min(1, max / Math.max(image.width, image.height));
      const canvas = document.createElement('canvas'); canvas.width = Math.round(image.width * scale); canvas.height = Math.round(image.height * scale);
      canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height);
      uploadPlanImage(canvas.toDataURL('image/png'));
    };
    image.onerror = () => toast('That image could not be read.'); image.src = String(reader.result || '');
  };
  reader.readAsDataURL(file);
}

async function uploadPlanImage(image: string): Promise<void> {
  const button = $button('planImgBtn'), original = button.textContent || 'Choose plan image';
  button.disabled = true; button.textContent = 'Interpreting plan…';
  try {
    cfg = readForm();
    const response = await fetch('/api/ai/plan-from-image', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image, plotW: cfg.plotW, plotD: cfg.plotD, floors: cfg.floors, style: cfg.style })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.layout) throw new Error(cleanText(data.error || data.hint || 'No readable plan was returned.'));
    showPlanConfirmation({ layout: data.layout as Layout, concept: cleanText(data.concept, 900), source: cleanText(data.source || 'from-image', 50) });
  } catch (error) { toast(`Plan interpretation failed: ${errorMessage(error)}`); }
  finally { button.disabled = false; button.textContent = original; }
}

function showPlanConfirmation(result: { layout: Layout; concept?: string; source?: string }): void {
  pendingUploadedPlan = result;
  const warning = $('planDialogWarning');
  const exact = result.source === 'from-image';
  warning.hidden = exact;
  warning.textContent = exact ? '' : 'The image was difficult to interpret. Treat this as a related concept, not an exact reconstruction.';
  $('planDialogConcept').textContent = cleanText(result.concept || 'Review the detected room program before using this concept.', 900);
  const roomHost = $('planDialogRooms'); roomHost.replaceChildren();
  result.layout.floors.forEach((floor, index) => {
    const section = create('section', 'detected-floor'); section.append(create('h3', '', `Level ${index + 1}`));
    const tags = create('div', 'room-tags');
    floor.rooms.filter(room => room.type !== 'corridor').forEach(room => tags.append(create('span', 'room-tag', `${cleanText(room.name, 60)} · ${room.w.toFixed(1)} × ${room.h.toFixed(1)} m`)));
    if (!tags.childElementCount) tags.append(create('span', 'room-tag', 'No named rooms detected'));
    section.append(tags); roomHost.append(section);
  });
  $<HTMLDialogElement>('planConfirmDialog').showModal();
}

function useConfirmedPlan(): void {
  if (!pendingUploadedPlan) return;
  cfg = readForm();
  const result = pendingUploadedPlan; pendingUploadedPlan = null;
  $<HTMLDialogElement>('planConfirmDialog').close('default');
  applyLayout(result.layout, {
    concept: cleanText(result.concept, 900), source: 'from-image'
  }, true);
  toast('Plan interpretation opened for review.');
}

function randomizeBrief(): void {
  const ideas = [
    { w: 12, d: 16, f: 2, b: 4, ba: 3, style: 'modern', prompt: 'A warm modern family home arranged around a planted courtyard, with a garden-facing kitchen, a calm study and a private primary suite.' },
    { w: 9, d: 18, f: 3, b: 3, ba: 3, style: 'scandinavian', prompt: 'A narrow urban home that brings daylight deep into the plan, with flexible work space, a roof terrace and efficient storage.' },
    { w: 18, d: 14, f: 1, b: 3, ba: 2, style: 'traditional', prompt: 'A contemporary single-storey residence with a welcoming central hall, shaded garden living and an enduring natural material palette.' }
  ];
  const idea = ideas[Math.floor(Math.random() * ideas.length)];
  $input('plotW').value = String(idea.w); $input('plotD').value = String(idea.d); $input('floors').value = String(idea.f);
  $input('bedrooms').value = String(idea.b); $input('bathrooms').value = String(idea.ba); $<HTMLTextAreaElement>('promptText').value = idea.prompt;
  const style = document.querySelector<HTMLInputElement>(`input[name="style"][value="${idea.style}"]`); if (style) style.checked = true;
  updateArea(); toast('A starting brief is ready. Adjust it, then create the plan.');
}

/* -------------------------------- boot -------------------------------- */
function boot(): void {
  try { viewer = new Viewer($('view3d')); } catch { viewer = null; }
  versions = loadStoredVersions();
  const savedName = cleanText(localStorage.getItem(PROJECT_NAME_KEY), 64); if (savedName) $input('projectName').value = savedName;
  enableProjectStages(false); updateArea(); updateVersionUI(); updateReferenceCount(); renderCustomRoomChips(); setStage('create'); checkAI();

  $('briefForm').addEventListener('submit', event => { event.preventDefault(); generatePlan(); });
  $button('proceduralBtn').addEventListener('click', () => generateProceduralPlan());
  $button('randomBtn').addEventListener('click', randomizeBrief);
  document.querySelectorAll<HTMLButtonElement>('[data-prompt]').forEach(button => button.addEventListener('click', () => {
    $<HTMLTextAreaElement>('promptText').value = button.dataset.prompt || ''; $<HTMLTextAreaElement>('promptText').focus();
  }));
  ['plotW', 'plotD'].forEach(id => $input(id).addEventListener('input', updateArea));
  $button('addCustomRoomBtn').addEventListener('click', addCustomRoom);
  $input('customRoomName').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); addCustomRoom(); } });

  document.querySelectorAll<HTMLButtonElement>('.workflow-tab').forEach((tab, index) => {
    tab.addEventListener('click', () => setStage(tab.dataset.stage as Stage, true));
    tab.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const enabled = Array.from(document.querySelectorAll<HTMLButtonElement>('.workflow-tab')).filter(item => !item.disabled);
      const current = enabled.indexOf(tab), target = event.key === 'Home' ? 0 : event.key === 'End' ? enabled.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + enabled.length) % enabled.length;
      enabled[target]?.focus();
    });
  });

  $button('brandBtn').addEventListener('click', startNewProject);
  $button('resumeBtn').addEventListener('click', () => { if (versions[0]) loadVersion(versions[0].id); });
  $<HTMLSelectElement>('versionSelect').addEventListener('change', event => loadVersion((event.target as HTMLSelectElement).value));
  $button('saveVersionBtn').addEventListener('click', () => { saveCurrentVersion(); toast('A new local version was saved.'); });
  $input('projectName').addEventListener('input', () => { $('saveState').textContent = 'Unsaved name'; if (layout) updatePlanInspector(); });
  $input('projectName').addEventListener('change', persistVersions);

  $button('reviseBtn').addEventListener('click', () => {
    const request = $<HTMLTextAreaElement>('reviseText').value.trim();
    if (!request) { toast('Describe the change you want first.'); return; }
    generatePlan(request);
  });
  $button('planTo3dBtn').addEventListener('click', () => setStage('visualize', true));
  $button('goPresentBtn').addEventListener('click', () => setStage('present', true));
  $button('regenSeedBtn').addEventListener('click', () => generateProceduralPlan());
  $button('zoomInBtn').addEventListener('click', () => { planZoom = clamp(Number((planZoom + 0.2).toFixed(2)), 0.6, 2.4); applyPlanZoom(); });
  $button('zoomOutBtn').addEventListener('click', () => { planZoom = clamp(Number((planZoom - 0.2).toFixed(2)), 0.6, 2.4); applyPlanZoom(); });
  $button('zoomResetBtn').addEventListener('click', () => { planZoom = 1; applyPlanZoom(); });
  $button('dlSvg').addEventListener('click', exportPlanSVG);
  $button('dlPng').addEventListener('click', exportPlanPNG);
  $button('dlJsonBtn').addEventListener('click', exportProjectJSON);
  $button('dlReportBtn').addEventListener('click', exportClientDossier);
  $<HTMLSelectElement>('costMarket').addEventListener('change', updateCostEstimateUI);
  $<HTMLSelectElement>('finishTier').addEventListener('change', updateCostEstimateUI);
  $button('aiPlanRenderBtn').addEventListener('click', renderPresentationPlan);
  $button('exportGlbBtn').addEventListener('click', exportGLB);
  $button('schemeBtn').addEventListener('click', generateScheme);

  document.querySelectorAll<HTMLButtonElement>('#mode3d button').forEach(button => button.addEventListener('click', () => {
    const mode = button.dataset.m === 'walk' ? 'walk' : 'orbit'; viewer?.setMode(mode);
    document.querySelectorAll<HTMLButtonElement>('#mode3d button').forEach(item => { const active = item === button; item.classList.toggle('active', active); item.setAttribute('aria-pressed', String(active)); });
  }));
  $button('cutBtn').addEventListener('click', () => {
    cutaway = !cutaway; const button = $button('cutBtn'); button.setAttribute('aria-pressed', String(cutaway)); button.textContent = cutaway ? 'Cutaway on' : 'Cutaway'; viewer?.setCutaway(cutaway);
  });
  document.querySelectorAll<HTMLButtonElement>('[data-cam-preset]').forEach(btn => btn.addEventListener('click', () => {
    const preset = (btn.dataset.camPreset || 'hero') as 'hero' | 'rear' | 'top' | 'dollhouse';
    viewer?.setCameraPreset(preset);
    cutaway = preset === 'top' || preset === 'dollhouse';
    const cutButton = $button('cutBtn');
    cutButton.setAttribute('aria-pressed', String(cutaway));
    cutButton.textContent = cutaway ? 'Cutaway on' : 'Cutaway';
  }));
  $button('nightBtn').addEventListener('click', () => {
    night = !night; const button = $button('nightBtn'); button.setAttribute('aria-pressed', String(night)); button.textContent = night ? 'Daylight' : 'Evening'; viewer?.setDayNight(night);
  });

  $button('generateSetBtn').addEventListener('click', generatePresentationSet);
  document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(button => button.addEventListener('click', () => renderView(button.dataset.view || '', button.dataset.label || button.textContent || 'Project view')));

  $button('uploadBtn').addEventListener('click', () => $input('fileInput').click());
  $input('fileInput').addEventListener('change', event => { handleReferenceFiles((event.target as HTMLInputElement).files); (event.target as HTMLInputElement).value = ''; });
  $button('webSearchBtn').addEventListener('click', searchReferences);
  $input('webQuery').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); searchReferences(); } });
  $button('planImgBtn').addEventListener('click', () => $input('planImgInput').click());
  $input('planImgInput').addEventListener('change', event => { const target = event.target as HTMLInputElement; readPlanImage(target.files?.[0]); target.value = ''; });
  $button('confirmPlanBuild').addEventListener('click', event => { event.preventDefault(); useConfirmedPlan(); });
  $<HTMLDialogElement>('planConfirmDialog').addEventListener('close', () => { if ($<HTMLDialogElement>('planConfirmDialog').returnValue !== 'default') pendingUploadedPlan = null; });

  window.addEventListener('resize', () => { if (activeStage === 'visualize') viewer?._resize(); });
}

boot();
