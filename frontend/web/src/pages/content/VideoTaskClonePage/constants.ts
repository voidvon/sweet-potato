import type { FilterGroup, FilterValues, MaterialKind, ToolOption } from './types';

export const defaultMaterials: MaterialKind[] = [
  { key: 'image', label: '参考图', hint: '最多 9 张', meta: '可选' },
  { key: 'video', label: '参考视频', hint: '限 1 个', meta: '可选' },
  { key: 'audio', label: '参考音频', hint: '最多 3 段', meta: '可选' },
];

export const toolOptions: ToolOption[] = [
  {
    label: '视频',
    description: '文字、图片、视频和音频参考生成短视频。',
    materialHint: '上传参考素材',
    materials: defaultMaterials,
    submitText: '开始生成',
  },
  {
    label: '视频高清放大',
    description: '上传已有视频，生成高清版本。',
    materialHint: '上传待放大视频',
    materials: [{ key: 'video', label: '待放大视频', hint: '限 1 个', meta: '可选' }],
    submitText: '开始高清放大',
  },
  {
    label: '口播视频生成',
    description: '解析视频分镜与口播脚本，并继续生成口播视频。',
    materialHint: '上传口播参考素材',
    materials: defaultMaterials,
    submitText: '生成口播视频',
  },
  {
    label: '模特 / 商品替换',
    description: '解析短视频链接并结合主体图生成同款。',
    materialHint: '上传替换主体素材',
    materials: defaultMaterials,
    submitText: '开始替换',
  },
  {
    label: '跳舞复刻',
    description: '参考视频动作和音乐，生成主体角色跳舞视频。',
    materialHint: '上传动作与角色素材',
    materials: defaultMaterials,
    submitText: '开始复刻',
  },
  {
    label: '营销视频生成',
    description: '围绕商品图生成分镜和营销视频。',
    materialHint: '上传商品图',
    materials: [{ key: 'image', label: '商品图', hint: '最多 9 张', meta: '可选' }],
    submitText: '生成营销视频',
  },
  {
    label: '字幕擦除',
    description: '上传源视频，擦除画面中的硬字幕。',
    materialHint: '上传源视频',
    materials: [{ key: 'video', label: '源视频', hint: '限 1 个', meta: '可选' }],
    submitText: '开始擦除',
  },
  {
    label: '视频翻译',
    description: '上传源视频并选择目标语言，生成翻译视频。',
    materialHint: '上传源视频',
    materials: [{ key: 'video', label: '源视频', hint: '限 1 个', meta: '可选' }],
    submitText: '开始翻译',
  },
];

export const modelOptions = ['Seedance 2.0', 'Seedance 2.0 Fast', 'Seedance 2.0 Mini', 'Kling Omni'];

export const modelDescriptions: Record<string, string> = {
  'Seedance 2.0': '适合画面表现、音画生成和通用短视频创作。',
  'Seedance 2.0 Fast': '适合更快出片和高频尝试。',
  'Seedance 2.0 Mini': '更轻量的 Seedance 档位，适合海量短片快速产出。',
  'Kling Omni': '适合同款参考、稳定构图和高清成片。',
};

export const ratioOptions = ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9'];

export const qualityOptions = [
  { label: '480P', description: '更快出片，适合草稿预览。' },
  { label: '720P', description: '更清晰，适合常规发布。' },
];

export const durationOptions = ['4s', '5s', '6s', '7s', '8s', '9s', '10s', '11s', '12s', '13s', '14s', '15s'];

export const audioOptions = ['推荐音频男1', '推荐音频女1', '推荐音频男2', '推荐音频女2', '推荐音频男3', '推荐音频女3', '推荐音频男4', '推荐音频女4'];

export const modelPickerOptions = [
  '小孩头像 男1', '小孩头像 女1', '男头像 1', '女头像 1',
  '小孩头像 男2', '小孩头像 女2', '男头像 2', '女头像 2',
  '小孩头像 男3', '小孩头像 女3', '男头像 3', '女头像 3',
  '小孩头像 男4', '小孩头像 女4', '男头像 4', '女头像 4',
  '小孩头像 男5', '小孩头像 女5', '男头像 5', '女头像 5',
  '小孩头像 男6', '小孩头像 女6', '男头像 6', '女头像 6',
];

export const filterGroups: FilterGroup[] = [
  { label: '时间', options: ['全部时间', '今天', '近 7 天', '近 30 天'] },
  { label: '类型', options: ['全部类型', ...toolOptions.map((item) => item.label)] },
  { label: '状态', options: ['全部状态', '已完成', '生成中', '失败'] },
];

export const defaultFilters: FilterValues = {
  时间: '全部时间',
  类型: '全部类型',
  状态: '全部状态',
};

export const promptPlaceholder = '描述镜头、主体动作、风格和节奏，输入 @ 引用素材';

export const examplePrompt = '主体居中展示，镜头缓慢推进，明亮自然光，节奏轻快，突出产品质感与使用场景。';
