import type {
  PlanningCandidate,
  PlanningGeneration,
  PlanningJobStage,
  PlanningMaterialCaption,
  PlanningProductInsights,
  PlanningSession,
  PlanningSettings,
} from '../../../../../api/content-planning';
import type { LocalMaterialFile, SelectedMaterials } from '../../types';
import { getLocalFiles } from './materialHelpers';
import { t } from '@shared/i18n';

export type AnalysisDraft = {
  useBreakdown: boolean;
  materialCaptions: PlanningMaterialCaption[];
  productInsights: PlanningProductInsights;
};

export type CaptionDraftCard = {
  id: string;
  label: string;
  previewUrl: string;
  description: string;
};

const auditStageLabels: Record<string, string> = {
  planner: t("1. 分析输入与约束"),
  strategy: t("2. 策略规划与差异化路线"),
  timeline: t("3. 细化时间轴与节奏"),
  copywriter: t("4. 撰写文案与字数检查"),
  visualDirector: t("5. 视觉落地与分镜定稿"),
  validator: t("6. 校验、修正与最终选择"),
};

const hiddenAuditFields = new Set([
  'candidateId',
  'fullScript',
  'id',
  'materialRefs',
  'prompt',
  'repairApplied',
  'script',
  'segmentId',
  'selectedCandidateId',
  'sourceStrategyId',
  'strategyId',
  'validationPassed',
]);

const auditFieldLabels: Record<string, string> = {
  action: '主体动作',
  audienceAngle: t("受众角度"),
  beat: t("节奏"),
  brief: t("策划简报"),
  camera: t("镜头"),
  candidateDirections: t("候选方向"),
  candidateId: t("候选 ID"),
  candidates: t("候选脚本"),
  dialogue: t("口播"),
  emotionalArc: t("情绪曲线"),
  endSecond: t("结束时间"),
  followReferenceStructure: t("沿用参考结构"),
  goal: t("目标"),
  hardConstraints: t("硬性约束"),
  hook: t("开场钩子"),
  issues: t("问题"),
  lighting: t("光线"),
  lines: t("分段文案"),
  materialRefs: t("素材引用"),
  repairAdvice: t("修复建议"),
  score: t("评分"),
  selectedCandidateId: t("推荐方案"),
  segmentId: t("分段 ID"),
  segments: t("时间段"),
  soundEffect: t("音效"),
  spaceRelation: t("空间关系"),
  startSecond: t("开始时间"),
  storyboard: t("逐秒分镜"),
  strategies: t("创意策略"),
  strategyId: t("策略 ID"),
  summary: t("摘要"),
  tags: t("标签"),
  text: t("文案"),
  timelines: t("时间轴"),
  title: t("标题"),
  visual: t("画面"),
};

export function buildAnalysisDraft(session: PlanningSession | null, useBreakdown: boolean): AnalysisDraft {
  return {
    useBreakdown,
    materialCaptions: session?.analysis.materialCaptions || [],
    productInsights: session?.analysis.productInsights || {
      productName: '',
      productCategory: '',
      productFeatures: [],
      coreSellingPoints: [],
      targetAudience: [],
      useScenarios: [],
    },
  };
}

export function buildCaptionDraftCards(captions: PlanningMaterialCaption[]): CaptionDraftCard[] {
  return captions.map((caption, index) => ({
    description: caption.description,
    id: caption.id,
    label: caption.label || t("图片{{0}}", { "0": index + 1 }),
    previewUrl: caption.previewUrl,
  }));
}

export function buildReasoningText(generation?: PlanningGeneration) {
  if (!generation) {
    return '';
  }
  const contents = generation.reasoningLogs
    .map((log) => log.content.trim())
    .filter(Boolean);
  const streamingContent = generation.reasoningStream?.content.trim() || '';
  const storedOutputs = formatStoredStageOutputs(generation.stageOutputs || {});
  if (storedOutputs && !streamingContent) {
    return storedOutputs;
  }
  const visibleContents = [...Array.from(new Set(contents)), streamingContent].filter(Boolean);
  if (visibleContents.length) {
    return visibleContents.join('\n\n');
  }
  return generation.validatorSummary.trim();
}

