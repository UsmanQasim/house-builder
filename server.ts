/**
 * ForthHome — AI House Designer server (TypeScript, Node built-ins).
 * Compiled by tsc to build/server.js. API surface unchanged from v2:
 *   GET  /api/ai/status | /api/ai/diagnose | /api/plan-research | /api/reference-images
 *   GET  /api/texture | /api/model
 *   POST /api/ai/design-brief | /api/ai/floor-plan | /api/ai/plan-from-image | /api/ai/render
 * /api/ai/floor-plan returns a bespoke AI-generated plan when available, with
 * the validated seeded constraint planner as the reliable offline/failure fallback.
 */
import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import { isIP } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HouseLayout } from './src/engine/layout.js';
import { PlanResearch } from './src/engine/plan-research.js';
import { PlanTemplates } from './src/engine/plan-templates.js';
import type { Layout, Spec } from './src/engine/types.js';
import { getTextProvider, getImageProvider } from './server/providers.js';
import {
  generateFurnitureGLB, isValidFurnitureGLB, MAX_FURNITURE_MODEL_BYTES,
  normalizeFurnitureType, rodinAvailable
} from './server/model3d.js';
import { generateBespokePlan } from './server/plan-generator.js';
import {
  boundedPositiveInteger, fetchWithTimeout, parseImageReference,
  readResponseBuffer, resolvePathWithin
} from './server/net.js';
import type { ServerResponse, IncomingMessage } from 'node:http';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..'); // compiled file lives in build/

(function loadEnv(): void {
  try {
    const file = path.join(ROOT, '.env');
    if (!fs.existsSync(file)) return;
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const t = line.trim(); if (!t || t.startsWith('#')) continue;
      const i = t.indexOf('='); if (i === -1) continue;
      const k = t.slice(0, i).trim(); const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
      if (!(k in process.env)) process.env[k] = v;
    }
  } catch { /* optional */ }
})();

const DIST = path.join(ROOT, 'dist');
const LEGACY_PUBLIC = path.join(ROOT, 'public'); // cached GLB furniture models
const PORT = process.env.PORT || 3000;
const TEXT_MODEL = process.env.OPENAI_TEXT_MODEL || 'gpt-5.6-terra';
const PLAN_MODEL = process.env.OPENAI_PLAN_MODEL || 'gpt-5.6-sol';
const IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2';

const TYPES: Record<string, string> = { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.ico':'image/x-icon','.glb':'model/gltf-binary','.map':'application/json' };
const json = (res: ServerResponse, code: number, obj: unknown): void => { res.writeHead(code, {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff'
}); res.end(JSON.stringify(obj)); };

interface ApiErr extends Error { status?: number; hint?: string; }
function requestError(message: string, status: number): ApiErr {
  const error = new Error(message) as ApiErr;
  error.status = status;
  return error;
}

function readBody(req: IncomingMessage, max = 14 * 1024 * 1024): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let len = 0;
    let settled = false;
    const fail = (message: string, status: number): void => {
      if (settled) return;
      settled = true;
      chunks.length = 0;
      reject(requestError(message, status));
    };
    const declared = Number(req.headers['content-length'] || 0);
    if (Number.isFinite(declared) && declared > max) {
      req.resume();
      fail('Request body exceeds the allowed size.', 413);
      return;
    }
    req.on('data', (value: Buffer | Uint8Array) => {
      if (settled) return;
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      len += chunk.length;
      if (len > max) { fail('Request body exceeds the allowed size.', 413); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text.trim()) { settled = true; resolve({}); return; }
      try {
        const parsed = JSON.parse(text) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return fail('JSON body must be an object.', 400);
        settled = true;
        resolve(parsed as Record<string, unknown>);
      } catch { fail('Malformed JSON request body.', 400); }
    });
    req.on('aborted', () => fail('Request body was interrupted.', 400));
    req.on('error', () => fail('Could not read request body.', 400));
  });
}

async function withJsonBody(
  req: IncomingMessage,
  res: ServerResponse,
  max: number,
  handler: (res: ServerResponse, body: Record<string, unknown>) => Promise<void>
): Promise<void> {
  let body: Record<string, unknown>;
  try { body = await readBody(req, max); }
  catch (e) {
    const err = e as ApiErr;
    if (!res.headersSent) json(res, err.status || 400, { error: String(err.message || 'Invalid request body.') });
    return;
  }
  await handler(res, body);
}

const provider = () => getTextProvider();
const imageProvider = () => getImageProvider();
const noKey = (res: ServerResponse) => json(res, 501, { error: 'AI is unavailable. Configure the selected provider key and set AI_OFFLINE=0. The validated procedural floor planner and 3D viewer still work offline.' });

interface RateBucket { started: number; count: number; }
const aiBuckets = new Map<string, RateBucket>();
const AI_WINDOW_MS = 60 * 60 * 1000;
const AI_LIMIT = boundedPositiveInteger(process.env.AI_RATE_LIMIT_PER_HOUR, 30, 1, 100_000);
const MAX_RATE_BUCKETS = 2048;
function tokenMatches(value: string, expected: string): boolean {
  const actualBytes = Buffer.from(value);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}
