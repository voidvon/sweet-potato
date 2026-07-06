import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { VideoRemakeWorkflowState } from '../src/modules/video-remake/video-remake.types.js';

function createWorkflow(): VideoRemakeWorkflowState {
  return {
    mode: 'video_remake',
    currentNode: 'merge_video',
    source: {
      kind: 'url',
      title: '分段重生成参考视频测试',
      sourceUrl: 'https://example.com/source.mp4',
    },
    artifacts: {
      videoBasicInfo: { aspectRatio: '9:16', resolution: '720p' },
      scriptContent: { content: '人物口播内容' },
      seedancePrompts: [
        {
          segmentId: 'segment_1',
          index: 1,
          startTime: 0,
          endTime: 4,
          duration: 4,
          prompt: {
            mainPrompt: '分段1提示词',
            systemPrompt: '# 生成规则',
            negativePrompt: '',
          },
        },
        {
          segmentId: 'segment_2',
          index: 2,
          startTime: 4,
          endTime: 8,
          duration: 4,
          prompt: {
            mainPrompt: '分段2提示词',
            systemPrompt: '# 生成规则',
            negativePrompt: '',
          },
        },
      ],
    },
    invalidArtifacts: [],
    runtime: {
      referencePrimerPlan: {
        mode: 'scene_spans',
        segmentPrimerMap: {
          '1': 'primer_span_1',
          '2': 'primer_span_2',
        },
        spans: [
          {
            spanId: 'primer_span_1',
            segmentIndexes: [1],
            segmentStartIndex: 1,
            segmentEndIndex: 1,
            sceneLabels: ['场景 1'],
            people: ['人物 1'],
            narration: '分段1提示词',
            gapKinds: ['character', 'scene'],
            primer: {
              assetId: 'reference-primer-asset',
              videoUrl: 'https://cdn.example.com/reference-primer.mp4',
            },
          },
          {
            spanId: 'primer_span_2',
            segmentIndexes: [2],
            segmentStartIndex: 2,
            segmentEndIndex: 2,
            sceneLabels: ['场景 2'],
            people: ['人物 1'],
            narration: '分段2提示词',
            gapKinds: ['character', 'scene'],
            primer: {
              assetId: 'reference-primer-asset-2',
              videoUrl: 'https://cdn.example.com/reference-primer-2.mp4',
            },
          },
        ],
      },
      referencePrimer: {
        assetId: 'reference-primer-asset',
        videoUrl: 'https://cdn.example.com/reference-primer.mp4',
      },
      videoSegments: [
        {
          segmentId: 'segment_1',
          index: 1,
          startSecond: 0,
          endSecond: 4,
          durationSecond: 4,
        },
        {
          segmentId: 'segment_2',
          index: 2,
          startSecond: 4,
          endSecond: 8,
          durationSecond: 4,
        },
      ],
    },
    updatedAt: new Date().toISOString(),
  };
}

function createCardData() {
  return {
    versionNumber: 1,
    versionLabel: 'v1',
    videoUrl: '/files/final-v1.mp4',
    seedancePrompts: [
      {
        segmentId: 'segment_1',
        index: 1,
        prompt: {
          mainPrompt: '分段1提示词',
          systemPrompt: '# 生成规则',
          negativePrompt: '',
        },
      },
      {
        segmentId: 'segment_2',
        index: 2,
        prompt: {
          mainPrompt: '分段2提示词',
          systemPrompt: '# 生成规则',
          negativePrompt: '',
        },
      },
    ],
    segments: [
      {
        segmentIndex: 1,
        seconds: 4,
        prompt: { mainPrompt: '分段1提示词', systemPrompt: '# 生成规则', negativePrompt: '' },
        seedancePrompt: '分段1提示词',
        videoUrl: 'https://cdn.example.com/segment-1.mp4',
        status: 'completed',
      },
      {
        segmentIndex: 2,
        seconds: 4,
        prompt: { mainPrompt: '分段2提示词', systemPrompt: '# 生成规则', negativePrompt: '' },
        seedancePrompt: '分段2提示词',
        videoUrl: 'https://cdn.example.com/segment-2.mp4',
        status: 'completed',
      },
    ],
    generatedSegments: [
      {
        segmentIndex: 1,
        seconds: 4,
        prompt: { mainPrompt: '分段1提示词', systemPrompt: '# 生成规则', negativePrompt: '' },
        seedancePrompt: '分段1提示词',
        videoUrl: 'https://cdn.example.com/segment-1.mp4',
        status: 'completed',
      },
      {
        segmentIndex: 2,
        seconds: 4,
        prompt: { mainPrompt: '分段2提示词', systemPrompt: '# 生成规则', negativePrompt: '' },
        seedancePrompt: '分段2提示词',
        videoUrl: 'https://cdn.example.com/segment-2.mp4',
        status: 'completed',
      },
    ],
    videos: [
      {
        versionNumber: 1,
        versionLabel: 'v1',
        videoUrl: '/files/final-v1.mp4',
        segments: [
          { segmentIndex: 1, videoUrl: 'https://cdn.example.com/segment-1.mp4', status: 'completed' },
          { segmentIndex: 2, videoUrl: 'https://cdn.example.com/segment-2.mp4', status: 'completed' },
        ],
      },
    ],
  };
}

