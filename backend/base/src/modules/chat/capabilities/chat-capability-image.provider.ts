import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { contentFilesDir } from '../../content/internals/content-common.js';
import {
  editImageWithConfiguredModel,
  extensionForMimeType,
  generateImageWithConfiguredModel,
} from '../../content/internals/content-image-assets.js';
import { fileUrlFor } from '../../content/internals/content-voice-clone.js';
import type { ChatCapabilityExecutionInput, ChatCapabilityExecutionResult, ChatCapabilityHandler } from '../chat-capability.types.js';
import type { ChatAttachment } from '../chat.types.js';

function dataUrlToBuffer(dataUrl: string) {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/i.exec(dataUrl);
  if (!match) {
    throw new Error('参考图格式不支持');
  }
  const mimeType = match[1] || 'image/png';
  const isBase64 = Boolean(match[2]);
  const payload = match[3] || '';
  return {
    buffer: isBase64 ? Buffer.from(payload, 'base64') : Buffer.from(decodeURIComponent(payload)),
    mimeType,
  };
}

function safeImageName(value: string, fallback: string) {
  return (value || fallback).replace(/[^\w.-]+/g, '-').slice(0, 120) || fallback;
}

async function chatAttachmentToReferenceAsset(attachment: ChatAttachment) {
  const parsed = dataUrlToBuffer(attachment.url);
  const originalFileName = safeImageName(attachment.name, 'reference.png');
  const extension = extensionForMimeType(parsed.mimeType);
  const storedFileName = `chat-image-reference-${randomBytes(8).toString('hex')}.${extension}`;
  const filePath = path.join(contentFilesDir, storedFileName);
  await writeFile(filePath, parsed.buffer);
  return {
    filePath,
    mimeType: parsed.mimeType,
    originalFileName,
  };
}

export const imageGenerationChatCapabilityHandler: ChatCapabilityHandler = {
  capability: 'image_generation',
  mentionTokens: ['@生图', '＠生图'],
  async execute(input: ChatCapabilityExecutionInput): Promise<ChatCapabilityExecutionResult> {
    const modelConfig = input.imageModelConfig;
    if (!modelConfig) {
      throw new Error('请先选择图片模型');
    }
    if (modelConfig.type !== 'image') {
      throw new Error('请选择图片模型配置');
    }
    if (!modelConfig.apiKey) {
      throw new Error(`图片模型「${modelConfig.name}」尚未配置 API Key`);
    }
    if (!modelConfig.model || !modelConfig.baseUrl) {
      throw new Error(`图片模型「${modelConfig.name}」配置不完整`);
    }

    const prompt = input.content.trim();
    if (!prompt) {
      throw new Error('请输入生图提示词');
    }

    const imageAttachments = input.attachments.filter((attachment) => attachment.kind === 'image' && attachment.url);
    const generated = imageAttachments.length
      ? await editImageWithConfiguredModel({
          prompt,
          modelConfig,
          referenceAssets: await Promise.all(imageAttachments.map(chatAttachmentToReferenceAsset)),
          billingContext: {
            userId: input.userId,
            sourceType: 'chat_image_generation',
            sourceId: input.conversation?.id || `chat-image-${Date.now()}`,
          },
        })
      : await generateImageWithConfiguredModel({
          prompt,
          modelConfig,
          billingContext: {
            userId: input.userId,
            sourceType: 'chat_image_generation',
            sourceId: input.conversation?.id || `chat-image-${Date.now()}`,
          },
        });

    const extension = extensionForMimeType(generated.mimeType);
    const storedFileName = `chat-generated-image-${randomBytes(8).toString('hex')}.${extension}`;
    const filePath = path.join(contentFilesDir, storedFileName);
    await writeFile(filePath, generated.buffer);

    return {
      capability: 'image_generation',
      assistantContent: `已使用 ${modelConfig.name} / ${modelConfig.model} 生成图片。`,
      assistantAttachments: [{
        id: randomBytes(8).toString('hex'),
        kind: 'image',
        name: `generated-image.${extension}`,
        type: generated.mimeType,
        size: generated.buffer.byteLength,
        url: fileUrlFor(storedFileName),
      }],
      metadata: {
        previewText: '已生成图片',
      },
    };
  },
};