function clientAddress(req: IncomingMessage): string {
  const remote = String(req.socket.remoteAddress || 'local').slice(0, 80);
  if (process.env.TRUST_PROXY !== '1') return remote;
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return isIP(forwarded) ? forwarded : remote;
}
function pruneRateBuckets(now: number): void {
  for (const [key, value] of aiBuckets) if (now - value.started >= AI_WINDOW_MS) aiBuckets.delete(key);
  while (aiBuckets.size >= MAX_RATE_BUCKETS) {
    const oldest = aiBuckets.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    aiBuckets.delete(oldest);
  }
}
function allowAIRequest(req: IncomingMessage, res: ServerResponse): boolean {
  const requiredToken = process.env.APP_ACCESS_TOKEN;
  if (requiredToken) {
    const auth = String(req.headers.authorization || '');
    const bearer = /^Bearer\s+(.+)$/i.exec(auth)?.[1].trim() || '';
    const headerToken = String(req.headers['x-app-token'] || '').trim();
    if (!tokenMatches(bearer, requiredToken) && !tokenMatches(headerToken, requiredToken)) {
      json(res, 401, { error: 'This deployment requires an access token.' });
      return false;
    }
  }
  const now = Date.now();
  const client = clientAddress(req);
  let bucket = aiBuckets.get(client);
  if (!bucket) pruneRateBuckets(now);
  if (!bucket || now - bucket.started >= AI_WINDOW_MS) bucket = { started: now, count: 0 };
  bucket.count += 1;
  aiBuckets.set(client, bucket);
  res.setHeader('X-RateLimit-Limit', String(AI_LIMIT));
  res.setHeader('X-RateLimit-Remaining', String(Math.max(0, AI_LIMIT - bucket.count)));
  if (bucket.count > AI_LIMIT) {
    res.setHeader('Retry-After', String(Math.ceil((AI_WINDOW_MS - (now - bucket.started)) / 1000)));
    json(res, 429, { error: 'Hourly AI generation limit reached. Try again later or raise AI_RATE_LIMIT_PER_HOUR.' });
    return false;
  }
  return true;
}

/* ------------------------------ AI endpoints ------------------------------ */
let lastDiagnosis: { at: number; ok: boolean; message: string } | null = null;
async function diagnose(res: ServerResponse): Promise<void> {
  const image = imageProvider();
  const text = provider();
  const img = await image.diagnose();
  let ok = img.ok;
  let message = '[images: ' + image.id + '] ' + img.message;
  if (image.id !== text.id) {
    const txt = await text.diagnose();
    ok = ok && txt.ok;
    message += '\n[plans/text: ' + provider().id + '] ' + txt.message;
  }
  lastDiagnosis = { at: Date.now(), ok, message };
  json(res, 200, { ...img, ok, message, imageProviderId: image.id, textProviderId: text.id, rodin: rodinAvailable() });
}

async function designBrief(res: ServerResponse, spec: Record<string, unknown>): Promise<void> {
  const P = provider();
  if (!P.available()) return noKey(res);
  const sys = 'You are a senior residential interior designer. Return ONLY valid JSON describing a cohesive, realistic scheme. Colors are hex like "#RRGGBB".';
  const user = `Design a cohesive scheme for a ${spec.style} home: ${spec.area} m2, ${spec.floors} floor(s), ${spec.bedrooms} bed, ${spec.bathrooms} bath, ${spec.kitchens} kitchen(s), ${spec.living} living${spec.dining ? ', dining' : ''}${spec.garage ? ', garage' : ''}.\n` +
    'JSON shape: {"concept":"2-3 sentences","palette":[{"name":"","hex":"#RRGGBB","role":""}],' +
    '"exterior":{"materials":"","accentHex":"#RRGGBB"},' +
    '"rooms":{"living":{"notes":"","accentHex":"#RRGGBB"},"bedroom":{"notes":"","accentHex":"#RRGGBB"},"kitchen":{"notes":"","accentHex":"#RRGGBB"},"bathroom":{"notes":"","accentHex":"#RRGGBB"},"dining":{"notes":"","accentHex":"#RRGGBB"}}}';
  try {
    const brief = await P.chatJSON({ model: TEXT_MODEL, temperature: 0.7, maxTokens: 1800, messages: [{ role: 'system', content: sys }, { role: 'user', content: user }] });
    json(res, 200, { brief });
  } catch (e) { const err = e as ApiErr; json(res, err.status || 500, { error: String(err.message || e), hint: err.hint }); }
}

