import { randomUUID } from 'node:crypto';
import { arkVideoUnderstandingConfig } from '../../config/env.js';
import {
  findReservedFixedBillableUsage,
  getContentPlanningBillingCredits,
  releaseFixedBillableUsage,
  reserveFixedBillableUsage,
  settleFixedBillableUsage,
} from '../billing/billing.service.js';
import type { CreditReservation } from '../billing/billing.types.js';
import { contentRepository } from '../content/content.repository.js';
import type { ContentAsset } from '../content/content.types.js';
import {
  createEmptyPlanningGeneration,
  contentPlanningRepository,
} from './content-planning.repository.js';
import {
  buildContentPlanningPrompt,
  createContentPlanningAgentProvider,
  type ContentPlanningAgentProvider,
  type PlanningBrief,
  type PlanningRuntimeContext,
  type PlanningScriptLines,
  type PlanningTimeline,
} from './content-planning-agent-runtime.js';
import {
  createContentPlanningAnalysisProvider,
  type ContentPlanningAnalysisAsset,
  type ContentPlanningAnalysisProvider,
} from './content-planning-analysis-runtime.js';
import { publishContentPlanningEvent } from './content-planning.events.js';
import { buildContentPlanningWebSearchContext } from './content-planning-web-search.js';
import { logger } from '../../shared/logger.js';
import type {
  AgentStage,
  ContentPlanningAgentStageStatus,
  ContentPlanningAnalysis,
  ContentPlanningAssetRef,
  ContentPlanningCandidate,
  ContentPlanningGeneration,
  ContentPlanningJobStage,
  ContentPlanningMediaInput,
  ContentPlanningSession,
  ContentPlanningReasoningLog,
  ContentPlanningReasoningStream,
  ContentPlanningSettings,
  ContentPlanningStrategyDirection,
  CreateContentPlanningSessionPayload,
  AnalyzeContentPlanningSessionPayload,
  UpdateContentPlanningConfirmationPayload,
  UpdateContentPlanningSettingsPayload,
} from './content-planning.types.js';

const runningAnalysisJobs = new Set<string>();
const runningGenerationJobs = new Set<string>();

export type ContentPlanningAnalysisBilling = {
  reserve(input: {
    userId: string;
    sessionId: string;
    imageCount: number;
    hasReferenceVideo: boolean;
  }): CreditReservation | null;
  complete(input: { reservation: CreditReservation; sessionId: string }): void;
  fail(reservation: CreditReservation): void;
};

const defaultContentPlanningAnalysisBilling: ContentPlanningAnalysisBilling = {
  reserve(input) {
    const { analysisCredits } = getContentPlanningBillingCredits();
    if (analysisCredits <= 0) {
      return null;
    }
    return reserveFixedBillableUsage({
      userId: input.userId,
      category: 'content_planning_analysis',
      sourceType: 'content_planning_analysis',
      sourceId: `${input.sessionId}:analysis:${randomUUID()}`,
      sessionId: input.sessionId,
      credits: analysisCredits,
      step: 'content_planning_analysis',
      stepLabel: '爆款策划素材识别',
      requestSnapshot: {
        imageCount: input.imageCount,
        hasReferenceVideo: input.hasReferenceVideo,
      },
    });
  },
  complete(input) {
    settleFixedBillableUsage({
      reservation: input.reservation,
      category: 'content_planning_analysis',
      provider: 'volcengine-ark',
      model: arkVideoUnderstandingConfig.model,
      sessionId: input.sessionId,
      responseSnapshot: { status: 'completed' },
    });
  },
  fail(reservation) {
    releaseFixedBillableUsage(reservation);
  },
};

export type ContentPlanningGenerationBilling = {
  reserve(input: {
    userId: string;
    sessionId: string;
    candidateCount: number;
    deepThink: boolean;
    regenerate: boolean;
  }): CreditReservation | null;
  recover(sessionId: string): CreditReservation | null;
  complete(input: { reservation: CreditReservation; sessionId: string }): void;
  fail(reservation: CreditReservation): void;
};

