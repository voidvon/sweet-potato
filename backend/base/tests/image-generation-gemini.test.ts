import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveGeminiImageConfig,
  resolveImageGenerationProviderAdapter,
} from '../src/modules/chat/capabilities/image-generation.provider-adapter.js';
import { googleGeminiImagesProvider } from '../src/modules/image-models/providers/google-gemini-images.js';
import type { AiModelConfig } from '../src/modules/model-configs/model-config.types.js';
import { createUser } from '../src/modules/users/user.service.js';

function geminiModelConfig(model: string): AiModelConfig {
  return {
    id: `gemini-test-${model}`,
    type: 'image',
    name: model,
    provider: 'google-gemini-images',
    model,
    apiKey: 'test-key',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    temperature: 0.7,
    settings: {
      imageGeneration: {
        adapter: 'gemini',
        supportsCustomResolution: true,
      },
    },
    isDefault: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

test('gemini image provider registers both stable 3.1 flash image models', () => {
  assert.equal(
    (googleGeminiImagesProvider.defaultSettings?.imageGeneration as { supportsCustomResolution?: boolean })?.supportsCustomResolution,
    true,
  );
  assert.ok(googleGeminiImagesProvider.models.some((model) => model.id === 'gemini-3.1-flash-image'));
  assert.ok(googleGeminiImagesProvider.models.some((model) => model.id === 'gemini-3.1-flash-lite-image'));
});

test('gemini image config enforces model-specific resolution support', () => {
  assert.deepEqual(
    resolveGeminiImageConfig('gemini-3.1-flash-image', '4K', '16:9'),
    { aspectRatio: '16:9', imageSize: '4K' },
  );
  assert.deepEqual(
    resolveGeminiImageConfig('gemini-3.1-flash-lite-image', '4K', '9:16'),
    { aspectRatio: '9:16', imageSize: '1K' },
  );
  assert.deepEqual(
    resolveGeminiImageConfig('gemini-3.1-flash-image', '1K', 'auto'),
    { imageSize: '1K' },
  );
});

test('gemini generateContent request sends imageConfig', async () => {
  const originalFetch = globalThis.fetch;
  const user = createUser(`gemini-image-${Date.now()}`, 'password123', 'Gemini Image User');
  let capturedBody: Record<string, unknown> | null = null;

  try {
    globalThis.fetch = (async (_url, init) => {
      capturedBody = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>;
      return new Response(JSON.stringify({
        candidates: [{
          content: {
            parts: [{
              inlineData: {
                mimeType: 'image/png',
                data: Buffer.from('gemini-image').toString('base64'),
              },
            }],
          },
        }],
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    const config = geminiModelConfig('gemini-3.1-flash-image');
    const adapter = resolveImageGenerationProviderAdapter(config);
    await adapter.generate({
      modelConfig: config,
      outputAspectRatio: '16:9',
      outputCount: 1,
      outputResolution: '4K',
      prompt: '生成一张横向海报',
      referenceAssets: [],
      sourceIdPrefix: 'gemini-image-config',
      userId: user.id,
    });

    const generationConfig = capturedBody?.generationConfig as Record<string, unknown> | undefined;
    assert.deepEqual(generationConfig?.responseModalities, ['TEXT', 'IMAGE']);
    assert.deepEqual(generationConfig?.imageConfig, { aspectRatio: '16:9', imageSize: '4K' });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
