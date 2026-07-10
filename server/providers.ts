/* AI provider abstraction (server-side only — keys never reach the browser).
 *
 * Providers:
 *   - openai  : GPT-4o text/JSON + gpt-image-1 images
 *   - gemini  : Gemini text/JSON + Nano Banana Pro (gemini-3-pro-image-preview) images
 * Selection:
 *   - text/plan reasoning : getTextProvider()  — OpenAI preferred, Gemini fallback
 *   - image generation    : getImageProvider() — IMAGE_PROVIDER env wins; else Nano
 *                           Banana Pro when GEMINI_API_KEY is set; else OpenAI.
 * Add another provider: implement Provider, register in PROVIDERS. */

export interface ChatMessagePart { type: string; text?: string; image_url?: { url: string }; }
export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string | ChatMessagePart[]; }
export interface ChatOptions { model?: string; messages: ChatMessage[]; temperature?: number; maxTokens?: number; }
export interface ImageOptions { prompt: string; size?: string; quality?: string; references?: { b64: string; type?: string }[]; }
export interface Diagnosis { ok: boolean; stage?: string; keyValid?: boolean; textModelAvailable?: boolean; imageModelAvailable?: boolean; imageModel?: string; message: string; }

export interface Provider {
  id: string;
  available(): boolean;
  diagnose(): Promise<Diagnosis>;
  chatJSON<T = Record<string, unknown>>(opts: ChatOptions): Promise<T>;
  generateImage(opts: ImageOptions): Promise<{ b64: string | null; url: string | null }>;
}

const OPENAI_TEXT_MODEL = () => process.env.OPENAI_TEXT_MODEL || 'gpt-4o';
const OPENAI_PLAN_MODEL = () => process.env.OPENAI_PLAN_MODEL || 'gpt-4o';
const OPENAI_IMAGE_MODEL = () => process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1';
const openaiKey = () => process.env.OPENAI_API_KEY;

const GEMINI_TEXT_MODEL = () => process.env.GEMINI_TEXT_MODEL || 'gemini-2.5-flash';
const GEMINI_IMAGE_MODEL = () => process.env.GEMINI_IMAGE_MODEL || 'gemini-3-pro-image-preview'; // Nano Banana Pro
const geminiKey = () => process.env.GEMINI_API_KEY;
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

/* ------------------------------ retry helper ------------------------------ */
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
export interface ApiError extends Error { status?: number; hint?: string; }

export async function withRetry<T>(fn: () => Promise<T>, opts: { retries?: number; base?: number } = {}): Promise<T> {
  const { retries = 2, base = 900 } = opts;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try { return await fn(); }
    catch (e) {
      lastErr = e;
      const status = (e as ApiError).status;
      const retriable = !status || status === 429 || status >= 500;
      if (!retriable || attempt === retries) throw e;
      await sleep(base * Math.pow(2, attempt) + Math.random() * 250);
    }
  }
  throw lastErr;
}

function apiError(message: string, status: number, hint?: string): ApiError {
  const e = new Error(message) as ApiError;
  e.status = status;
  if (hint) e.hint = hint;
  else if (status === 429) e.hint = 'Rate limited — the request was retried automatically. Wait a minute and try again.';
  return e;
}

function multipart(fields: Record<string, string>, files: { name: string; filename: string; type: string; buffer: Buffer }[]): { contentType: string; body: Buffer } {
  const b = '----forthhome' + Date.now(), parts: Buffer[] = [];
  for (const k in fields) parts.push(Buffer.from('--' + b + '\r\nContent-Disposition: form-data; name="' + k + '"\r\n\r\n' + fields[k] + '\r\n'));
  files.forEach(f => parts.push(Buffer.concat([
    Buffer.from('--' + b + '\r\nContent-Disposition: form-data; name="' + f.name + '"; filename="' + f.filename + '"\r\nContent-Type: ' + f.type + '\r\n\r\n'),
    f.buffer, Buffer.from('\r\n')])));
  parts.push(Buffer.from('--' + b + '--\r\n'));
  return { contentType: 'multipart/form-data; boundary=' + b, body: Buffer.concat(parts) };
}

