import test from 'node:test';
import assert from 'node:assert/strict';
import { runVideoRemakeAnalysisGraph } from '../src/modules/video-remake/video-remake.langgraph.js';
import type { VideoRemakeNodeAdapters, VideoRemakeNodeContext, VideoRemakeNodeEvent } from '../src/modules/video-remake/video-remake.node-adapters.js';
import type { VideoRemakeWorkflowState } from '../src/modules/video-remake/video-remake.types.js';

function workflow(): VideoRemakeWorkflowState {
  return {
    mode: 'test',
    currentNode: 'upload_to_vod',
    artifacts: {},
    invalidArtifacts: [],
    source: {
      kind: 'upload',
      title: 'graph-test.mp4',
      sourceUrl: '',
    },
    runtime: {},
    updatedAt: new Date().toISOString(),
  };
}

test('analysis graph emits understanding completion before director normalize waits on LLM', async () => {
  const events: VideoRemakeNodeEvent[] = [];
  let understandingCompleted = false;
  let directorStarted = false;

  const adapters: VideoRemakeNodeAdapters = {
    uploadToVod: async () => ({ vid: 'vid-graph-test' }),
    analyzeAudio: async () => ({ roleName: '音频理解专家', content: '音频结果' }),
    analyzeVisual: async () => ({ roleName: '视频理解专家', content: '视频结果' }),
    analyzePip: async () => ({ roleName: '画中画理解专家', content: '画中画结果' }),
    directorNormalize: async () => {
      directorStarted = true;
      assert.equal(understandingCompleted, true);
      return { basicInfo: { title: '已整理' } };
    },
    generateStoryboard: async () => [],
    generateSeedancePrompts: async () => [],
    generateVideoSegments: async () => [],
    mergeVideo: async () => ({}),
    regenerateVideoSegment: async () => ({}),
  };

  const context: VideoRemakeNodeContext = {
    sessionId: 'session-graph-test',
    userId: 'user-graph-test',
    workflow: workflow(),
    emit: (event) => events.push(event),
    onUnderstandingComplete: ({ vod, audio, visual, pip }) => {
      understandingCompleted = true;
      assert.equal(vod.vid, 'vid-graph-test');
      assert.equal(audio.content, '音频结果');
      assert.equal(visual.content, '视频结果');
      assert.equal(pip.content, '画中画结果');
    },
  };

  const result = await runVideoRemakeAnalysisGraph(context, adapters);

  assert.equal(understandingCompleted, true);
  assert.equal(directorStarted, true);
  assert.deepEqual(result.normalized, { basicInfo: { title: '已整理' } });
});
