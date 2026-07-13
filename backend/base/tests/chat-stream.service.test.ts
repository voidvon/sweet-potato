import test from 'node:test';
import assert from 'node:assert/strict';

import { makeConversationTitle } from '../src/modules/chat/chat-stream.service.js';

test('image generation uses user input as conversation name when prompt content exists', () => {
  const title = makeConversationTitle({
    content: '把图一里的模特穿上图二的衣服，并微调成更适合夏季上新的轻盈风格',
    capability: 'image_generation',
    capabilityContext: {
      imageGeneration: {
        modeKey: 'outfit',
        modeTitle: '换装',
      },
    },
  });

  assert.match(title, /^把图一里的模特穿上图二的衣服/u);
});

test('image generation falls back to module title when prompt content is empty', () => {
  const title = makeConversationTitle({
    content: '   ',
    capability: 'image_generation',
    capabilityContext: {
      imageGeneration: {
        modeKey: 'detail',
        modeTitle: '详情图生成',
      },
    },
  });

  assert.equal(title, '详情图生成');
});