const defaultContentPlanningGenerationBilling: ContentPlanningGenerationBilling = {
  reserve(input) {
    const { generationCredits } = getContentPlanningBillingCredits();
    if (generationCredits <= 0) {
      return null;
    }
    return reserveFixedBillableUsage({
      userId: input.userId,
      category: 'content_planning_generation',
      sourceType: 'content_planning_generation',
      sourceId: `${input.sessionId}:generation:${randomUUID()}`,
      sessionId: input.sessionId,
      credits: generationCredits,
      step: 'content_planning_generation',
      stepLabel: '爆款策划脚本生成',
      requestSnapshot: {
        candidateCount: input.candidateCount,
        deepThink: input.deepThink,
        regenerate: input.regenerate,
      },
    });
  },
  recover(sessionId) {
    return findReservedFixedBillableUsage({
      sourceType: 'content_planning_generation',
      sessionId,
    });
  },
  complete(input) {
    settleFixedBillableUsage({
      reservation: input.reservation,
      category: 'content_planning_generation',
      provider: 'configured-llm',
      sessionId: input.sessionId,
      responseSnapshot: { status: 'completed' },
    });
  },
  fail(reservation) {
    releaseFixedBillableUsage(reservation);
  },
};

function nowIso() {
  return new Date().toISOString();
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || 'content planning failed');
}

function assertSessionOwner(session: ContentPlanningSession | null, userId: string) {
  if (!session || session.userId !== userId) {
    throw new Error('planning session not found');
  }
  return session;
}

function mediaKindForMimeType(mimeType: string): ContentPlanningAssetRef['kind'] | null {
  if (mimeType.startsWith('image/')) {
    return 'image';
  }
  if (mimeType.startsWith('video/')) {
    return 'video';
  }
  if (mimeType.startsWith('audio/')) {
    return 'audio';
  }
  return null;
}

function assetRef(asset: ContentAsset, kind: ContentPlanningAssetRef['kind']): ContentPlanningAssetRef {
  return {
    assetId: asset.id,
    kind,
    name: asset.name,
    fileUrl: asset.fileUrl,
    mimeType: asset.mimeType,
    originalFileName: asset.originalFileName,
    storedFileName: asset.storedFileName,
  };
}

function resolveOwnedAsset(userId: string, assetId: string, expectedKind: ContentPlanningAssetRef['kind']) {
  const asset = contentRepository.findAsset(assetId);
  if (!asset || asset.userId !== userId) {
    throw new Error(`asset ${assetId} not found`);
  }
  const actualKind = mediaKindForMimeType(asset.mimeType);
  if (actualKind !== expectedKind) {
    throw new Error(`asset ${assetId} is not a ${expectedKind} asset`);
  }
  return assetRef(asset, expectedKind);
}

function dedupeMedia(media: ContentPlanningMediaInput[]) {
  return [...new Map(media.map((item) => [`${item.kind}:${item.assetId}`, item])).values()];
}

function normalizeSettings(current: ContentPlanningSettings, input: Partial<ContentPlanningSettings>): ContentPlanningSettings {
  const duration = input.durationSeconds ?? current.durationSeconds;
  if (![5, 10, 15].includes(Number(duration))) {
    throw new Error('durationSeconds must be 5, 10, or 15');
  }
  const candidateCount = input.candidateCount ?? current.candidateCount;
  if (!Number.isInteger(candidateCount) || candidateCount < 1 || candidateCount > 3) {
    throw new Error('candidateCount must be an integer from 1 to 3');
  }
  return {
    ...current,
    ...input,
    durationSeconds: Number(duration) as ContentPlanningSettings['durationSeconds'],
    candidateCount,
    styleKeywords: Array.isArray(input.styleKeywords) ? input.styleKeywords.filter(Boolean).slice(0, 12) : current.styleKeywords,
    referencePolicy: {
      ...current.referencePolicy,
      ...(input.referencePolicy || {}),
    },
  };
}

function createStage(role: AgentStage['role'], status: ContentPlanningAgentStageStatus = 'pending'): AgentStage {
  return {
    id: `stage-${role.toLowerCase().replace(/\s+/g, '-')}`,
    role,
    status,
    inputSummary: '',
    outputSummary: '',
  };
}

function initialStages(): AgentStage[] {
  return ['Planner', 'Strategy', 'Timeline', 'Copywriter', 'Visual Director', 'Validator'].map((role) => createStage(role as AgentStage['role']));
}

function resetGeneration() {
  return createEmptyPlanningGeneration();
}

function stageJobStage(role: AgentStage['role']): ContentPlanningJobStage {
  return {
    Planner: 'planner_running',
    Strategy: 'strategy_running',
    Timeline: 'timeline_running',
    Copywriter: 'copywriter_running',
    'Visual Director': 'visual_director_running',
    Validator: 'validator_running',
  }[role] as ContentPlanningJobStage;
}

function roleForJobStage(jobStage: ContentPlanningJobStage): AgentStage['role'] | null {
  const roles: Partial<Record<ContentPlanningJobStage, AgentStage['role']>> = {
    planner_running: 'Planner',
    strategy_running: 'Strategy',
    timeline_running: 'Timeline',
    copywriter_running: 'Copywriter',
    visual_director_running: 'Visual Director',
    validator_running: 'Validator',
  };
  return roles[jobStage] || null;
}

