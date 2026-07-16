import assert from 'node:assert/strict';
import { test } from 'node:test';
import { z } from 'zod';
import {
  parseContentPlanningAnalysisResponse,
  parseContentPlanningAnalysisWithRetry,
} from '../src/modules/content-planning/content-planning-analysis-runtime.js';

const testSchema = z.object({
  title: z.string(),
  summary: z.string(),
  tags: z.array(z.string()),
});

test('content planning analysis repairs malformed model JSON before schema validation', async () => {
  const result = await parseContentPlanningAnalysisResponse(
    '{"title":"参考视频","summary":"前半段展示产品" "tags":["种草",],}',
    testSchema,
  );

  assert.deepEqual(result, {
    title: '参考视频',
    summary: '前半段展示产品',
    tags: ['种草'],
  });
});

test('content planning analysis parses JSON from a fenced model response', async () => {
  const result = await parseContentPlanningAnalysisResponse([
    '以下是分析结果：',
    '```json',
    '{"title":"参考视频","summary":"节奏紧凑","tags":["口播"]}',
    '```',
  ].join('\n'), testSchema);

  assert.equal(result.summary, '节奏紧凑');
});

test('content planning analysis still rejects repaired JSON that violates the schema', async () => {
  await assert.rejects(
    parseContentPlanningAnalysisResponse(
      '{"title":"参考视频","summary":123,"tags":[]}',
      testSchema,
    ),
    /素材理解结果不符合约定格式/u,
  );
});

test('content planning analysis asks the agent for a new output after parsing and repair both fail', async () => {
  let retryCount = 0;
  const result = await parseContentPlanningAnalysisWithRetry(
    '{"title":"参考视频","summary":123,"tags":[]}',
    testSchema,
    async () => {
      retryCount += 1;
      return '{"title":"参考视频","summary":"重新理解后输出","tags":["种草"]}';
    },
  );

  assert.equal(retryCount, 1);
  assert.equal(result.summary, '重新理解后输出');
});

test('content planning analysis retries at most once', async () => {
  let retryCount = 0;
  await assert.rejects(
    parseContentPlanningAnalysisWithRetry(
      '{"title":"参考视频","summary":123,"tags":[]}',
      testSchema,
      async () => {
        retryCount += 1;
        return '{"title":"参考视频","summary":456,"tags":[]}';
      },
    ),
    /素材理解自动重试后仍失败/u,
  );
  assert.equal(retryCount, 1);
});
