import type { ContentModule } from './content.types.js';

export const contentModules: ContentModule[] = [
  {
    code: 'digital_human',
    name: '数字人形象',
    kind: 'asset_library',
    description: '管理数字人形象、出镜素材、预览视频和可复用人物模板。',
  },
  {
    code: 'virtual_portrait_assets',
    name: '人物素材',
    kind: 'asset_library',
    description: '管理可用于视频出镜的人物素材，并同步到火山方舟私域人物素材资产库。',
  },
  {
    code: 'ai_voice',
    name: '人声素材',
    kind: 'asset_library',
    description: '管理音色、口播试听文件、情绪风格和语音素材。',
  },
  {
    code: 'scene_library',
    name: '场景素材',
    kind: 'asset_library',
    description: '管理背景、空间、产品展示和可复用视频场景素材。',
  },
  {
    code: 'product_assets',
    name: '产品素材',
    kind: 'asset_library',
    description: '管理产品图片、产品视频、卖点说明和可复用商品展示素材。',
  },
  {
    code: 'finished_assets',
    name: '成片素材',
    kind: 'asset_library',
    description: '管理已生成或上传的成片视频，支持后续复用、下载和二次编辑。',
  },
  {
    code: 'real_person_assets',
    name: '真人素材',
    kind: 'asset_library',
    description: '管理已完成认证的真人形象、火山方舟人像素材和可用于视频生成的真人素材引用。',
  },
  {
    code: 'create_video',
    name: '视频创作',
    kind: 'video_generation',
    description: '选择画质、比例、时长和参考素材，通过提示词生成视频并保存生成记录。',
  },
];
