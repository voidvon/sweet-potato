import type { ImageModelProvider } from '../image-model-provider.types.js';

export const openaiImagesProvider: ImageModelProvider = {
  id: 'openai-images',
  name: 'OpenAI Images',
  description: 'OpenAI 图片生成与编辑 API，支持文生图、参考图和图片编辑。',
  keyLabel: 'OpenAI API Key',
  keyPlaceholder: '请输入 OpenAI API Key',
  keyHelp: '调用 OpenAI Images API，使用 Bearer API Key 鉴权；Base URL 可按代理或兼容网关配置。',
  defaultBaseUrl: 'https://api.openai.com/v1/images/edits',
  defaultModel: 'gpt-image-1',
  models: [
    { id: 'gpt-image-1', name: 'GPT Image 1', description: 'OpenAI 图片生成与编辑模型。' },
    { id: 'gpt-image-1.5', name: 'GPT Image 1.5', description: 'OpenAI 图片生成与编辑模型。' },
    { id: 'gpt-image-2', name: 'GPT Image 2', description: 'OpenAI 图片生成与编辑模型。' },
  ],
};
