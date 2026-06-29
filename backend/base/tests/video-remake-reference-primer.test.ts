import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'video-remake-reference-tests-'));
const dataDir = path.join(tempRoot, 'data');
const previousDataDir = process.env.DATA_DIR;
mkdirSync(dataDir, { recursive: true });
process.env.DATA_DIR = dataDir;

const [
  { migrateDatabase },
  { createUser },
  { defaultVideoRemakeNodeAdapters, videoRemakeVideoModelRuntime },
] = await Promise.all([
  import('../src/db/schema.js'),
  import('../src/modules/users/user.service.js'),
  import('../src/modules/video-remake/video-remake.node-adapters.js'),
]);

migrateDatabase();

test.after(() => {
  if (previousDataDir === undefined) {
    delete process.env.DATA_DIR;
  } else {
    process.env.DATA_DIR = previousDataDir;
  }
  rmSync(tempRoot, { recursive: true, force: true });
});

function buildWorkflow(input?: {
  storyboardScript?: Array<Record<string, unknown>>;
  seedancePrompts?: Array<Record<string, unknown>>;
  videoSegments?: Array<Record<string, unknown>>;
  characterSetting?: Record<string, unknown>;
  sceneSetting?: Record<string, unknown>;
  scriptContent?: string;
}) {
  const seedancePrompts = input?.seedancePrompts || [1, 2, 3, 4].map((index) => ({
    segmentId: `segment_${index}`,
    index,
    startTime: (index - 1) * 4,
    endTime: index * 4,
    duration: 4,
    prompt: {
      mainPrompt: [
        '# 当前分镜',
        `画面：第 ${index} 段`,
        '',
        '# 本段口播',
        `人物1：第 ${index} 段口播。`,
      ].join('\n'),
      systemPrompt: '# 生成规则\n纯画面视频。',
      negativePrompt: '',
    },
  }));
  const videoSegments = input?.videoSegments || seedancePrompts.map((segment) => ({
    segmentId: String(segment.segmentId),
    index: Number(segment.index),
    startSecond: Number(segment.startTime || 0),
    endSecond: Number(segment.endTime || 4),
    durationSecond: Number(segment.duration || 4),
    seedancePrompt: String((segment.prompt as Record<string, unknown>)?.mainPrompt || ''),
    prompt: segment.prompt,
  }));
  return {
    mode: 'video_remake',
    currentNode: 'merge_video',
    source: {
      kind: 'url',
      title: '参考视频策略测试',
      sourceUrl: 'https://example.com/source.mp4',
    },
    artifacts: {
      videoBasicInfo: { aspectRatio: '9:16', resolution: '720p' },
      storyboardScript: input?.storyboardScript || [
        { startSecond: 0, endSecond: 8, visualDescription: '场景 1 中 人物 1 和 人物 2 对话', actionDescription: '人物 1 和 人物 2 同框', narration: '人物1：第一段。人物2：补充。' },
        { startSecond: 8, endSecond: 16, visualDescription: '场景 2 中 人物 1 单独出镜', actionDescription: '人物 1 展示产品', narration: '人物1：第二场景。' },
      ],
      scriptContent: { content: input?.scriptContent || '人物1：第一段。人物2：补充。人物1：第二场景。' },
      characterSetting: input?.characterSetting || {
        items: [
          { label: '人物 1', referenceMode: 'prompt', required: true, characterPrompt: '主讲人，女性' },
          { label: '人物 2', referenceMode: 'prompt', required: true, characterPrompt: '搭档，男性' },
        ],
      },
      sceneSetting: input?.sceneSetting || {
        items: [
          { label: '场景 1', referenceMode: 'prompt', required: true, description: '室内访谈区' },
          { label: '场景 2', referenceMode: 'prompt', required: true, description: '产品展示台' },
        ],
      },
      seedancePrompts,
    },
    invalidArtifacts: [],
    runtime: {
      videoSegments,
    },
    updatedAt: new Date().toISOString(),
  };
}

