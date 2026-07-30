/* ForthHome Studio — plan-first client application. */
import { Viewer } from './engine/viewer.js';
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
    $('saveState').textContent = 'AI unavailable';
    toast('AI planning is required. Check the provider connection and try again.');
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
    toast(`AI plan not created: ${errorMessage(error)}`);
    $('saveState').textContent = 'AI plan rejected';
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
      return v?.layout?.floors?.length && v?.spec && (source === 'ai-generated' || source === 'from-image');
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
  if (w < 1.45 || h < 1.45) return '';
  const box = (bx: number, by: number, bw: number, bh: number, radius = .05): string =>
    `<rect x="${bx}" y="${by}" width="${Math.max(.1, bw)}" height="${Math.max(.1, bh)}" rx="${radius}" stroke="${FURNC}" stroke-width=".045" fill="none"/>`;
  const circle = (a: number, b: number, radius: number): string => `<circle cx="${a}" cy="${b}" r="${radius}" stroke="${FURNC}" stroke-width=".045" fill="none"/>`;
  switch (room.type) {
    case 'bedroom': {
      const bw = Math.min(1.6, w * .48), bl = Math.min(2, h * .52), bx = x + .25, by = cy - bl / 2;
      return box(bx, by, bw, bl, .08) + box(bx + .12, by + .12, bw - .24, Math.min(.38, bl * .2), .05);
    }
    case 'living': {
      const sw = Math.min(2.5, w * .58), sh = Math.min(.78, h * .22);
      return box(cx - sw / 2, y + h - sh - .24, sw, sh, .1) + box(cx - Math.min(.55, w * .16), cy - Math.min(.25, h * .1), Math.min(1.1, w * .32), Math.min(.5, h * .2), .08);
    }
    case 'kitchen': {
      const counter = Math.max(.7, w - .5);
      return box(x + .25, y + .25, counter, Math.min(.55, h * .18), .04) + circle(x + Math.min(.85, w * .3), y + .5, .13);
    }
    case 'bathroom': return box(x + .2, y + .22, Math.min(1.45, w * .62), Math.min(.68, h * .3), .17) + circle(x + w - .45, y + .48, .18);
    case 'dining': {
      const tw = Math.min(1.8, w * .5), th = Math.min(.95, h * .34);
      return box(cx - tw / 2, cy - th / 2, tw, th, .06);
    }
    case 'garage': return box(cx - Math.min(.8, w * .28), cy - Math.min(1.6, h * .38), Math.min(1.6, w * .56), Math.min(3.2, h * .76), .22);
    default: return '';
  }
}

function dimensionSVG(next: Layout): string {
  const foot = next.foot, offset = .8, bottom = foot.y + foot.h + offset, left = foot.x - offset;
  const horizontal = lineSVG(foot.x, bottom, foot.x + foot.w, bottom, '#7e8781', .025) +
    lineSVG(foot.x, bottom - .14, foot.x, bottom + .14, '#7e8781', .025) + lineSVG(foot.x + foot.w, bottom - .14, foot.x + foot.w, bottom + .14, '#7e8781', .025) +
    textSVG(foot.x + foot.w / 2, bottom - .16, `${foot.w.toFixed(1)} m`, .33, '#5f6862');
  const vertical = lineSVG(left, foot.y, left, foot.y + foot.h, '#7e8781', .025) +
    lineSVG(left - .14, foot.y, left + .14, foot.y, '#7e8781', .025) + lineSVG(left - .14, foot.y + foot.h, left + .14, foot.y + foot.h, '#7e8781', .025) +
    textSVG(left - .18, foot.y + foot.h / 2, `${foot.h.toFixed(1)} m`, .33, '#5f6862', 'middle', '500', ` transform="rotate(-90 ${left - .18} ${foot.y + foot.h / 2})"`);
  return horizontal + vertical;
}