function stageOutputSummary(role: AgentStage['role'], output: unknown) {
  if (role === 'Planner') {
    return (output as PlanningBrief).summary;
  }
  if (role === 'Strategy') {
    return `已生成 ${(output as ContentPlanningStrategyDirection[]).length} 条差异化创意策略。`;
  }
  if (role === 'Timeline') {
    return `已完成 ${(output as PlanningTimeline[]).length} 条逐秒时间轴。`;
  }
  if (role === 'Copywriter') {
    return `已完成 ${(output as PlanningScriptLines[]).length} 条分段口播文案。`;
  }
  if (role === 'Visual Director') {
    return `已完成 ${(output as ContentPlanningCandidate[]).length} 条完整视觉分镜。`;
  }
  return (output as { summary: string }).summary;
}

function numberedLines(items: string[]) {
  return items.map((item, index) => `${index + 1}. ${item}`).join('\n');
}

function readablePlanningText(value: string) {
  return value
    .replace(/candidate-strategy-\d+-[a-z0-9]+/giu, '候选脚本')
    .replace(/strategy-\d+-[a-z0-9]+(?:-(?:segment|shot)-\d+)?/giu, '对应方案');
}

function stageReasoningContent(role: AgentStage['role'], output: unknown) {
  if (role === 'Planner') {
    const brief = output as PlanningBrief;
    return [
      '1. 分析输入与约束',
      `策划简报：${brief.summary}`,
      '',
      '硬性约束：',
      numberedLines(brief.hardConstraints),
      '',
      '候选创意方向：',
      numberedLines(brief.candidateDirections),
    ].join('\n');
  }
  if (role === 'Strategy') {
    const strategies = output as ContentPlanningStrategyDirection[];
    return [
      '2. 策略规划与差异化路线',
      ...strategies.flatMap((strategy, index) => [
        '',
        `方案 ${index + 1}｜${strategy.title}`,
        `开场钩子：${strategy.hook}`,
        `受众角度：${strategy.audienceAngle}`,
        `情绪曲线：${strategy.emotionalArc}`,
        `参考结构：${strategy.followReferenceStructure ? '沿用参考视频结构' : '采用独立结构'}`,
        `策略摘要：${strategy.summary}`,
        `标签：${strategy.tags.join('、') || '无'}`,
      ]),
    ].join('\n');
  }
  if (role === 'Timeline') {
    const timelines = output as PlanningTimeline[];
    return [
      '3. 细化时间轴与节奏',
      ...timelines.flatMap((timeline, index) => [
        '',
        `方案 ${index + 1}`,
        ...timeline.segments.map((segment) => (
          `${segment.startSecond}-${segment.endSecond}s｜节奏：${segment.beat}｜目标：${segment.goal}`
        )),
      ]),
    ].join('\n');
  }
  if (role === 'Copywriter') {
    const scripts = output as PlanningScriptLines[];
    return [
      '4. 撰写文案与字数检查',
      ...scripts.flatMap((script, index) => [
        '',
        `方案 ${index + 1}`,
        ...script.lines.map((line, lineIndex) => (
          `第 ${lineIndex + 1} 段：${line.text || '无口播，仅画面展示'}`
        )),
      ]),
    ].join('\n');
  }
  if (role === 'Visual Director') {
    const candidates = output as ContentPlanningCandidate[];
    return [
      '5. 视觉落地与分镜定稿',
      ...candidates.flatMap((candidate, index) => [
        '',
        `方案 ${index + 1}｜${candidate.title}`,
        `钩子：${candidate.hook}`,
        `受众角度：${candidate.audienceAngle}`,
        `方案摘要：${candidate.summary}`,
        `标签：${candidate.tags.join('、') || '无'}`,
        ...candidate.storyboard.flatMap((segment, segmentIndex) => [
          `分镜 ${segmentIndex + 1}｜${segment.startSecond}-${segment.endSecond}s｜${segment.title}`,
          `画面：${segment.visual}`,
          `动作：${segment.action}`,
          `镜头：${segment.camera}`,
          `光线：${segment.lighting}`,
          `空间：${segment.spaceRelation}`,
          `口播：${segment.dialogue || '无'}`,
          `音效：${segment.soundEffect || '无'}`,
        ]),
      ]),
    ].join('\n');
  }
  const validation = output as {
    candidates: ContentPlanningCandidate[];
    selectedCandidateId: string;
    summary: string;
    repairApplied?: boolean;
    validationPassed?: boolean;
  };
  const selectedCandidate = validation.candidates.find((candidate) => candidate.id === validation.selectedCandidateId);
  return [
    '6. 校验、修正与最终选择',
    `综合结论：${readablePlanningText(validation.summary)}`,
    `自动修复：${validation.repairApplied ? '已执行一轮并完成最终复核' : '无需修复'}`,
    `推荐方案：${selectedCandidate?.title || '未选出可执行方案'}`,
    ...validation.candidates.flatMap((candidate, index) => [
      '',
      `方案 ${index + 1}｜${candidate.title}｜评分 ${candidate.score}`,
      `问题：${candidate.issues.join('；') || '未发现阻断问题'}`,
      `修复建议：${candidate.repairAdvice || '无需修复'}`,
    ]),
  ].join('\n');
}