test('video remake scene-aware primers generate multiple spans and route each segment to its primer', async () => {
  const previousVideoApiKey = process.env.VIDEO_MODEL_API_KEY;
  const previousVideoBaseUrl = process.env.VIDEO_MODEL_BASE_URL;
  const previousVideoModelId = process.env.VIDEO_MODEL_ID;
  const originalCallConfigured = videoRemakeVideoModelRuntime.callConfiguredVideoModel;
  const originalWait = videoRemakeVideoModelRuntime.waitForVideoModelCompletion;
  const originalSegmented = videoRemakeVideoModelRuntime.callSceneAwareSegmentedSeedanceVideoGeneration;
  const configuredCalls: Array<Record<string, unknown>> = [];
  const segmentedCalls: Array<Record<string, unknown>> = [];

  try {
    process.env.VIDEO_MODEL_API_KEY = 'test-video-key';
    process.env.VIDEO_MODEL_BASE_URL = 'https://video-model.example.com';
    process.env.VIDEO_MODEL_ID = 'doubao-seedance-2-0-260128';
    const user = createUser(`user-reference-primer-${Date.now()}`, 'password123', 'Reference Primer User');

    videoRemakeVideoModelRuntime.callConfiguredVideoModel = async (input) => {
      configuredCalls.push(input as unknown as Record<string, unknown>);
      const idx = configuredCalls.length;
      return {
        provider: 'volcengine-seedance',
        model: 'doubao-seedance-2-0-260128',
        jobId: `primer-job-${idx}`,
        status: 'completed',
        videoUrl: `https://cdn.example.com/reference-primer-${idx}.mp4`,
        coverUrl: '',
        usage: { completionTokens: 1, totalTokens: 1 },
      };
    };
    videoRemakeVideoModelRuntime.waitForVideoModelCompletion = async ({ jobId }) => ({
      provider: 'volcengine-seedance',
      model: 'doubao-seedance-2-0-260128',
      jobId,
      status: 'completed',
      videoUrl: `https://cdn.example.com/${jobId}.mp4`,
      coverUrl: '',
      usage: { completionTokens: 1, totalTokens: 1 },
    });
    videoRemakeVideoModelRuntime.callSceneAwareSegmentedSeedanceVideoGeneration = async (input) => {
      segmentedCalls.push(input as unknown as Record<string, unknown>);
      return {
        provider: 'volcengine-seedance',
        model: 'doubao-seedance-2-0-260128',
        status: 'completed',
        videoUrl: '/files/content/generated.mp4',
        jobId: 'segmented-job-1',
        renderMode: 'segmented_ffmpeg',
        segments: input.segmentInputs.map((segment) => ({
          segmentIndex: segment.segmentIndex,
          seconds: segment.seconds,
          status: 'completed',
          videoUrl: `/files/content/segment-${segment.segmentIndex}.mp4`,
        })),
      };
    };

    const workflow = buildWorkflow({
      seedancePrompts: [1, 2, 3, 4].map((index) => ({
        segmentId: `segment_${index}`,
        index,
        startTime: (index - 1) * 4,
        endTime: index * 4,
        duration: 4,
        prompt: {
          mainPrompt: [
            '# 当前分镜',
            `画面：第 ${index} 段`,
            '',
            '# 本段口播',
            index <= 2 ? `人物1：场景一第 ${index} 句。人物2：同时出现。` : `人物1：场景二第 ${index} 句。`,
          ].join('\n'),
          systemPrompt: '# 生成规则\n纯画面视频。',
          negativePrompt: '',
        },
      })),
      storyboardScript: [
        { startSecond: 0, endSecond: 8, visualDescription: '场景 1 中 人物 1 和 人物 2 同时出现', actionDescription: '人物 1 和 人物 2 同框交流', narration: '人物1：场景一。人物2：补充。' },
        { startSecond: 8, endSecond: 16, visualDescription: '场景 2 中 只有 人物 1 出镜', actionDescription: '人物 1 展示产品', narration: '人物1：场景二。' },
      ],
    });

    const result = await defaultVideoRemakeNodeAdapters.mergeVideo({
      sessionId: 'session-reference-primer',
      userId: user.id,
      taskId: 'task-reference-primer',
      workflow,
      emit: () => undefined,
    });

    assert.equal(configuredCalls.length, 2);
    assert.match(String(configuredCalls[0]?.prompt || ''), /人物 1/);
    assert.match(String(configuredCalls[0]?.prompt || ''), /人物 2/);
    assert.equal(segmentedCalls.length, 1);
    const segmentInputs = segmentedCalls[0]?.segmentInputs as Array<Record<string, unknown>>;
    assert.equal(segmentInputs.length, 4);
    assert.equal(String(segmentInputs[0]?.referencePrimerSpanId || ''), 'primer_span_1');
    assert.equal(String(segmentInputs[1]?.referencePrimerSpanId || ''), 'primer_span_1');
    assert.equal(String(segmentInputs[2]?.referencePrimerSpanId || ''), 'primer_span_2');
    assert.equal(String(segmentInputs[3]?.referencePrimerSpanId || ''), 'primer_span_2');
    assert.equal((result as { referencePrimerPlan?: { spans?: unknown[] } }).referencePrimerPlan?.spans?.length, 2);
  } finally {
    videoRemakeVideoModelRuntime.callConfiguredVideoModel = originalCallConfigured;
    videoRemakeVideoModelRuntime.waitForVideoModelCompletion = originalWait;
    videoRemakeVideoModelRuntime.callSceneAwareSegmentedSeedanceVideoGeneration = originalSegmented;
    if (previousVideoApiKey === undefined) {
      delete process.env.VIDEO_MODEL_API_KEY;
    } else {
      process.env.VIDEO_MODEL_API_KEY = previousVideoApiKey;
    }
    if (previousVideoBaseUrl === undefined) {
      delete process.env.VIDEO_MODEL_BASE_URL;
    } else {
      process.env.VIDEO_MODEL_BASE_URL = previousVideoBaseUrl;
    }
    if (previousVideoModelId === undefined) {
      delete process.env.VIDEO_MODEL_ID;
    } else {
      process.env.VIDEO_MODEL_ID = previousVideoModelId;
    }
  }
});

