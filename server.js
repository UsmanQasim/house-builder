/**
 * ForthHome — AI House Designer server (zero dependencies, Node built-ins).
 *
 * Endpoints:
 *   GET  /api/ai/status     -> is a key present + which models are configured
 *   GET  /api/ai/diagnose   -> actually calls OpenAI and reports the real reason
 *                              renders fail (invalid key / org not verified / no model)
 *   POST /api/ai/design-brief -> cohesive palette + per-room interior plan (gpt-4o-mini)
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
const TEXT_MODEL = process.env.OPENAI_TEXT_MODEL || 'gpt-4o-mini';
const IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1';
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
  if (req.method === 'GET' && u.pathname === '/api/ai/status') return json(res, 200, { openai: !!key(), textModel: TEXT_MODEL, imageModel: IMAGE_MODEL });
  if (req.method === 'GET' && u.pathname === '/api/ai/diagnose') return diagnose(res);
  if (req.method === 'POST' && u.pathname === '/api/ai/design-brief') return designBrief(res, await readBody(req));
  if (req.method === 'POST' && u.pathname === '/api/ai/render') return render(res, await readBody(req));
  if (req.method === 'GET' && u.pathname === '/api/reference-images') return referenceImages(res, (u.searchParams.get('q') || 'house interior').slice(0, 120));
  serveStatic(req, res);
}).listen(PORT, () => console.log('\n  ForthHome AI House Designer:  http://localhost:' + PORT + '\n  OpenAI: ' + (key() ? 'key present (' + TEXT_MODEL + ' / ' + IMAGE_MODEL + ')' : 'NOT configured') + '\n'));