function promptText(v: unknown, max = 500): string {
  return String(v || '').replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function buildPrompt(b: Record<string, unknown>, canonicalReferences = false): string {
  const style = promptText(b.style || 'modern', 60);
  const view = promptText(b.view || 'house exterior', 80);
  const palette = promptText(b.palette, 320);
  const notes = promptText(b.notes, 500);
  const concept = promptText(b.concept, 320);
  const plan = promptText(b.planSummary, 900);
  const identity = canonicalReferences
    ? 'The first supplied images are canonical references from this exact project. Preserve the same massing, floor count, openings, roof language, room geometry and material identity; render the same home, not a new interpretation. '
    : '';
  const continuity = 'Keep a single coherent design identity across every project view. Do not add rooms, floors, doors or windows that contradict the supplied project information. ';
  const project = [concept && ('Design concept: ' + concept + '.'), plan && ('Verified plan: ' + plan + '.'), palette && ('Material palette: ' + palette + '.'), notes].filter(Boolean).join(' ');
  if (/exterior|facade|outside|house/i.test(view)) {
    return identity + continuity + `Create a photorealistic architectural exterior photograph of the ${style} ${b.floors || 1}-storey home shown in the project references. ` +
      `Camera view: ${view}. Accurate residential scale, buildable structure, resolved facade details, realistic glazing, landscaped site and driveway, natural daylight, ` +
      `high-end architectural visualization, 24mm tilt-shift lens, physically plausible materials and shadows, no people, no text, no watermark. ${project}`;
  }
  return identity + continuity + `Create a photorealistic interior architectural visualization of this home's ${view} in the established ${style} design language. ` +
    `Respect the room proportions, doors and windows shown by the project references. Use circulation-safe furniture placement, layered lighting, realistic joinery, ` +
    `physically plausible materials, natural daylight, magazine-quality real-estate photography, 24mm lens, no people, no text, no watermark. ${project}`;
}

async function render(res: ServerResponse, body: Record<string, unknown>): Promise<void> {
  const P = imageProvider();
  if (!P.available()) return noKey(res);
  const references: { b64: string; type?: string }[] = [];
  let canonicalCount = 0;
  const addReference = (value: unknown, canonical = false): void => {
    if (!value || references.length >= 4) return;
    const parsed = parseImageReference(value);
    if (!parsed) return;
    references.push(parsed);
    if (canonical) canonicalCount += 1;
  };
  addReference(body.sceneReference, true);
  addReference(body.planReference, true);
  if (Array.isArray(body.references)) body.references.slice(0, 8).forEach(r => addReference(r));
  const prompt = buildPrompt(body, canonicalCount > 0);
  const quality = ['low', 'medium', 'high'].includes(String(body.quality)) ? String(body.quality) : 'medium';
  const size = ['1024x1024', '1536x1024', '1024x1536', '2048x1152'].includes(String(body.size)) ? String(body.size) : '1536x1024';
  try {
    const out = await P.generateImage({ prompt, size, quality, references });
    json(res, 200, { b64: out.b64, url: out.url, prompt, provider: P.id, canonicalReferences: canonicalCount });
  } catch (e) { const err = e as ApiErr; json(res, err.status || 500, { error: String(err.message || e), hint: err.hint }); }
}

function footprint(spec: Spec): { fw: number; fh: number } {
  const margin = Math.max(0.8, Math.min(2, Math.min(spec.plotW, spec.plotD) * 0.08));
  return { fw: Math.max(8, spec.plotW - 2 * margin), fh: Math.max(7, spec.plotD - 2 * margin) };
}

async function planFromImage(res: ServerResponse, body: Record<string, unknown>): Promise<void> {
  const P = provider();
  if (!P.available()) return noKey(res);
  if (!body.image) return json(res, 400, { error: 'No image provided.' });
  const spec: Spec = {
    plotW: (+(body.plotW as number) >= 6 && +(body.plotW as number) <= 80) ? +(body.plotW as number) : 9,
    plotD: (+(body.plotD as number) >= 6 && +(body.plotD as number) <= 80) ? +(body.plotD as number) : 14,
    floors: Math.min(4, Math.max(1, Math.round(+(body.floors as number) || 1))),
    bedrooms: 3, bathrooms: 2, kitchens: 1, living: 1, dining: true, garage: false,
    style: String(body.style || 'modern')
  };
  const fp = footprint(spec);
  const shape = '{"floors":[{"rooms":[{"type":"living|bedroom|kitchen|bathroom|dining|garage|corridor","name":"label from the plan","x":m,"y":m,"w":m,"h":m,"door":{"side":"left|right|top|bottom","pos":m,"width":0.9}}],"corridor":{"x":m,"y":m,"w":m,"h":m},"entrance":{"x":m,"y":m,"width":1.2},"stairs":{"x":m,"y":m,"w":m,"h":m}}],"concept":"one sentence"}';
  const sys = 'You convert a residential floor-plan IMAGE into structured JSON for a 3D builder. ' +
    'Express every room as a rectangle in METRES inside a footprint ' + fp.fw.toFixed(1) + ' m wide (x: 0 to ' + fp.fw.toFixed(1) + ') by ' + fp.fh.toFixed(1) + ' m deep (y: 0 to ' + fp.fh.toFixed(1) + '), origin top-left, the street/main entrance at the bottom (y=' + fp.fh.toFixed(1) + '). ' +
    'Rooms must tile each floor without overlapping and stay inside the footprint. Reproduce the plan faithfully: same rooms, same relative positions/sizes, same names. Give every room a door toward the corridor/stairs. There must be exactly ' + spec.floors + ' floor object(s). Return ONLY JSON: ' + shape;
  try {
    const raw = await P.chatJSON<Record<string, unknown>>({
      model: PLAN_MODEL, temperature: 0.15, maxTokens: 3000,
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: [
          { type: 'text', text: 'Convert the floor plan in this image to JSON, matching it as closely as you can. The building has ' + spec.floors + ' floor(s).' },
          { type: 'image_url', image_url: { url: String(body.image) } }
        ] }
      ]
    });
    const report = HouseLayout.fromAIReport(raw, spec);
    if (!report.layout || !report.validation.ok) {
      return json(res, 422, {
        error: 'This image could not be reconstructed into a trustworthy plan.',
        hint: 'Upload a clean, straight-on plan with one floor per image and readable room boundaries.',
        issues: report.validation.issues.slice(0, 8)
      });
    }
    json(res, 200, { ok: true, layout: report.layout, concept: (raw.concept as string) || '', source: 'from-image', validation: report.validation, coverage: report.coverage });
  } catch (e) { const err = e as ApiErr; json(res, err.status || 500, { error: String(err.message || e), hint: err.hint }); }
}