export function isReasoningStreamWaiting(generation?: PlanningGeneration) {
  const content = generation?.reasoningStream?.content.trim();
  if (!content) {
    return false;
  }
  return content.split('\n').filter((line) => line.trim()).length === 1;
}

export function invalidatePlanningSessionResult(
  session: PlanningSession,
  patch: Partial<Pick<PlanningSession, 'jobStage' | 'settings' | 'status' | 'uiStep'>>,
): PlanningSession {
  return {
    ...session,
    ...patch,
    applySnapshot: null,
    errorMessage: '',
    generation: {
      ...session.generation,
      candidates: [],
      reasoningLogs: [],
      selectedCandidateId: '',
      stageOutputs: {},
      stages: [],
      validatorSummary: '',
    },
  };
}

export function formatCandidateScript(candidate: PlanningCandidate) {
  const storyboard = candidate.script?.storyboard || candidate.storyboard;
  const title = candidate.script?.title || candidate.title;
  const summary = candidate.script?.summary || candidate.summary;
  const materialRefs = [...new Set(storyboard.flatMap((segment) => [
    ...segment.materialRefs,
    ...(segment.visual.match(/@image[1-9]\b/giu) || []),
  ]))];
  const scenePlan = storyboard
    .map((segment) => `${segment.startSecond}-${segment.endSecond}s ${segment.title}`)
    .join('；');
  const lightingPlan = [...new Set(storyboard.map((segment) => segment.lighting.trim()).filter(Boolean))].join('；');
  const parts = [
    t("## 视频总览"),
    t("- 标题：{{0}}", { "0": title }),
    t("- 方案摘要：{{0}}", { "0": summary }),
    candidate.hook ? t("- 开场钩子：{{0}}", { "0": candidate.hook }) : '',
    candidate.audienceAngle ? t("- 受众角度：{{0}}", { "0": candidate.audienceAngle }) : '',
    candidate.tags.length ? t("- 内容标签：{{0}}", { "0": candidate.tags.join('、') }) : '',
    ...(materialRefs.length ? ['', t("## 素材参考"), t("- 全片商品外观统一参考：{{0}}", { "0": materialRefs.join('、') })] : []),
    '',
    t("## 场景与光线"),
    t("- 镜头场景安排：{{0}}", { "0": scenePlan || '按逐秒镜头执行' }),
    t("- 布光方案：{{0}}", { "0": lightingPlan || '按逐秒镜头执行' }),
    '',
    t("## 逐秒镜头拆解列表"),
  ];

  storyboard.forEach((segment) => {
    parts.push(
      '',
      `### ${segment.startSecond}-${segment.endSecond}s｜${segment.title}`,
      segment.camera ? `- 景别/角度与运镜：${segment.camera}` : '',
      segment.visual ? `- 画面：${segment.visual.replace(/\s*@image[1-9]\b/giu, '').trim()}` : '',
      segment.action ? `- 主体动作：${segment.action}` : '',
      segment.spaceRelation ? `- 空间关系：${segment.spaceRelation}` : '',
      segment.lighting ? `- 光线：${segment.lighting}` : '',
      `- 口播：${segment.dialogue || '无，仅画面展示'}`,
      segment.soundEffect ? `- 音效与音乐：${segment.soundEffect}` : '',
    );
  });

  if (!storyboard.length && candidate.fullScript) {
    parts.push(candidate.fullScript);
  }
  return parts.filter((line, index) => line || parts[index - 1] !== '').join('\n').trim();
}

export function getAnalyzeLoadingCopy(jobStage: PlanningJobStage, references: { hasVideo: boolean }) {
  if (jobStage === 'analyzing_reference_video') {
    return {
      title: t("商品图识别完成，正在拆解参考视频"),
      description: t("正在解析镜头/节奏/结构，脚本会参考视频结构，请勿关闭"),
    };
  }
  if (!references.hasVideo) {
    return {
      title: t("AI 正在识别商品素材"),
      description: t("正在分析商品主体、外观、核心卖点与使用场景，约 15-30 秒，请勿关闭"),
    };
  }
  return {
    title: t("AI 正在分析素材 + 参考视频"),
    description: t("识别商品并拆解参考视频的节奏/镜头/结构，约 30-60 秒，请勿关闭"),
  };
}