function stageReasoningTitle(role: AgentStage['role']) {
  return {
    Planner: '1. 分析输入与约束',
    Strategy: '2. 策略规划与差异化路线',
    Timeline: '3. 细化时间轴与节奏',
    Copywriter: '4. 撰写文案与字数检查',
    'Visual Director': '5. 视觉落地与分镜定稿',
    Validator: '6. 校验、修正与最终选择',
  }[role];
}

function stageOutputKey(role: AgentStage['role']) {
  return {
    Planner: 'planner',
    Strategy: 'strategy',
    Timeline: 'timeline',
    Copywriter: 'copywriter',
    'Visual Director': 'visualDirector',
    Validator: 'validator',
  }[role] as keyof ContentPlanningGeneration['stageOutputs'];
}

function updateStage(generation: ContentPlanningGeneration, role: AgentStage['role'], patch: Partial<AgentStage>) {
  const stages = generation.stages.length ? [...generation.stages] : initialStages();
  const index = stages.findIndex((stage) => stage.role === role);
  stages[index === -1 ? stages.length : index] = {
    ...(stages[index] || createStage(role)),
    ...patch,
  };
  return { ...generation, stages };
}

function analysisAsset(userId: string, material: ContentPlanningAssetRef): ContentPlanningAnalysisAsset {
  const asset = contentRepository.findAsset(material.assetId);
  if (!asset || asset.userId !== userId) {
    throw new Error(`asset ${material.assetId} not found`);
  }
  return { ...material, filePath: asset.filePath };
}

export class ContentPlanningService {
  constructor(
    private readonly provider: ContentPlanningAgentProvider = createContentPlanningAgentProvider(),
    private readonly analysisProvider: ContentPlanningAnalysisProvider = createContentPlanningAnalysisProvider(),
    private readonly analysisBilling: ContentPlanningAnalysisBilling = defaultContentPlanningAnalysisBilling,
    private readonly generationBilling: ContentPlanningGenerationBilling = defaultContentPlanningGenerationBilling,
  ) {}

  getClientConfig() {
    return getContentPlanningBillingCredits();
  }

  createSession(input: CreateContentPlanningSessionPayload) {
    const sourceSurface = input.sourceSurface || 'create_video';
    if (input.sessionId) {
      return assertSessionOwner(contentPlanningRepository.findSession(input.sessionId), input.userId);
    }
    if (input.restoreLatest) {
      const latest = contentPlanningRepository.findLatestRestorableSession(input.userId, sourceSurface);
      if (latest) {
        return latest;
      }
    }
    const created = contentPlanningRepository.createSession({ userId: input.userId, sourceSurface });
    if (!created) {
      throw new Error('planning session could not be created');
    }
    const materialBundle = {
      ...created.materialBundle,
      prompt: input.prompt?.trim() || '',
      productName: input.productName?.trim() || '',
    };
    return contentPlanningRepository.updateSession(created.id, { materialBundle }) || created;
  }

  getSession(userId: string, sessionId: string) {
    return assertSessionOwner(contentPlanningRepository.findSession(sessionId), userId);
  }

  getUpdates(userId: string, sessionId: string, _since?: string) {
    const session = this.getSession(userId, sessionId);
    return {
      sessionId: session.id,
      status: session.status,
      jobStage: session.jobStage,
      updatedAt: session.updatedAt,
      reasoningLogs: session.generation.reasoningLogs,
      reasoningStream: session.generation.reasoningStream,
      stages: session.generation.stages,
      candidates: session.generation.candidates,
      selectedCandidateId: session.generation.selectedCandidateId,
    };
  }

