import type { FilterGroup, FilterValues, MaterialKind, ToolOption } from './types';
import { ratioOptions } from '../shared/videoGenerationOptions';
import { t } from '@shared/i18n';

export {
  durationOptions,
  modelDescriptions,
  modelOptionIds,
  modelOptions,
  qualityOptions,
  ratioOptions,
} from '../shared/videoGenerationOptions';

export const defaultMaterials: MaterialKind[] = [
  { key: 'image', label: t("参考图"), hint: t("最多 9 张"), maxCount: 9, meta: t("可选") },
  { key: 'video', label: t("参考视频"), hint: t("限 1 个，≤ 15 秒"), maxCount: 1, meta: t("可选") },
  { key: 'audio', label: t("参考音频"), hint: t("最多 3 段"), maxCount: 3, meta: t("可选") },
];

export const toolOptions: ToolOption[] = [
  {
    key: 'lightweight-marketing-video',
    label: t("轻量营销视频生成"),
    description: t("使用结构化素材快速生成轻量营销视频。"),
    materialHint: t("上传营销素材"),
    materials: [],
    submitText: t("开始生成"),
    workspace: {
      blocks: [{ id: 'lightweight-marketing-video-form', type: 'lightweight-marketing-video-form' }],
      generate: { handler: 'pending' },
    },
  },
  {
    key: 'video',
    label: t("视频"),
    description: t("文字、图片、视频和音频参考生成短视频。"),
    materialHint: t("上传参考素材"),
    materials: defaultMaterials,
    submitText: t("开始生成"),
    workspace: {
      blocks: [
        { id: 'material', type: 'material', showVoiceToggle: true },
        { id: 'prompt', type: 'prompt' },
        { id: 'parameters', type: 'parameters' },
      ],
      generate: { handler: 'video-generation' },
    },
  },
  {
    key: 'video-upscale',
    label: t("视频高清放大"),
    description: t("上传已有视频，生成高清版本。"),
    materialHint: t("上传待放大视频"),
    materials: [{ key: 'video', label: t("待放大视频"), hint: t("限 1 个，≤ 15 秒"), maxCount: 1, meta: t("必选"), minCount: 1 }],
    submitText: t("开始高清放大"),
    workspace: { blocks: [{ id: 'material', type: 'material' }], generate: { handler: 'video-upscale' } },
  },
  {
    key: 'talking-video',
    label: t("口播视频生成"),
    description: t("解析视频分镜与口播脚本，并继续生成口播视频。"),
    materialHint: t("上传口播参考素材"),
    materials: [
      { key: 'video', label: t("口播参考视频"), hint: t("限 1 个，≤ 15 秒"), maxCount: 1, meta: t("必选"), minCount: 1 },
      { key: 'image', label: t("图片素材"), hint: t("总计最多 9 张"), maxCount: 9, meta: t("必选"), minCount: 1 },
    ],
    submitText: t("生成提示词"),
    workspace: { blocks: [{ id: 'talking-video-form', type: 'talking-video-form' }], generate: { handler: 'pending' } },
  },
  {
    key: 'subject-replace',
    label: t("模特 / 商品替换"),
    description: t("解析短视频链接并结合主体图生成同款。"),
    materialHint: t("上传替换主体素材"),
    materials: [
      { key: 'image', label: t("模特图"), hint: t("限 1 张"), maxCount: 1, meta: t("必选"), minCount: 1 },
      { key: 'video', label: t("参考视频"), hint: t("限 1 个"), maxCount: 1, meta: t("必选"), minCount: 1 },
    ],
    submitText: t("开始替换"),
    workspace: {
      blocks: [
        { id: 'subject-replace-form', type: 'subject-replace-form' },
        { id: 'parameters', type: 'parameters', showDuration: false, showHeader: false, showRatio: false },
      ],
      generate: { handler: 'subject-replace' },
    },
  },
  {
    key: 'dance-remake',
    label: t("跳舞复刻"),
    description: t("参考视频动作和音乐，生成主体角色跳舞视频。"),
    materialHint: t("上传人物素材"),
    materials: [
      { key: 'image', label: t("人物图"), hint: t("限 1 张"), maxCount: 1, meta: t("必选"), minCount: 1 },
      { key: 'video', label: t("参考视频"), hint: t("限 1 个"), maxCount: 1, meta: t("必选"), minCount: 1 },
    ],
    submitText: t("开始复刻"),
    workspace: {
      blocks: [
        { id: 'material', type: 'material' },
        { id: 'dance-remake-form', type: 'dance-remake-form' },
        { id: 'parameters', type: 'parameters', showDuration: false, showHeader: false, showRatio: false },
      ],
      generate: { handler: 'dance-remake' },
    },
  },
  {
    key: 'marketing-video',
    label: t("营销视频生成"),
    description: t("围绕商品图生成分镜和营销视频。"),
    materialHint: t("上传商品图"),
    materials: [{ key: 'image', label: t("商品图"), hint: t("1 至 5 张"), maxCount: 5, meta: t("必选"), minCount: 1 }],
    submitText: t("生成营销视频"),
    workspace: {
      blocks: [
        { id: 'material', type: 'material' },
        { id: 'marketing-video-form', type: 'marketing-video-form' },
      ],
      generate: { handler: 'pending' },
    },
  },
  {
    key: 'subtitle-removal',
    label: t("字幕擦除"),
    description: t("上传源视频，擦除画面中的硬字幕。"),
    materialHint: t("上传源视频"),
    materials: [{ key: 'video', label: t("源视频"), hint: t("限 1 个，≤ 15 秒"), maxCount: 1, meta: t("必选"), minCount: 1 }],
    submitText: t("开始擦除"),
    workspace: {
      blocks: [
        { id: 'material', type: 'material' },
        { id: 'subtitle-removal', type: 'subtitle-removal' },
      ],
      generate: { handler: 'subtitle-removal' },
    },
  },
  {
    key: 'video-translation',
    label: t("视频翻译"),
    description: t("上传源视频并选择目标语言，生成翻译视频。"),
    materialHint: t("上传源视频"),
    materials: [
      { key: 'video', label: t("源视频"), hint: t("限 1 个，≤ 15 秒"), maxCount: 1, meta: t("必选"), minCount: 1 },
      { key: 'audio', label: t("参考音频"), hint: t("最多 1 段"), maxCount: 1, meta: t("可选") },
    ],
    submitText: t("开始翻译"),
    workspace: {
      blocks: [
        { id: 'material', type: 'material' },
        { id: 'video-translation', type: 'video-translation' },
      ],
      generate: { handler: 'video-translation' },
    },
  },
];

