/**
 * ForthHome — AI House Designer server (TypeScript, Node built-ins).
 * Compiled by tsc to build/server.js. API surface unchanged from v2:
 *   GET  /api/ai/status | /api/ai/diagnose | /api/plan-research | /api/reference-images
 *   GET  /api/texture | /api/model
 *   POST /api/ai/design-brief | /api/ai/floor-plan | /api/ai/plan-from-image | /api/ai/render
 * /api/ai/floor-plan now returns a BESPOKE AI-generated plan (source: "ai-generated");
 * templates are only the offline fallback.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HouseLayout } from './src/engine/layout.js';
import { PlanResearch } from './src/engine/plan-research.js';
import { PlanTemplates } from './src/engine/plan-templates.js';
import type { Layout, Spec } from './src/engine/types.js';
import { getTextProvider, getImageProvider } from './server/providers.js';
import { generateFurnitureGLB, rodinAvailable } from './server/model3d.js';
import { generateBespokePlan } from './server/plan-generator.js';
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
const TEXT_MODEL = process.env.OPENAI_TEXT_MODEL || 'gpt-4o';
const PLAN_MODEL = process.env.OPENAI_PLAN_MODEL || 'gpt-4o';
const IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1';

const TYPES: Record<string, string> = { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.ico':'image/x-icon','.glb':'model/gltf-binary','.map':'application/json' };
const json = (res: ServerResponse, code: number, obj: unknown): void => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); };

function readBody(req: IncomingMessage, max = 14 * 1024 * 1024): Promise<Record<string, unknown>> {
  return new Promise(resolve => {
    const chunks: Buffer[] = []; let len = 0;
    req.on('data', (c: Buffer) => { len += c.length; if (len > max) { req.destroy(); return; } chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

interface ApiErr extends Error { status?: number; hint?: string; }
const provider = () => getTextProvider();
const imageProvider = () => getImageProvider();
const noKey = (res: ServerResponse) => json(res, 501, { error: 'No AI key configured (.env). The 3D model and floor plans still work offline — this feature needs a key.' });

/* ------------------------------ AI endpoints ------------------------------ */
async function diagnose(res: ServerResponse): Promise<void> {
  const img = await imageProvider().diagnose();
  let message = '[images: ' + imageProvider().id + '] ' + img.message;
  if (imageProvider().id !== provider().id) {
    const txt = await provider().diagnose();
    message += '\n[plans/text: ' + provider().id + '] ' + txt.message;
  }
  json(res, 200, { ...img, message, imageProviderId: imageProvider().id, textProviderId: provider().id, rodin: rodinAvailable() });
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
    const brief = await P.chatJSON({ model: TEXT_MODEL, temperature: 0.7, messages: [{ role: 'system', content: sys }, { role: 'user', content: user }] });
    json(res, 200, { brief });
  } catch (e) { const err = e as ApiErr; json(res, err.status || 500, { error: String(err.message || e), hint: err.hint }); }
}

function buildPrompt(b: Record<string, unknown>): string {
  const pal = b.palette ? ' Color palette: ' + b.palette + '.' : '';
  const notes = b.notes ? ' ' + b.notes : '';
  if (/exterior|facade|outside|house/i.test(String(b.view)))
    return `Photorealistic architectural exterior photograph of a ${b.style} ${b.floors || 1}-storey family house` +
      `${b.bedrooms ? ', approx ' + b.bedrooms + ' bedrooms' : ''}, landscaped front yard, driveway, golden-hour daylight, ` +
      `realistic materials, ultra detailed, professional real-estate photography, no text or watermark.${pal}${notes}`;
  return `Photorealistic interior design photograph of a ${b.style} ${b.view}, professionally designed and furnished, ` +
    `natural daylight from large windows, realistic materials and textures, soft global illumination, wide-angle lens, ` +
    `magazine-quality real-estate photography, ultra detailed, no text or watermark.${pal}${notes}`;
}