/* ================================ OpenAI ================================ */
async function openaiPost(endpoint: string, payload: unknown): Promise<Record<string, unknown>> {
  const r = await fetch('https://api.openai.com/v1/' + endpoint, {
    method: 'POST', headers: { Authorization: 'Bearer ' + openaiKey(), 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
  });
  const data = await r.json().catch(() => ({})) as { error?: { message?: string } };
  if (!r.ok) {
    const m = (data.error && data.error.message) || ('OpenAI HTTP ' + r.status);
    const hint = r.status === 403 && /verif/i.test(m)
      ? 'Your OpenAI organization must be verified to use ' + OPENAI_IMAGE_MODEL() + '. Verify at https://platform.openai.com/settings/organization/general.' : undefined;
    throw apiError(m, r.status, hint);
  }
  return data as Record<string, unknown>;
}

export const OpenAIProvider: Provider = {
  id: 'openai',
  available: () => !!openaiKey(),

  async diagnose(): Promise<Diagnosis> {
    if (!openaiKey()) return { ok: false, stage: 'key', message: 'No OPENAI_API_KEY found in .env. Add it and restart the server.' };
    try {
      const r = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: 'Bearer ' + openaiKey() } });
      const data = await r.json().catch(() => ({})) as { data?: { id: string }[]; error?: { message?: string } };
      if (!r.ok) {
        const m = (data.error && data.error.message) || ('HTTP ' + r.status);
        return { ok: false, stage: 'auth', message: r.status === 401 ? 'Your OpenAI API key is invalid or revoked. Create a new one at platform.openai.com/api-keys.' : m };
      }
      const ids = (data.data || []).map(x => x.id);
      const hasImg = ids.includes(OPENAI_IMAGE_MODEL());
      return { ok: hasImg, keyValid: true, imageModelAvailable: hasImg, imageModel: OPENAI_IMAGE_MODEL(),
        message: hasImg ? 'OpenAI key valid. ' + OPENAI_IMAGE_MODEL() + ' available — renders should work.'
          : 'OpenAI key valid, but ' + OPENAI_IMAGE_MODEL() + ' is NOT enabled for this org (verify your organization). Floor plans and schemes still work. Tip: add GEMINI_API_KEY to use Nano Banana Pro for images instead.' };
    } catch (e) { return { ok: false, stage: 'network', message: String((e as Error).message || e) }; }
  },

  async chatJSON<T>(opts: ChatOptions): Promise<T> {
    const payload: Record<string, unknown> = {
      model: opts.model || OPENAI_PLAN_MODEL(),
      temperature: opts.temperature ?? 0.3,
      response_format: { type: 'json_object' },
      messages: opts.messages
    };
    if (opts.maxTokens) payload.max_tokens = opts.maxTokens;
    const data = await withRetry(() => openaiPost('chat/completions', payload));
    const choices = data.choices as { message: { content: string } }[] | undefined;
    return JSON.parse((choices && choices[0] && choices[0].message.content) || '{}') as T;
  },

  async generateImage(opts: ImageOptions): Promise<{ b64: string | null; url: string | null }> {
    const refs = (opts.references || []).slice(0, 3);
    const size = opts.size || '1024x1024', quality = opts.quality || 'medium';
    const run = async (): Promise<Record<string, unknown>> => {
      if (refs.length) {
        const files = refs.map((r, i) => ({ name: 'image[]', filename: 'ref' + i + '.png', type: r.type || 'image/png', buffer: Buffer.from(r.b64, 'base64') }));
        const mp = multipart({ model: OPENAI_IMAGE_MODEL(), prompt: opts.prompt + ' Use the supplied reference image(s) for style, palette and mood.', size, quality, n: '1' }, files);
        const r = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: 'Bearer ' + openaiKey(), 'Content-Type': mp.contentType }, body: mp.body });
        const data = await r.json().catch(() => ({})) as { error?: { message?: string } };
        if (!r.ok) throw apiError((data.error && data.error.message) || ('OpenAI HTTP ' + r.status), r.status);
        return data as Record<string, unknown>;
      }
      const payload: Record<string, unknown> = { model: OPENAI_IMAGE_MODEL(), prompt: opts.prompt, n: 1, size };
      if (/^gpt-image/.test(OPENAI_IMAGE_MODEL())) payload.quality = quality;
      return openaiPost('images/generations', payload);
    };
    const data = await withRetry(run, { retries: 2 });
    const arr = data.data as { b64_json?: string; url?: string }[] | undefined;
    const d = (arr && arr[0]) || {};
    return { b64: d.b64_json || null, url: d.url || null };
  }
};

/* ============================ Gemini / Nano Banana Pro ============================ */
interface GeminiPart { text?: string; inlineData?: { mimeType: string; data: string }; }

function toGeminiParts(msg: ChatMessage): GeminiPart[] {
  if (typeof msg.content === 'string') return [{ text: msg.content }];
  return msg.content.map(p => {
    if (p.type === 'image_url' && p.image_url) {
      const m = /^data:([^;]+);base64,(.*)$/.exec(p.image_url.url);
      if (m) return { inlineData: { mimeType: m[1], data: m[2] } };
      return { text: '[image: ' + p.image_url.url + ']' };
    }
    return { text: p.text || '' };
  });
}

