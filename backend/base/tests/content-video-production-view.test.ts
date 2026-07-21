import assert from 'node:assert/strict';
import test from 'node:test';
import { toVideoProductionView } from '../src/modules/content/internals/content-video-production-view.js';
import type { VideoGenerationTask } from '../src/modules/content/content.types.js';

test('video production list view exposes only explicitly allowed fields', () => {
  const task = {
    id: 'task-1',
    userId: 'user-secret',
    sourceUrl: 'https://private.example/source.mp4',
    prompt: 'private prompt',
    title: 'Video',
    status: 'generating',
    rawParseResult: { providerPayload: 'secret' },
    editableParseResult: {
      videoGenerationResult: {
        status: 'running',
        provider: 'internal-provider',
        model: 'internal-model',
        jobId: 'provider-job-secret',
        assetId: 'asset-visible',
        duration: '5s',
        ratio: '9:16',
        generatedAt: '2026-07-20T00:00:00.000Z',
      },
    },
    selectedSkillIds: ['internal-skill'],
    expertContext: {
      mode: 'video_create',
      quality: '720p',
      userPrompt: 'user-prompt-secret',
      generateAudio: false,
      subjectReplaceRemoteVideo: {
        input: 'https://example.com/video',
        trimStart: 1,
        authorization: 'secret',
      },
      providerRequest: { token: 'secret' },
      failureHistory: [{ reason: 'internal' }],
    },
    selectedDigitalHumanId: 'digital-human-secret',
    selectedVoiceId: 'voice-secret',
    selectedSceneId: 'scene-secret',
    generatedVideoUrl: null,
    aspectRatio: '9:16',
    creditCost: 10,
    failureReason: null,
    createdAt: '2026-07-20T00:00:00.000Z',
    updatedAt: '2026-07-20T00:01:00.000Z',
  } as unknown as VideoGenerationTask;

  const view = toVideoProductionView(task);

  assert.equal('userId' in view, false);
  assert.equal('prompt' in view, false);
  assert.equal('sourceUrl' in view, false);
  assert.equal('rawParseResult' in view, false);
  assert.equal('selectedSkillIds' in view, false);
  assert.deepEqual(view.expertContext, {
    mode: 'video_create',
    quality: '720p',
  });
  assert.deepEqual(view.editableParseResult.videoGenerationResult, {
    status: 'running',
    videoUrl: undefined,
    coverUrl: undefined,
    errorMessage: undefined,
    duration: '5s',
    ratio: '9:16',
    renderStatus: undefined,
    assetId: 'asset-visible',
    generatedAt: '2026-07-20T00:00:00.000Z',
  });
  assert.doesNotMatch(JSON.stringify(view), /secret|providerPayload|providerRequest|failureHistory/);
});
