import assert from 'node:assert/strict';
import test from 'node:test';
import { runTalkingVideoPromptAgent } from '../src/modules/talking-video/talking-video-agent-runtime.js';

test('talking video agent disables provider hidden thinking while preserving deepThink reasoning report flow', async () => {
  const calls: Array<{ thinking: boolean }> = [];
  const phases: Array<{ phase: string; metrics: { arkUploadCount: number; understandingModelCalls: number; reuseCacheHitCount: number } }> = [];
  const result = await runTalkingVideoPromptAgent({
    userId: 'user-agent-thinking',
    deepThink: true,
    video: {
      filePath: '/tmp/source.mp4',
      filename: 'source.mp4',
      mimeType: 'video/mp4',
      durationSeconds: 14,
    },
    images: [{
      filePath: '/tmp/model.png',
      filename: 'model.png',
      mimeType: 'image/png',
      role: 'model',
    }],
    runStructuredUnderstanding: async (input) => {
      calls.push({ thinking: input.thinking });
      input.onPhase?.('uploading_assets', {
        arkUploadCount: 2,
        arkUploadPollMs: 12,
        understandingModelCalls: 0,
        understandingReplayCalls: 0,
        formatRepairCalls: 0,
        promptRepairCalls: 0,
        reuseCacheHitCount: 0,
      });
      input.onPhase?.('understanding_video', {
        arkUploadCount: 2,
        arkUploadPollMs: 12,
        understandingModelCalls: 1,
        understandingReplayCalls: 0,
        formatRepairCalls: 0,
        promptRepairCalls: 0,
        reuseCacheHitCount: 0,
      });
      input.onAnswerDelta?.('<reasoning_report>这个视频是一个装修短视频。\n视频内容分析：\n主画面展示装修点位。</reasoning_report>');
      input.onPhase?.('validating_analysis', {
        arkUploadCount: 2,
        arkUploadPollMs: 12,
        understandingModelCalls: 1,
        understandingReplayCalls: 0,
        formatRepairCalls: 0,
        promptRepairCalls: 0,
        reuseCacheHitCount: 0,
      });
      return {
        metrics: {
          arkUploadCount: 2,
          arkUploadPollMs: 12,
          understandingModelCalls: 1,
          understandingReplayCalls: 0,
          formatRepairCalls: 0,
          promptRepairCalls: 0,
          reuseCacheHitCount: 0,
        },
        parsed: {
          durationSeconds: 14,
          summary: '装修点位讲解',
          visualStyle: '写实口播',
          finalPrompt: [
            '画面不要生成字幕、字幕条、标题字、贴片文字、平台水印或其他可读文字。',
            '@图片1：仅作为出镜模特的人物身份与稳定外观参考。',
            '独立场景设计：按装修讲解主题设计简洁室内空间。',
            '分段A',
            '镜号1｜近景｜0-14秒',
            '画面：讲解者面对镜头讲解装修点位。',
            '台词：“这里要提前预留插座。”（语气：自然，语速：中速）',
            '表演要点：讲解者自然讲解',
            '拍摄注意：固定机位保持讲解者全程出镜',
          ].join('\n'),
          presentationLayout: {
            type: 'full_screen_presenter' as const,
            mainVisualRole: '讲解者全屏口播',
            presenterPlacement: '主画面居中',
            persistence: '全程持续',
          },
          videoStructure: {
            isContinuousTake: true,
            shotBoundaryReason: '单镜头讲解',
          },
          presenter: {
            identity: '装修讲解者',
            expressionStyle: '自然',
            performanceStyle: '稳定口播',
          },
          shots: [{
            startSecond: 0,
            endSecond: 14,
            shotSize: '近景',
            visual: '讲解者面对镜头讲解装修点位。',
            dialogue: '这里要提前预留插座。',
            performance: '讲解者自然讲解',
            shootingNotes: '固定机位保持讲解者全程出镜',
          }],
          imageReferences: [{
            imageIndex: 1,
            role: 'model' as const,
            usableTraits: '素材清晰可用',
          }],
        },
      };
    },
    onPhaseChange: (phase, metrics) => {
      phases.push({
        phase,
        metrics: {
          arkUploadCount: metrics.arkUploadCount,
          understandingModelCalls: metrics.understandingModelCalls,
          reuseCacheHitCount: metrics.reuseCacheHitCount,
        },
      });
    },
  });

  assert.deepEqual(calls, [{ thinking: false }]);
  assert.deepEqual(phases.slice(0, 3), [
    {
      phase: 'uploading_assets',
      metrics: {
        arkUploadCount: 2,
        understandingModelCalls: 0,
        reuseCacheHitCount: 0,
      },
    },
    {
      phase: 'understanding_video',
      metrics: {
        arkUploadCount: 2,
        understandingModelCalls: 1,
        reuseCacheHitCount: 0,
      },
    },
    {
      phase: 'validating_analysis',
      metrics: {
        arkUploadCount: 2,
        understandingModelCalls: 1,
        reuseCacheHitCount: 0,
      },
    },
  ]);
  assert.match(result.reasoning, /视频内容分析：/u);
  assert.equal(result.metrics.understandingModelCalls, 1);
  assert.equal(result.metrics.arkUploadCount, 2);
});