async function render(res: ServerResponse, body: Record<string, unknown>): Promise<void> {
  const P = imageProvider();
  if (!P.available()) return noKey(res);
  const prompt = buildPrompt(body);
  try {
    const out = await P.generateImage({ prompt, size: '1024x1024', quality: String(body.quality || 'medium'), references: Array.isArray(body.references) ? body.references as { b64: string; type?: string }[] : [] });
    json(res, 200, { b64: out.b64, url: out.url, prompt });
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
    let layout = HouseLayout.fromAI(raw, spec); let source = 'from-image';
    if (!layout) { layout = HouseLayout.computeLayout(spec); source = 'fallback'; }
    json(res, 200, { ok: source === 'from-image', layout, concept: (raw.concept as string) || '', source });
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
    const r = await fetch('https://api.search.brave.com/res/v1/web/search?q=' + encodeURIComponent(q) + '&count=8', {
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
    const r = await fetch('https://html.duckduckgo.com/html/', {
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
    const r = await fetch('https://api.duckduckgo.com/?q=' + encodeURIComponent(q) + '&format=json&no_html=1&skip_disambig=1');
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
  return {
    plotW: (+(p.plotW as number) >= 6 && +(p.plotW as number) <= 80) ? +(p.plotW as number) : spec.plotW,
    plotD: (+(p.plotD as number) >= 6 && +(p.plotD as number) <= 80) ? +(p.plotD as number) : spec.plotD,
    floors: cl(p.floors, 1, 4, spec.floors), bedrooms: cl(p.bedrooms, 0, 12, spec.bedrooms),
    bathrooms: cl(p.bathrooms, 0, 8, spec.bathrooms), kitchens: cl(p.kitchens, 0, 4, spec.kitchens),
    living: cl(p.living, 0, 4, spec.living),
    dining: typeof p.dining === 'boolean' ? p.dining : spec.dining,
    garage: typeof p.garage === 'boolean' ? p.garage : spec.garage,
    style: styles[String(p.style)] ? String(p.style) : spec.style,
    prompt: spec.prompt
  };
}
async function extractParams(spec: Spec): Promise<{ params?: Record<string, unknown>; concept?: string }> {
  const sys = 'You are a residential architect. Read the brief and return ONLY JSON extracting build parameters and a short concept: ' +
    '{"params":{"plotW":m,"plotD":m,"floors":1-4,"bedrooms":int,"bathrooms":int,"kitchens":int,"living":int,"dining":bool,"garage":bool,"style":"modern|traditional|minimalist|scandinavian|industrial"},"concept":"1-2 sentences"}';
  const user = 'Brief: "' + String(spec.prompt).slice(0, 700) + '"\nCurrent settings: ' + JSON.stringify({ plotW: spec.plotW, plotD: spec.plotD, floors: spec.floors, bedrooms: spec.bedrooms, bathrooms: spec.bathrooms, kitchens: spec.kitchens, living: spec.living, dining: spec.dining, garage: spec.garage, style: spec.style });
  return provider().chatJSON({ model: PLAN_MODEL, temperature: 0.2, messages: [{ role: 'system', content: sys }, { role: 'user', content: user }] });
}

async function aiFloorPlan(res: ServerResponse, body: Record<string, unknown>): Promise<void> {
  const P = provider();
  let spec = body as unknown as Spec;
  spec = sanitizeSpec(body, { plotW: 11, plotD: 13, floors: 2, bedrooms: 3, bathrooms: 2, kitchens: 1, living: 1, dining: true, garage: true, style: 'modern', prompt: typeof body.prompt === 'string' ? body.prompt : undefined });
  if (typeof body.prompt === 'string' && body.prompt.trim()) spec.prompt = body.prompt.trim();

  let promptConcept = '';
  if (spec.prompt && P.available()) {
    try {
      const ex = await extractParams(spec);
      if (ex.params) spec = { ...sanitizeSpec(ex.params, spec), prompt: spec.prompt };
      promptConcept = ex.concept || '';
    } catch { /* keep form spec */ }
  }

  const research = await planResearchWeb(spec);

  if (P.available()) {
    const gen = await generateBespokePlan(P, spec, research.hits);
    if (gen) {
      return json(res, 200, {
        layout: gen.layout,
        spec: { plotW: spec.plotW, plotD: spec.plotD, floors: spec.floors, bedrooms: spec.bedrooms, bathrooms: spec.bathrooms, kitchens: spec.kitchens, living: spec.living, dining: spec.dining, garage: spec.garage, style: spec.style },
        concept: promptConcept || gen.concept,
        inspiration: 'Bespoke AI design (attempt ' + gen.attempts + ', ' + Math.round(gen.coverage * 100) + '% coverage, score ' + gen.score + ')',
        researchQuery: research.query, researchHits: research.hits.length, researchEngine: research.engine,
        source: 'ai-generated', planModel: PLAN_MODEL
      });
    }
  }

  // offline / AI-failed fallback
  const layout: Layout = HouseLayout.computeLayout(spec);
  json(res, 200, {
    layout,
    spec: { plotW: spec.plotW, plotD: spec.plotD, floors: spec.floors, bedrooms: spec.bedrooms, bathrooms: spec.bathrooms, kitchens: spec.kitchens, living: spec.living, dining: spec.dining, garage: spec.garage, style: spec.style },
    concept: promptConcept || layout.planConcept || '',
    inspiration: P.available() ? 'AI generation failed twice — validated offline plan used' : 'Offline plan (no AI key)',
    researchQuery: research.query, researchHits: research.hits.length, researchEngine: research.engine,
    source: 'pro-template', planModel: PLAN_MODEL
  });
}

/* -------- AI floor-plan render (Nano Banana Pro): schematic SVG -> beautiful plan image -------- */
async function planImage(res: ServerResponse, body: Record<string, unknown>): Promise<void> {
  const P = imageProvider();
  if (!P.available()) return noKey(res);
  const image = String(body.image || '');
  const m = /^data:image\/(png|jpeg);base64,(.*)$/.exec(image);
  if (!m) return json(res, 400, { error: 'No plan image provided.' });
  const style = String(body.style || 'modern');
  const level = Number(body.level || 1);
  const prompt = 'Transform this schematic floor plan into a beautiful, professional 2D architectural floor-plan presentation render: ' +
    'top-down orthographic view, realistic textured flooring per room (wood, tile, carpet), elegant furniture illustrations, soft ambient-occlusion shadows, ' +
    style + ' interior color palette. CRITICAL: keep every wall position, room shape, door, window, label and dimension EXACTLY as in the reference image — same proportions, nothing moved, added or removed. ' +
    'Clean white background, crisp linework, high-end real-estate marketing quality, no watermark, no extra text.';
  try {
    const out = await P.generateImage({ prompt, references: [{ b64: m[2], type: 'image/' + m[1] }] });
    json(res, 200, { b64: out.b64, url: out.url, provider: P.id, level });
  } catch (e) { const err = e as ApiErr; json(res, err.status || 500, { error: String(err.message || e), hint: err.hint }); }
}

/* ------------------------------ reference images ------------------------------ */
async function referenceImages(res: ServerResponse, query: string): Promise<void> {
  const k = process.env.UNSPLASH_ACCESS_KEY;
  if (!k) return json(res, 501, { error: 'Add UNSPLASH_ACCESS_KEY to .env to enable web image search.' });
  try {
    const r = await fetch('https://api.unsplash.com/search/photos?per_page=12&query=' + encodeURIComponent(query), { headers: { Authorization: 'Client-ID ' + k } });
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
    const fr = await fetch('https://api.polyhaven.com/files/' + slug, { headers: { Accept: 'application/json' } });
    if (!fr.ok) throw new Error('polyhaven ' + fr.status);
    const files = await fr.json() as Record<string, Record<string, Record<string, { url?: string }>>>;
    const diff = map === 'nor' ? (files.nor_gl || files.Normal || files.nor_dx)
      : map === 'rough' ? (files.Rough || files.rough || files.roughness)
      : (files.Diffuse || files.diffuse || files.Color || files.col || files.albedo);
    const r1 = diff && (diff['1k'] || diff['2k'] || diff[Object.keys(diff)[0]]);
    const fm = r1 && (r1.jpg || r1.png || r1[Object.keys(r1)[0]]);
    const url = fm && fm.url;
    if (!url) throw new Error('no map url');
    const ir = await fetch(url);
    if (!ir.ok) throw new Error('img ' + ir.status);
    const buf = Buffer.from(await ir.arrayBuffer());
    res.writeHead(200, { 'Content-Type': ir.headers.get('content-type') || 'image/jpeg', 'Cache-Control': 'public, max-age=604800' });
    res.end(buf);
  } catch (e) { res.writeHead(502); res.end('texture proxy failed: ' + String((e as Error).message || e)); }
}

async function model(res: ServerResponse, type: string): Promise<void> {
  const safe = String(type || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').trim().slice(0, 30);
  if (!safe) { res.writeHead(404); res.end('no type'); return; }
  const dir = path.join(LEGACY_PUBLIC, 'models');
  const file = path.join(dir, safe.replace(/ /g, '_') + '.glb');
  try {
    if (fs.existsSync(file)) { res.writeHead(200, { 'Content-Type': 'model/gltf-binary', 'Cache-Control': 'public, max-age=604800' }); fs.createReadStream(file).pipe(res); return; }
    // Rodin (Hyper3D) text-to-3D: generate a high-quality furniture GLB once, then cache it
    if (rodinAvailable()) {
      const buf = await generateFurnitureGLB(safe);
      if (buf) {
        try { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file, buf); } catch { /* cache optional */ }
        res.writeHead(200, { 'Content-Type': 'model/gltf-binary', 'Cache-Control': 'public, max-age=604800' });
        res.end(buf); return;
      }
    }
    const k = process.env.POLY_PIZZA_KEY;
    if (!k) { res.writeHead(404); res.end(rodinAvailable() ? 'no model source succeeded' : 'RODIN_API_KEY / POLY_PIZZA_KEY not set'); return; }
    const sr = await fetch('https://api.poly.pizza/v1.1/search/' + encodeURIComponent(safe), { headers: { 'x-auth-token': k } });
    if (!sr.ok) throw new Error('poly search ' + sr.status);
    const data = await sr.json() as { results?: Record<string, string>[]; Results?: Record<string, string>[] };
    const list = data.results || data.Results || [];
    let url: string | null = null;
    for (const m of list) { const dl = m.Download || m.download || m.url; if (dl && /\.glb/i.test(dl)) { url = dl; break; } }
    if (!url && list[0]) url = list[0].Download || list[0].download;
    if (!url) throw new Error('no glb result');
    const mr = await fetch(url);
    if (!mr.ok) throw new Error('model fetch ' + mr.status);
    const buf = Buffer.from(await mr.arrayBuffer());
    try { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file, buf); } catch { /* cache optional */ }
    res.writeHead(200, { 'Content-Type': 'model/gltf-binary', 'Cache-Control': 'public, max-age=604800' });
    res.end(buf);
  } catch (e) { res.writeHead(502); res.end('model proxy: ' + String((e as Error).message || e)); }
}

/* ------------------------------ static (vite dist) ------------------------------ */
function serveStatic(req: IncomingMessage, res: ServerResponse): void {
  let p = decodeURIComponent((req.url || '/').split('?')[0]); if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(DIST, p));
  if (!file.startsWith(DIST)) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.readFile(file, (err, buf) => {
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
}

/* ------------------------------ router ------------------------------ */
http.createServer(async (req, res) => {
  let u: URL; try { u = new URL(req.url || '/', 'http://localhost'); } catch { res.writeHead(400); res.end('Bad request'); return; }
  if (req.method === 'GET' && u.pathname === '/api/ai/status') return json(res, 200, {
    openai: provider().available(), imageProvider: imageProvider().id, textProvider: provider().id,
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
  if (req.method === 'POST' && u.pathname === '/api/ai/design-brief') return designBrief(res, await readBody(req));
  if (req.method === 'POST' && u.pathname === '/api/ai/floor-plan') return aiFloorPlan(res, await readBody(req));
  if (req.method === 'POST' && u.pathname === '/api/ai/plan-from-image') return planFromImage(res, await readBody(req));
  if (req.method === 'POST' && u.pathname === '/api/ai/render') return render(res, await readBody(req));
  if (req.method === 'POST' && u.pathname === '/api/ai/plan-image') return planImage(res, await readBody(req));
  if (req.method === 'GET' && u.pathname === '/api/reference-images') return referenceImages(res, (u.searchParams.get('q') || 'house interior').slice(0, 120));
  if (req.method === 'GET' && u.pathname === '/api/texture') return texture(res, (u.searchParams.get('name') || '').slice(0, 20), (u.searchParams.get('map') || '').slice(0, 8));
  if (req.method === 'GET' && u.pathname === '/api/model') return model(res, u.searchParams.get('type') || '');
  serveStatic(req, res);
}).listen(PORT, () => console.log('\n  ForthHome AI House Designer:  http://localhost:' + PORT +
  '\n  Text/plans: ' + provider().id + ' | Images: ' + imageProvider().id + ' | Rodin 3D: ' + (rodinAvailable() ? 'on' : 'off') + ' — ' + (provider().available() ? ('key present — BESPOKE AI floor plans on (plans ' + PLAN_MODEL + ', text ' + TEXT_MODEL + ', images ' + IMAGE_MODEL + ')') : 'NOT configured (offline template plans)') +
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
