import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeVideoUnderstandingRequest } from '../src/modules/video-understanding/video-understanding.client.js';

test('video understanding request defaults to Files API and fps 2', () => {
  const request = normalizeVideoUnderstandingRequest({
    prompt: '请分析视频',
    inputs: [{
      type: 'video_url',
      video_url: { url: 'https://example.com/video.mp4' },
    }],
  });

  assert.equal(request.useFilesApi, true);
  assert.equal(request.fps, 2);
  assert.equal(request.messages[0]?.content[1]?.type, 'video_url');
  assert.equal((request.messages[0]?.content[1] as { video_url: { fps?: number } }).video_url.fps, 2);
});

test('video understanding request accepts custom fps and disables Files API', () => {
  const request = normalizeVideoUnderstandingRequest({
    prompt: '请分析',
    fps: 0.3,
    useFilesApi: false,
    inputs: [{
      type: 'image_url',
      image_url: { data: 'data:image/jpeg;base64,AA==' },
    }],
  });

  assert.equal(request.useFilesApi, false);
  assert.equal(request.fps, 0.3);
});

test('video understanding request rejects fps outside Ark limits', () => {
  assert.throws(
    () => normalizeVideoUnderstandingRequest({ prompt: '请分析', fps: 6 }),
    /fps 必须在 0\.2 到 5/u,
  );
});
