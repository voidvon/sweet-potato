import type { ImageModelProvider } from '../image-model-provider.types.js';

export const googleGeminiImagesProvider: ImageModelProvider = {
  id: 'google-gemini-images',
  name: 'Google Gemini Images',
  description: 'Google Gemini 原生图片生成模型，使用 generateContent 接口返回 inlineData 图片。',
  keyLabel: 'Gemini API Key',
  keyPlaceholder: '请输入 Gemini API Key',
  keyHelp: '调用 Google Gemini API，使用 x-goog-api-key 鉴权；Base URL 填 API 根地址，例如 https://generativelanguage.googleapis.com/v1beta。',
  defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
  defaultModel: 'gemini-3.1-flash-image',
  defaultSettings: {
    imageGeneration: {
      adapter: 'gemini',
    },
  },
  models: [
    { id: 'gemini-3-pro-image-preview', name: 'Gemini 3 Pro Image Preview', description: 'Gemini Pro 图片生成预览模型，支持文本和参考图输入。' },
    { id: 'gemini-3.1-flash-image-preview', name: 'Gemini 3.1 Flash Image Preview', description: 'Gemini Flash 图片生成预览模型，支持文本和参考图输入。' },
    { id: 'gemini-3.1-flash-image', name: 'Gemini 3.1 Flash Image', description: 'Gemini Flash 图片生成模型，支持文本和参考图输入。' },
  ],
};
