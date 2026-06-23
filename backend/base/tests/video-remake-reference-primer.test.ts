import test from 'node:test';
import assert from 'node:assert/strict';

import {
  defaultVideoRemakeNodeAdapters,
  videoRemakeVideoModelRuntime,
} from '../src/modules/video-remake/video-remake.node-adapters.js';
import type { VideoRemakeWorkflowState } from '../src/modules/video-remake/video-remake.types.js';

test('video remake segmented generation creates and attaches reference primer when no materials exist', async () => {
  const originalCallConfigured = videoRemakeVideoModelRuntime.callConfiguredVideoModel;
  const originalWait = videoRemakeVideoModelRuntime.waitForVideoModelCompletion;
  const originalSegmented = videoRemakeVideoModelRuntime.callSegmentedSeedanceVideoGeneration;
  const configuredCalls: Array<Record<string, unknown>> = [];
  const segmentedCalls: Array<Record<string, unknown>> = [];

  videoRemakeVideoModelRuntime.callConfiguredVideoModel = async (input) => {
    configuredCalls.push(input as unknown as Record<string, unknown>);
    return {
      provider: 'volcengine-seedance',
      model: 'doubao-seedance-2-0-260128',
      jobId: 'primer-job-1',
      status: 'running',
      videoUrl: '',
      coverUrl: '',
    };
  };
  videoRemakeVideoModelRuntime.waitForVideoModelCompletion = async () => ({
    provider: 'volcengine-seedance',
    model: 'doubao-seedance-2-0-260128',
    jobId: 'primer-job-1',
    status: 'completed',
    videoUrl: 'https://cdn.example.com/reference-primer.mp4',
    coverUrl: '',
    usage: { completionTokens: 1, totalTokens: 1 },
  });
  videoRemakeVideoModelRuntime.callSegmentedSeedanceVideoGeneration = async (input) => {
    segmentedCalls.push(input as unknown as Record<string, unknown>);
    return {
      provider: 'volcengine-seedance',
      model: 'doubao-seedance-2-0-260128',
      status: 'completed',
      videoUrl: '/files/content/generated.mp4',
      jobId: 'segmented-job-1',
      segments: [{ segmentIndex: 1, seconds: 10, videoUrl: '/files/content/segment-1.mp4', status: 'completed' }],
    };
  };

  try {
    const workflow: VideoRemakeWorkflowState = {
      mode: 'video_remake',
      currentNode: 'merge_video',
      source: {
        kind: 'url',
        title: '参考视频策略测试',
        sourceUrl: 'https://example.com/source.mp4',
      },
      artifacts: {
        videoBasicInfo: { aspectRatio: '9:16', resolution: '720p' },
        scriptContent: { content: '人物1：第一句话用于参考。第二句话进入正片。' },
        characterSetting: { items: [{ label: '人物 1', referenceMode: 'prompt', required: true, characterPrompt: '自然讲解者' }] },
        sceneSetting: { items: [{ label: '场景 1', referenceMode: 'prompt', required: true, description: '干净室内场景' }] },
        voiceAudioSetting: {
          voice: '原声参考',
          voiceStyle: '自然口播',
          items: [{ label: '人物 1 声音', voice: '原声参考', voiceStyle: '自然口播' }],
        },
        seedancePrompts: [1, 2, 3].map((index) => ({
          segmentId: `segment_${index}`,
          index,
          startTime: (index - 1) * 10,
          endTime: index * 10,
          duration: 10,
          prompt: {
            mainPrompt: [
              '# 当前分镜',
              `画面：第 ${index} 段`,
              '',
              '# 本段口播',
              index === 1 ? '人物1：第一句话用于参考。第二句话进入正片。' : `人物1：第 ${index} 段口播。`,
            ].join('\n'),
            systemPrompt: '# 生成规则\n纯画面视频。',
            negativePrompt: '',
          },
        })),
      },
      invalidArtifacts: [],
      runtime: {
        videoSegments: [1, 2, 3].map((index) => ({
          segmentId: `segment_${index}`,
          index,
          startSecond: (index - 1) * 10,
          endSecond: index * 10,
          durationSecond: 10,
        })),
      },
      updatedAt: new Date().toISOString(),
    };

    const result = await defaultVideoRemakeNodeAdapters.mergeVideo({
      sessionId: 'session-reference-primer',
      userId: 'user-reference-primer',
      taskId: 'task-reference-primer',
      workflow,
      emit: () => undefined,
    });

    assert.equal(configuredCalls.length, 1);
    assert.match(String(configuredCalls[0]?.title || ''), /分段参考视频/);
    assert.match(String(configuredCalls[0]?.prompt || ''), /只朗读这一句口播：第一句话用于参考。/);
    assert.equal(configuredCalls[0]?.resolution, '480p');
    assert.equal(configuredCalls[0]?.duration, '4s');
    assert.equal((configuredCalls[0]?.seedanceOptions as Record<string, unknown> | undefined)?.resolution, '480p');
    assert.equal(segmentedCalls.length, 1);
    const segmentedContext = segmentedCalls[0]?.context as Record<string, unknown>;
    const materialContext = segmentedCalls[0]?.materialContext as Record<string, unknown>;
    const references = materialContext.references as Record<string, unknown>;
    assert.match(String(segmentedCalls[0]?.prompt || ''), /# 临时参考视频/);
    assert.match(String(segmentedCalls[0]?.prompt || ''), /参考视频1/);
    assert.equal(Array.isArray(references.videos) ? references.videos.length : 0, 1);
    assert.match(JSON.stringify(segmentedContext.videoGenerationFlow || {}), /primer-job-1/);
    assert.equal(workflow.runtime.referencePrimer?.videoUrl, 'https://cdn.example.com/reference-primer.mp4');
    assert.equal(result.videoUrl, '/files/content/generated.mp4');
  } finally {
    videoRemakeVideoModelRuntime.callConfiguredVideoModel = originalCallConfigured;
    videoRemakeVideoModelRuntime.waitForVideoModelCompletion = originalWait;
    videoRemakeVideoModelRuntime.callSegmentedSeedanceVideoGeneration = originalSegmented;
  }
});