  analyze(input: AnalyzeContentPlanningSessionPayload) {
    const session = this.getSession(input.userId, input.sessionId);
    if (runningAnalysisJobs.has(input.sessionId) || session.status === 'analyzing') {
      throw new Error('planning analysis is already in progress');
    }
    const media = dedupeMedia([
      ...(input.imageAssetIds || []).map((assetId) => ({ assetId, kind: 'image' as const })),
      ...(input.referenceVideoAssetId ? [{ assetId: input.referenceVideoAssetId, kind: 'video' as const }] : []),
      ...(input.referenceAudioAssetId ? [{ assetId: input.referenceAudioAssetId, kind: 'audio' as const }] : []),
      ...(input.media || []),
    ]);
    const imageMaterials = media.filter((item) => item.kind === 'image').map((item) => resolveOwnedAsset(input.userId, item.assetId, 'image'));
    if (imageMaterials.length === 0) {
      throw new Error('at least one product image is required');
    }
    if (imageMaterials.length > 9) {
      throw new Error('a planning session supports at most 9 image materials');
    }
    const referenceVideo = media.find((item) => item.kind === 'video');
    const referenceAudio = media.find((item) => item.kind === 'audio');
    const materialBundle = {
      ...session.materialBundle,
      prompt: input.prompt?.trim() ?? session.materialBundle.prompt,
      productName: input.productName.trim(),
      imageMaterials,
      referenceVideo: referenceVideo ? resolveOwnedAsset(input.userId, referenceVideo.assetId, 'video') : null,
      referenceAudio: referenceAudio ? resolveOwnedAsset(input.userId, referenceAudio.assetId, 'audio') : null,
    };
    const settings = {
      ...session.settings,
      referencePolicy: {
        ...session.settings.referencePolicy,
        useBreakdown: Boolean(referenceVideo),
      },
    };
    const analysisReservation = this.analysisBilling.reserve({
      userId: input.userId,
      sessionId: input.sessionId,
      imageCount: imageMaterials.length,
      hasReferenceVideo: Boolean(referenceVideo),
    });
    let next: ContentPlanningSession | null = null;
    try {
      next = contentPlanningRepository.updateSession(input.sessionId, {
        status: 'analyzing',
        uiStep: 'step1',
        jobStage: 'analyzing_materials',
        materialBundle,
        settings,
        generation: resetGeneration(),
        applySnapshot: null,
        errorMessage: '',
      });
    } catch (error) {
      if (analysisReservation) {
        this.analysisBilling.fail(analysisReservation);
      }
      throw error;
    }
    if (!next) {
      if (analysisReservation) {
        this.analysisBilling.fail(analysisReservation);
      }
      throw new Error('planning session could not be updated');
    }
    runningAnalysisJobs.add(next.id);
    void this.runAnalysis(next.id, input.userId, analysisReservation);
    return next;
  }

  private async runAnalysis(
    sessionId: string,
    userId: string,
    analysisReservation: CreditReservation | null,
  ) {
    try {
      await Promise.resolve();
      let session = this.getSession(userId, sessionId);
      const productAnalysis = session.materialBundle.imageMaterials.length
        ? await this.analysisProvider.analyzeProduct({
          productName: session.materialBundle.productName,
          prompt: session.materialBundle.prompt,
          images: session.materialBundle.imageMaterials.map((material) => analysisAsset(userId, material)),
        })
        : {
          materialCaptions: [],
          productInsights: {
            productName: session.materialBundle.productName,
            productCategory: '',
            productFeatures: [],
            coreSellingPoints: [],
            targetAudience: [],
            useScenarios: [],
          },
        };
      const analysis: ContentPlanningAnalysis = {
        ...session.analysis,
        ...productAnalysis,
        confirmed: false,
        notes: [],
      };
      const hasReferenceVideo = Boolean(session.materialBundle.referenceVideo);
      session = contentPlanningRepository.updateSession(sessionId, {
        jobStage: hasReferenceVideo ? 'analyzing_reference_video' : 'completed',
        analysis,
      }) || session;
      const viralBreakdown = hasReferenceVideo
        ? await this.analysisProvider.analyzeReference({
          productName: session.materialBundle.productName,
          prompt: session.materialBundle.prompt,
          productInsights: productAnalysis.productInsights,
          video: session.materialBundle.referenceVideo
            ? analysisAsset(userId, session.materialBundle.referenceVideo)
            : null,
        })
        : null;
      const completed = contentPlanningRepository.updateSession(sessionId, {
        status: 'confirming',
        uiStep: 'step2',
        jobStage: 'completed',
        analysis: { ...analysis, viralBreakdown },
      });
      if (!completed) {
        throw new Error('planning session could not be updated');
      }
      if (analysisReservation) {
        this.analysisBilling.complete({ reservation: analysisReservation, sessionId });
      }
    } catch (error) {
      if (analysisReservation) {
        try {
          this.analysisBilling.fail(analysisReservation);
        } catch (billingError) {
          logger.error('content planning analysis credit release failed', {
            sessionId,
            userId,
            error: errorMessage(billingError),
          });
        }
      }
      contentPlanningRepository.updateSession(sessionId, {
        status: 'failed',
        jobStage: 'failed',
        errorMessage: errorMessage(error),
      });
    } finally {
      runningAnalysisJobs.delete(sessionId);
    }
  }

