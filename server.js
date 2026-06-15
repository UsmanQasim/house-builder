/**
 * ForthHome — AI House Designer server (zero dependencies, Node built-ins).
 *
 * Endpoints:
 *   GET  /api/ai/status     -> is a key present + which models are configured
 *   GET  /api/ai/diagnose   -> actually calls OpenAI and reports the real reason
 *                              renders fail (invalid key / org not verified / no model)
 *   POST /api/ai/design-brief -> cohesive palette + per-room interior plan (gpt-4o-mini)
 *   POST /api/ai/floor-plan   -> AI floor plan from web research + OpenAI (best maps)
 *   GET  /api/plan-research    -> web snippets about matching floor plans (Brave optional)
 *   POST /api/ai/render     -> photorealistic image (gpt-image-1); uses reference
 *                              images via the images/edits endpoint when provided
 *   GET  /api/reference-images -> optional Unsplash web image search
 *
 * Run:  node server.js   (no npm install needed)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

(function loadEnv() {
  try {
    const file = path.join(__dirname, '.env');
    if (!fs.existsSync(file)) return;
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const t = line.trim(); if (!t || t.startsWith('#')) continue;
      const i = t.indexOf('='); if (i === -1) continue;
      const k = t.slice(0, i).trim(); const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
      if (!(k in process.env)) process.env[k] = v;
    }
  } catch (_) {}
})();

const PUBLIC = path.join(__dirname, 'public');
const PORT = process.env.PORT || 3000;
const TEXT_MODEL = process.env.OPENAI_TEXT_MODEL || 'gpt-4o';
const PLAN_MODEL = process.env.OPENAI_PLAN_MODEL || 'gpt-4o';
const IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1';
const HouseLayout = require('./public/layout.js');
const PlanResearch = require('./public/plan-research.js');
const PlanTemplates = require('./public/plan-templates.js');
const TYPES = { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.ico':'image/x-icon' };
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); };
const key = () => process.env.OPENAI_API_KEY;

function readBody(req, max) {
  max = max || 14 * 1024 * 1024;
  return new Promise(resolve => {
    let chunks = [], len = 0;
    req.on('data', c => { len += c.length; if (len > max) { req.destroy(); return; } chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

async function postJSON(endpoint, payload) {
  const r = await fetch('https://api.openai.com/v1/' + endpoint, {
    method: 'POST', headers: { Authorization: 'Bearer ' + key(), 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw apiError(data, r.status);
  return data;
}
function apiError(data, status) {
  const m = (data && data.error && data.error.message) || ('OpenAI HTTP ' + status);
  const e = new Error(m); e.status = status;
  if (status === 403 && /verif/i.test(m)) e.hint = 'Your OpenAI organization must be verified to use ' + IMAGE_MODEL + '. Verify at https://platform.openai.com/settings/organization/general , wait, create a fresh key, and restart.';
  return e;
}

/* multipart/form-data builder for images/edits (reference-guided renders) */
function multipart(fields, files) {
  const b = '----forthhome' + Date.now(), parts = [];
  for (const k in fields) parts.push(Buffer.from('--' + b + '\r\nContent-Disposition: form-data; name="' + k + '"\r\n\r\n' + fields[k] + '\r\n'));
  files.forEach(f => parts.push(Buffer.concat([
    Buffer.from('--' + b + '\r\nContent-Disposition: form-data; name="' + f.name + '"; filename="' + f.filename + '"\r\nContent-Type: ' + f.type + '\r\n\r\n'),
    f.buffer, Buffer.from('\r\n')])));
  parts.push(Buffer.from('--' + b + '--\r\n'));
  return { contentType: 'multipart/form-data; boundary=' + b, body: Buffer.concat(parts) };
}

