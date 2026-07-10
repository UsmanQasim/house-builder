/* AI image/text provider abstraction (server-side only — keys never reach the browser).
 *
 * To add a provider (e.g. Higgsfield, Stability, Replicate):
 *   1. Implement the interface below: { id, available(), diagnose(), chatJSON(), generateImage() }
 *   2. Register it in PROVIDERS.
 *   3. Select it with IMAGE_PROVIDER=<id> in .env.
 *
 * generateImage({ prompt, size, quality, references }) -> { b64?, url? }
 *   references: [{ b64, type }] conditioning images (may be ignored by providers
 *   without an image-edit endpoint; the prompt still carries the style intent).
 */

const TEXT_MODEL = () => process.env.OPENAI_TEXT_MODEL || 'gpt-4o';
const PLAN_MODEL = () => process.env.OPENAI_PLAN_MODEL || 'gpt-4o';
const IMAGE_MODEL = () => process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1';
const key = () => process.env.OPENAI_API_KEY;

/* ------------------------------ retry helper ------------------------------ */
const sleep = ms => new Promise(r => setTimeout(r, ms));
export async function withRetry(fn, { retries = 2, base = 900 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try { return await fn(); }
    catch (e) {
      lastErr = e;
      const retriable = !e.status || e.status === 429 || e.status >= 500;
      if (!retriable || attempt === retries) throw e;
      await sleep(base * Math.pow(2, attempt) + Math.random() * 250);
    }
  }
  throw lastErr;
}

function apiError(data, status, imageModel) {
  const m = (data && data.error && data.error.message) || ('Provider HTTP ' + status);
  const e = new Error(m); e.status = status;
  if (status === 403 && /verif/i.test(m)) e.hint = 'Your OpenAI organization must be verified to use ' + imageModel + '. Verify at https://platform.openai.com/settings/organization/general , wait, create a fresh key, and restart.';
  if (status === 429) e.hint = 'Rate limited — the request was retried automatically. Wait a minute and try again.';
  return e;
}

/* multipart/form-data builder for reference-guided image edits */
function multipart(fields, files) {
  const b = '----forthhome' + Date.now(), parts = [];
  for (const k in fields) parts.push(Buffer.from('--' + b + '\r\nContent-Disposition: form-data; name="' + k + '"\r\n\r\n' + fields[k] + '\r\n'));
  files.forEach(f => parts.push(Buffer.concat([
    Buffer.from('--' + b + '\r\nContent-Disposition: form-data; name="' + f.name + '"; filename="' + f.filename + '"\r\nContent-Type: ' + f.type + '\r\n\r\n'),
    f.buffer, Buffer.from('\r\n')])));
  parts.push(Buffer.from('--' + b + '--\r\n'));
  return { contentType: 'multipart/form-data; boundary=' + b, body: Buffer.concat(parts) };
}

/* ------------------------------ OpenAI provider ------------------------------ */
export const OpenAIProvider = {
  id: 'openai',
  available: () => !!key(),
  models: () => ({ text: TEXT_MODEL(), plan: PLAN_MODEL(), image: IMAGE_MODEL() }),

  async _postJSON(endpoint, payload) {
    const r = await fetch('https://api.openai.com/v1/' + endpoint, {
      method: 'POST', headers: { Authorization: 'Bearer ' + key(), 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw apiError(data, r.status, IMAGE_MODEL());
    return data;
  },

  async diagnose() {
    if (!key()) return { ok: false, stage: 'key', message: 'No OPENAI_API_KEY found in .env. Add it and restart the server.' };
    try {
      const r = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: 'Bearer ' + key() } });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        const m = (data.error && data.error.message) || ('HTTP ' + r.status);
        return { ok: false, stage: 'auth', message: r.status === 401 ? 'Your API key is invalid or revoked. Create a new one at platform.openai.com/api-keys.' : m };
      }
      const ids = (data.data || []).map(x => x.id);
      const hasImg = ids.includes(IMAGE_MODEL()), hasTxt = ids.includes(TEXT_MODEL());
      return { ok: hasImg, keyValid: true, textModelAvailable: hasTxt, imageModelAvailable: hasImg, imageModel: IMAGE_MODEL(),
        message: hasImg ? ('Key valid. ' + IMAGE_MODEL() + ' is available — renders should work.')
          : ('Key is valid, but ' + IMAGE_MODEL() + ' is NOT enabled for this org. Verify your organization at https://platform.openai.com/settings/organization/general (this is the usual cause of failed renders). Design-scheme text should still work.') };
    } catch (e) { return { ok: false, stage: 'network', message: String(e.message || e) }; }
  },

  /* JSON-mode chat completion. messages: standard chat array (may include image_url parts). */
  async chatJSON({ model, messages, temperature = 0.3, maxTokens }) {
    const payload = { model: model || PLAN_MODEL(), temperature, response_format: { type: 'json_object' }, messages };
    if (maxTokens) payload.max_tokens = maxTokens;
    const data = await withRetry(() => this._postJSON('chat/completions', payload));
    return JSON.parse((data.choices && data.choices[0] && data.choices[0].message.content) || '{}');
  },

  async generateImage({ prompt, size = '1024x1024', quality = 'medium', references = [] }) {
    const refs = (references || []).slice(0, 3);
    const run = async () => {
      if (refs.length) {
        const files = refs.map((r, i) => ({ name: 'image[]', filename: 'ref' + i + '.png', type: r.type || 'image/png', buffer: Buffer.from(r.b64, 'base64') }));
        const mp = multipart({ model: IMAGE_MODEL(), prompt: prompt + ' Use the supplied reference image(s) for style, palette and mood.', size, quality, n: '1' }, files);
        const r = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: 'Bearer ' + key(), 'Content-Type': mp.contentType }, body: mp.body });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw apiError(data, r.status, IMAGE_MODEL());
        return data;
      }
      const payload = { model: IMAGE_MODEL(), prompt, n: 1, size };
      if (/^gpt-image/.test(IMAGE_MODEL())) payload.quality = quality;
      return this._postJSON('images/generations', payload);
    };
    const data = await withRetry(run, { retries: 2 });
    const d = (data.data && data.data[0]) || {};
    return { b64: d.b64_json || null, url: d.url || null };
  }
};

/* ------------------------------ registry ------------------------------ */
const PROVIDERS = { openai: OpenAIProvider };

export function getProvider() {
  const id = (process.env.IMAGE_PROVIDER || 'openai').toLowerCase();
  return PROVIDERS[id] || OpenAIProvider;
}
export function registerProvider(p) { PROVIDERS[p.id] = p; }