  updateConfirmation(input: UpdateContentPlanningConfirmationPayload) {
    const session = this.getSession(input.userId, input.sessionId);
    const analysis: ContentPlanningAnalysis = {
      ...session.analysis,
      viralBreakdown: input.viralBreakdown === undefined ? session.analysis.viralBreakdown : input.viralBreakdown,
      materialCaptions: input.materialCaptions,
      productInsights: input.productInsights,
      confirmed: true,
    };
    const settings = {
      ...session.settings,
      referencePolicy: input.referencePolicy,
    };
    return contentPlanningRepository.updateSession(input.sessionId, {
      status: 'configuring',
      uiStep: 'step3',
      jobStage: 'idle',
      analysis,
      settings,
      generation: resetGeneration(),
      applySnapshot: null,
      errorMessage: '',
    });
  }

  updateSettings(input: UpdateContentPlanningSettingsPayload) {
    const session = this.getSession(input.userId, input.sessionId);
    const settings = normalizeSettings(session.settings, input.settings);
    return contentPlanningRepository.updateSession(input.sessionId, {
      status: 'configuring',
      uiStep: 'step3',
      jobStage: 'idle',
      settings,
      generation: resetGeneration(),
      applySnapshot: null,
      errorMessage: '',
    });
  }

  generate(userId: string, sessionId: string, regenerate = false) {
    const session = this.getSession(userId, sessionId);
    if (!session.analysis.confirmed) {
      throw new Error('confirm planning analysis before generating candidates');
    }
    if (runningGenerationJobs.has(sessionId)) {
      return session;
    }
    if (session.status === 'generating') {
      this.resumeInterruptedGeneration(sessionId);
      return this.getSession(userId, sessionId);
    }
    const generation: ContentPlanningGeneration = {
      ...resetGeneration(),
      stages: initialStages(),
    };
    const generationReservation = this.generationBilling.reserve({
      userId,
      sessionId,
      candidateCount: session.settings.candidateCount,
      deepThink: session.settings.deepThink,
      regenerate,
    });
    let next: ContentPlanningSession | null = null;
    try {
      next = contentPlanningRepository.updateSession(sessionId, {
        status: 'generating',
        uiStep: 'step4',
        jobStage: 'planner_running',
        generation,
        applySnapshot: null,
        errorMessage: '',
      });
    } catch (error) {
      if (generationReservation) {
        this.generationBilling.fail(generationReservation);
      }
      throw error;
    }
    if (!next) {
      if (generationReservation) {
        this.generationBilling.fail(generationReservation);
      }
      throw new Error('planning session could not be updated');
    }
    runningGenerationJobs.add(sessionId);
    void this.runGeneration(sessionId, userId, generationReservation);
    return next;
  }

  resumeInterruptedGenerationsOnStartup() {
    const sessions = contentPlanningRepository.listSessionsByStatuses(['generating']);
    if (!sessions.length) {
      logger.info('no interrupted content planning generations to resume');
      return 0;
    }
    logger.info('resuming interrupted content planning generations', {
      count: sessions.length,
      sessionIds: sessions.map((session) => session.id),
    });
    sessions.forEach((session) => {
      this.resumeInterruptedGeneration(session.id);
    });
    return sessions.length;
  }

  resumeInterruptedGeneration(sessionId: string) {
    const session = contentPlanningRepository.findSession(sessionId);
    if (!session || session.status !== 'generating' || runningGenerationJobs.has(sessionId)) {
      return false;
    }
    runningGenerationJobs.add(sessionId);
    logger.warn('resuming interrupted content planning generation', {
      sessionId,
      userId: session.userId,
      jobStage: session.jobStage,
    });
    let generationReservation: CreditReservation | null = null;
    try {
      generationReservation = this.generationBilling.recover(sessionId);
    } catch (error) {
      logger.error('content planning generation credit recovery failed', {
        sessionId,
        userId: session.userId,
        error: errorMessage(error),
      });
    }
    void this.runGeneration(sessionId, session.userId, generationReservation);
    return true;
  }

