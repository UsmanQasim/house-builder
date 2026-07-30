/* Provider selection: text vs image routing with different key combinations. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { getTextProvider, getImageProvider, OpenAIProvider, GeminiProvider } from '../build/server/providers.js';
import { boundedPositiveInteger, parseImageReference, readResponseBuffer, resolvePathWithin } from '../build/server/net.js';
import { isValidFurnitureGLB, normalizeFurnitureType } from '../build/server/model3d.js';

const ENV_KEYS = ['OPENAI_API_KEY', 'GEMINI_API_KEY', 'IMAGE_PROVIDER', 'AI_OFFLINE', 'OPENAI_REASONING_EFFORT'];

function withEnv(env, fn) {
  const saved = {};
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  Object.assign(process.env, env);
  try { return fn(); } finally {
    for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
}

async function withAsyncEnv(env, fn) {
  const saved = {};
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  Object.assign(process.env, env);
  try { return await fn(); } finally {
    for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
}

test('both keys: OpenAI does text, Nano Banana Pro does images', () => {
  withEnv({ OPENAI_API_KEY: 'x', GEMINI_API_KEY: 'y' }, () => {
    assert.equal(getTextProvider().id, 'openai');
    assert.equal(getImageProvider().id, 'gemini');
  });
});

test('IMAGE_PROVIDER env overrides image selection', () => {
  withEnv({ OPENAI_API_KEY: 'x', GEMINI_API_KEY: 'y', IMAGE_PROVIDER: 'openai' }, () => {
    assert.equal(getImageProvider().id, 'openai');
  });
});

test('gemini-only: gemini handles both', () => {
  withEnv({ GEMINI_API_KEY: 'y' }, () => {
    assert.equal(getTextProvider().id, 'gemini');
    assert.equal(getImageProvider().id, 'gemini');
  });
});

test('openai-only: openai handles both', () => {
  withEnv({ OPENAI_API_KEY: 'x' }, () => {
    assert.equal(getTextProvider().id, 'openai');
    assert.equal(getImageProvider().id, 'openai');
  });
});

test('no keys: providers report unavailable', () => {
  withEnv({}, () => {
    assert.equal(OpenAIProvider.available(), false);
    assert.equal(GeminiProvider.available(), false);
  });
});

test('GPT-5.6 chat payload uses supported reasoning parameters and a bounded budget', async () => {
  const originalFetch = globalThis.fetch;
  let payload;
  try {
    await withAsyncEnv({ OPENAI_API_KEY: 'test-openai-key', OPENAI_REASONING_EFFORT: 'not-valid' }, async () => {
      globalThis.fetch = async (_input, init) => {
        payload = JSON.parse(String(init.body));
        return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }), {
          status: 200, headers: { 'content-type': 'application/json' }
        });
      };
      const result = await OpenAIProvider.chatJSON({
        model: 'gpt-5.6-sol', temperature: 0.9, maxTokens: 3800,
        messages: [{ role: 'user', content: 'Return JSON.' }]
      });
      assert.deepEqual(result, { ok: true });
    });
  } finally { globalThis.fetch = originalFetch; }
  assert.equal(payload.reasoning_effort, 'medium');
  assert.equal(payload.max_completion_tokens, 8000);
  assert.equal(payload.temperature, undefined);
  assert.equal(payload.max_tokens, undefined);
});

test('image references require real bounded PNG/JPEG/WebP data', () => {
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2Z5sAAAAASUVORK5CYII=';
  const parsed = parseImageReference({ b64: png, type: 'image/png' });
  assert.equal(parsed?.type, 'image/png');
  assert.equal(parseImageReference({ b64: Buffer.alloc(64, 7).toString('base64'), type: 'image/png' }), null);
  assert.equal(parseImageReference({ b64: png, type: 'text/html' }), null);
});

test('server utility guards reject traversal, invalid limits, and oversized streams', async () => {
  const root = path.resolve('dist');
  assert.equal(resolvePathWithin(root, '/assets/app.js'), path.join(root, 'assets', 'app.js'));
  assert.equal(resolvePathWithin(root, '../.env'), null);
  assert.equal(resolvePathWithin(root, '..\\.env'), null);
  assert.equal(resolvePathWithin(root, '/bad\0path'), null);
  assert.equal(boundedPositiveInteger('not-a-number', 30, 1, 100), 30);
  await assert.rejects(() => readResponseBuffer(new Response(Buffer.alloc(32)), 16), /size limit/);
});

test('furniture allowlist is strict and downloaded GLBs need a valid bounded header', () => {
  assert.equal(normalizeFurnitureType(' Coffee Table '), 'coffee table');
  assert.equal(normalizeFurnitureType('../../bed'), null);
  const glb = Buffer.alloc(12);
  glb.write('glTF', 0, 'ascii');
  glb.writeUInt32LE(2, 4);
  glb.writeUInt32LE(glb.length, 8);
  assert.equal(isValidFurnitureGLB(glb), true);
  glb.writeUInt32LE(999, 8);
  assert.equal(isValidFurnitureGLB(glb), false);
});
