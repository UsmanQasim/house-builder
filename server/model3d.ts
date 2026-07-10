/* Rodin (Hyper3D / Deemos) text-to-3D furniture generation.
 * Docs: https://developer.hyper3d.ai — async task: submit -> poll status -> download GLB.
 * Used by /api/model when a furniture GLB is not in the local cache. Results are
 * cached to public/models so each furniture type is generated at most once. */

const BASE = 'https://api.hyper3d.com/api/v2';
const key = () => process.env.RODIN_API_KEY || process.env.HYPER3D_API_KEY;

export const rodinAvailable = (): boolean => !!key();

/* Furniture prompt tuning: standalone object, real-world scale, no floor/base. */
const PROMPTS: Record<string, string> = {
  bed: 'modern double bed with wooden frame, mattress, pillows and a throw blanket',
  sofa: 'modern 3-seat fabric sofa with cushions',
  'coffee table': 'modern low wooden coffee table',
  wardrobe: 'modern wooden wardrobe closet with two doors',
  chair: 'modern wooden dining chair',
  'dining table': 'modern rectangular wooden dining table',
  refrigerator: 'modern stainless steel refrigerator, double door',
  bathtub: 'modern white ceramic bathtub',
  toilet: 'modern white ceramic toilet',
  'potted plant': 'potted monstera house plant in a ceramic pot',
  car: 'modern family SUV car, neutral gray'
};
const ALLOWED = new Set(Object.keys(PROMPTS));

const inflight = new Map<string, Promise<Buffer | null>>();
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const k in fields) fd.append(k, fields[k]);
  return fd;
}

async function post(path: string, body: FormData | string, jsonBody = false): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = { Authorization: 'Bearer ' + key() };
  if (jsonBody) headers['Content-Type'] = 'application/json';
  const r = await fetch(BASE + path, { method: 'POST', headers, body });
  const data = await r.json().catch(() => ({})) as Record<string, unknown> & { error?: unknown; message?: string };
  if (!r.ok) throw new Error('Rodin ' + path + ' HTTP ' + r.status + (data.message ? ': ' + data.message : ''));
  return data;
}

async function generateOnce(type: string): Promise<Buffer | null> {
  const prompt = PROMPTS[type];
  if (!prompt) return null;
  // 1. submit
  const task = await post('/rodin', form({
    prompt: 'single ' + prompt + ', photorealistic PBR materials, clean standalone object, real-world proportions, no background, no floor, no base',
    geometry_file_format: 'glb',
    material: 'PBR',
    quality: 'medium',
    tier: 'Regular'
  }));
  const uuid = task.uuid as string | undefined;
  const jobs = task.jobs as { subscription_key?: string } | undefined;
  const subKey = jobs && jobs.subscription_key;
  if (!uuid || !subKey) throw new Error('Rodin: unexpected submit response');

  // 2. poll (max ~3 min)
  const deadline = Date.now() + 180_000;
  for (;;) {
    if (Date.now() > deadline) throw new Error('Rodin: generation timed out');
    await sleep(4000);
    const st = await post('/status', JSON.stringify({ subscription_key: subKey }), true);
    const list = (st.jobs as { status: string }[] | undefined) || [];
    if (list.length && list.every(j => j.status === 'Done')) break;
    if (list.some(j => j.status === 'Failed')) throw new Error('Rodin: generation failed');
  }

  // 3. download the GLB
  const dl = await post('/download', JSON.stringify({ task_uuid: uuid }), true);
  const files = (dl.list as { url: string; name: string }[] | undefined) || [];
  const glb = files.find(f => /\.glb$/i.test(f.name)) || files[0];
  if (!glb || !glb.url) throw new Error('Rodin: no GLB in download list');
  const fr = await fetch(glb.url);
  if (!fr.ok) throw new Error('Rodin: GLB fetch HTTP ' + fr.status);
  return Buffer.from(await fr.arrayBuffer());
}

/** Generate a furniture GLB via Rodin. Deduped per type; returns null when
 * unavailable/unknown type so callers can fall through to other sources. */
export function generateFurnitureGLB(type: string): Promise<Buffer | null> {
  const t = type.toLowerCase().trim();
  if (!rodinAvailable() || !ALLOWED.has(t)) return Promise.resolve(null);
  const existing = inflight.get(t);
  if (existing) return existing;
  const p = generateOnce(t)
    .catch(err => { console.error('[rodin]', t, String((err as Error).message)); return null; })
    .finally(() => { inflight.delete(t); });
  inflight.set(t, p);
  return p;
}