async function diagnose(res) {
  if (!key()) return json(res, 200, { ok: false, stage: 'key', message: 'No OPENAI_API_KEY found in .env. Add it and restart the server.' });
  try {
    const r = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: 'Bearer ' + key() } });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) { const m = (data.error && data.error.message) || ('HTTP ' + r.status);
      return json(res, 200, { ok: false, stage: 'auth', message: r.status === 401 ? 'Your API key is invalid or revoked. Create a new one at platform.openai.com/api-keys.' : m }); }
    const ids = (data.data || []).map(x => x.id);
    const hasImg = ids.indexOf(IMAGE_MODEL) !== -1, hasTxt = ids.indexOf(TEXT_MODEL) !== -1;
    return json(res, 200, { ok: hasImg, keyValid: true, textModelAvailable: hasTxt, imageModelAvailable: hasImg, imageModel: IMAGE_MODEL,
      message: hasImg ? ('Key valid. ' + IMAGE_MODEL + ' is available — renders should work.')
        : ('Key is valid, but ' + IMAGE_MODEL + ' is NOT enabled for this org. Verify your organization at https://platform.openai.com/settings/organization/general (this is the usual cause of failed renders). Design-scheme text should still work.') });
  } catch (e) { return json(res, 200, { ok: false, stage: 'network', message: String(e.message || e) }); }
}

async function designBrief(res, spec) {
  if (!key()) return json(res, 501, { error: 'No OPENAI_API_KEY in .env.' });
  const sys = 'You are a senior residential interior designer. Return ONLY valid JSON describing a cohesive, realistic scheme. Colors are hex like "#RRGGBB".';
  const user = `Design a cohesive scheme for a ${spec.style} home: ${spec.area} m2, ${spec.floors} floor(s), ${spec.bedrooms} bed, ${spec.bathrooms} bath, ${spec.kitchens} kitchen(s), ${spec.living} living${spec.dining ? ', dining' : ''}${spec.garage ? ', garage' : ''}.\n` +
    'JSON shape: {"concept":"2-3 sentences","palette":[{"name":"","hex":"#RRGGBB","role":""}],' +
    '"exterior":{"materials":"","accentHex":"#RRGGBB"},' +
    '"rooms":{"living":{"notes":"","accentHex":"#RRGGBB"},"bedroom":{"notes":"","accentHex":"#RRGGBB"},"kitchen":{"notes":"","accentHex":"#RRGGBB"},"bathroom":{"notes":"","accentHex":"#RRGGBB"},"dining":{"notes":"","accentHex":"#RRGGBB"}}}';
  try {
    const data = await postJSON('chat/completions', { model: TEXT_MODEL, temperature: 0.7, response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: sys }, { role: 'user', content: user }] });
    const txt = (data.choices && data.choices[0] && data.choices[0].message.content) || '{}';
    json(res, 200, { brief: JSON.parse(txt) });
  } catch (e) { json(res, e.status || 500, { error: String(e.message || e), hint: e.hint }); }
}

function buildPrompt(b) {
  const pal = b.palette ? ' Color palette: ' + b.palette + '.' : '';
  const notes = b.notes ? ' ' + b.notes : '';
  if (/exterior|facade|outside|house/i.test(b.view))
    return `Photorealistic architectural exterior photograph of a ${b.style} ${b.floors || 1}-storey family house` +
      `${b.bedrooms ? ', approx ' + b.bedrooms + ' bedrooms' : ''}, landscaped front yard, driveway, golden-hour daylight, ` +
      `realistic materials, ultra detailed, professional real-estate photography, no text or watermark.${pal}${notes}`;
  return `Photorealistic interior design photograph of a ${b.style} ${b.view}, professionally designed and furnished, ` +
    `natural daylight from large windows, realistic materials and textures, soft global illumination, wide-angle lens, ` +
    `magazine-quality real-estate photography, ultra detailed, no text or watermark.${pal}${notes}`;
}