test('segment regeneration attaches mapped primer for scene-start segments and previous segment video for later segments', async () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'video-remake-segment-reference-'));
  const dataDir = path.join(tempRoot, 'data');
  mkdirSync(dataDir, { recursive: true });

  const previousDataDir = process.env.DATA_DIR;
  const previousVideoModelApiKey = process.env.VIDEO_MODEL_API_KEY;
  const previousVideoModelBaseUrl = process.env.VIDEO_MODEL_BASE_URL;
  const previousVideoModelId = process.env.VIDEO_MODEL_ID;

  try {
    process.env.DATA_DIR = dataDir;
    process.env.VIDEO_MODEL_API_KEY = 'test-video-model-key';
    process.env.VIDEO_MODEL_BASE_URL = 'https://video-model.example.com';
    process.env.VIDEO_MODEL_ID = 'doubao-seedance-2-0-260128';

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
    createUser('user-segment-reference', 'password123', 'Segment Reference User');

    const originalCallConfigured = videoRemakeVideoModelRuntime.callConfiguredVideoModel;
    const originalWait = videoRemakeVideoModelRuntime.waitForVideoModelCompletion;
    const configuredCalls: Array<Record<string, unknown>> = [];

    videoRemakeVideoModelRuntime.callConfiguredVideoModel = async (input) => {
      configuredCalls.push(input as unknown as Record<string, unknown>);
      throw new Error(`CONFIG_CAPTURE_${configuredCalls.length}`);
    };
    videoRemakeVideoModelRuntime.waitForVideoModelCompletion = async () => ({
      provider: 'volcengine-seedance',
      model: 'doubao-seedance-2-0-260128',
      jobId: 'segment-job',
      status: 'completed',
      videoUrl: 'https://cdn.example.com/regenerated-segment.mp4',
      coverUrl: '',
      usage: { completionTokens: 1, totalTokens: 1 },
    });

    try {
      await assert.rejects(() => defaultVideoRemakeNodeAdapters.regenerateVideoSegment({
        sessionId: 'session-segment-reference-1',
        userId: 'user-segment-reference',
        taskId: 'task-segment-reference-1',
        workflow: createWorkflow(),
        emit: () => undefined,
      }, {
        cardData: createCardData(),
        segmentIndex: 1,
      }), /CONFIG_CAPTURE_1/);

      await assert.rejects(() => defaultVideoRemakeNodeAdapters.regenerateVideoSegment({
        sessionId: 'session-segment-reference-2',
        userId: 'user-segment-reference',
        taskId: 'task-segment-reference-2',
        workflow: createWorkflow(),
        emit: () => undefined,
      }, {
        cardData: createCardData(),
        segmentIndex: 2,
      }), /CONFIG_CAPTURE_2/);

      assert.equal(configuredCalls.length, 2);

      const firstContext = configuredCalls[0]?.context as Record<string, unknown>;
      const firstReferences = ((firstContext.materialContext as Record<string, unknown>).references as Record<string, unknown>);
      const firstVideos = Array.isArray(firstReferences.videos) ? firstReferences.videos : [];
      assert.equal(firstVideos.length, 1);
      assert.equal(String(firstVideos[0]?.fileUrl || firstVideos[0]?.url || ''), 'https://cdn.example.com/reference-primer.mp4');

      const secondContext = configuredCalls[1]?.context as Record<string, unknown>;
      const secondReferences = ((secondContext.materialContext as Record<string, unknown>).references as Record<string, unknown>);
      const secondVideos = Array.isArray(secondReferences.videos) ? secondReferences.videos : [];
      assert.equal(secondVideos.length, 1);
      assert.equal(String(secondVideos[0]?.fileUrl || secondVideos[0]?.url || ''), 'https://cdn.example.com/reference-primer-2.mp4');
    } finally {
      videoRemakeVideoModelRuntime.callConfiguredVideoModel = originalCallConfigured;
      videoRemakeVideoModelRuntime.waitForVideoModelCompletion = originalWait;
    }
  } finally {
    if (previousDataDir === undefined) {
      delete process.env.DATA_DIR;
    } else {
      process.env.DATA_DIR = previousDataDir;
    }
    if (previousVideoModelApiKey === undefined) {
      delete process.env.VIDEO_MODEL_API_KEY;
    } else {
      process.env.VIDEO_MODEL_API_KEY = previousVideoModelApiKey;
    }
    if (previousVideoModelBaseUrl === undefined) {
      delete process.env.VIDEO_MODEL_BASE_URL;
    } else {
      process.env.VIDEO_MODEL_BASE_URL = previousVideoModelBaseUrl;
    }
    if (previousVideoModelId === undefined) {
      delete process.env.VIDEO_MODEL_ID;
    } else {
      process.env.VIDEO_MODEL_ID = previousVideoModelId;
    }
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('segment regeneration falls back to legacy singular referencePrimer when no primer plan exists', async () => {
  const previousVideoModelApiKey = process.env.VIDEO_MODEL_API_KEY;
  const previousVideoModelBaseUrl = process.env.VIDEO_MODEL_BASE_URL;
  const previousVideoModelId = process.env.VIDEO_MODEL_ID;
  const [
    { defaultVideoRemakeNodeAdapters, videoRemakeVideoModelRuntime },
  ] = await Promise.all([
    import('../src/modules/video-remake/video-remake.node-adapters.js'),
  ]);

  const originalCallConfigured = videoRemakeVideoModelRuntime.callConfiguredVideoModel;
  const originalWait = videoRemakeVideoModelRuntime.waitForVideoModelCompletion;
  const configuredCalls: Array<Record<string, unknown>> = [];

  videoRemakeVideoModelRuntime.callConfiguredVideoModel = async (input) => {
    configuredCalls.push(input as unknown as Record<string, unknown>);
    throw new Error(`CONFIG_CAPTURE_LEGACY_${configuredCalls.length}`);
  };
  videoRemakeVideoModelRuntime.waitForVideoModelCompletion = async () => ({
    provider: 'volcengine-seedance',
    model: 'doubao-seedance-2-0-260128',
    jobId: 'segment-job-legacy',
    status: 'completed',
    videoUrl: 'https://cdn.example.com/regenerated-segment-legacy.mp4',
    coverUrl: '',
    usage: { completionTokens: 1, totalTokens: 1 },
  });

  try {
    process.env.VIDEO_MODEL_API_KEY = 'test-video-model-key';
    process.env.VIDEO_MODEL_BASE_URL = 'https://video-model.example.com';
    process.env.VIDEO_MODEL_ID = 'doubao-seedance-2-0-260128';
    const workflow = createWorkflow();
    delete (workflow.runtime as Record<string, unknown>).referencePrimerPlan;

    await assert.rejects(() => defaultVideoRemakeNodeAdapters.regenerateVideoSegment({
      sessionId: 'session-segment-reference-legacy',
      userId: 'user-segment-reference',
      taskId: 'task-segment-reference-legacy',
      workflow,
      emit: () => undefined,
    }, {
      cardData: {
        versionNumber: 1,
        versionLabel: 'v1',
        seedancePrompts: createCardData().seedancePrompts,
        segments: [
          {
            segmentIndex: 1,
            seconds: 4,
            prompt: { mainPrompt: '分段1提示词', systemPrompt: '# 生成规则', negativePrompt: '' },
            seedancePrompt: '分段1提示词',
            videoUrl: '/files/segment-1.mp4',
            status: 'completed',
          },
        ],
      },
      segmentIndex: 1,
    }), /CONFIG_CAPTURE_LEGACY_1/);

    assert.equal(configuredCalls.length, 1);
    const firstContext = configuredCalls[0]?.context as Record<string, unknown>;
    const firstReferences = ((firstContext.materialContext as Record<string, unknown>).references as Record<string, unknown>);
    const firstVideos = Array.isArray(firstReferences.videos) ? firstReferences.videos : [];
    assert.equal(firstVideos.length, 1);
    assert.equal(String(firstVideos[0]?.fileUrl || firstVideos[0]?.url || ''), 'https://cdn.example.com/reference-primer.mp4');
  } finally {
    videoRemakeVideoModelRuntime.callConfiguredVideoModel = originalCallConfigured;
    videoRemakeVideoModelRuntime.waitForVideoModelCompletion = originalWait;
    if (previousVideoModelApiKey === undefined) {
      delete process.env.VIDEO_MODEL_API_KEY;
    } else {
      process.env.VIDEO_MODEL_API_KEY = previousVideoModelApiKey;
    }
    if (previousVideoModelBaseUrl === undefined) {
      delete process.env.VIDEO_MODEL_BASE_URL;
    } else {
      process.env.VIDEO_MODEL_BASE_URL = previousVideoModelBaseUrl;
    }
    if (previousVideoModelId === undefined) {
      delete process.env.VIDEO_MODEL_ID;
    } else {
      process.env.VIDEO_MODEL_ID = previousVideoModelId;
    }
  }
});
