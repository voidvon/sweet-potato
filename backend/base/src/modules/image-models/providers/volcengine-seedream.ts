import type { ImageModelProvider } from '../image-model-provider.types.js';

export const volcengineSeedreamProvider: ImageModelProvider = {
  id: 'volcengine-seedream',
  name: '火山引擎 Seedream',
  description: '火山方舟图片生成 API，支持文生图与图生图。',
  keyLabel: '火山引擎 API Key',
  keyPlaceholder: '请输入火山方舟 API Key',
  keyHelp: '调用地址为 /api/v3/images/generations，使用 Bearer API Key 鉴权。',
  defaultBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
  defaultModel: 'doubao-seedream-5-0-260128',
  models: [
    { id: 'doubao-seedream-5-0-260128', name: 'Seedream 5.0 Lite', description: '支持文本、单图和多图输入，适合轻量生成。' },
    { id: 'doubao-seedream-4-5-251128', name: 'Seedream 4.5', description: '支持文本、单图和多图输入。' },
    { id: 'doubao-seedream-4-0-250828', name: 'Seedream 4.0', description: '支持文本、单图和多图输入与图像编辑。' },
  ],
};