export function getGenerateLoadingCopy(jobStage: PlanningJobStage, hasReasoning: boolean, deepThink: boolean) {
  if (deepThink && (
    hasReasoning
    || jobStage === 'timeline_running'
    || jobStage === 'copywriter_running'
    || jobStage === 'visual_director_running'
    || jobStage === 'validator_running'
  )) {
    return {
      title: t("AI 正在深度思考"),
      description: t("构思逐秒分镜脚本，约 1-2 分钟 · 可关闭弹窗，后台继续生成"),
    };
  }
  return {
    title: t("正在生成脚本"),
    description: t("可关闭弹窗，后台会继续生成，重新打开自动恢复"),
  };
}

export function normalizeProductInsights(value: PlanningProductInsights): PlanningProductInsights {
  return {
    productName: value.productName.trim(),
    productCategory: value.productCategory.trim(),
    productFeatures: normalizeTokens(value.productFeatures),
    coreSellingPoints: normalizeTokens(value.coreSellingPoints),
    targetAudience: normalizeTokens(value.targetAudience),
    useScenarios: normalizeTokens(value.useScenarios),
  };
}

export function normalizePlanningSettingsDraft(settings: PlanningSettings): PlanningSettings {
  const normalizedKeywords = Array.from(new Set(settings.styleKeywords.map((item) => item.trim()).filter(Boolean))).slice(0, 6);
  const supportedBusinessScenes: PlanningSettings['businessScene'][] = ['ecommerce', 'local_service', 'door_to_door', 'education'];
  return {
    ...settings,
    businessScene: supportedBusinessScenes.includes(settings.businessScene) ? settings.businessScene : 'unrestricted',
    candidateCount: Math.max(1, Math.min(3, Math.round(settings.candidateCount))),
    contentType: settings.contentType.trim(),
    durationSeconds: [5, 10, 15].includes(settings.durationSeconds) ? settings.durationSeconds : 5,
    extraInstruction: settings.extraInstruction.trim(),
    shootingMethod: settings.shootingMethod.trim(),
    styleKeywords: normalizedKeywords.length ? normalizedKeywords : [t("干净明亮")],
  };
}

export function normalizeTagToken(value: string) {
  return value.replace(/[，,]+$/g, '').trim();
}

export function serializeAnalysisDraft(analysisDraft: AnalysisDraft) {
  return JSON.stringify({
    materialCaptions: analysisDraft.materialCaptions.map((caption, index) => ({
      label: t("图片{{0}}", { "0": index + 1 }),
      description: caption.description.trim(),
      previewUrl: caption.previewUrl,
    })),
    productInsights: normalizeProductInsights(analysisDraft.productInsights),
    useBreakdown: analysisDraft.useBreakdown,
  });
}

export function serializeSessionAnalysis(session: PlanningSession, useBreakdown: boolean) {
  return JSON.stringify({
    materialCaptions: session.analysis.materialCaptions.map((caption, index) => ({
      label: t("图片{{0}}", { "0": index + 1 }),
      description: caption.description.trim(),
      previewUrl: caption.previewUrl,
    })),
    productInsights: normalizeProductInsights(session.analysis.productInsights),
    useBreakdown,
  });
}

export function serializeSettingsDraft(settings: PlanningSettings) {
  const normalized = normalizePlanningSettingsDraft(settings);
  return JSON.stringify({
    businessScene: normalized.businessScene,
    candidateCount: normalized.candidateCount,
    contentType: normalized.contentType,
    deepThink: normalized.deepThink,
    displayOnly: normalized.displayOnly,
    durationSeconds: normalized.durationSeconds,
    extraInstruction: normalized.extraInstruction,
    shootingMethod: normalized.shootingMethod,
    spokenLanguage: normalized.spokenLanguage,
    styleKeywords: normalized.styleKeywords,
    webSearch: normalized.webSearch,
  });
}

