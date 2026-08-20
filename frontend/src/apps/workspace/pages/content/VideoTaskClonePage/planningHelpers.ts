import { resolveAssetUrl } from '../../../api/request';
import type {
  PlanningApplyPayload,
  PlanningAssetRef,
  PlanningJobStage,
  PlanningSession,
  PlanningSessionUpdates,
  PlanningStatus,
  PlanningUiStep,
} from '../../../api/content-planning';
import type { LocalMaterialFile, SelectedMaterials, SelectedMaterialValue } from './types';
import { t } from '@shared/i18n';

export const planningSteps: PlanningUiStep[] = ['step1', 'step2', 'step3', 'step4'];

function planningTimestampTokenToSeconds(value: string) {
  const parts = value.trim().replace(/(?:秒|s)$/iu, '').split(':').map((part) => Number(part));
  if (!parts.length || parts.some((part) => !Number.isFinite(part) || part < 0)) {
    return null;
  }
  if (parts.length === 1) {
    return parts[0];
  }
  if (parts.length === 2) {
    return (parts[0] * 60) + parts[1];
  }
  if (parts.length === 3) {
    return (parts[0] * 3600) + (parts[1] * 60) + parts[2];
  }
  return null;
}

export function formatPlanningTimeRange(value: string) {
  const normalized = value
    .trim()
    .replace(/[：]/gu, ':')
    .replace(/[–—－~～]/gu, '-')
    .replace(/\s+/gu, ' ');
  const parts = normalized.split(/\s*(?:-|至)\s*/u);
  if (parts.length !== 2) {
    return normalized.replace(/s$/iu, '秒');
  }
  const start = planningTimestampTokenToSeconds(parts[0]);
  const end = planningTimestampTokenToSeconds(parts[1]);
  if (start === null || end === null) {
    return normalized.replace(/s$/iu, '秒');
  }
  return t("{{0}}-{{1}}秒", { "0": Number(start.toFixed(3)), "1": Number(end.toFixed(3)) });
}

export const planningStageLabels: Record<PlanningJobStage, string> = {
  idle: t("等待开始"),
  uploading_assets: t("上传素材"),
  analyzing_materials: t("识别商品素材"),
  analyzing_reference_video: t("拆解参考视频"),
  planner_running: t("Planner 生成 brief"),
  strategy_running: t("Strategy 生成方向"),
  timeline_running: t("Timeline 生成节奏"),
  copywriter_running: t("Copywriter 生成文案"),
  visual_director_running: t("Visual Director 生成分镜"),
  validator_running: t("Validator 校验结果"),
  completed: t("已完成"),
  failed: t("执行失败"),
};

export function cloneSelectedMaterialFiles(value: SelectedMaterialValue, limit = 9): LocalMaterialFile[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.slice(0, limit).map((file) => ({ ...file }));
}

export function buildPlanningSeedMaterials(
  session: PlanningSession | null,
  fallback: SelectedMaterials,
): SelectedMaterials {
  const hasSessionMaterials = Boolean(
    session?.materialBundle.imageMaterials.length
    || session?.materialBundle.referenceVideo
    || session?.materialBundle.referenceAudio,
  );
  if (hasSessionMaterials && session) {
    return compactPlanningMaterials({
      image: planningAssetRefsToLocalMaterials(session.materialBundle.imageMaterials),
      video: session.materialBundle.referenceVideo ? [planningAssetRefToLocalMaterial(session.materialBundle.referenceVideo)] : undefined,
      audio: session.materialBundle.referenceAudio ? [planningAssetRefToLocalMaterial(session.materialBundle.referenceAudio)] : undefined,
    });
  }
  return compactPlanningMaterials({
    image: cloneSelectedMaterialFiles(fallback.image, 9),
    video: cloneSelectedMaterialFiles(fallback.video, 1),
    audio: cloneSelectedMaterialFiles(fallback.audio, 1),
  });
}

export function planningAssetRefsToLocalMaterials(assets: PlanningAssetRef[]) {
  return assets.map(planningAssetRefToLocalMaterial);
}

export function planningAssetRefToLocalMaterial(asset: PlanningAssetRef): LocalMaterialFile {
  return {
    assetId: asset.assetId,
    audioDuration: asset.kind === 'audio' ? asset.durationSeconds : undefined,
    id: `${asset.kind}-${asset.assetId}`,
    name: asset.name || asset.originalFileName || asset.storedFileName || `${asset.kind} asset`,
    serverFileUrl: asset.fileUrl,
    storedFileName: asset.storedFileName,
    trimDuration: asset.kind === 'video' ? asset.durationSeconds : undefined,
    type: asset.kind,
    url: resolveAssetUrl(asset.fileUrl),
  };
}

