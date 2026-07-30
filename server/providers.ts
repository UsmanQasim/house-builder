/* AI provider abstraction (server-side only — keys never reach the browser).
 *
 * Providers:
 *   - openai  : GPT-5.6 text/JSON + GPT Image 2 images
 *   - gemini  : Gemini text/JSON + Nano Banana Pro (gemini-3-pro-image) images
 * Selection:
 *   - text/plan reasoning : getTextProvider()  — OpenAI preferred, Gemini fallback
 *   - image generation    : getImageProvider() — IMAGE_PROVIDER env wins; else Nano
 *                           Banana Pro when GEMINI_API_KEY is set; else OpenAI.
 * Add another provider: implement Provider, register in PROVIDERS. */

import { boundedPositiveInteger, fetchWithTimeout, parseImageReference, type ParsedImageReference } from './net.js';

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

const OPENAI_TEXT_MODEL = () => process.env.OPENAI_TEXT_MODEL || 'gpt-5.6-terra';
const OPENAI_PLAN_MODEL = () => process.env.OPENAI_PLAN_MODEL || 'gpt-5.6-sol';
const OPENAI_IMAGE_MODEL = () => process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2';
const openaiKey = () => process.env.OPENAI_API_KEY;
const aiEnabled = () => process.env.AI_OFFLINE !== '1';

const GEMINI_TEXT_MODEL = () => process.env.GEMINI_TEXT_MODEL || 'gemini-2.5-flash';
const GEMINI_IMAGE_MODEL = () => process.env.GEMINI_IMAGE_MODEL || 'gemini-3-pro-image'; // Nano Banana Pro
const geminiKey = () => process.env.GEMINI_API_KEY;
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