test('video remake scene-aware primers keep stable multi-segment spans in mixed scene switches', async () => {
  const previousVideoApiKey = process.env.VIDEO_MODEL_API_KEY;
  const previousVideoBaseUrl = process.env.VIDEO_MODEL_BASE_URL;
  const previousVideoModelId = process.env.VIDEO_MODEL_ID;
  const originalCallConfigured = videoRemakeVideoModelRuntime.callConfiguredVideoModel;
  const originalWait = videoRemakeVideoModelRuntime.waitForVideoModelCompletion;
  const originalSegmented = videoRemakeVideoModelRuntime.callSceneAwareSegmentedSeedanceVideoGeneration;
  const configuredCalls: Array<Record<string, unknown>> = [];
  const segmentedCalls: Array<Record<string, unknown>> = [];

  try {
    process.env.VIDEO_MODEL_API_KEY = 'test-video-key';
    process.env.VIDEO_MODEL_BASE_URL = 'https://video-model.example.com';
    process.env.VIDEO_MODEL_ID = 'doubao-seedance-2-0-260128';
    const user = createUser(`user-reference-mixed-${Date.now()}`, 'password123', 'Mixed Scene User');

    videoRemakeVideoModelRuntime.callConfiguredVideoModel = async (input) => {
      configuredCalls.push(input as unknown as Record<string, unknown>);
      const idx = configuredCalls.length;
      return {
        provider: 'volcengine-seedance',
        model: 'doubao-seedance-2-0-260128',
        jobId: `primer-job-mixed-${idx}`,
        status: 'completed',
        videoUrl: `https://cdn.example.com/reference-primer-mixed-${idx}.mp4`,
        coverUrl: '',
        usage: { completionTokens: 1, totalTokens: 1 },
      };
    };
    videoRemakeVideoModelRuntime.waitForVideoModelCompletion = async ({ jobId }) => ({
      provider: 'volcengine-seedance',
      model: 'doubao-seedance-2-0-260128',
      jobId,
      status: 'completed',
      videoUrl: `https://cdn.example.com/${jobId}.mp4`,
      coverUrl: '',
      usage: { completionTokens: 1, totalTokens: 1 },
    });
    videoRemakeVideoModelRuntime.callSceneAwareSegmentedSeedanceVideoGeneration = async (input) => {
      segmentedCalls.push(input as unknown as Record<string, unknown>);
      return {
        provider: 'volcengine-seedance',
        model: 'doubao-seedance-2-0-260128',
        status: 'completed',
        videoUrl: '/files/content/generated-mixed.mp4',
        jobId: 'segmented-job-mixed',
        renderMode: 'segmented_ffmpeg',
        segments: input.segmentInputs.map((segment) => ({
          segmentIndex: segment.segmentIndex,
          seconds: segment.seconds,
          status: 'completed',
          videoUrl: `/files/content/segment-mixed-${segment.segmentIndex}.mp4`,
        })),
      };
    };

    const workflow = buildWorkflow({
      sceneSetting: {
        items: [
          { label: '场景 A', referenceMode: 'prompt', required: true, description: '场景 A 室内讲解区' },
          { label: '场景 B', referenceMode: 'prompt', required: true, description: '场景 B 展示台' },
          { label: '场景 C', referenceMode: 'prompt', required: true, description: '场景 C 收尾区' },
        ],
      },
      storyboardScript: [
        { startSecond: 0, endSecond: 8, visualDescription: '场景 A 中 人物 1 出镜', actionDescription: '人物 1 在场景 A 中讲解', narration: '人物1：场景A前半段。' },
        { startSecond: 8, endSecond: 12, visualDescription: '场景 B 中 人物 1 出镜', actionDescription: '人物 1 切换到场景 B', narration: '人物1：场景B。' },
        { startSecond: 12, endSecond: 16, visualDescription: '场景 C 中 人物 1 出镜', actionDescription: '人物 1 切换到场景 C', narration: '人物1：场景C。' },
      ],
      seedancePrompts: [1, 2, 3, 4].map((index) => ({
        segmentId: `segment_${index}`,
        index,
        startTime: (index - 1) * 4,
        endTime: index * 4,
        duration: 4,
        prompt: {
          mainPrompt: [
            '# 当前分镜',
            `画面：第 ${index} 段`,
            '',
            '# 本段口播',
            index <= 2 ? `人物1：场景A第 ${index} 句。` : index === 3 ? '人物1：场景B。' : '人物1：场景C。',
          ].join('\n'),
          systemPrompt: '# 生成规则\n纯画面视频。',
          negativePrompt: '',
        },
      })),
    });

    const result = await defaultVideoRemakeNodeAdapters.mergeVideo({
      sessionId: 'session-reference-mixed',
      userId: user.id,
      taskId: 'task-reference-mixed',
      workflow,
      emit: () => undefined,
    });

    assert.equal(configuredCalls.length, 3);
    assert.equal(segmentedCalls.length, 1);
    const plan = (result as {
      referencePrimerPlan?: {
        mode?: string;
        spans?: Array<{ segmentIndexes?: number[] }>;
      };
    }).referencePrimerPlan;
    assert.equal(plan?.mode, 'scene_spans');
    assert.equal(plan?.spans?.length, 3);
    assert.deepEqual(plan?.spans?.map((span) => span.segmentIndexes), [[1, 2], [3], [4]]);

    const segmentInputs = segmentedCalls[0]?.segmentInputs as Array<Record<string, unknown>>;
    assert.equal(String(segmentInputs[0]?.referencePrimerSpanId || ''), 'primer_span_1');
    assert.equal(String(segmentInputs[1]?.referencePrimerSpanId || ''), 'primer_span_1');
    assert.equal(String(segmentInputs[2]?.referencePrimerSpanId || ''), 'primer_span_2');
    assert.equal(String(segmentInputs[3]?.referencePrimerSpanId || ''), 'primer_span_3');
  } finally {
    videoRemakeVideoModelRuntime.callConfiguredVideoModel = originalCallConfigured;
    videoRemakeVideoModelRuntime.waitForVideoModelCompletion = originalWait;
    videoRemakeVideoModelRuntime.callSceneAwareSegmentedSeedanceVideoGeneration = originalSegmented;
    if (previousVideoApiKey === undefined) {
      delete process.env.VIDEO_MODEL_API_KEY;
    } else {
      process.env.VIDEO_MODEL_API_KEY = previousVideoApiKey;
    }
    if (previousVideoBaseUrl === undefined) {
      delete process.env.VIDEO_MODEL_BASE_URL;
    } else {
      process.env.VIDEO_MODEL_BASE_URL = previousVideoBaseUrl;
    }
    if (previousVideoModelId === undefined) {
      delete process.env.VIDEO_MODEL_ID;
    } else {
      process.env.VIDEO_MODEL_ID = previousVideoModelId;
    }
  }
});