async function render(res, body) {
  if (!key()) return json(res, 501, { error: 'No OPENAI_API_KEY in .env.' });
  const prompt = buildPrompt(body);
  const refs = Array.isArray(body.references) ? body.references.slice(0, 3) : [];
  try {
    let data;
    if (refs.length) {
      const files = refs.map((r, i) => ({ name: 'image[]', filename: 'ref' + i + '.png', type: r.type || 'image/png', buffer: Buffer.from(r.b64, 'base64') }));
      const mp = multipart({ model: IMAGE_MODEL, prompt: prompt + ' Use the supplied reference image(s) for style, palette and mood.', size: '1024x1024', quality: body.quality || 'medium', n: '1' }, files);
      const r = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: 'Bearer ' + key(), 'Content-Type': mp.contentType }, body: mp.body });
      data = await r.json().catch(() => ({})); if (!r.ok) throw apiError(data, r.status);
    } else {
      const payload = { model: IMAGE_MODEL, prompt, n: 1, size: '1024x1024' };
      if (/^gpt-image/.test(IMAGE_MODEL)) payload.quality = body.quality || 'medium';
      data = await postJSON('images/generations', payload);
    }
    const d = (data.data && data.data[0]) || {};
    json(res, 200, { b64: d.b64_json || null, url: d.url || null, prompt });
  } catch (e) { json(res, e.status || 500, { error: String(e.message || e), hint: e.hint }); }
}

async function referenceImages(res, query) {
  const k = process.env.UNSPLASH_ACCESS_KEY;
  if (!k) return json(res, 501, { error: 'Add UNSPLASH_ACCESS_KEY to .env to enable web image search.' });
  try {
    const r = await fetch('https://api.unsplash.com/search/photos?per_page=12&query=' + encodeURIComponent(query), { headers: { Authorization: 'Client-ID ' + k } });
    if (!r.ok) throw new Error('Unsplash HTTP ' + r.status);
    const data = await r.json();
    json(res, 200, { images: (data.results || []).map(p => ({ thumb: p.urls.small, full: p.urls.regular, alt: p.alt_description || query, link: p.links && p.links.html })) });
  } catch (e) { json(res, 500, { error: String(e.message || e) }); }
}

function footprint(spec) {
  const margin = Math.max(0.8, Math.min(2, Math.min(spec.plotW, spec.plotD) * 0.08));
  const fw = Math.max(8, spec.plotW - 2 * margin), fh = Math.max(7, spec.plotD - 2 * margin);
  return { fw, fh, margin };
}