export function serializeStep1Draft(prompt: string, productName: string, materials: SelectedMaterials) {
  return JSON.stringify({
    materials: serializeMaterials(materials),
    productName: productName.trim(),
    prompt: prompt.trim(),
  });
}

export function serializeSessionStep1(session: PlanningSession) {
  return JSON.stringify({
    materials: [
      ...session.materialBundle.imageMaterials.map((asset) => `${asset.kind}:${asset.assetId}`),
      ...(session.materialBundle.referenceVideo ? [`video:${session.materialBundle.referenceVideo.assetId}`] : []),
      ...(session.materialBundle.referenceAudio ? [`audio:${session.materialBundle.referenceAudio.assetId}`] : []),
    ],
    productName: session.materialBundle.productName.trim(),
    prompt: session.materialBundle.prompt.trim(),
  });
}

export function sanitizePlanningMaterials(materials: SelectedMaterials): SelectedMaterials {
  const next: SelectedMaterials = {};
  const images = getLocalFiles(materials.image).slice(0, 9);
  const videos = getLocalFiles(materials.video).slice(0, 1);
  const audios = getLocalFiles(materials.audio).slice(0, 1);
  if (images.length) {
    next.image = images;
  }
  if (videos.length) {
    next.video = videos;
  }
  if (audios.length) {
    next.audio = audios;
  }
  return next;
}

function formatStoredStageOutputs(outputs: Record<string, unknown>) {
  return ['planner', 'strategy', 'timeline', 'copywriter', 'visualDirector', 'validator']
    .flatMap((stage) => {
      const output = outputs[stage];
      if (output === undefined || output === null) {
        return [];
      }
      return [auditStageLabels[stage], ...formatAuditValue(output, 0), ''];
    })
    .join('\n')
    .trim();
}

function formatAuditValue(value: unknown, depth: number): string[] {
  const indent = '  '.repeat(depth);
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => {
      if (isAuditPrimitive(item)) {
        return [`${indent}${index + 1}. ${formatAuditPrimitive(item)}`];
      }
      return [`${indent}${index + 1}.`, ...formatAuditValue(item, depth + 1)];
    });
  }
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, item]) => {
      if (hiddenAuditFields.has(key)) {
        return [];
      }
      const label = auditFieldLabels[key] || key;
      if (isAuditPrimitive(item)) {
        return [`${indent}${label}：${formatAuditPrimitive(item)}`];
      }
      return [`${indent}${label}：`, ...formatAuditValue(item, depth + 1)];
    });
  }
  return [`${indent}${formatAuditPrimitive(value)}`];
}

function formatAuditPrimitive(value: unknown) {
  if (typeof value === 'boolean') {
    return value ? t("是") : t("否");
  }
  if (value === null || value === undefined || value === '') {
    return t("无");
  }
  return String(value)
    .replace(/candidate-strategy-\d+-[a-z0-9]+/giu, '候选脚本')
    .replace(/strategy-\d+-[a-z0-9]+(?:-(?:segment|shot)-\d+)?/giu, '对应方案');
}

function isAuditPrimitive(value: unknown) {
  return value === null || ['boolean', 'number', 'string', 'undefined'].includes(typeof value);
}

function normalizeTokens(value: string[]) {
  return value
    .flatMap((item) => item.split(/\n|,|，/))
    .map((item) => item.trim())
    .filter(Boolean);
}

function serializeMaterials(materials: SelectedMaterials) {
  return [
    ...getLocalFiles(materials.image).map(serializeLocalMaterial),
    ...getLocalFiles(materials.video).map(serializeLocalMaterial),
    ...getLocalFiles(materials.audio).map(serializeLocalMaterial),
  ];
}

function serializeLocalMaterial(file: LocalMaterialFile) {
  return file.assetId
    ? `${file.type}:${file.assetId}`
    : file.serverFileUrl
      || `${file.type}:${file.name}:${file.file?.size || 0}`;
}
