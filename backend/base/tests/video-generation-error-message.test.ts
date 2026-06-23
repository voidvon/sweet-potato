import test from 'node:test';
import assert from 'node:assert/strict';
import { userFacingVideoGenerationError } from '../src/modules/content/internals/content-video-generation.js';

test('maps seedance audio_url validation failure to user-facing audio-only message', () => {
  const message = 'The parameter `content[2].audio_url` specified in the request is not valid. Request id: 0217816193782392748f57c5f4210b3bc611acce6828c7aa72830';
  assert.equal(userFacingVideoGenerationError(new Error(message)), 'seedance 不支持仅上传音频素材');
});
