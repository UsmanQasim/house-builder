/* Provider selection: text vs image routing with different key combinations. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getTextProvider, getImageProvider, OpenAIProvider, GeminiProvider } from '../build/server/providers.js';

function withEnv(env, fn) {
  const saved = {};
  for (const k of ['OPENAI_API_KEY', 'GEMINI_API_KEY', 'IMAGE_PROVIDER']) { saved[k] = process.env[k]; delete process.env[k]; }
  Object.assign(process.env, env);
  try { return fn(); } finally {
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
