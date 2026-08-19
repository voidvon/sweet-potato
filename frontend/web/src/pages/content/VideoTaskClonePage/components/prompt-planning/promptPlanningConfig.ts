import type {
  PlanningJobStage,
  PlanningSettings,
  PlanningUiStep,
} from '../../../../../api/content-planning';
import type { MaterialKind, PromptPanel as PromptPanelKind } from '../../types';

export type BusyAction =
  | 'idle'
  | 'restoring'
  | 'analyzing'
  | 'confirming'
  | 'generating'
  | 'applying';

export type PlanningStageItem = {
  jobStage: PlanningJobStage;
  role: string;
  shortLabel: string;
};

export const modalCopy: Record<PromptPanelKind, { title: string; subtitle: string; action: string }> = {
  marketing: {
    title: '内容策划',
    subtitle: '上传商品图，AI 帮你策划这条电商视频的脚本',
    action: '开始识别',
  },
  reverse: {
    title: '内容策划',
    subtitle: '上传商品图，AI 帮你策划这条电商视频的脚本',
    action: '开始识别',
  },
  write: {
    title: '内容策划',
    subtitle: '上传商品图，AI 帮你策划这条电商视频的脚本',
    action: '开始识别',
  },
};

export const railSteps: Record<PlanningUiStep, string> = {
  step1: '商品素材',
  step2: '确认信息',
  step3: '视频设定',
  step4: '挑选脚本',
};

export const stageItems: PlanningStageItem[] = [
  { jobStage: 'planner_running', role: 'Planner', shortLabel: '规划' },
  { jobStage: 'strategy_running', role: 'Strategy', shortLabel: '方向' },
  { jobStage: 'timeline_running', role: 'Timeline', shortLabel: '节奏' },
  { jobStage: 'copywriter_running', role: 'Copywriter', shortLabel: '文案' },
  { jobStage: 'visual_director_running', role: 'Visual Director', shortLabel: '分镜' },
  { jobStage: 'validator_running', role: 'Validator', shortLabel: '校验' },
];

export const imageMaterial: MaterialKind = { key: 'image', label: '商品素材', hint: '1-9 张', meta: '必传', minCount: 1, maxCount: 9 };
export const videoMaterial: MaterialKind = { key: 'video', label: '参考视频', hint: '限 1 条', meta: '选填', maxCount: 1 };
export const audioMaterial: MaterialKind = { key: 'audio', label: '参考音色', hint: '限 1 段', meta: '选填', maxCount: 1 };

export const sceneOptions: Array<{ value: PlanningSettings['businessScene']; label: string }> = [
  { value: 'ecommerce', label: '电商带货' },
  { value: 'local_service', label: '同城到店' },
  { value: 'door_to_door', label: '上门服务' },
  { value: 'education', label: '教育培训' },
];

export const languageOptions: Array<{ value: PlanningSettings['spokenLanguage']; label: string }> = [
  { value: 'zh', label: '中文' },
  { value: 'en', label: '英文' },
  { value: 'ja', label: '日文' },
  { value: 'de', label: '德文' },
  { value: 'fr', label: '法文' },
];

export const durationOptions: PlanningSettings['durationSeconds'][] = [5, 10, 15];
export const stylePresets = ['干净明亮', '高级感', '直播感', '生活化', '电影质感', '不限'];
export const contentTypeOptions = ['智能匹配', '带货类', '种草类', '同城类', '知识类', '娱乐类', '卖点钩子', '不限定'];
export const shootingMethodOptions = ['智能匹配', '口播', '桌拍', '情景演绎', 'Vlog/生活记录', '跟拍/运动镜头', '一镜到底', '品牌TVC', '不限定'];

export const defaultSettings: PlanningSettings = {
  businessScene: 'unrestricted',
  contentType: '',
  shootingMethod: '',
  spokenLanguage: 'zh',
  displayOnly: false,
  extraInstruction: '',
  durationSeconds: 5,
  styleKeywords: ['干净明亮'],
  deepThink: true,
  webSearch: false,
  candidateCount: 1,
  referencePolicy: {
    useBreakdown: true,
    lockedContentPreset: null,
  },
};
