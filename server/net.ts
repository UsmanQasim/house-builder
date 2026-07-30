import path from 'node:path';

/** Parse an integer configuration value without allowing NaN/Infinity to
 * silently disable a guard. */
export function boundedPositiveInteger(
  value: unknown,
  fallback: number,
  min = 1,
  max = Number.MAX_SAFE_INTEGER
): number {
  const lower = Number.isFinite(min) ? Math.trunc(min) : 1;
  const upper = Math.max(lower, Number.isFinite(max) ? Math.trunc(max) : Number.MAX_SAFE_INTEGER);
  const safeFallback = Math.min(upper, Math.max(lower, Number.isFinite(fallback) ? Math.trunc(fallback) : lower));
  if (value === undefined || value === null || String(value).trim() === '') return safeFallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return safeFallback;
  return Math.min(upper, Math.max(lower, Math.trunc(parsed)));
}

function combineSignals(signals: AbortSignal[]): AbortSignal {
  const nativeAny = (AbortSignal as unknown as { any?: (values: AbortSignal[]) => AbortSignal }).any;
  if (typeof nativeAny === 'function') return nativeAny.call(AbortSignal, signals);

  // AbortSignal.any landed after AbortSignal.timeout in Node. Keep the server
  // compatible with older supported Node 18 releases while retaining both the
  // caller's cancellation and our timeout.
  const controller = new AbortController();
  const listeners: Array<[AbortSignal, () => void]> = [];
  const cleanup = (): void => listeners.splice(0).forEach(([signal, listener]) => signal.removeEventListener('abort', listener));
  const abortFrom = (signal: AbortSignal): void => {
    if (!controller.signal.aborted) controller.abort(signal.reason);
    cleanup();
  };
  for (const signal of signals) {
    if (signal.aborted) { abortFrom(signal); break; }
    const listener = () => abortFrom(signal);
    listeners.push([signal, listener]);
    signal.addEventListener('abort', listener, { once: true });
  }
  return controller.signal;
}

/** Network helper for third-party APIs. A stalled provider must never pin a
 * request forever in the demo server. */
export function fetchWithTimeout(
  input: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1] = {},
  timeoutMs = 35_000
): ReturnType<typeof fetch> {
  const options = init || {};
  const timeoutSignal = AbortSignal.timeout(boundedPositiveInteger(timeoutMs, 35_000, 1, 10 * 60_000));
  const signal = options.signal ? combineSignals([options.signal, timeoutSignal]) : timeoutSignal;
  return fetch(input, { ...options, signal });
}

export const MAX_IMAGE_REFERENCE_BYTES = 6_750_000;
const MAX_IMAGE_REFERENCE_BASE64_CHARS = 9_000_000;
export type ImageMime = 'image/png' | 'image/jpeg' | 'image/webp';
export interface ParsedImageReference { b64: string; type: ImageMime; }

function normalizeImageMime(value: unknown): ImageMime | null {
  const type = String(value || '').trim().toLowerCase();
  if (type === 'image/jpg') return 'image/jpeg';
  return type === 'image/png' || type === 'image/jpeg' || type === 'image/webp' ? type : null;
}

function detectImageMime(bytes: Buffer): ImageMime | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

/** Accept only real PNG/JPEG/WebP references, with a strict encoded and
 * decoded size ceiling. The detected MIME wins over a harmless mislabel. */
export function parseImageReference(value: unknown, fallbackType: ImageMime = 'image/png'): ParsedImageReference | null {
  let encoded: string;
  let declaredType: unknown = fallbackType;
  if (typeof value === 'string') {
    const match = /^data:([^;,]+);base64,([\s\S]+)$/i.exec(value.trim());
    if (!match) return null;
    declaredType = match[1];
    encoded = match[2];
  } else if (value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'b64')) {
    const candidate = value as { b64?: unknown; type?: unknown };
    if (typeof candidate.b64 !== 'string') return null;
    encoded = candidate.b64;
    declaredType = candidate.type === undefined ? fallbackType : candidate.type;
  } else return null;

  if (!normalizeImageMime(declaredType)) return null;
  const compact = encoded.replace(/\s+/g, '');
  if (compact.length <= 32 || compact.length >= MAX_IMAGE_REFERENCE_BASE64_CHARS) return null;
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(compact)) return null;
  const unpadded = compact.replace(/=+$/, '');
  if (unpadded.length % 4 === 1) return null;
  const canonical = unpadded + '='.repeat((4 - (unpadded.length % 4)) % 4);
  const bytes = Buffer.from(canonical, 'base64');
  if (!bytes.length || bytes.length > MAX_IMAGE_REFERENCE_BYTES) return null;
  if (bytes.toString('base64').replace(/=+$/, '') !== unpadded) return null;
  const detectedType = detectImageMime(bytes);
  return detectedType ? { b64: canonical, type: detectedType } : null;
}

/** Read a remote binary without trusting Content-Length. */
export async function readResponseBuffer(response: Response, maxBytes: number): Promise<Buffer> {
  const limit = boundedPositiveInteger(maxBytes, 1, 1, Number.MAX_SAFE_INTEGER);
  const declaredText = response.headers.get('content-length');
  const declared = declaredText === null ? 0 : Number(declaredText);
  if (Number.isFinite(declared) && declared > limit) throw new Error('asset exceeds size limit');
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    total += part.value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new Error('asset exceeds size limit');
    }
    chunks.push(part.value);
  }
  return Buffer.concat(chunks.map(chunk => Buffer.from(chunk)), total);
}

/** Lexically resolve a request path while keeping it inside one static root. */
export function resolvePathWithin(root: string, requestPath: string): string | null {
  if (/[\u0000-\u001f\u007f]/.test(requestPath)) return null;
  const candidate = path.resolve(root, requestPath.replace(/^[/\\]+/, ''));
  const relative = path.relative(root, candidate);
  if (relative === '') return candidate;
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) return null;
  return candidate;
}
