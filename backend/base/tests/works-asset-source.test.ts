import assert from 'node:assert/strict';
import test from 'node:test';
import worksAssetSourceModule from '../../../frontend/web/src/pages/content/assets/worksAssetSource.js';

const {
  getVideoWorkSourceFromMode,
  getVideoWorkSourceLabel,
} = worksAssetSourceModule;

test('talking video work mode has a dedicated user-facing label', () => {
  const source = getVideoWorkSourceFromMode('talking_video');
  assert.equal(source, 'talking_video');
  assert.equal(getVideoWorkSourceLabel(source), '口播视频生成');
});
