import type {
  PlanningJobStage,
  PlanningSettings,
  PlanningUiStep,
} from '../../../../../api/content-planning';
import type { MaterialKind, PromptPanel as PromptPanelKind } from '../../types';
import { t } from '@shared/i18n';

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
    title: t("内容策划"),
    subtitle: t("上传商品图，AI 帮你策划这条电商视频的脚本"),
    action: '开始识别',
  },
  reverse: {
    title: t("内容策划"),
    subtitle: t("上传商品图，AI 帮你策划这条电商视频的脚本"),
    action: '开始识别',
  },
  write: {
    title: t("内容策划"),
    subtitle: t("上传商品图，AI 帮你策划这条电商视频的脚本"),
    action: '开始识别',
  },
};

export const railSteps: Record<PlanningUiStep, string> = {
  step1: t("商品素材"),
  step2: t("确认信息"),
  step3: t("视频设定"),
  step4: t("挑选脚本"),
};

export const stageItems: PlanningStageItem[] = [
  { jobStage: 'planner_running', role: 'Planner', shortLabel: t("规划") },
  { jobStage: 'strategy_running', role: 'Strategy', shortLabel: t("方向") },
  { jobStage: 'timeline_running', role: 'Timeline', shortLabel: t("节奏") },
  { jobStage: 'copywriter_running', role: 'Copywriter', shortLabel: t("文案") },
  { jobStage: 'visual_director_running', role: 'Visual Director', shortLabel: t("分镜") },
  { jobStage: 'validator_running', role: 'Validator', shortLabel: t("校验") },
];

export const imageMaterial: MaterialKind = { key: 'image', label: t("商品素材"), hint: t("1-9 张"), meta: t("必传"), minCount: 1, maxCount: 9 };
export const videoMaterial: MaterialKind = { key: 'video', label: t("参考视频"), hint: t("限 1 条"), meta: t("选填"), maxCount: 1 };
export const audioMaterial: MaterialKind = { key: 'audio', label: t("参考音色"), hint: t("限 1 段"), meta: t("选填"), maxCount: 1 };

export const sceneOptions: Array<{ value: PlanningSettings['businessScene']; label: string }> = [
  { value: 'ecommerce', label: t("电商带货") },
  { value: 'local_service', label: t("同城到店") },
  { value: 'door_to_door', label: t("上门服务") },
  { value: 'education', label: t("教育培训") },
];

export const languageOptions: Array<{ value: PlanningSettings['spokenLanguage']; label: string }> = [
  { value: 'zh', label: t("中文") },
  { value: 'en', label: t("英文") },
  { value: 'ja', label: t("日文") },
  { value: 'de', label: t("德文") },
  { value: 'fr', label: t("法文") },
];

export const durationOptions: PlanningSettings['durationSeconds'][] = [5, 10, 15];
export const stylePresets = [t("干净明亮"), t("高级感"), t("直播感"), t("生活化"), t("电影质感"), t("不限")];
export const contentTypeOptions = [t("智能匹配"), t("带货类"), t("种草类"), t("同城类"), t("知识类"), t("娱乐类"), t("卖点钩子"), t("不限定")];
export const shootingMethodOptions = [t("智能匹配"), t("口播"), t("桌拍"), t("情景演绎"), t("Vlog/生活记录"), t("跟拍/运动镜头"), t("一镜到底"), t("品牌TVC"), t("不限定")];

export const defaultSettings: PlanningSettings = {
  businessScene: 'unrestricted',
  contentType: '',
  shootingMethod: '',
  spokenLanguage: 'zh',
  displayOnly: false,
  extraInstruction: '',
  durationSeconds: 5,
  styleKeywords: [t("干净明亮")],
  deepThink: true,
  webSearch: false,
  candidateCount: 1,
  referencePolicy: {
    useBreakdown: true,
    lockedContentPreset: null,
  },
};
