import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { editImageWithJsonReferences } from '../src/modules/content/internals/content-image-assets.js';
import { resolveImageGenerationProviderAdapter } from '../src/modules/chat/capabilities/image-generation.provider-adapter.js';
import { volcengineSeedreamProvider } from '../src/modules/image-models/providers/volcengine-seedream.js';
import { createUser } from '../src/modules/users/user.service.js';

test('volcengine seedream provider defaults to dedicated adapter', () => {
  assert.equal(
    (volcengineSeedreamProvider.defaultSettings?.imageGeneration as { adapter?: string } | undefined)?.adapter,
    'volcengine-seedream',
  );
  assert.equal(volcengineSeedreamProvider.defaultModel, 'doubao-seedream-5-0-lite-260128');
  assert.deepEqual(
    volcengineSeedreamProvider.models.map((item) => item.id),
    ['doubao-seedream-5-0-pro-260628', 'doubao-seedream-5-0-lite-260128'],
  );
});

test('seedream json reference flow sends generations payload with image urls and output options', async () => {
  const originalFetch = globalThis.fetch;
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'seedream-json-ref-'));
  const imageFilePath = path.join(tempDir, 'reference.png');
  const referenceBytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WnSUs8AAAAASUVORK5CYII=',
    'base64',
  );

  let capturedUrl = '';
  let capturedBody: Record<string, unknown> | null = null;

  try {
    await writeFile(imageFilePath, referenceBytes);
    globalThis.fetch = (async (url, init) => {
      capturedUrl = String(url);
      capturedBody = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>;
      return new Response(JSON.stringify({
        data: [{
          b64_json: Buffer.from('generated-image').toString('base64'),
        }],
      }), {
        status: 200,
        headers: {
          'content-type': 'application/json',
        },
      });
    }) as typeof fetch;

    const result = await editImageWithJsonReferences({
      prompt: '保留主体，替换背景为干净白底',
      background: 'white',
      outputCompression: 90,
      outputFormat: 'png',
      modelConfig: {
        id: 'seedream-test',
        type: 'image',
        name: 'Seedream Test',
        provider: 'volcengine-seedream',
        model: 'doubao-seedream-5-0-lite-260128',
        apiKey: 'test-key',
        baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
        temperature: 0.7,
        settings: {},
        isDefault: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      referenceAssets: [{
        filePath: imageFilePath,
        mimeType: 'image/png',
        originalFileName: 'reference.png',
      }],
      size: '2048x2048',
    });

    assert.equal(capturedUrl, 'https://ark.cn-beijing.volces.com/api/v3/images/generations');
    assert.equal(capturedBody?.model, 'doubao-seedream-5-0-lite-260128');
    assert.equal(capturedBody?.prompt, '保留主体，替换背景为干净白底');
    assert.equal(capturedBody?.size, '2048x2048');
    assert.equal(capturedBody?.background, 'white');
    assert.equal(capturedBody?.output_format, 'png');
    assert.equal(capturedBody?.output_compression, 90);
    assert.equal(typeof capturedBody?.image, 'string');
    assert.equal(result.model, 'doubao-seedream-5-0-lite-260128');
    assert.equal(result.mimeType, 'image/png');
    assert.equal(result.buffer.toString(), 'generated-image');
  } finally {
    globalThis.fetch = originalFetch;
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('seedream lite uses sequential image generation for grouped output', async () => {
  const originalFetch = globalThis.fetch;
  let callCount = 0;
  let capturedBody: Record<string, unknown> | null = null;
  const username = `seedream-lite-${Date.now()}`;
  const user = createUser(username, 'password123', 'Seedream Lite User');

  try {
    globalThis.fetch = (async (_url, init) => {
      callCount += 1;
      capturedBody = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>;
      return new Response(JSON.stringify({
        data: [
          { b64_json: Buffer.from('image-1').toString('base64') },
          { b64_json: Buffer.from('image-2').toString('base64') },
          { b64_json: Buffer.from('image-3').toString('base64') },
        ],
      }), {
        status: 200,
        headers: {
          'content-type': 'application/json',
        },
      });
    }) as typeof fetch;

    const adapter = resolveImageGenerationProviderAdapter({
      id: 'seedream-lite',
      type: 'image',
      name: 'Seedream Lite',
      provider: 'volcengine-seedream',
      model: 'doubao-seedream-5-0-lite-260128',
      apiKey: 'test-key',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      temperature: 0.7,
      settings: {
        imageGeneration: {
          adapter: 'volcengine-seedream',
        },
      },
      isDefault: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const results = await adapter.generate({
      modelConfig: {
        id: 'seedream-lite',
        type: 'image',
        name: 'Seedream Lite',
        provider: 'volcengine-seedream',
        model: 'doubao-seedream-5-0-lite-260128',
        apiKey: 'test-key',
        baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
        temperature: 0.7,
        settings: {
          imageGeneration: {
            adapter: 'volcengine-seedream',
          },
        },
        isDefault: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      modeKey: 'dialog',
      outputCount: 3,
      outputFormat: 'png',
      outputSize: '2K',
      prompt: '生成三张同一人物在不同场景中的插画',
      referenceAssets: [],
      sourceIdPrefix: 'seedream-seq',
      userId: user.id,
    });

    assert.equal(callCount, 1);
    assert.equal(capturedBody?.model, 'doubao-seedream-5-0-lite-260128');
    assert.equal(capturedBody?.size, '2K');
    assert.equal(capturedBody?.sequential_image_generation, 'auto');
    assert.deepEqual(capturedBody?.sequential_image_generation_options, { max_images: 3 });
    assert.equal(capturedBody?.response_format, 'b64_json');
    assert.equal(capturedBody?.output_format, 'png');
    assert.equal(results.length, 3);
    assert.deepEqual(results.map((item) => item.buffer.toString()), ['image-1', 'image-2', 'image-3']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
