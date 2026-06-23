import test from 'node:test';
import assert from 'node:assert/strict';

test('getViralUnderstandingExecutionWithWorker repairs truncated json content', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    ok: true,
    status: 'Success',
    content: '{"task1":{"视频内容":"装修建议"},"task5":{"产品列表":[{"产品名称":"黑色花洒"},',
    raw: {
      output: {
        task: {
          vision: {
            content: '{"task1":{"视频内容":"装修建议"},"task5":{"产品列表":[{"产品名称":"黑色花洒"},',
          },
        },
      },
    },
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }) as unknown as Response;

  try {
    const { getViralUnderstandingExecutionWithWorker } = await import('../src/modules/content/internals/content-viral-director.js');
    const result = await getViralUnderstandingExecutionWithWorker('run_truncated');
    assert.equal(result.status, 'Success');
    assert.ok(result.content);
    const parsed = JSON.parse(String(result.content));
    assert.equal(parsed.task1['视频内容'], '装修建议');
    assert.deepEqual(parsed.task5['产品列表'], [{ '产品名称': '黑色花洒' }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