  private async runGeneration(
    sessionId: string,
    userId: string,
    generationReservation: CreditReservation | null,
  ) {
    try {
      let session = this.getSession(userId, sessionId);
      let context: PlanningRuntimeContext = { session };
      let generation = session.generation;
      if (session.settings.webSearch) {
        const webSearchContext = await buildContentPlanningWebSearchContext(session);
        context = { ...context, webSearchContext };
        if (webSearchContext.errorMessage) {
          logger.warn('content planning web search completed with errors', {
            sessionId,
            userId,
            error: webSearchContext.errorMessage,
          });
        }
      }
      const execute = async <T>(
        role: AgentStage['role'],
        action: (onAuditDelta?: (delta: string) => void) => Promise<T>,
      ) => {
        const startedAt = nowIso();
        const jobStage = stageJobStage(role);
        let lastPersistedAt = 0;
        const initialReasoningStream: ContentPlanningReasoningStream | null = session.settings.deepThink
          ? {
            stage: jobStage,
            role,
            content: `${stageReasoningTitle(role)}\n`,
            updatedAt: startedAt,
          }
          : null;
        generation = updateStage(generation, role, {
          status: 'running',
          startedAt,
          inputSummary: `Input snapshot for ${role}`,
          errorMessage: undefined,
        });
        generation = { ...generation, reasoningStream: initialReasoningStream };
        contentPlanningRepository.updateSession(sessionId, { jobStage, generation });
        if (initialReasoningStream) {
          publishContentPlanningEvent(userId, {
            type: 'reasoning_stream',
            sessionId,
            reasoningStream: initialReasoningStream,
          });
        }
        const onAuditDelta = session.settings.deepThink
          ? (delta: string) => {
            if (!delta) {
              return;
            }
            const current = generation.reasoningStream?.stage === jobStage
              ? generation.reasoningStream
              : initialReasoningStream;
            if (!current) {
              return;
            }
            const reasoningStream: ContentPlanningReasoningStream = {
              ...current,
              content: `${current.content}${delta}`,
              updatedAt: nowIso(),
            };
            generation = { ...generation, reasoningStream };
            publishContentPlanningEvent(userId, {
              type: 'reasoning_stream',
              sessionId,
              reasoningStream,
            });
            if (Date.now() - lastPersistedAt >= 120) {
              lastPersistedAt = Date.now();
              contentPlanningRepository.updateSession(sessionId, { generation });
            }
          }
          : undefined;
        const output = await action(onAuditDelta);
        const completedAt = nowIso();
        generation = updateStage(generation, role, {
          status: 'completed',
          completedAt,
          outputSummary: stageOutputSummary(role, output),
        });
        const key = stageOutputKey(role);
        generation = { ...generation, stageOutputs: { ...generation.stageOutputs, [key]: output } };
        let reasoningLog: ContentPlanningReasoningLog | undefined;
        if (session.settings.deepThink) {
          reasoningLog = {
            id: `reasoning-${randomId()}`,
            stage: jobStage,
            role,
            content: stageReasoningContent(role, output),
            createdAt: completedAt,
          };
          generation = {
            ...generation,
            reasoningLogs: [...generation.reasoningLogs, reasoningLog],
            reasoningStream: null,
          };
        }
        contentPlanningRepository.updateSession(sessionId, { generation });
        if (reasoningLog) {
          publishContentPlanningEvent(userId, {
            type: 'stage_completed',
            sessionId,
            reasoningStream: null,
            reasoningLog,
          });
        }
        return output;
      };

      const executeOrRestore = async <T>(
        role: AgentStage['role'],
        action: (onAuditDelta?: (delta: string) => void) => Promise<T>,
      ) => {
        const stage = generation.stages.find((item) => item.role === role);
        const restored = generation.stageOutputs[stageOutputKey(role)] as T | undefined;
        if (stage?.status === 'completed' && restored !== undefined) {
          return restored;
        }
        return execute(role, action);
      };

      const brief = await executeOrRestore('Planner', (onAuditDelta) => this.provider.planner({ ...context, onAuditDelta }));
      context = { ...context, brief };
      const strategies = await executeOrRestore('Strategy', (onAuditDelta) => this.provider.strategy({ ...context, onAuditDelta }));
      context = { ...context, strategies };
      const timelines = await executeOrRestore('Timeline', (onAuditDelta) => this.provider.timeline({ ...context, onAuditDelta }));
      context = { ...context, timelines };
      const scripts = await executeOrRestore('Copywriter', (onAuditDelta) => this.provider.copywriter({ ...context, onAuditDelta }));
      context = { ...context, scripts };
      const candidates = await executeOrRestore('Visual Director', (onAuditDelta) => this.provider.visualDirector({ ...context, onAuditDelta }));
      context = { ...context, candidates };
      const validated = await executeOrRestore('Validator', (onAuditDelta) => this.provider.validator({ ...context, candidates, onAuditDelta }));
      generation = {
        ...generation,
        candidates: validated.candidates,
        selectedCandidateId: validated.selectedCandidateId,
        validatorSummary: validated.summary,
      };
      if (!validated.validationPassed) {
        contentPlanningRepository.updateSession(sessionId, { generation });
        throw new Error('候选脚本自动修复后仍未通过最终校验，请调整设置或素材后重新生成');
      }
      const completed = contentPlanningRepository.updateSession(sessionId, {
        status: 'ready_to_apply',
        uiStep: 'step4',
        jobStage: 'completed',
        generation,
      });
      if (!completed) {
        throw new Error('planning session could not be updated');
      }
      if (generationReservation) {
        this.generationBilling.complete({ reservation: generationReservation, sessionId });
      }
    } catch (error) {
      if (generationReservation) {
        try {
          this.generationBilling.fail(generationReservation);
        } catch (billingError) {
          logger.error('content planning generation credit release failed', {
            sessionId,
            userId,
            error: errorMessage(billingError),
          });
        }
      }
      const current = contentPlanningRepository.findSession(sessionId);
      const role = current ? roleForJobStage(current.jobStage) : null;
      const generation = current
        ? {
          ...(role ? updateStage(current.generation, role, {
            status: 'failed',
            errorMessage: errorMessage(error),
            completedAt: nowIso(),
          }) : current.generation),
          reasoningStream: null,
        }
        : undefined;
      contentPlanningRepository.updateSession(sessionId, {
        status: 'failed',
        jobStage: 'failed',
        errorMessage: errorMessage(error),
        ...(generation ? { generation } : {}),
      });
      publishContentPlanningEvent(userId, {
        type: 'generation_failed',
        sessionId,
        reasoningStream: null,
      });
    } finally {
      runningGenerationJobs.delete(sessionId);
    }
  }