/* ------------------------------ web research ------------------------------ */
interface Hit { title: string; snippet: string; url: string; }
function decodeHtml(s: string): string {
  return String(s || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
}
async function searchBrave(q: string, token: string): Promise<Hit[]> {
  const hits: Hit[] = [];
  try {
    const r = await fetchWithTimeout('https://api.search.brave.com/res/v1/web/search?q=' + encodeURIComponent(q) + '&count=8', {
      headers: { 'X-Subscription-Token': token, Accept: 'application/json' }
    });
    const data = await r.json().catch(() => ({})) as { web?: { results?: { title?: string; description?: string; url?: string }[] } };
    if (r.ok) ((data.web && data.web.results) || []).slice(0, 6).forEach(x => hits.push({ title: x.title || '', snippet: x.description || '', url: x.url || '' }));
  } catch { /* optional */ }
  return hits;
}
async function searchDuckDuckGo(q: string): Promise<Hit[]> {
  const hits: Hit[] = [];
  try {
    const r = await fetchWithTimeout('https://html.duckduckgo.com/html/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'ForthHome/3.0 (house designer)' },
      body: 'q=' + encodeURIComponent(q)
    });
    if (!r.ok) return hits;
    const html = await r.text();
    const parts = html.split('result__body');
    for (let i = 1; i < parts.length && hits.length < 6; i++) {
      const b = parts[i];
      const titleM = b.match(/result__a[^>]*>([\s\S]*?)<\/a>/);
      const snipM = b.match(/result__snippet[^>]*>([\s\S]*?)<\/a>/);
      const urlM = b.match(/uddg=([^&"]+)/);
      if (!titleM || !snipM) continue;
      hits.push({
        title: decodeHtml(titleM[1].replace(/<[^>]+>/g, '').trim()),
        snippet: decodeHtml(snipM[1].replace(/<[^>]+>/g, '').trim()),
        url: urlM ? decodeURIComponent(urlM[1]) : ''
      });
    }
  } catch { /* optional */ }
  return hits;
}
async function searchDuckDuckGoInstant(q: string): Promise<Hit[]> {
  const hits: Hit[] = [];
  try {
    const r = await fetchWithTimeout('https://api.duckduckgo.com/?q=' + encodeURIComponent(q) + '&format=json&no_html=1&skip_disambig=1');
    const data = await r.json().catch(() => ({})) as { AbstractText?: string; Heading?: string; AbstractURL?: string; RelatedTopics?: { Text?: string; FirstURL?: string; Topics?: { Text?: string; FirstURL?: string }[] }[] };
    if (data.AbstractText) hits.push({ title: data.Heading || q, snippet: data.AbstractText, url: data.AbstractURL || '' });
    (data.RelatedTopics || []).slice(0, 5).forEach(t => {
      if (t.Text) hits.push({ title: t.Text.split(' - ')[0], snippet: t.Text, url: t.FirstURL || '' });
      else if (t.Topics) t.Topics.slice(0, 3).forEach(u => { if (u.Text) hits.push({ title: u.Text.split(' - ')[0], snippet: u.Text, url: u.FirstURL || '' }); });
    });
  } catch { /* optional */ }
  return hits.slice(0, 6);
}
async function planResearchWeb(spec: Spec): Promise<{ query: string; hits: Hit[]; webEnabled: boolean; engine: string }> {
  const q = PlanResearch.researchQuery(spec);
  let hits: Hit[] = [], engine = 'none';
  const brave = process.env.BRAVE_SEARCH_API_KEY;
  if (brave) { hits = await searchBrave(q, brave); if (hits.length) engine = 'brave'; }
  if (!hits.length) { hits = await searchDuckDuckGo(q); if (hits.length) engine = 'duckduckgo'; }
  if (!hits.length) { hits = await searchDuckDuckGoInstant(q); if (hits.length) engine = 'duckduckgo-instant'; }
  return { query: q, hits, webEnabled: hits.length > 0, engine };
}

/* ------------------------------ floor plans ------------------------------ */
function sanitizeSpec(p: Record<string, unknown>, spec: Spec): Spec {
  const cl = (v: unknown, lo: number, hi: number, d: number) => { const n = Math.round(+(v as number)); return isNaN(n) ? d : Math.max(lo, Math.min(hi, n)); };
  const styles: Record<string, 1> = { modern: 1, traditional: 1, minimalist: 1, scandinavian: 1, industrial: 1 };
  const rawCustom = Array.isArray(p.customRooms) ? p.customRooms : (spec.customRooms || []);
  const customRooms = rawCustom.slice(0, 10).map(value => {
    const room = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
    const name = promptText(room.name, 50);
    return {
      name,
      count: cl(room.count, 1, 4, 1),
      minW: Math.max(1.5, Math.min(6, +(room.minW as number) || 2.4)),
      minH: Math.max(1.5, Math.min(8, +(room.minH as number) || 2.6)),
      preferredFloor: cl(room.preferredFloor, 0, Math.max(0, cl(p.floors, 1, 4, spec.floors) - 1), 0)
    };
  }).filter(room => room.name);
  const seed = Number.isFinite(+(p.seed as number)) ? Math.abs(Math.trunc(+(p.seed as number))) : spec.seed;
  return {
    plotW: (+(p.plotW as number) >= 6 && +(p.plotW as number) <= 80) ? +(p.plotW as number) : spec.plotW,
    plotD: (+(p.plotD as number) >= 6 && +(p.plotD as number) <= 80) ? +(p.plotD as number) : spec.plotD,
    floors: cl(p.floors, 1, 4, spec.floors), bedrooms: cl(p.bedrooms, 0, 12, spec.bedrooms),
    bathrooms: cl(p.bathrooms, 0, 8, spec.bathrooms), kitchens: cl(p.kitchens, 0, 4, spec.kitchens),
    living: cl(p.living, 0, 4, spec.living),
    dining: typeof p.dining === 'boolean' ? p.dining : spec.dining,
    garage: typeof p.garage === 'boolean' ? p.garage : spec.garage,
    style: styles[String(p.style)] ? String(p.style) : spec.style,
    prompt: spec.prompt,
    seed,
    customRooms
  };
}
async function extractParams(spec: Spec): Promise<{ params?: Record<string, unknown>; concept?: string }> {
  const sys = 'You are a residential architect. Read the brief and return ONLY JSON extracting build parameters and a short concept: ' +
    '{"params":{"plotW":m,"plotD":m,"floors":1-4,"bedrooms":int,"bathrooms":int,"kitchens":int,"living":int,"dining":bool,"garage":bool,"style":"modern|traditional|minimalist|scandinavian|industrial","customRooms":[{"name":"Office|Laundry|Pantry|Utility|Prayer Room|Gym|other requested space","count":int,"minW":m,"minH":m,"preferredFloor":zero_based_int}]},"concept":"1-2 sentences"}. ' +
    'Only add customRooms explicitly requested by the client; do not duplicate bedrooms, bathrooms, kitchens, living, dining or garage there.';
  const user = 'Brief: "' + String(spec.prompt).slice(0, 700) + '"\nCurrent settings: ' + JSON.stringify({ plotW: spec.plotW, plotD: spec.plotD, floors: spec.floors, bedrooms: spec.bedrooms, bathrooms: spec.bathrooms, kitchens: spec.kitchens, living: spec.living, dining: spec.dining, garage: spec.garage, style: spec.style, customRooms: spec.customRooms || [] });
  return provider().chatJSON({ model: PLAN_MODEL, temperature: 0.2, maxTokens: 1200, messages: [{ role: 'system', content: sys }, { role: 'user', content: user }] });
}

async function aiFloorPlan(res: ServerResponse, body: Record<string, unknown>): Promise<void> {
  const P = provider();
  let spec = body as unknown as Spec;
  spec = sanitizeSpec(body, { plotW: 11, plotD: 13, floors: 2, bedrooms: 3, bathrooms: 2, kitchens: 1, living: 1, dining: true, garage: true, style: 'modern', prompt: typeof body.prompt === 'string' ? body.prompt : undefined });
  if (typeof body.prompt === 'string' && body.prompt.trim()) spec.prompt = body.prompt.trim();
  spec = HouseLayout.inferSpecFromPrompt(spec);

  let promptConcept = '';
  if (spec.prompt && P.available()) {
    try {
      const ex = await extractParams(spec);
      if (ex.params) spec = { ...sanitizeSpec(ex.params, spec), prompt: spec.prompt };
      promptConcept = ex.concept || '';
    } catch { /* keep form spec */ }
  }

  const research = body.useResearch === true && P.available()
    ? await planResearchWeb(spec)
    : { query: PlanResearch.researchQuery(spec), hits: [] as Hit[], webEnabled: false, engine: 'disabled' };

  if (P.available()) {
    const gen = await generateBespokePlan(P, spec, research.hits);
    if (gen) {
      return json(res, 200, {
        layout: gen.layout,
        spec: { plotW: spec.plotW, plotD: spec.plotD, floors: spec.floors, bedrooms: spec.bedrooms, bathrooms: spec.bathrooms, kitchens: spec.kitchens, living: spec.living, dining: spec.dining, garage: spec.garage, style: spec.style, seed: gen.layout.planSeed, customRooms: spec.customRooms || [] },
        concept: promptConcept || gen.concept,
        inspiration: 'Bespoke AI design (attempt ' + gen.attempts + ', ' + Math.round(gen.coverage * 100) + '% coverage, score ' + gen.score + ')',
        researchQuery: research.query, researchHits: research.hits.length, researchEngine: research.engine,
        source: 'ai-generated', planModel: PLAN_MODEL,
        validation: HouseLayout.validateLayout(gen.layout, { ...spec, strictCounts: true })
      });
    }
  }

  // offline / AI-failed fallback
  const layout: Layout = HouseLayout.computeLayout(spec);
  const offlineValidation = HouseLayout.validateLayout(layout, { ...spec, strictCounts: true });
  if (!offlineValidation.ok) {
    return json(res, 422, {
      error: 'This room program does not fit the selected footprint without compromising the plan.',
      hint: 'Increase the buildable width/length, add a floor, or remove one of the requested spaces.',
      issues: offlineValidation.issues.slice(0, 10),
      source: 'rejected-procedural'
    });
  }
  json(res, 200, {
    layout,
    spec: { plotW: spec.plotW, plotD: spec.plotD, floors: spec.floors, bedrooms: spec.bedrooms, bathrooms: spec.bathrooms, kitchens: spec.kitchens, living: spec.living, dining: spec.dining, garage: spec.garage, style: spec.style, seed: layout.planSeed, customRooms: spec.customRooms || [] },
    concept: promptConcept || layout.planConcept || '',
    inspiration: P.available() ? 'AI geometry was rejected — validated constraint-planned design used' : 'Validated offline constraint-planned design',
    researchQuery: research.query, researchHits: research.hits.length, researchEngine: research.engine,
    source: 'procedural-optimized', planModel: PLAN_MODEL,
    validation: offlineValidation
  });
}

/* -------- AI floor-plan render (Nano Banana Pro): schematic SVG -> beautiful plan image -------- */
async function planImage(res: ServerResponse, body: Record<string, unknown>): Promise<void> {
  const P = imageProvider();
  if (!P.available()) return noKey(res);
  const reference = parseImageReference(body.image);
  if (!reference) return json(res, 400, { error: 'A valid PNG, JPEG or WebP plan image is required.' });
  const style = promptText(body.style || 'modern', 60);
  const level = Number(body.level || 1);
  const prompt = 'Transform this schematic floor plan into a beautiful, professional 2D architectural floor-plan presentation render: ' +
    'top-down orthographic view, realistic textured flooring per room (wood, tile, carpet), elegant furniture illustrations, soft ambient-occlusion shadows, ' +
    style + ' interior color palette. CRITICAL: keep every wall position, room shape, door, window, label and dimension EXACTLY as in the reference image — same proportions, nothing moved, added or removed. ' +
    'Clean white background, crisp linework, high-end real-estate marketing quality, no watermark, no extra text.';
  try {
    const out = await P.generateImage({ prompt, references: [reference] });
    json(res, 200, { b64: out.b64, url: out.url, provider: P.id, level });
  } catch (e) { const err = e as ApiErr; json(res, err.status || 500, { error: String(err.message || e), hint: err.hint }); }
}

/* ------------------------------ reference images ------------------------------ */
async function referenceImages(res: ServerResponse, query: string): Promise<void> {
  const k = process.env.UNSPLASH_ACCESS_KEY;
  if (!k) return json(res, 501, { error: 'Add UNSPLASH_ACCESS_KEY to .env to enable web image search.' });
  try {
    const r = await fetchWithTimeout('https://api.unsplash.com/search/photos?per_page=12&query=' + encodeURIComponent(query), { headers: { Authorization: 'Client-ID ' + k } });
    if (!r.ok) throw new Error('Unsplash HTTP ' + r.status);
    const data = await r.json() as { results?: { urls: { small: string; regular: string }; alt_description?: string; links?: { html?: string } }[] };
    json(res, 200, { images: (data.results || []).map(p => ({ thumb: p.urls.small, full: p.urls.regular, alt: p.alt_description || query, link: p.links && p.links.html })) });
  } catch (e) { json(res, 500, { error: String((e as Error).message || e) }); }
}

/* ------------------------------ CC0 asset proxies ------------------------------ */
const TEX_SLUGS: Record<string, string> = { wood:'wood_floor', tile:'floor_tiles_06', brick:'red_brick_03', plaster:'beige_wall_001', siding:'wood_planks', shingle:'roof_tiles', concrete:'concrete_floor_02', marble:'marble_01', carpet:'carpet', grass:'aerial_grass_rock', membrane:'concrete_floor_02' };
async function texture(res: ServerResponse, name: string, map: string): Promise<void> {
  const slug = TEX_SLUGS[name];
  if (!slug) { res.writeHead(404); res.end('unknown texture'); return; }
  try {
    const fr = await fetchWithTimeout('https://api.polyhaven.com/files/' + slug, { headers: { Accept: 'application/json' } });
    if (!fr.ok) throw new Error('polyhaven ' + fr.status);
    const files = await fr.json() as Record<string, Record<string, Record<string, { url?: string }>>>;
    const diff = map === 'nor' ? (files.nor_gl || files.Normal || files.nor_dx)
      : map === 'rough' ? (files.Rough || files.rough || files.roughness)
      : (files.Diffuse || files.diffuse || files.Color || files.col || files.albedo);
    const r1 = diff && (diff['1k'] || diff['2k'] || diff[Object.keys(diff)[0]]);
    const fm = r1 && (r1.jpg || r1.png || r1[Object.keys(r1)[0]]);
    const url = fm && fm.url;
    if (!url) throw new Error('no map url');
    const ir = await fetchWithTimeout(url);
    if (!ir.ok) throw new Error('img ' + ir.status);
    const buf = await readResponseBuffer(ir, 12 * 1024 * 1024);
    res.writeHead(200, { 'Content-Type': ir.headers.get('content-type') || 'image/jpeg', 'Cache-Control': 'public, max-age=604800' });
    res.end(buf);
  } catch (e) { res.writeHead(502); res.end('texture proxy failed: ' + String((e as Error).message || e)); }
}

async function model(res: ServerResponse, type: string): Promise<void> {
  const safe = normalizeFurnitureType(type);
  if (!safe) { res.writeHead(404); res.end('unknown model type'); return; }
  const dir = path.join(LEGACY_PUBLIC, 'models');
  const file = path.join(dir, safe.replace(/ /g, '_') + '.glb');
  try {
    if (fs.existsSync(file)) {
      const stat = fs.statSync(file);
      if (stat.isFile() && stat.size > 0 && stat.size <= MAX_FURNITURE_MODEL_BYTES) {
        res.writeHead(200, { 'Content-Type': 'model/gltf-binary', 'Cache-Control': 'public, max-age=604800', 'X-Content-Type-Options': 'nosniff' });
        fs.createReadStream(file).pipe(res);
        return;
      }
    }
    // Rodin (Hyper3D) text-to-3D: generate a high-quality furniture GLB once, then cache it
    if (rodinAvailable()) {
      const buf = await generateFurnitureGLB(safe);
      if (buf && isValidFurnitureGLB(buf)) {
        try { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file, buf); } catch { /* cache optional */ }
        res.writeHead(200, { 'Content-Type': 'model/gltf-binary', 'Cache-Control': 'public, max-age=604800' });
        res.end(buf); return;
      }
    }
    const k = process.env.POLY_PIZZA_KEY;
    if (!k) { res.writeHead(404); res.end(rodinAvailable() ? 'no model source succeeded' : 'RODIN_API_KEY / POLY_PIZZA_KEY not set'); return; }
    const sr = await fetchWithTimeout('https://api.poly.pizza/v1.1/search/' + encodeURIComponent(safe), { headers: { 'x-auth-token': k } });
    if (!sr.ok) throw new Error('poly search ' + sr.status);
    const data = await sr.json() as { results?: Record<string, string>[]; Results?: Record<string, string>[] };
    const list = data.results || data.Results || [];
    let url: string | null = null;
    for (const m of list) { const dl = m.Download || m.download || m.url; if (dl && /\.glb/i.test(dl)) { url = dl; break; } }
    if (!url && list[0]) url = list[0].Download || list[0].download;
    if (!url) throw new Error('no glb result');
    const mr = await fetchWithTimeout(url, {}, 60_000);
    if (!mr.ok) throw new Error('model fetch ' + mr.status);
    const buf = await readResponseBuffer(mr, MAX_FURNITURE_MODEL_BYTES);
    if (!isValidFurnitureGLB(buf)) throw new Error('downloaded file is not a valid bounded GLB');
    try { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file, buf); } catch { /* cache optional */ }
    res.writeHead(200, { 'Content-Type': 'model/gltf-binary', 'Cache-Control': 'public, max-age=604800' });
    res.end(buf);
  } catch (e) { res.writeHead(502); res.end('model proxy: ' + String((e as Error).message || e)); }
}

/* ------------------------------ static (vite dist) ------------------------------ */
function serveStatic(req: IncomingMessage, res: ServerResponse): void {
  let p: string;
  try { p = decodeURIComponent((req.url || '/').split('?')[0]).replace(/\\/g, '/'); }
  catch { res.writeHead(400); res.end('Bad request'); return; }
  if (p === '/') p = '/index.html';
  const file = resolvePathWithin(DIST, p);
  if (!file) { res.writeHead(403); res.end('Forbidden'); return; }
  const sendFile = (): void => fs.readFile(file, (err, buf) => {
    if (err) {
      if (p === '/index.html') {
        res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<body style="font-family:sans-serif;background:#0e1014;color:#eef1f6;display:flex;align-items:center;justify-content:center;height:100vh"><div style="max-width:460px;line-height:1.7"><h2>ForthHome isn\'t built yet</h2>Run <code style="background:#1c212b;padding:2px 8px;border-radius:6px">npm install &amp;&amp; npm run dev</code> in the house-builder folder, then reload.</div></body>');
        return;
      }
      res.writeHead(404); res.end('Not found'); return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
  try { sendFile(); }
  catch { res.writeHead(400); res.end('Bad request'); }
}

/* ------------------------------ router ------------------------------ */
http.createServer(async (req, res) => {
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  let u: URL; try { u = new URL(req.url || '/', 'http://localhost'); } catch { res.writeHead(400); res.end('Bad request'); return; }
  if (req.method === 'POST' && u.pathname.startsWith('/api/ai/') && !allowAIRequest(req, res)) return;
  if (req.method === 'GET' && u.pathname === '/api/ai/status') return json(res, 200, {
    openai: provider().available(), imageProvider: imageProvider().id, textProvider: provider().id,
    configured: provider().available(), verified: lastDiagnosis ? lastDiagnosis.ok : null,
    verifiedAt: lastDiagnosis ? lastDiagnosis.at : null,
    gemini: !!process.env.GEMINI_API_KEY, rodin: rodinAvailable(),
    planImage: imageProvider().available(),
    textModel: TEXT_MODEL, planModel: PLAN_MODEL, imageModel: IMAGE_MODEL,
    bespokePlans: provider().available(),
    webSearch: 'duckduckgo-free', braveSearch: !!process.env.BRAVE_SEARCH_API_KEY,
    aiFloorPlans: true, templates: PlanTemplates.listTemplates().length
  });
  if (req.method === 'GET' && u.pathname === '/api/ai/diagnose') return diagnose(res);
  if (req.method === 'GET' && u.pathname === '/api/plan-research') {
    const spec: Spec = {
      plotW: +(u.searchParams.get('plotW') || 18), plotD: +(u.searchParams.get('plotD') || 14),
      floors: +(u.searchParams.get('floors') || 2), bedrooms: +(u.searchParams.get('bedrooms') || 3),
      bathrooms: +(u.searchParams.get('bathrooms') || 2), kitchens: +(u.searchParams.get('kitchens') || 1),
      living: +(u.searchParams.get('living') || 1), dining: u.searchParams.get('dining') !== '0',
      garage: u.searchParams.get('garage') !== '0', style: (u.searchParams.get('style') || 'modern').slice(0, 40)
    };
    try { return json(res, 200, await planResearchWeb(spec)); }
    catch (e) { return json(res, 500, { error: String((e as Error).message || e) }); }
  }
  if (req.method === 'POST' && u.pathname === '/api/ai/design-brief') return withJsonBody(req, res, 256 * 1024, designBrief);
  if (req.method === 'POST' && u.pathname === '/api/ai/floor-plan') return withJsonBody(req, res, 256 * 1024, aiFloorPlan);
  if (req.method === 'POST' && u.pathname === '/api/ai/plan-from-image') return withJsonBody(req, res, 14 * 1024 * 1024, planFromImage);
  if (req.method === 'POST' && u.pathname === '/api/ai/render') return withJsonBody(req, res, 14 * 1024 * 1024, render);
  if (req.method === 'POST' && u.pathname === '/api/ai/plan-image') return withJsonBody(req, res, 14 * 1024 * 1024, planImage);
  if (req.method === 'GET' && u.pathname === '/api/reference-images') return referenceImages(res, (u.searchParams.get('q') || 'house interior').slice(0, 120));
  if (req.method === 'GET' && u.pathname === '/api/texture') return texture(res, (u.searchParams.get('name') || '').slice(0, 20), (u.searchParams.get('map') || '').slice(0, 8));
  if (req.method === 'GET' && u.pathname === '/api/model') return model(res, u.searchParams.get('type') || '');
  serveStatic(req, res);
}).listen(PORT, () => console.log('\n  ForthHome AI House Designer:  http://localhost:' + PORT +
  '\n  Text/plans: ' + provider().id + ' | Images: ' + imageProvider().id + ' | Rodin 3D: ' + (rodinAvailable() ? 'on' : 'off') + ' — ' + (provider().available() ? ('key present — BESPOKE AI floor plans on (plans ' + PLAN_MODEL + ', text ' + TEXT_MODEL + ', images ' + IMAGE_MODEL + ')') : 'AI unavailable (validated seeded procedural planner active)') +
  '\n  Static: ' + (fs.existsSync(path.join(DIST, 'index.html')) ? 'dist/ (built)' : 'dist/ MISSING — run npm run build') + '\n'))
  .on('error', (e: NodeJS.ErrnoException) => {
    if (e.code === 'EADDRINUSE') {
      console.error('\n  Port ' + PORT + ' is already in use — ForthHome is probably ALREADY running.' +
        '\n  - Easiest: just open  http://localhost:' + PORT + '  in your browser.' +
        '\n  - Or stop the other server, then start again.' +
        '\n  - Or run on a different port:  set PORT=3001 && npm start  (Windows)\n');
      process.exit(1);
    } else throw e;
  });