export const audioOptions = [t("推荐音频男1"), t("推荐音频女1"), t("推荐音频男2"), t("推荐音频女2"), t("推荐音频男3"), t("推荐音频女3"), t("推荐音频男4"), t("推荐音频女4")];

export const modelPickerOptions = [
  t("小孩头像 男1"), t("小孩头像 女1"), t("男头像 1"), t("女头像 1"),
  t("小孩头像 男2"), t("小孩头像 女2"), t("男头像 2"), t("女头像 2"),
  t("小孩头像 男3"), t("小孩头像 女3"), t("男头像 3"), t("女头像 3"),
  t("小孩头像 男4"), t("小孩头像 女4"), t("男头像 4"), t("女头像 4"),
  t("小孩头像 男5"), t("小孩头像 女5"), t("男头像 5"), t("女头像 5"),
  t("小孩头像 男6"), t("小孩头像 女6"), t("男头像 6"), t("女头像 6"),
];

export const filterGroups: FilterGroup[] = [
  { label: t("比例"), options: [t("全部比例"), ...ratioOptions] },
  { label: t("时间"), options: [t("全部时间"), t("今天"), t("近 7 天"), t("近 30 天")] },
  { label: t("状态"), options: [t("全部状态"), t("已完成"), t("生成中"), t("失败")] },
];

export const defaultFilters: FilterValues = {
  比例: t("全部比例"),
  时间: t("全部时间"),
  状态: t("全部状态"),
};

export const promptPlaceholder = t("描述镜头、主体动作、风格和节奏，输入 @ 引用素材");

export const examplePrompt = t("主体居中展示，镜头缓慢推进，明亮自然光，节奏轻快，突出产品质感与使用场景。");