function decodeHtml(s) {
  return String(s || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
}

async function searchBrave(q, token) {
  const hits = [];
  try {
    const r = await fetch('https://api.search.brave.com/res/v1/web/search?q=' + encodeURIComponent(q) + '&count=8', {
      headers: { 'X-Subscription-Token': token, Accept: 'application/json' }
    });
    const data = await r.json().catch(() => ({}));
    if (r.ok) (data.web && data.web.results || []).slice(0, 6).forEach(function (x) {
      hits.push({ title: x.title || '', snippet: x.description || '', url: x.url || '' });
    });
  } catch (_) {}
  return hits;
}

async function searchDuckDuckGo(q) {
  const hits = [];
  try {
    const r = await fetch('https://html.duckduckgo.com/html/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'ForthHome/1.0 (house designer)' },
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
  } catch (_) {}
  return hits;
}

async function searchDuckDuckGoInstant(q) {
  const hits = [];
  try {
    const r = await fetch('https://api.duckduckgo.com/?q=' + encodeURIComponent(q) + '&format=json&no_html=1&skip_disambig=1');
    const data = await r.json().catch(() => ({}));
    if (data.AbstractText) hits.push({ title: data.Heading || q, snippet: data.AbstractText, url: data.AbstractURL || '' });
    (data.RelatedTopics || []).slice(0, 5).forEach(function (t) {
      if (t.Text) hits.push({ title: t.Text.split(' - ')[0], snippet: t.Text, url: t.FirstURL || '' });
      else if (t.Topics) t.Topics.slice(0, 3).forEach(function (u) {
        if (u.Text) hits.push({ title: u.Text.split(' - ')[0], snippet: u.Text, url: u.FirstURL || '' });
      });
    });
  } catch (_) {}
  return hits.slice(0, 6);
}

async function planResearchWeb(spec) {
  const q = PlanResearch.researchQuery(spec);
  let hits = [], engine = 'none';
  const brave = process.env.BRAVE_SEARCH_API_KEY;
  if (brave) {
    hits = await searchBrave(q, brave);
    if (hits.length) engine = 'brave';
  }
  if (!hits.length) {
    hits = await searchDuckDuckGo(q);
    if (hits.length) engine = 'duckduckgo';
  }
  if (!hits.length) {
    hits = await searchDuckDuckGoInstant(q);
    if (hits.length) engine = 'duckduckgo-instant';
  }
  return { query: q, hits: hits, webEnabled: hits.length > 0, engine: engine };
}

async function planResearch(res, spec) {
  try {
    const data = await planResearchWeb(spec);
    json(res, 200, data);
  } catch (e) { json(res, 500, { error: String(e.message || e) }); }
}

async function aiFloorPlan(res, spec) {
  const fp = footprint(spec);
  const research = await planResearchWeb(spec);
  const catalog = PlanTemplates.listTemplates();
  let templateId = PlanTemplates.pickTemplate(spec);
  let concept = PlanTemplates.CATALOG[templateId] ? PlanTemplates.CATALOG[templateId].concept : '';
  let inspiration = 'Professional ' + templateId + ' template';

  if (key()) {
    const refBlock = research.hits.length
      ? research.hits.map(function (h, i) { return (i + 1) + '. ' + h.title + ': ' + h.snippet; }).join('\n')
      : 'Standard residential typologies.';
    try {
      const data = await postJSON('chat/completions', {
        model: PLAN_MODEL, temperature: 0.2, response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: 'You are a residential architect. Pick the best pre-built floor plan template for the user. Return ONLY JSON: {"templateId":"","concept":"why this suits them","inspiration":"pattern name"}. Valid templateId values: ' + catalog.map(function (t) { return t.id; }).join(', ') },
          { role: 'user', content: 'Plot ' + spec.plotW + '×' + spec.plotD + 'm, footprint ' + fp.fw.toFixed(1) + '×' + fp.fh.toFixed(1) + 'm.\n' +
            spec.floors + ' floors, ' + spec.bedrooms + ' bedrooms, ' + spec.bathrooms + ' bathrooms, ' +
            spec.kitchens + ' kitchen(s), style: ' + spec.style + ', garage: ' + (spec.garage ? 'yes' : 'no') + ', dining: ' + (spec.dining ? 'yes' : 'no') + '.\n\nWeb research:\n' + refBlock + '\n\nTemplates:\n' +
            catalog.map(function (t) { return '- ' + t.id + ': ' + t.name + ' — ' + t.concept; }).join('\n') }
        ]
      });
      const pick = JSON.parse((data.choices && data.choices[0] && data.choices[0].message.content) || '{}');
      if (pick.templateId && PlanTemplates.CATALOG[pick.templateId]) templateId = pick.templateId;
      if (pick.concept) concept = pick.concept;
      if (pick.inspiration) inspiration = pick.inspiration;
    } catch (_) { /* keep local pick */ }
  }

  let layout = HouseLayout.buildFromTemplate(spec, templateId);
  if (!layout) layout = HouseLayout.computeLayout(spec);

  json(res, 200, {
    layout: layout,
    concept: concept,
    inspiration: inspiration,
    templateId: templateId,
    researchQuery: research.query,
    researchHits: research.hits.length,
    researchEngine: research.engine,
    source: layout.planSource === 'template' ? 'pro-template' : 'built-in',
    planModel: PLAN_MODEL
  });
}

/* Free CC0 material textures (Poly Haven, no key) proxied so the browser can
 * load them same-origin and map them onto the 3D house. Falls back silently. */
