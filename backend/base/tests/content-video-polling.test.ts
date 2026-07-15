import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_VIDEO_PROCESSING_TIMEOUT_MS,
  defaultVideoPollMaxAttempts,
} from '../src/modules/content/internals/content-video-polling.js';

test('video processing timeout defaults to 15 minutes', () => {
  assert.equal(DEFAULT_VIDEO_PROCESSING_TIMEOUT_MS, 15 * 60_000);
  assert.equal(defaultVideoPollMaxAttempts(10_000), 90);
  assert.equal(defaultVideoPollMaxAttempts(30_000), 30);
});