export function planningShouldPoll(status?: PlanningStatus | null) {
  return status === 'analyzing' || status === 'generating';
}

export function resolvePlanningStep(session: Pick<PlanningSession, 'status' | 'uiStep' | 'jobStage'> | null | undefined): PlanningUiStep {
  if (!session) {
    return 'step1';
  }
  if (session.status === 'draft' || session.status === 'analyzing') {
    return 'step1';
  }
  if (session.status === 'confirming') {
    return 'step2';
  }
  if (session.status === 'configuring') {
    return 'step3';
  }
  if (session.status === 'generating' || session.status === 'ready_to_apply' || session.status === 'applied') {
    return 'step4';
  }
  if (session.status === 'failed') {
    if (session.jobStage === 'failed' && session.uiStep) {
      return session.uiStep;
    }
  }
  return session.uiStep || 'step1';
}

export function planningStepIndex(step: PlanningUiStep) {
  return planningSteps.indexOf(step);
}

export function mergePlanningSessionUpdates(
  session: PlanningSession,
  updates: PlanningSessionUpdates,
): PlanningSession {
  const existingLogs = session.generation.reasoningLogs;
  const nextLogs = [...existingLogs];
  updates.reasoningLogs.forEach((log) => {
    if (!nextLogs.some((current) => current.id === log.id)) {
      nextLogs.push(log);
    }
  });
  nextLogs.sort((left, right) => left.createdAt.localeCompare(right.createdAt));

  return {
    ...session,
    status: updates.status,
    jobStage: updates.jobStage,
    uiStep: resolvePlanningStep({
      status: updates.status,
      jobStage: updates.jobStage,
      uiStep: session.uiStep,
    }),
    updatedAt: updates.updatedAt,
    generation: {
      ...session.generation,
      reasoningLogs: nextLogs,
      reasoningStream: updates.reasoningStream,
      stages: updates.stages,
      candidates: updates.candidates,
      selectedCandidateId: updates.selectedCandidateId,
    },
  };
}

export function normalizePlanningPromptTokens(value: string) {
  return value
    .replace(/@image(\d+)/gi, '@图片$1')
    .replace(/@video(\d+)/gi, '@视频$1')
    .replace(/@audio(\d+)/gi, '@音频$1');
}

export function displayPlanningMaterialRef(value: string) {
  return normalizePlanningPromptTokens(value).replace(/^@/, '');
}

export function planningApplyPayloadToFormState(payload: PlanningApplyPayload) {
  // Reference video guides planning structure only; it is not a generation input.
  return {
    audioMaterials: payload.allowlist.referenceAudio
      ? [planningAssetRefToLocalMaterial(payload.allowlist.referenceAudio)]
      : [],
    duration: payload.allowlist.duration,
    imageMaterials: planningAssetRefsToLocalMaterials(payload.allowlist.imageMaterials),
    prompt: normalizePlanningPromptTokens(payload.allowlist.prompt),
  };
}

export function planningCompletionRatio(jobStage: PlanningJobStage, stageCount: number) {
  if (jobStage === 'completed') {
    return 1;
  }
  if (jobStage === 'failed' || jobStage === 'idle') {
    return 0;
  }
  const runningOrder: PlanningJobStage[] = [
    'analyzing_materials',
    'analyzing_reference_video',
    'planner_running',
    'strategy_running',
    'timeline_running',
    'copywriter_running',
    'visual_director_running',
    'validator_running',
  ];
  const runningIndex = runningOrder.indexOf(jobStage);
  if (runningIndex === -1 || stageCount <= 0) {
    return 0;
  }
  const normalized = Math.min(runningIndex + 1, stageCount) / stageCount;
  return Math.max(0.12, normalized);
}

function compactPlanningMaterials(materials: {
  image?: LocalMaterialFile[];
  video?: LocalMaterialFile[];
  audio?: LocalMaterialFile[];
}): SelectedMaterials {
  const next: SelectedMaterials = {};
  if (materials.image?.length) {
    next.image = materials.image;
  }
  if (materials.video?.length) {
    next.video = materials.video;
  }
  if (materials.audio?.length) {
    next.audio = materials.audio;
  }
  return next;
}