const TEX_SLUGS = { wood:'wood_floor', tile:'floor_tiles_06', brick:'red_brick_03', plaster:'beige_wall_001', siding:'wood_planks', shingle:'roof_tiles', concrete:'concrete_floor_02', marble:'marble_01', carpet:'carpet', grass:'aerial_grass_rock' };
async function texture(res, name) {
  const slug = TEX_SLUGS[name];
  if (!slug) { res.writeHead(404); return res.end('unknown texture'); }
  try {
    const fr = await fetch('https://api.polyhaven.com/files/' + slug, { headers: { Accept: 'application/json' } });
    if (!fr.ok) throw new Error('polyhaven ' + fr.status);
    const files = await fr.json();
    const diff = files.Diffuse || files.diffuse || files.Color || files.col || files.albedo;
    const r1 = diff && (diff['1k'] || diff['2k'] || diff[Object.keys(diff)[0]]);
    const fm = r1 && (r1.jpg || r1.png || r1[Object.keys(r1)[0]]);
    const url = fm && fm.url;
    if (!url) throw new Error('no diffuse url');
    const ir = await fetch(url);
    if (!ir.ok) throw new Error('img ' + ir.status);
    const buf = Buffer.from(await ir.arrayBuffer());
    res.writeHead(200, { 'Content-Type': ir.headers.get('content-type') || 'image/jpeg', 'Cache-Control': 'public, max-age=604800' });
    res.end(buf);
  } catch (e) { res.writeHead(502); res.end('texture proxy failed: ' + String(e.message || e)); }
}

function serveStatic(req, res) {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(PUBLIC, p));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' }); res.end(buf);
  });
}

http.createServer(async (req, res) => {
  let u; try { u = new URL(req.url, 'http://localhost'); } catch (_) { res.writeHead(400); return res.end('Bad request'); }
  if (req.method === 'GET' && u.pathname === '/api/ai/status') return json(res, 200, {
    openai: !!key(), textModel: TEXT_MODEL, planModel: PLAN_MODEL, imageModel: IMAGE_MODEL,
    webSearch: 'duckduckgo-free', braveSearch: !!process.env.BRAVE_SEARCH_API_KEY,
    aiFloorPlans: true, templates: PlanTemplates.listTemplates().length
  });
  if (req.method === 'GET' && u.pathname === '/api/ai/diagnose') return diagnose(res);
  if (req.method === 'GET' && u.pathname === '/api/plan-research') return planResearch(res, {
    plotW: +(u.searchParams.get('plotW') || 18), plotD: +(u.searchParams.get('plotD') || 14),
    floors: +(u.searchParams.get('floors') || 2), bedrooms: +(u.searchParams.get('bedrooms') || 3),
    bathrooms: +(u.searchParams.get('bathrooms') || 2), kitchens: +(u.searchParams.get('kitchens') || 1),
    living: +(u.searchParams.get('living') || 1), dining: u.searchParams.get('dining') !== '0',
    garage: u.searchParams.get('garage') !== '0', style: (u.searchParams.get('style') || 'modern').slice(0, 40)
  });
  if (req.method === 'POST' && u.pathname === '/api/ai/design-brief') return designBrief(res, await readBody(req));
  if (req.method === 'POST' && u.pathname === '/api/ai/floor-plan') return aiFloorPlan(res, await readBody(req));
  if (req.method === 'POST' && u.pathname === '/api/ai/render') return render(res, await readBody(req));
  if (req.method === 'GET' && u.pathname === '/api/reference-images') return referenceImages(res, (u.searchParams.get('q') || 'house interior').slice(0, 120));
  if (req.method === 'GET' && u.pathname === '/api/texture') return texture(res, (u.searchParams.get('name') || '').slice(0, 20));
  serveStatic(req, res);
}).listen(PORT, () => console.log('\n  ForthHome AI House Designer:  http://localhost:' + PORT +
  '\n  OpenAI: ' + (key() ? ('key present — plans ' + PLAN_MODEL + ', text ' + TEXT_MODEL + ', images ' + IMAGE_MODEL) : 'NOT configured') +
  '\n  Floor templates: ' + PlanTemplates.listTemplates().length + ' pro layouts loaded\n'))
  .on('error', function (e) {
    if (e.code === 'EADDRINUSE') {
      console.error('\n  Port ' + PORT + ' is already in use — ForthHome is probably ALREADY running.' +
        '\n  - Easiest: just open  http://localhost:' + PORT + '  in your browser.' +
        '\n  - Or stop the other server (press Ctrl+C in its terminal window), then start again.' +
        '\n  - Or run on a different port:' +
        '\n      Windows:    set PORT=3001 && npm start' +
        '\n      Mac/Linux:  PORT=3001 npm start\n');
      process.exit(1);
    } else { throw e; }
  });
