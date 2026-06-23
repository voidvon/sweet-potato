import test from 'node:test';
import assert from 'node:assert/strict';

test('picture-in-picture normalization keeps concise schema only', async () => {
  const { normalizePictureInPictureResult, pictureInPictureParseSummary } = await import('../src/modules/content/internals/content-viral-director.js');

  const normalized = normalizePictureInPictureResult({
    appeared: true,
    summary: '存在辅助截图',
    items: [
      {
        id: 'pip_1',
        type: 'screenshot_overlay',
        startSecond: 1,
        endSecond: 3,
        content: '评论截图',
        confidence: 0.86,
        width: 320,
        height: 180,
        x: 10,
        y: 20,
        position: '右上角',
      },
    ],
  });

  assert.equal(normalized.appeared, true);
  assert.deepEqual(normalized.items[0], {
    id: 'pip_1',
    type: 'screenshot_overlay',
    startSecond: 1,
    endSecond: 3,
    position: '右上角',
    content: '评论截图',
    confidence: 0.86,
  });

  const summary = pictureInPictureParseSummary(normalized);
  assert.match(summary, /1-3秒/);
  assert.match(summary, /右上角/);
  assert.match(summary, /评论截图/);
  assert.doesNotMatch(summary, /坐标|尺寸|320x180|\(10, 20\)/);
});