function drawPlan(): void {
  if (!layout || !cfg) return;
  currentFloor = clamp(currentFloor, 0, layout.floors.length - 1);
  const foot = layout.foot, floor = layout.floors[currentFloor];
  const viewX = foot.x - 2.1, viewY = foot.y - 1.75, viewW = foot.w + 4.2, viewH = foot.h + 5;
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewX} ${viewY} ${viewW} ${viewH}" role="img" aria-labelledby="planSvgTitle planSvgDesc" preserveAspectRatio="xMidYMid meet">`,
    `<title id="planSvgTitle">${escapeXML(`Floor plan, level ${currentFloor + 1}`)}</title>`,
    `<desc id="planSvgDesc">${escapeXML(planSummary())}</desc>`,
    rectSVG(viewX, viewY, viewW, viewH, '#fff'), rectSVG(foot.x, foot.y, foot.w, foot.h, '#f7f5ef', WALL, .2)
  ];
  if (floor.corridor) parts.push(rectSVG(floor.corridor.x, floor.corridor.y, floor.corridor.w, floor.corridor.h, FILL.corridor));
  floor.rooms.forEach(room => {
    if (room.type === 'corridor' && floor.corridor && Math.abs(room.x - floor.corridor.x) < .05 && Math.abs(room.y - floor.corridor.y) < .05) return;
    const fill = room.name === 'Hall' ? FILL.living : (FILL[room.type] || FILL.room);
    parts.push(rectSVG(room.x, room.y, room.w, room.h, fill, room.name === 'Hall' ? undefined : WALL, .105));
    if (room.type !== 'corridor') parts.push(furnitureSVG(room), doorSVG(room), windowSVG(room));
    parts.push(roomLabelSVG(room));
  });
  if (floor.entrance) {
    parts.push(rectSVG(floor.entrance.x - floor.entrance.width / 2, floor.entrance.y - .12, floor.entrance.width, .24, '#fff'));
    parts.push(textSVG(floor.entrance.x, floor.entrance.y + .55, '▲ ENTRY', .27, '#477259', 'middle', '700'));
  }
  if (floor.stairs) {
    const stairs = floor.stairs;
    parts.push(rectSVG(stairs.x, stairs.y, stairs.w, stairs.h, '#ddd8cc', WALL, .07));
    for (let step = 1; step < 6; step++) parts.push(lineSVG(stairs.x + .08, stairs.y + step * stairs.h / 6, stairs.x + stairs.w - .08, stairs.y + step * stairs.h / 6, '#aaa296', .035));
    parts.push(textSVG(stairs.x + stairs.w / 2, stairs.y + stairs.h / 2, 'STAIRS', fitTextSize('STAIRS', stairs.w - .2, .27, .15), '#666d68', 'middle', '700'));
  }
  parts.push(dimensionSVG(layout));
  const northX = foot.x + foot.w + 1.1, northY = foot.y + .15;
  parts.push(`<path d="M ${northX} ${northY - .38} L ${northX - .19} ${northY + .24} L ${northX} ${northY + .1} L ${northX + .19} ${northY + .24} Z" fill="#4a534d"/>`, textSVG(northX, northY + .67, 'N', .28, '#4a534d', 'middle', '700'));
  const footerY = foot.y + foot.h + 1.7;
  const title = `${String(cfg.style).replace(/^./, c => c.toUpperCase())} residence · Level ${currentFloor + 1}`;
  parts.push(textSVG(foot.x, footerY, title, fitTextSize(title, foot.w, .47, .24), LBL, 'start', '700'));
  const summary = `${cfg.bedrooms} bed · ${cfg.bathrooms} bath · ${cfg.floors} floor${cfg.floors === 1 ? '' : 's'} · ${fmt(cfg.plotW * cfg.plotD)} m² site`;
  parts.push(textSVG(foot.x, footerY + .6, summary, fitTextSize(summary, foot.w, .31, .17), '#68716b', 'start', '500'));
  const concept = cleanText(planMeta?.concept, 130);
  if (concept) parts.push(textSVG(foot.x, footerY + 1.15, concept, fitTextSize(concept, foot.w, .25, .14), '#7b827d', 'start', '400'));
  parts.push('</svg>');
  $('planHost').innerHTML = parts.join('');
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
  const normalized = Number.isFinite(metadataScore) ? (metadataScore <= 1 ? metadataScore * 100 : metadataScore) : derived;
  return { score: Math.round(clamp(normalized, 0, 100)), checks };
}

function updatePlanInspector(): void {
  if (!layout || !cfg) return;
  const source = String(planMeta?.source || layout.planSource || 'unknown');
  const badge = $('provenanceBadge');
  badge.classList.remove('fallback');
  badge.textContent = source === 'from-image' ? 'AI plan interpretation' : 'Validated AI geometry';
  $('provenanceText').textContent = source === 'from-image'
    ? 'AI reconstructed this concept from your uploaded image. Compare every room and dimension with the source before relying on it.'
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
    badge.className = `service-badge ${verified ? 'online' : configured ? 'checking' : 'offline'}`;
    badge.querySelector('span')!.textContent = verified ? 'AI verified' : configured ? 'AI configured' : 'AI unavailable';
    badge.title = verified ? 'The AI service has passed a live verification.' : configured ? 'AI credentials are configured; plan geometry must pass validation before it is shown.' : 'AI planning is required and no offline plan will be substituted.';
    $button('generateBtn').disabled = !aiAvailable;
    $button('planImgBtn').disabled = !aiAvailable;
  } catch {
    aiAvailable = false; badge.className = 'service-badge offline'; badge.querySelector('span')!.textContent = 'AI unavailable';
    badge.title = 'The AI service could not be reached; plan generation is disabled.';
    $button('generateBtn').disabled = true;
    $button('planImgBtn').disabled = true;
  }
}

async function generateScheme(): Promise<void> {
  if (!cfg || !layout) { toast('Create a plan first.'); return; }
  const button = $button('schemeBtn'), original = button.textContent || 'Create design direction';
  button.disabled = true; button.textContent = 'Curating materials…';
  try {
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
    if (!response.ok || !data.brief) throw new Error(cleanText(data.error || data.hint || 'Design direction was not returned.'));
    brief = data.brief as Brief;
    renderScheme(brief);
    rebuild3D();
    toast('Design direction is now applied to the 3D concept.');
  } catch (error) { toast(`Design direction failed: ${errorMessage(error)}`); }
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
    if (!response.ok) throw new Error(cleanText(data.error || data.hint || `Render service returned ${response.status}.`));
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
    const image = await planToDataURL(1280);
    const response = await fetch('/api/ai/plan-image', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image, style: cfg.style, level: currentFloor + 1, planSummary: planSummary(), concept: cleanText(planMeta?.concept, 900) })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(cleanText(data.error || data.hint || 'Presentation plan failed.'));
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
  $button('dlSvg').addEventListener('click', exportPlanSVG);
  $button('dlPng').addEventListener('click', exportPlanPNG);
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