test('video remake scene-aware primers collapse rapid scene switching to a single primer', async () => {
  const previousVideoApiKey = process.env.VIDEO_MODEL_API_KEY;
  const previousVideoBaseUrl = process.env.VIDEO_MODEL_BASE_URL;
  const previousVideoModelId = process.env.VIDEO_MODEL_ID;
  const originalCallConfigured = videoRemakeVideoModelRuntime.callConfiguredVideoModel;
  const originalWait = videoRemakeVideoModelRuntime.waitForVideoModelCompletion;
  const originalSegmented = videoRemakeVideoModelRuntime.callSceneAwareSegmentedSeedanceVideoGeneration;
  const configuredCalls: Array<Record<string, unknown>> = [];

  try {
    process.env.VIDEO_MODEL_API_KEY = 'test-video-key';
    process.env.VIDEO_MODEL_BASE_URL = 'https://video-model.example.com';
    process.env.VIDEO_MODEL_ID = 'doubao-seedance-2-0-260128';
    const user = createUser(`user-reference-rapid-${Date.now()}`, 'password123', 'Rapid Switch User');

    videoRemakeVideoModelRuntime.callConfiguredVideoModel = async (input) => {
      configuredCalls.push(input as unknown as Record<string, unknown>);
      return {
        provider: 'volcengine-seedance',
        model: 'doubao-seedance-2-0-260128',
        jobId: 'primer-job-rapid',
        status: 'completed',
        videoUrl: 'https://cdn.example.com/reference-primer-rapid.mp4',
        coverUrl: '',
        usage: { completionTokens: 1, totalTokens: 1 },
      };
    };
    videoRemakeVideoModelRuntime.waitForVideoModelCompletion = async ({ jobId }) => ({
      provider: 'volcengine-seedance',
      model: 'doubao-seedance-2-0-260128',
      jobId,
      status: 'completed',
      videoUrl: `https://cdn.example.com/${jobId}.mp4`,
      coverUrl: '',
      usage: { completionTokens: 1, totalTokens: 1 },
    });
    videoRemakeVideoModelRuntime.callSceneAwareSegmentedSeedanceVideoGeneration = async (input) => ({
      provider: 'volcengine-seedance',
      model: 'doubao-seedance-2-0-260128',
      status: 'completed',
      videoUrl: '/files/content/generated-rapid.mp4',
      jobId: 'segmented-job-rapid',
      renderMode: 'segmented_ffmpeg',
      segments: input.segmentInputs.map((segment) => ({
        segmentIndex: segment.segmentIndex,
        seconds: segment.seconds,
        status: 'completed',
        videoUrl: `/files/content/segment-rapid-${segment.segmentIndex}.mp4`,
      })),
    });

    const workflow = buildWorkflow({
      storyboardScript: [
        { startSecond: 0, endSecond: 4, visualDescription: '场景 1', actionDescription: '人物 1', narration: '人物1：第一句。' },
        { startSecond: 4, endSecond: 8, visualDescription: '场景 2', actionDescription: '人物 1', narration: '人物1：第二句。' },
        { startSecond: 8, endSecond: 12, visualDescription: '场景 1', actionDescription: '人物 1', narration: '人物1：第三句。' },
        { startSecond: 12, endSecond: 16, visualDescription: '场景 2', actionDescription: '人物 1', narration: '人物1：第四句。' },
      ],
    });

    const result = await defaultVideoRemakeNodeAdapters.mergeVideo({
      sessionId: 'session-reference-rapid',
      userId: user.id,
      taskId: 'task-reference-rapid',
      workflow,
      emit: () => undefined,
    });

    assert.equal(configuredCalls.length, 1);
    assert.equal((result as { referencePrimerPlan?: { mode?: string; spans?: unknown[] } }).referencePrimerPlan?.mode, 'rapid_switch_fallback');
    assert.equal((result as { referencePrimerPlan?: { spans?: unknown[] } }).referencePrimerPlan?.spans?.length, 1);
  } finally {
    videoRemakeVideoModelRuntime.callConfiguredVideoModel = originalCallConfigured;
    videoRemakeVideoModelRuntime.waitForVideoModelCompletion = originalWait;
    videoRemakeVideoModelRuntime.callSceneAwareSegmentedSeedanceVideoGeneration = originalSegmented;
    if (previousVideoApiKey === undefined) {
      delete process.env.VIDEO_MODEL_API_KEY;
    } else {
      process.env.VIDEO_MODEL_API_KEY = previousVideoApiKey;
    }
    if (previousVideoBaseUrl === undefined) {
      delete process.env.VIDEO_MODEL_BASE_URL;
    } else {
      process.env.VIDEO_MODEL_BASE_URL = previousVideoBaseUrl;
    }
    if (previousVideoModelId === undefined) {
      delete process.env.VIDEO_MODEL_ID;
    } else {
      process.env.VIDEO_MODEL_ID = previousVideoModelId;
    }
  }
});
