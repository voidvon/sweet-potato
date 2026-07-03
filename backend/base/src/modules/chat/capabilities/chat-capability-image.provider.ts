import type { ChatCapabilityExecutionResult, ChatCapabilityHandler } from '../chat-capability.types.js';
import { runImageGenerationWorkflow } from './image-generation.workflow.js';

export const imageGenerationChatCapabilityHandler: ChatCapabilityHandler = {
  capability: 'image_generation',
  mentionTokens: ['@生图', '＠生图'],
  async execute(input): Promise<ChatCapabilityExecutionResult> {
    const result = await runImageGenerationWorkflow(input);
    return {
      capability: 'image_generation',
      assistantContent: result.assistantContent,
      assistantAttachments: result.assistantAttachments,
      metadata: {
        previewText: '已生成图片',
      },
    };
  },
};