async function geminiGenerate(model: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const r = await fetch(GEMINI_BASE + '/models/' + model + ':generateContent?key=' + geminiKey(), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  const data = await r.json().catch(() => ({})) as { error?: { message?: string } };
  if (!r.ok) {
    const m = (data.error && data.error.message) || ('Gemini HTTP ' + r.status);
    const hint = r.status === 404 ? 'Model "' + model + '" not found for this key. Set GEMINI_IMAGE_MODEL / GEMINI_TEXT_MODEL in .env to a model your key can access (see ai.google.dev).' : undefined;
    throw apiError(m, r.status, hint);
  }
  return data as Record<string, unknown>;
}

export const GeminiProvider: Provider = {
  id: 'gemini',
  available: () => !!geminiKey(),

  async diagnose(): Promise<Diagnosis> {
    if (!geminiKey()) return { ok: false, stage: 'key', message: 'No GEMINI_API_KEY found in .env. Get one free at aistudio.google.com and restart.' };
    try {
      const r = await fetch(GEMINI_BASE + '/models?key=' + geminiKey() + '&pageSize=200');
      const data = await r.json().catch(() => ({})) as { models?: { name: string }[]; error?: { message?: string } };
      if (!r.ok) return { ok: false, stage: 'auth', message: (data.error && data.error.message) || ('Gemini HTTP ' + r.status) };
      const names = (data.models || []).map(m => m.name.replace(/^models\//, ''));
      const hasImg = names.some(n => n === GEMINI_IMAGE_MODEL());
      return { ok: hasImg, keyValid: true, imageModelAvailable: hasImg, imageModel: GEMINI_IMAGE_MODEL(),
        message: hasImg ? 'Gemini key valid. Nano Banana Pro (' + GEMINI_IMAGE_MODEL() + ') available — image renders enabled.'
          : 'Gemini key valid, but "' + GEMINI_IMAGE_MODEL() + '" is not in your model list. Set GEMINI_IMAGE_MODEL in .env to one of your available image models (e.g. gemini-3-1-flash-image / gemini-2.5-flash-image).' };
    } catch (e) { return { ok: false, stage: 'network', message: String((e as Error).message || e) }; }
  },

  async chatJSON<T>(opts: ChatOptions): Promise<T> {
    // Fold system messages into the first user turn; request strict JSON output.
    const sys = opts.messages.filter(m => m.role === 'system').map(m => typeof m.content === 'string' ? m.content : '').join('\n');
    const contents = opts.messages.filter(m => m.role !== 'system').map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: toGeminiParts(m)
    }));
    if (sys && contents.length && contents[0].role === 'user') contents[0].parts.unshift({ text: '[Instructions]\n' + sys + '\n[End instructions]\n' });
    const body: Record<string, unknown> = {
      contents,
      generationConfig: { temperature: opts.temperature ?? 0.3, responseMimeType: 'application/json', ...(opts.maxTokens ? { maxOutputTokens: opts.maxTokens } : {}) }
    };
    const data = await withRetry(() => geminiGenerate(GEMINI_TEXT_MODEL(), body));
    const cands = data.candidates as { content?: { parts?: GeminiPart[] } }[] | undefined;
    const txt = cands?.[0]?.content?.parts?.map(p => p.text || '').join('') || '{}';
    return JSON.parse(txt) as T;
  },

  /* Nano Banana Pro: text -> image, and reference-conditioned edits (references
   * are passed as inline images; the model preserves what the prompt doesn't change). */
  async generateImage(opts: ImageOptions): Promise<{ b64: string | null; url: string | null }> {
    const parts: GeminiPart[] = [{ text: opts.prompt }];
    (opts.references || []).slice(0, 4).forEach(r => parts.push({ inlineData: { mimeType: r.type || 'image/png', data: r.b64 } }));
    const body: Record<string, unknown> = {
      contents: [{ role: 'user', parts }],
      generationConfig: { responseModalities: ['TEXT', 'IMAGE'] }
    };
    const data = await withRetry(() => geminiGenerate(GEMINI_IMAGE_MODEL(), body), { retries: 2 });
    const cands = data.candidates as { content?: { parts?: GeminiPart[] } }[] | undefined;
    const img = cands?.[0]?.content?.parts?.find(p => p.inlineData && p.inlineData.data);
    if (!img || !img.inlineData) throw apiError('Nano Banana Pro returned no image (the prompt may have been blocked).', 502);
    return { b64: img.inlineData.data, url: null };
  }
};

/* ------------------------------ registry & selection ------------------------------ */
const PROVIDERS: Record<string, Provider> = { openai: OpenAIProvider, gemini: GeminiProvider };

/** Text/JSON reasoning (floor plans, schemes, vision): OpenAI preferred, Gemini fallback. */
export function getTextProvider(): Provider {
  if (OpenAIProvider.available()) return OpenAIProvider;
  if (GeminiProvider.available()) return GeminiProvider;
  return OpenAIProvider;
}
/** Images (photoreal renders, plan renders): IMAGE_PROVIDER env wins; else Nano Banana Pro if configured; else OpenAI. */
export function getImageProvider(): Provider {
  const id = (process.env.IMAGE_PROVIDER || '').toLowerCase();
  if (id && PROVIDERS[id]) return PROVIDERS[id];
  if (GeminiProvider.available()) return GeminiProvider;
  return OpenAIProvider;
}
/** Back-compat alias (text). */
export function getProvider(): Provider { return getTextProvider(); }
export function registerProvider(p: Provider): void { PROVIDERS[p.id] = p; }
