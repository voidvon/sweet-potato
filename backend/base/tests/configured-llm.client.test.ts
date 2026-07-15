import assert from 'node:assert/strict';
import { test } from 'node:test';
import { streamConfiguredLlmWithoutBilling } from '../src/modules/content/configured-llm.client.js';
import type { AiModelConfig } from '../src/modules/model-configs/model-config.types.js';

const modelConfig: AiModelConfig = {
  id: 'fixed-billing-test-model',
  type: 'llm',
  name: 'Fixed billing test model',
  provider: 'openai-compatible',
  model: 'test-model',
  apiKey: 'test-key',
  baseUrl: 'https://example.com/v1',
  temperature: 0.3,
  settings: {},
  isDefault: false,
  sortOrder: 0,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};

test('unbilled configured LLM stream yields OpenAI-compatible answer deltas', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_input, init) => {
    const body = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>;
    assert.equal(body.stream, true);
    assert.equal(body.model, modelConfig.model);
    const encoder = new TextEncoder();
    return new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"hello "}}]}\n\n'));
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"world"}}]}\n\n'));
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    }), { status: 200 });
  }) as typeof fetch;

  try {
    const deltas: string[] = [];
    for await (const delta of streamConfiguredLlmWithoutBilling({
      modelConfig,
      messages: [
        { role: 'system', content: 'system' },
        { role: 'user', content: 'user' },
      ],
      temperature: 0.3,
    })) {
      deltas.push(delta);
    }
    assert.deepEqual(deltas, ['hello ', 'world']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('unbilled configured LLM stream surfaces provider errors', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(
    JSON.stringify({ error: { message: 'provider rejected request' } }),
    { status: 400 },
  )) as typeof fetch;

  try {
    await assert.rejects(async () => {
      for await (const _delta of streamConfiguredLlmWithoutBilling({
        modelConfig,
        messages: [{ role: 'user', content: 'user' }],
        temperature: 0.3,
      })) {
        // Consume the stream to surface transport errors.
      }
    }, /provider rejected request/u);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