  selectCandidate(userId: string, sessionId: string, candidateId: string) {
    const session = this.getSession(userId, sessionId);
    const candidate = session.generation.candidates.find((item) => item.id === candidateId);
    if (!candidate) {
      throw new Error('planning candidate not found');
    }
    return contentPlanningRepository.updateSession(sessionId, {
      generation: { ...session.generation, selectedCandidateId: candidateId },
    });
  }

  apply(userId: string, sessionId: string, candidateId?: string) {
    const session = this.getSession(userId, sessionId);
    if (session.status !== 'ready_to_apply') {
      throw new Error('planning session is not ready to apply');
    }
    const selectedId = candidateId || session.generation.selectedCandidateId;
    const candidate = session.generation.candidates.find((item) => item.id === selectedId);
    if (!candidate) {
      throw new Error('select a planning candidate before applying');
    }
    if (candidate.issues.length) {
      throw new Error('该候选仍有未修复问题，无法回填视频表单');
    }
    const prompt = buildContentPlanningPrompt(session, candidate.storyboard, {
      title: candidate.title,
      summary: candidate.summary,
      hook: candidate.hook,
      audienceAngle: candidate.audienceAngle,
      tags: candidate.tags,
    });
    const applySnapshot = {
      prompt,
      duration: `${session.settings.durationSeconds}s` as `${ContentPlanningSettings['durationSeconds']}s`,
      imageMaterials: session.materialBundle.imageMaterials,
      ...(session.materialBundle.referenceVideo
        ? { referenceVideo: session.materialBundle.referenceVideo }
        : {}),
      ...(session.materialBundle.referenceAudio
        ? { referenceAudio: session.materialBundle.referenceAudio }
        : {}),
      appliedAt: nowIso(),
    };
    const next = contentPlanningRepository.updateSession(sessionId, {
      status: 'applied',
      jobStage: 'completed',
      generation: { ...session.generation, selectedCandidateId: candidate.id },
      applySnapshot,
    });
    if (!next) {
      throw new Error('planning session could not be applied');
    }
    return {
      session: next,
      allowlist: {
        prompt: applySnapshot.prompt,
        duration: applySnapshot.duration,
        imageMaterials: applySnapshot.imageMaterials,
        ...('referenceVideo' in applySnapshot
          ? { referenceVideo: applySnapshot.referenceVideo }
          : {}),
        ...('referenceAudio' in applySnapshot
          ? { referenceAudio: applySnapshot.referenceAudio }
          : {}),
      },
    };
  }
}

function randomId() {
  return Math.random().toString(36).slice(2, 10);
}

export const contentPlanningService = new ContentPlanningService();
