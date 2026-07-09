import type { ImageModelProvider } from '../image-model-provider.types.js';

export const volcengineSeedreamProvider: ImageModelProvider = {
  id: 'volcengine-seedream',
  name: '火山引擎 Seedream',
  description: '火山方舟 Doubao Seedream 5.0 图片生成 API，支持文生图、单图/多图生图，Lite 支持组图输出。',
  keyLabel: '火山引擎 API Key',
  keyPlaceholder: '请输入火山方舟 API Key',
  keyHelp: '调用地址为 /api/v3/images/generations，使用 Bearer API Key 鉴权。',
  defaultBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
  defaultModel: 'doubao-seedream-5-0-lite-260128',
  defaultSettings: {
    imageGeneration: {
      adapter: 'volcengine-seedream',
    },
  },
  models: [
    { id: 'doubao-seedream-5-0-pro-260628', name: 'Seedream 5.0 Pro', description: '高精度图片生成，支持文生图、单图/多图生图。' },
    { id: 'doubao-seedream-5-0-lite-260128', name: 'Seedream 5.0 Lite', description: '支持文生图、单图/多图生图与组图输出。' },
  ],
};
