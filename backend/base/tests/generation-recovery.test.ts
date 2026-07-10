import assert from 'node:assert/strict';
import test from 'node:test';
import {
  interruptedImageGenerationContent,
  interruptedImageGenerationMessage,
} from '../src/modules/generation/generation-recovery.service.js';

test('interrupted image generation explains a complete interruption', () => {
  assert.equal(
    interruptedImageGenerationContent(0),
    `图片生成失败：${interruptedImageGenerationMessage}`,
  );
});

test('interrupted image generation preserves the completed-image context', () => {
  assert.equal(
    interruptedImageGenerationContent(2),
    '已生成 2 张图片；其余图片因服务重启中断，请重新生成。',
  );
});