function redactSecrets(value: unknown): string {
  let message = String(value || 'Unknown provider error');
  const keys = [
    process.env.OPENAI_API_KEY, process.env.GEMINI_API_KEY, process.env.RODIN_API_KEY,
    process.env.HYPER3D_API_KEY, process.env.POLY_PIZZA_KEY, process.env.BRAVE_SEARCH_API_KEY,
    process.env.UNSPLASH_ACCESS_KEY, process.env.APP_ACCESS_TOKEN
  ].filter((secret): secret is string => typeof secret === 'string' && secret.length >= 6);
  for (const secret of keys) message = message.split(secret).join('[redacted]');
  return message.replace(/([?&]key=)[^&\s"']+/gi, '$1[redacted]').replace(/Bearer\s+[^\s,"']+/gi, 'Bearer [redacted]').slice(0, 1200);
}

function imageReferences(values: ImageOptions['references'], max: number): ParsedImageReference[] {
  const result: ParsedImageReference[] = [];
  for (const value of values || []) {
    const parsed = parseImageReference(value);
    if (parsed) result.push(parsed);
    if (result.length >= max) break;
  }
  return result;
}

const REASONING_EFFORTS = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
function reasoningEffort(model: string): string {
  const configured = String(process.env.OPENAI_REASONING_EFFORT || 'medium').trim().toLowerCase();
  if (!REASONING_EFFORTS.has(configured)) return 'medium';
  // GPT-5.6 supports none/low/medium/high/xhigh/max; "minimal" belongs to
  // earlier GPT-5 variants and is rejected by the 5.6 family.
  if (/^gpt-5\.6(?:-|$)/.test(model) && configured === 'minimal') return 'medium';
  return configured;
}

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
  const e = new Error(redactSecrets(message)) as ApiError;
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
  const r = await fetchWithTimeout('https://api.openai.com/v1/' + endpoint, {
    method: 'POST', headers: { Authorization: 'Bearer ' + openaiKey(), 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
  }, 120_000);
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
  available: () => aiEnabled() && !!openaiKey(),

  async diagnose(): Promise<Diagnosis> {
    if (!aiEnabled()) return { ok: false, stage: 'disabled', message: 'AI calls are disabled by AI_OFFLINE=1. The validated local planner remains available.' };
    if (!openaiKey()) return { ok: false, stage: 'key', message: 'No OPENAI_API_KEY found in .env. Add it and restart the server.' };
    try {
      const r = await fetchWithTimeout('https://api.openai.com/v1/models', { headers: { Authorization: 'Bearer ' + openaiKey() } });
      const data = await r.json().catch(() => ({})) as { data?: { id: string }[]; error?: { message?: string } };
      if (!r.ok) {
        const m = redactSecrets((data.error && data.error.message) || ('HTTP ' + r.status));
        return { ok: false, stage: 'auth', message: r.status === 401 ? 'Your OpenAI API key is invalid or revoked. Create a new one at platform.openai.com/api-keys.' : m };
      }
      const ids = (data.data || []).map(x => x.id);
      const textModel = OPENAI_PLAN_MODEL();
      const hasText = ids.includes(textModel) || ids.includes(textModel.replace(/-sol$/, ''));
      const hasImg = ids.includes(OPENAI_IMAGE_MODEL());
      return { ok: hasText && hasImg, keyValid: true, textModelAvailable: hasText, imageModelAvailable: hasImg, imageModel: OPENAI_IMAGE_MODEL(),
        message: 'OpenAI key valid. Plans: ' + (hasText ? textModel + ' ready' : textModel + ' unavailable') +
          '. Renders: ' + (hasImg ? OPENAI_IMAGE_MODEL() + ' ready.' : OPENAI_IMAGE_MODEL() + ' unavailable for this project.') };
    } catch (e) { return { ok: false, stage: 'network', message: redactSecrets((e as Error).message || e) }; }
  },

  async chatJSON<T>(opts: ChatOptions): Promise<T> {
    const model = opts.model || OPENAI_PLAN_MODEL();
    const isReasoningModel = /^gpt-5(?:\.|-|$)/.test(model);
    const payload: Record<string, unknown> = {
      model,
      response_format: { type: 'json_object' },
      messages: opts.messages
    };
    if (isReasoningModel) {
      payload.reasoning_effort = reasoningEffort(model);
      if (opts.maxTokens !== undefined) payload.max_completion_tokens = Math.max(boundedPositiveInteger(opts.maxTokens, 4000, 1, 128_000), 8000);
    } else {
      payload.temperature = opts.temperature ?? 0.3;
      if (opts.maxTokens !== undefined) payload.max_tokens = boundedPositiveInteger(opts.maxTokens, 4000, 1, 128_000);
    }
    const data = await withRetry(() => openaiPost('chat/completions', payload));
    const choices = data.choices as { message: { content: string } }[] | undefined;
    return JSON.parse((choices && choices[0] && choices[0].message.content) || '{}') as T;
  },

  async generateImage(opts: ImageOptions): Promise<{ b64: string | null; url: string | null }> {
    const refs = imageReferences(opts.references, 3);
    const size = opts.size || '1024x1024', quality = opts.quality || 'medium';
    const run = async (): Promise<Record<string, unknown>> => {
      if (refs.length) {
        const files = refs.map((r, i) => ({
          name: 'image[]',
          filename: 'ref' + i + (r.type === 'image/jpeg' ? '.jpg' : r.type === 'image/webp' ? '.webp' : '.png'),
          type: r.type,
          buffer: Buffer.from(r.b64, 'base64')
        }));
        const mp = multipart({ model: OPENAI_IMAGE_MODEL(), prompt: opts.prompt, size, quality, n: '1' }, files);
        const r = await fetchWithTimeout('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: 'Bearer ' + openaiKey(), 'Content-Type': mp.contentType }, body: mp.body }, 120_000);
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
  const r = await fetchWithTimeout(GEMINI_BASE + '/models/' + encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(geminiKey() || ''), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  }, 120_000);
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
  available: () => aiEnabled() && !!geminiKey(),

  async diagnose(): Promise<Diagnosis> {
    if (!aiEnabled()) return { ok: false, stage: 'disabled', message: 'AI calls are disabled by AI_OFFLINE=1. The validated local planner remains available.' };
    if (!geminiKey()) return { ok: false, stage: 'key', message: 'No GEMINI_API_KEY found in .env. Get one free at aistudio.google.com and restart.' };
    try {
      const r = await fetchWithTimeout(GEMINI_BASE + '/models?key=' + encodeURIComponent(geminiKey() || '') + '&pageSize=200');
      const data = await r.json().catch(() => ({})) as { models?: { name: string }[]; error?: { message?: string } };
      if (!r.ok) return { ok: false, stage: 'auth', message: redactSecrets((data.error && data.error.message) || ('Gemini HTTP ' + r.status)) };
      const names = (data.models || []).map(m => m.name.replace(/^models\//, ''));
      const hasImg = names.some(n => n === GEMINI_IMAGE_MODEL());
      const hasText = names.some(n => n === GEMINI_TEXT_MODEL());
      return { ok: hasImg && hasText, keyValid: true, textModelAvailable: hasText, imageModelAvailable: hasImg, imageModel: GEMINI_IMAGE_MODEL(),
        message: hasImg && hasText
          ? 'Gemini key valid. Nano Banana Pro (' + GEMINI_IMAGE_MODEL() + ') and text model ' + GEMINI_TEXT_MODEL() + ' are available.'
          : 'Gemini key valid, but unavailable model(s): ' + [!hasImg && GEMINI_IMAGE_MODEL(), !hasText && GEMINI_TEXT_MODEL()].filter(Boolean).join(', ') + '. Set GEMINI_IMAGE_MODEL / GEMINI_TEXT_MODEL in .env to models listed for this key.' };
    } catch (e) { return { ok: false, stage: 'network', message: redactSecrets((e as Error).message || e) }; }
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
    imageReferences(opts.references, 4).forEach(r => parts.push({ inlineData: { mimeType: r.type, data: r.b64 } }));
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
