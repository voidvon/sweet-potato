import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveCharacterReferenceImageIds, resolveSeedanceRejectedSourceAssetIds } from '../src/modules/content/content.service.js';

test('resolveCharacterReferenceImageIds infers character references from nearby prompt clauses', () => {
  const result = resolveCharacterReferenceImageIds({
    prompt: '人物参考 @图片1 和 @图片2，对车子进行讲解',
    referenceImageIds: ['img-1', 'img-2'],
    characterReferenceImageIds: [],
  });

  assert.deepEqual(result, ['img-1', 'img-2']);
});

test('resolveCharacterReferenceImageIds keeps explicit ids and merges inferred ids', () => {
  const result = resolveCharacterReferenceImageIds({
    prompt: '@图片1，人物是温柔女生，产品展示参考 @图片2',
    referenceImageIds: ['img-1', 'img-2'],
    characterReferenceImageIds: ['img-2'],
  });

  assert.deepEqual(result, ['img-2', 'img-1']);
});

test('resolveCharacterReferenceImageIds falls back to all mentions when prompt contains character keywords anywhere', () => {
  const result = resolveCharacterReferenceImageIds({
    prompt: '@图片1 和 @图片2，对车子进行讲解，整体人物口播自然',
    referenceImageIds: ['img-1', 'img-2'],
    characterReferenceImageIds: [],
  });

  assert.deepEqual(result, ['img-1', 'img-2']);
});

test('seedance rejected image fallback uses referenced character images first when message has no index', () => {
  const result = resolveSeedanceRejectedSourceAssetIds({
    message: 'The request failed because the input image may contain real person.',
    originalReferenceImageIds: ['img-1', 'img-2', 'img-3'],
    characterReferenceImageIds: ['img-2'],
  });

  assert.deepEqual(result, ['img-2']);
});

test('seedance rejected image fallback uses all reference images when message has no index and no explicit character refs', () => {
  const result = resolveSeedanceRejectedSourceAssetIds({
    message: 'The request failed because the input image may contain real person.',
    originalReferenceImageIds: ['img-1', 'img-2'],
    characterReferenceImageIds: [],
  });

  assert.deepEqual(result, ['img-1', 'img-2']);
});

test('seedance rejected image index keeps targeted source image when provider returns content index', () => {
  const result = resolveSeedanceRejectedSourceAssetIds({
    message: 'Invalid parameter: content[2].image_url.url failed validation',
    originalReferenceImageIds: ['img-1', 'img-2', 'img-3'],
    characterReferenceImageIds: ['img-1'],
  });

  assert.deepEqual(result, ['img-2']);
});
