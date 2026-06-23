import { randomUUID } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { jsonrepair } from 'jsonrepair';
import { createTraceId, logger, logToFile } from '../../../shared/logger.js';
import { recordVodUnderstandingUsage, recordVodUploadUsage } from '../../billing/billing.service.js';
import { publishContentEvent } from '../content.events.js';
import { contentRepository } from '../content.repository.js';
import type {
  ContentAsset,
  ContentResourceType,
  PictureInPictureDetection,
  VideoGenerationTask,
  VideoParseResult
} from '../content.types.js';
import { callConfiguredLlm, extractJsonObject } from '../configured-llm.client.js';

import { errorLogContext } from './content-common.js';
import { formatAnalysisEstimate, vodDurationSeconds } from './content-video-generation.js';
import { aiWorkerUrl, isRecord } from './content-viral-analysis.js';
import { renderPromptTemplate, viralSeedanceFullPromptTemplate, viralSeedanceGlobalPromptTemplate } from './content-viral-director-prompts.js';

export type VodUploadWorkerResult = {
  ok?: boolean;
  message?: string;
  vid?: string;
  spaceName?: string;
  posterUri?: string;
  requestId?: string;
  sourceInfo?: {
    fileName?: string;
    height?: number;
    width?: number;
  };
} & Record<string, unknown>;

export type ViralUnderstandingAgent = {
  key: 'audio_expert' | 'video_expert' | 'picture_in_picture_expert' | 'editing_expert';
  name: string;
  mode: 'audio' | 'multimodal' | 'local';
  prompt: string;
};

export type VodUnderstandingExecution = {
  role: string;
  roleName: string;
  mode: string;
  runId: string;
  prompt?: string;
  raw?: Record<string, unknown>;
};

export type VodUnderstandingStartWorkerResult = {
  ok?: boolean;
  message?: string;
  vid?: string;
  spaceName?: string;
  executions?: VodUnderstandingExecution[];
  pipExtraction?: Record<string, unknown>;
};

export type VodUnderstandingGetWorkerResult = {
  ok?: boolean;
  message?: string;
  runId?: string;
  status?: string;
  content?: string;
  pictureInPicture?: Record<string, unknown>;
  pipAssets?: Record<string, unknown>;
  raw?: Record<string, unknown>;
};

export type VodUnderstandingAgentsWorkerResult = {
  ok?: boolean;
  message?: string;
  agents?: unknown;
};

export type ViralConversationOutput = {
  id: string;
  roleName: string;
  content: string;
  source: string;
  createdAt: string;
  thinking?: boolean;
};

export type ViralUnderstandingOutput = {
  roleName: string;
  content: string;
  raw?: Record<string, unknown>;
  pictureInPicture?: Record<string, unknown>;
  pipAssets?: Record<string, unknown>;
};

export const videoGenerationLogFile = 'vedio-generation.log';

export function logVideoGenerationFlow(level: 'info' | 'warn' | 'error', message: string, context?: Record<string, unknown>) {
  logToFile(videoGenerationLogFile, level, message, context);
}

export function vodSpaceNameFromUploadResult(vod?: VodUploadWorkerResult | Record<string, unknown>) {
  const uploadedSpaceName = typeof vod?.spaceName === 'string' ? vod.spaceName.trim() : '';
  return uploadedSpaceName || process.env.VOLCENGINE_VOD_SPACE_NAME || process.env.VOD_SPACE_NAME || process.env.VOD_SPACE || '';
}

export type ViralDirectorStep = 'basic' | 'character' | 'scene' | 'product' | 'pip' | 'audio' | 'part' | 'storyboard' | 'final';

export type ViralDirectorStatus = 'drafting' | 'reviewing' | 'storyboard_reviewing' | 'ready_to_generate' | 'generating' | 'completed' | 'failed';

export type ViralDirectorData = {
  basic: {
    title: string;
    resolution: string;
    aspectRatio: string;
  };
  character: {
    label?: string;
    appearance: string;
    characterPrompt: string;
    gesture: string;
    expression: string;
    assetId?: string;
    required?: boolean;
    referenceMode?: 'asset' | 'prompt';
    items?: ViralDirectorCharacter[];
  };
  scene: {
    label?: string;
    description: string;
    environment: string;
    props: string;
    lighting: string;
    composition: string;
    camera: string;
    atmosphere: string;
    visualStyle: string;
    assetId?: string;
    groupId?: string;
    required?: boolean;
    referenceMode?: 'asset' | 'prompt';
    items?: ViralDirectorScene[];
  };
  product: {
    description: string;
    presentation: string;
    assetId?: string;
    groupId?: string;
    noProduct?: boolean;
    referenceMode?: 'asset' | 'prompt';
    items?: Array<{
      label?: string;
      description?: string;
      presentation?: string;
      productType?: string;
      feature?: string;
      brand?: string;
      model?: string;
      startSecond?: number;
      endSecond?: number;
      spokenCue?: string;
      keywords?: string[];
      noProduct?: boolean;
      referenceMode?: 'asset' | 'prompt';
    }>;
  };
  pip: {
    summary: string;
    items?: ViralDirectorPipItem[];
  };
  audio: {
    voice: string;
    voiceStyle: string;
    bgm: string;
    soundEffects: string;
    assetId?: string;
    groupId?: string;
    items?: ViralDirectorAudioItem[];
  };
  negativePrompt: string[];
  part: string;
};

export type ViralDirectorCharacter = {
  label?: string;
  appearance: string;
  characterPrompt?: string;
  gesture: string;
  expression: string;
  startSecond?: number;
  endSecond?: number;
  spokenCue?: string;
  keywords?: string[];
  assetId?: string;
  required?: boolean;
  referenceMode?: 'asset' | 'prompt';
};

export type ViralDirectorAudioItem = {
  label?: string;
  characterLabel?: string;
  characterIndex?: number;
  voice: string;
  voiceStyle: string;
  assetId?: string;
  groupId?: string;
};

export type ViralDirectorScene = {
  label?: string;
  description: string;
  environment?: string;
  props?: string;
  lighting?: string;
  composition?: string;
  camera?: string;
  atmosphere?: string;
  startSecond?: number;
  endSecond?: number;
  spokenCue?: string;
  keywords?: string[];
  assetId?: string;
  groupId?: string;
  required?: boolean;
  referenceMode?: 'asset' | 'prompt';
};

export type ViralDirectorPipItem = {
  id: string;
  label?: string;
  type?: string;
  startSecond: number;
  endSecond: number;
  position?: string;
  content: string;
  confidence?: number;
  required?: boolean;
  referenceMode?: 'asset' | 'prompt';
  replacementPrompt?: string;
  replacementAssetId?: string;
  replacementAssetUrl?: string;
  replacementAssetType?: 'image' | 'video';
  warning?: string;
  modelReferenceAssetId?: string;
  truncatedForModel?: boolean;
};

export const viralDirectorSteps: ViralDirectorStep[] = ['basic', 'character', 'scene', 'product', 'pip', 'audio', 'part', 'storyboard', 'final'];

export const videoExpertPendingSource = 'video_expert_pending';

export async function uploadLocalVideoToVodWithWorker(input: {
  filePath: string;
  originalFileName: string;
  title: string;
  fileSizeBytes: number;
  taskId?: string;
  userId?: string;
}) {
  const traceId = createTraceId('vod-upload');
  logger.info('viral video worker vod upload started', {
    traceId,
    filePath: input.filePath,
    fileName: input.originalFileName,
    workerUrl: aiWorkerUrl(),
  });
  const resolvedFileSizeBytes = input.fileSizeBytes > 0
    ? input.fileSizeBytes
    : (existsSync(input.filePath) ? statSync(input.filePath).size : 0);
  logger.info('viral video worker vod upload size resolved', {
    traceId,
    filePath: input.filePath,
    fileName: input.originalFileName,
    fileSizeBytes: resolvedFileSizeBytes,
  });
  let response: Response;
  let lastProgress = -1;
  const publishProgress = (progress: number, message = '视频正在上传中..') => {
    if (!input.userId || !input.taskId || progress === lastProgress) {
      return;
    }
    lastProgress = progress;
    publishContentEvent({
      type: 'viral-video-analysis-status',
      userId: input.userId,
      taskId: input.taskId,
      phase: 'vod-uploading',
      status: 'running',
      progress,
      message,
      at: new Date().toISOString(),
    });
  };
  const progressTimer = input.userId && input.taskId ? setInterval(() => {
    void (async () => {
      try {
        const progressResponse = await fetch(`${aiWorkerUrl()}/vod/upload/progress?uploadId=${encodeURIComponent(traceId)}`);
        const progressData = await progressResponse.json() as { progress?: unknown; message?: unknown; state?: unknown };
        const progress = Number(progressData.progress);
        if (Number.isFinite(progress)) {
          publishProgress(Math.max(0, Math.min(100, Math.round(progress))), typeof progressData.message === 'string' ? progressData.message : '视频正在上传中..');
        }
      } catch {
        // Progress polling is best-effort; the upload request itself remains the source of truth.
      }
    })();
  }, 1000) : undefined;
  try {
    response = await fetch(`${aiWorkerUrl()}/vod/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Trace-Id': traceId },
      body: JSON.stringify({
        filePath: input.filePath,
        fileName: input.originalFileName,
        title: input.title,
        uploadId: traceId,
      }),
    });
  } catch (error) {
    logger.error('viral video worker vod upload connection failed', {
      traceId,
      fileName: input.originalFileName,
      error: errorLogContext(error),
    });
    throw new Error(`VOD 上传失败：Python AI Worker 未启动或不可访问（${error instanceof Error ? error.message : '连接失败'}）`);
  } finally {
    if (progressTimer) {
      clearInterval(progressTimer);
    }
  }
  const text = await response.text();
  let data: VodUploadWorkerResult = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error('VOD 上传失败：Python AI Worker 返回了无法解析的响应');
  }
  if (!response.ok || data.ok === false || !data.vid) {
    logger.warn('viral video worker vod upload returned failure', {
      traceId,
      status: response.status,
      message: data.message,
      bodyPreview: text.slice(0, 1000),
    });
    throw new Error(data.message || `VOD 上传失败：Python AI Worker 处理失败（${response.status}）`);
  }
  logger.info('viral video worker vod upload completed', {
    traceId,
    fileName: input.originalFileName,
    vid: data.vid,
    requestId: data.requestId,
  });
  const uploaded = {
    vid: data.vid || '',
    spaceName: data.spaceName || '',
    posterUri: data.posterUri || '',
    requestId: data.requestId || '',
    sourceInfo: data.sourceInfo || {},
  };
  if (input.userId) {
    recordVodUploadUsage({
      userId: input.userId,
      sourceType: 'vod_upload',
      sourceId: input.taskId || input.filePath,
      taskId: input.taskId,
      fileSizeBytes: resolvedFileSizeBytes,
      requestSnapshot: {
        originalFileName: input.originalFileName,
        title: input.title,
        fileSizeBytes: resolvedFileSizeBytes,
      },
      responseSnapshot: {
        vid: uploaded.vid,
        spaceName: uploaded.spaceName,
        requestId: uploaded.requestId,
      },
    });
  }
  publishProgress(100, '视频上传完成');
  return uploaded;
}

export function findReusableViralVod(input: {
  userId: string;
  fileHash: string;
  fileSize: number;
  originalFileName: string;
  storedFileName: string;
}) {
  const tasks = contentRepository.listVideoTasks(input.userId);
  for (const task of tasks) {
    const context = isRecord(task.expertContext) ? task.expertContext : {};
    if (context.mode !== 'viral_replication_upload_parse') {
      continue;
    }
    const uploadedVideo = isRecord(context.uploadedVideo) ? context.uploadedVideo : {};
    const vod = isRecord(context.vod) ? context.vod : {};
    const vid = typeof vod.vid === 'string' ? vod.vid : '';
    if (!vid) {
      continue;
    }
    const previousHash = typeof uploadedVideo.fileHash === 'string' ? uploadedVideo.fileHash : '';
    if (previousHash && previousHash === input.fileHash) {
      return { task, vod, reason: 'sha256' };
    }
    const previousSize = Number(uploadedVideo.fileSize || 0);
    const previousOriginalFileName = typeof uploadedVideo.originalFileName === 'string' ? uploadedVideo.originalFileName : '';
    const previousStoredFileName = typeof uploadedVideo.storedFileName === 'string' ? uploadedVideo.storedFileName : '';
    if (
      !previousHash
      && previousSize === input.fileSize
      && Boolean(previousOriginalFileName || previousStoredFileName)
      && (previousOriginalFileName === input.originalFileName || previousStoredFileName === input.storedFileName)
    ) {
      return { task, vod, reason: 'legacy_metadata' };
    }
  }
  return null;
}

export function normalizeViralUnderstandingAgents(value: unknown): ViralUnderstandingAgent[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isRecord).flatMap((item) => {
    const key = typeof item.key === 'string' ? item.key : '';
    const name = typeof item.name === 'string' ? item.name : key;
    const mode = typeof item.mode === 'string' ? item.mode : 'multimodal';
    const prompt = typeof item.prompt === 'string' ? item.prompt : '';
    if (!['audio_expert', 'video_expert', 'picture_in_picture_expert', 'editing_expert'].includes(key) || !name || !prompt) {
      return [];
    }
    if (!['audio', 'multimodal', 'local'].includes(mode)) {
      return [];
    }
    return [{ key: key as ViralUnderstandingAgent['key'], name, mode: mode as ViralUnderstandingAgent['mode'], prompt }];
  });
}

export function viralUnderstandingSdkAgentList(agents: ViralUnderstandingAgent[]): ViralUnderstandingAgent[] {
  return agents.filter((agent) => agent.mode === 'audio' || agent.mode === 'multimodal');
}

function pictureInPictureOutput(outputs: Record<string, ViralUnderstandingOutput>) {
  return outputs.picture_in_picture_expert;
}

export function hasCompletedUnderstandingOutput(role: string, output?: ViralUnderstandingOutput) {
  if (!output) {
    return false;
  }
  if (role === 'picture_in_picture_expert') {
    return isRecord(output.pictureInPicture);
  }
  if (output.content) {
    return true;
  }
  return isRecord(output.raw);
}

export async function getViralUnderstandingAgentsWithWorker() {
  const traceId = createTraceId('vod-understanding-agents');
  let response: Response;
  try {
    response = await fetch(`${aiWorkerUrl()}/vod/understanding/agents`, {
      method: 'GET',
      headers: { 'X-Trace-Id': traceId },
    });
  } catch (error) {
    logger.error('viral video understanding agents connection failed', { traceId, error: errorLogContext(error) });
    throw new Error(`获取视频理解 Agent 列表失败：Python AI Worker 未启动或不可访问（${error instanceof Error ? error.message : '连接失败'}）`);
  }
  const text = await response.text();
  let data: VodUnderstandingAgentsWorkerResult = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error('获取视频理解 Agent 列表失败：Python AI Worker 返回了无法解析的响应');
  }
  const agents = normalizeViralUnderstandingAgents(data.agents);
  if (!response.ok || data.ok === false || !agents.length) {
    logger.warn('viral video understanding agents returned failure', {
      traceId,
      status: response.status,
      message: data.message,
      bodyPreview: text.slice(0, 1000),
    });
    throw new Error(data.message || `获取视频理解 Agent 列表失败：Python AI Worker 处理失败（${response.status}）`);
  }
  logger.info('viral video understanding agents loaded', {
    traceId,
    agents: agents.map((agent) => ({ key: agent.key, name: agent.name, mode: agent.mode, promptPreview: agent.prompt.slice(0, 120) })),
  });
  return agents;
}

export async function startViralUnderstandingWithWorker(input: {
  vid: string;
  spaceName?: string;
  filePath?: string;
  roles: ViralUnderstandingAgent[];
  billingContext?: {
    userId?: string;
    sourceType?: string;
    sourceId?: string;
    taskId?: string;
    sessionId?: string;
    durationSeconds?: number;
  };
}) {
  const traceId = createTraceId('vod-understanding-start');
  logger.info('viral video understanding start requested', {
    traceId,
    vid: input.vid,
    roles: input.roles.map((role) => ({
      key: role.key,
      name: role.name,
      mode: role.mode,
      promptPreview: role.prompt.slice(0, 160),
    })),
  });
  let response: Response;
  try {
    response = await fetch(`${aiWorkerUrl()}/vod/understanding/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Trace-Id': traceId },
      body: JSON.stringify(input),
    });
  } catch (error) {
    logger.error('viral video understanding start connection failed', { traceId, error: errorLogContext(error) });
    throw new Error(`视频理解提交失败：Python AI Worker 未启动或不可访问（${error instanceof Error ? error.message : '连接失败'}）`);
  }
  const text = await response.text();
  let data: VodUnderstandingStartWorkerResult = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error('视频理解提交失败：Python AI Worker 返回了无法解析的响应');
  }
  if (!response.ok || data.ok === false || !Array.isArray(data.executions) || !data.executions.length) {
    logger.warn('viral video understanding start returned failure', {
      traceId,
      status: response.status,
      message: data.message,
      bodyPreview: text.slice(0, 1000),
    });
    throw new Error(data.message || `视频理解提交失败：Python AI Worker 处理失败（${response.status}）`);
  }
  return data;
}

export async function getViralUnderstandingExecutionWithWorker(runId: string) {
  const traceId = createTraceId('vod-understanding-get');
  let response: Response;
  try {
    response = await fetch(`${aiWorkerUrl()}/vod/understanding/get`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Trace-Id': traceId },
      body: JSON.stringify({ runId }),
    });
  } catch (error) {
    logger.error('viral video understanding get connection failed', { traceId, runId, error: errorLogContext(error) });
    throw new Error(`视频理解查询失败：Python AI Worker 未启动或不可访问（${error instanceof Error ? error.message : '连接失败'}）`);
  }
  const text = await response.text();
  let data: VodUnderstandingGetWorkerResult = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error('视频理解查询失败：Python AI Worker 返回了无法解析的响应');
  }
  if (!response.ok || data.ok === false) {
    throw new Error(data.message || `视频理解查询失败：Python AI Worker 处理失败（${response.status}）`);
  }
  const repairedContent = repairUnderstandingContent(data.content);
  if (repairedContent && repairedContent !== data.content) {
    logger.info('viral video understanding content repaired', {
      traceId,
      runId,
      originalLength: typeof data.content === 'string' ? data.content.length : 0,
      repairedLength: repairedContent.length,
    });
  }
  return {
    ...data,
    content: repairedContent,
  };
}

export function isUnderstandingCompleted(status: string) {
  return ['success', 'succeeded', 'completed', 'complete', 'done'].includes(status.trim().toLowerCase());
}

export function isUnderstandingFailed(status: string) {
  return ['failed', 'fail', 'error', 'canceled', 'cancelled'].includes(status.trim().toLowerCase());
}

function looksLikeJsonText(value: string) {
  const trimmed = value.trim();
  return trimmed.startsWith('{') || trimmed.startsWith('[');
}

function repairUnderstandingContent(content: unknown) {
  if (typeof content !== 'string') {
    return typeof content === 'number' || typeof content === 'boolean' ? String(content) : '';
  }
  const text = content.trim();
  if (!text || !looksLikeJsonText(text)) {
    return text;
  }
  try {
    JSON.parse(text);
    return text;
  } catch {
    try {
      return jsonrepair(text);
    } catch {
      return text;
    }
  }
}

export function shouldFailViralUnderstandingPoll(error: unknown, attempt: number) {
  const message = error instanceof Error ? error.message : String(error);
  return attempt >= 3
    || /积分不足|欠费|余额|额度|quota|credit|balance|billing|payment|insufficient|unauthori[sz]ed|forbidden|permission|401|403/i.test(message)
    || error instanceof Error && error.name === 'InsufficientStepCreditsError';
}

export function mergeViralUnderstandingContext(task: VideoGenerationTask, patch: Record<string, unknown>) {
  const latest = contentRepository.findVideoTask(task.id) || task;
  const expertContext = {
    ...(latest.expertContext || {}),
    viralUnderstanding: {
      ...(isRecord(latest.expertContext?.viralUnderstanding) ? latest.expertContext.viralUnderstanding : {}),
      ...patch,
      updatedAt: new Date().toISOString(),
    },
  };
  return contentRepository.updateVideoTaskContext(latest.id, {
    selectedSkillIds: latest.selectedSkillIds || [],
    expertContext,
  });
}

function resetViralDirectorStateForUnderstandingRetry(
  context: Record<string, unknown>,
  retryAgentKeys: Set<ViralUnderstandingAgent['key']>,
) {
  const conversationMessages = normalizeViralConversationMessages(context.conversationMessages);
  const emittedSources = new Set(normalizeStringList(context.emittedSources));
  const sourcesToReset = new Set<string>();
  if (retryAgentKeys.has('video_expert')) {
    sourcesToReset.add('video_basic_info');
    sourcesToReset.add('video_expert_task2');
    sourcesToReset.add('video_expert_task3');
    sourcesToReset.add('video_expert_task4');
    sourcesToReset.add('video_expert_task5');
    sourcesToReset.add('video_expert_raw');
    sourcesToReset.add(videoExpertPendingSource);
    sourcesToReset.add('storyboard_final');
  }
  if (retryAgentKeys.has('audio_expert')) {
    sourcesToReset.add('audio_expert');
    sourcesToReset.add('storyboard_final');
  }
  if (retryAgentKeys.has('picture_in_picture_expert')) {
    sourcesToReset.add('picture_in_picture_expert');
    sourcesToReset.add('storyboard_final');
  }
  sourcesToReset.add('video_director');
  const nextMessages = conversationMessages.filter((message) => !sourcesToReset.has(message.source));
  sourcesToReset.forEach((source) => emittedSources.delete(source));
  return {
    conversationMessages: nextMessages,
    emittedSources: [...emittedSources],
    directorDraft: undefined,
    directorConfirmed: undefined,
    directorStep: undefined,
    directorStatus: undefined,
    directorFailureReason: '',
    storyboardDurationSeconds: undefined,
  };
}

export function appendAnalysisProcessFromUnderstanding(task: VideoGenerationTask, outputs: Record<string, ViralUnderstandingOutput>) {
  const context = isRecord(task.expertContext) ? task.expertContext : {};
  const uploadedVideo = isRecord(context.uploadedVideo) ? context.uploadedVideo : {};
  const vod = isRecord(context.vod) ? context.vod : {};
  const sourceInfo = isRecord(vod.sourceInfo) ? vod.sourceInfo : {};
  const width = Number(sourceInfo.width || 0);
  const height = Number(sourceInfo.height || 0);
  const durationSeconds = extractVideoDurationSeconds(outputs.video_expert?.raw);
  const videoBasics = {
    title: typeof uploadedVideo.originalFileName === 'string' ? uploadedVideo.originalFileName : task.title,
    width,
    height,
    resolution: videoResolutionLabel(width, height),
    aspectRatio: videoAspectRatio(width, height),
    duration: formatSeconds(durationSeconds),
    vid: typeof vod.vid === 'string' ? vod.vid : '',
  };
  const pipOutput = pictureInPictureOutput(outputs);
  const pipEvidence = mergePictureInPictureEvidence(
    pipOutput?.pictureInPicture,
    pipOutput?.pipAssets,
  );
  const pipSummary = pictureInPictureParseSummary(pipEvidence);
  const basicItem = {
    key: 'video_basic_info',
    label: '视频基础信息',
    items: [
      { label: '标题', value: videoBasics.title },
      { label: '分辨率', value: videoBasics.resolution || (width && height ? `${width}x${height}` : '') },
      { label: '宽高比', value: videoBasics.aspectRatio },
      { label: '时长', value: videoBasics.duration },
      { label: 'Vid', value: videoBasics.vid },
    ].filter((item) => item.value),
    conclusion: [videoBasics.title, videoBasics.resolution, videoBasics.aspectRatio, videoBasics.duration].filter(Boolean).join(' / '),
  };
  const analysisProcess = [
    basicItem,
    {
      key: 'pip',
      label: 'PIP 画中画',
      items: pipEvidence.appeared
        ? pipEvidence.items.map((item, index) => ({
          label: `画中画 ${index + 1}`,
          value: [
            item.type ? `类型：${item.type}` : '',
            item.position ? `位置：${item.position}` : '',
            typeof item.confidence === 'number' ? `置信度：${Math.round(item.confidence * 100)}%` : '',
            item.endSecond > item.startSecond ? `${item.startSecond}-${item.endSecond} 秒` : `${item.startSecond} 秒`,
            item.content,
          ].filter(Boolean).join('；'),
        }))
        : [{ label: '检测结果', value: pipEvidence.summary || '未出现画中画' }],
      conclusion: pipSummary,
    },
    ...Object.entries(outputs).map(([key, value]) => ({
      key,
      label: value.roleName,
      items: [{ label: '分析结果', value: value.content }],
      conclusion: value.content.slice(0, 240),
    })),
  ];
  const parseResult: VideoParseResult = {
    ...task.editableParseResult,
    pip: pipSummary,
    pictureInPicture: pipEvidence,
    extraDetails: Object.values(outputs).map((item) => `## ${item.roleName}\n${item.content}`).join('\n\n'),
    analysisProcess,
  };
  return contentRepository.updateVideoTaskParseResult(task.id, {
    editableParseResult: parseResult,
    selectedDigitalHumanId: task.selectedDigitalHumanId || undefined,
    selectedVoiceId: task.selectedVoiceId || undefined,
    selectedSceneId: task.selectedSceneId || undefined,
  });
}

export function streamAnalysisMessage(input: {
  userId: string;
  taskId: string;
  messageId: string;
  roleName: string;
  text: string;
  initialDelayMs?: number;
}) {
  const chunks = input.text.match(/[\s\S]{1,60}/g) || [];
  const initialDelayMs = input.initialDelayMs || 0;
  publishContentEvent({
    type: 'viral-video-analysis-status',
    userId: input.userId,
    taskId: input.taskId,
    phase: 'message-start',
    status: 'running',
    messageId: input.messageId,
    roleName: input.roleName,
    message: input.roleName,
    at: new Date().toISOString(),
  });
  chunks.forEach((delta, index) => {
    setTimeout(() => {
      publishContentEvent({
        type: 'viral-video-analysis-delta',
        userId: input.userId,
        taskId: input.taskId,
        messageId: input.messageId,
        delta,
        at: new Date().toISOString(),
      });
    }, initialDelayMs + index * 35);
  });
  const durationMs = initialDelayMs + Math.max(120, chunks.length * 35);
  setTimeout(() => {
    publishContentEvent({
      type: 'viral-video-analysis-status',
      userId: input.userId,
      taskId: input.taskId,
      phase: 'message-complete',
      status: 'running',
      messageId: input.messageId,
      roleName: input.roleName,
      at: new Date().toISOString(),
    });
  }, durationMs);
  return new Promise<void>((resolve) => setTimeout(resolve, durationMs + 180));
}

export function normalizeViralConversationMessages(value: unknown): ViralConversationOutput[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isRecord).map((item) => ({
    id: typeof item.id === 'string' ? item.id : randomUUID(),
    roleName: typeof item.roleName === 'string' ? item.roleName : '',
    content: typeof item.content === 'string' ? item.content : '',
    source: typeof item.source === 'string' ? item.source : '',
    createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date().toISOString(),
    thinking: item.thinking === true,
  })).filter((item) => item.content);
}

export function normalizeStringList(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function tokenCountFromRecord(value: Record<string, unknown>, keyNames: string[]) {
  for (const key of keyNames) {
    const numeric = Number(value[key]);
    if (Number.isFinite(numeric) && numeric >= 0) {
      return numeric;
    }
  }
  return 0;
}

function estimateTextTokens(text: string) {
  const normalized = text.trim();
  if (!normalized) {
    return 0;
  }
  return Math.max(1, Math.ceil(normalized.length / 4));
}

function parseRecordLike(value: unknown) {
  if (isRecord(value)) {
    return value;
  }
  if (typeof value !== 'string') {
    return {};
  }
  const text = value.trim();
  if (!text) {
    return {};
  }
  try {
    const parsed = JSON.parse(text);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function extractUnderstandingTokenUsage(raw: unknown) {
  const root = parseRecordLike(raw);
  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;
  const stack: Array<{ value: unknown; depth: number }> = [{ value: root, depth: 0 }];
  while (stack.length) {
    const current = stack.pop();
    if (!current || current.depth > 8) {
      continue;
    }
    const value = current.value;
    if (isRecord(value)) {
      inputTokens ||= tokenCountFromRecord(value, [
        'DoubaoInputTokens',
        'doubaoInputTokens',
        'doubao_input_tokens',
        'InputTokens',
        'inputTokens',
        'input_tokens',
        'doubao_text_input_tokens',
        'promptTokens',
        'prompt_tokens',
      ]);
      outputTokens ||= tokenCountFromRecord(value, [
        'DoubaoOutputTokens',
        'doubaoOutputTokens',
        'doubao_output_tokens',
        'OutputTokens',
        'outputTokens',
        'output_tokens',
        'doubao_text_output_tokens',
        'completionTokens',
        'completion_tokens',
      ]);
      totalTokens ||= tokenCountFromRecord(value, [
        'DoubaoTotalTokens',
        'doubaoTotalTokens',
        'doubao_total_tokens',
        'TotalTokens',
        'totalTokens',
        'total_tokens',
        'doubao_text_total_tokens',
        'tokenCount',
        'token_count',
      ]);
      if (inputTokens && outputTokens && totalTokens) {
        break;
      }
      Object.values(value).forEach((entry) => {
        if (entry && typeof entry === 'object') {
          stack.push({ value: entry, depth: current.depth + 1 });
        }
      });
      continue;
    }
    if (Array.isArray(value)) {
      value.forEach((entry) => {
        if (entry && typeof entry === 'object') {
          stack.push({ value: entry, depth: current.depth + 1 });
        }
      });
    }
  }
  if (!totalTokens) {
    totalTokens = inputTokens + outputTokens;
  }
  return {
    inputTokens: Math.max(0, Math.floor(inputTokens)),
    outputTokens: Math.max(0, Math.floor(outputTokens)),
    totalTokens: Math.max(0, Math.floor(totalTokens)),
  };
}

export function normalizeUnderstandingTokenUsage(input: {
  raw?: unknown;
  prompt?: string;
  content?: string;
}) {
  const tokenUsage = extractUnderstandingTokenUsage(input.raw);
  if (tokenUsage.inputTokens || tokenUsage.outputTokens || tokenUsage.totalTokens) {
    return tokenUsage;
  }
  const inputTokens = estimateTextTokens(input.prompt || '');
  const outputTokens = estimateTextTokens(input.content || '');
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
  };
}

export function findUnderstandingTokenFieldSummary(raw: unknown) {
  const root = parseRecordLike(raw);
  const stack: Array<{ value: unknown; path: string; depth: number }> = [{ value: root, path: '$', depth: 0 }];
  while (stack.length) {
    const current = stack.pop();
    if (!current || current.depth > 8) {
      continue;
    }
    const value = current.value;
    if (!isRecord(value)) {
      continue;
    }
    const inputTokens = tokenCountFromRecord(value, [
      'DoubaoInputTokens',
      'doubaoInputTokens',
      'doubao_input_tokens',
      'InputTokens',
      'inputTokens',
      'input_tokens',
      'doubao_text_input_tokens',
      'promptTokens',
      'prompt_tokens',
    ]);
    const outputTokens = tokenCountFromRecord(value, [
      'DoubaoOutputTokens',
      'doubaoOutputTokens',
      'doubao_output_tokens',
      'OutputTokens',
      'outputTokens',
      'output_tokens',
      'doubao_text_output_tokens',
      'completionTokens',
      'completion_tokens',
    ]);
    const totalTokens = tokenCountFromRecord(value, [
      'DoubaoTotalTokens',
      'doubaoTotalTokens',
      'doubao_total_tokens',
      'TotalTokens',
      'totalTokens',
      'total_tokens',
      'doubao_text_total_tokens',
      'tokenCount',
      'token_count',
    ]);
    if (inputTokens || outputTokens || totalTokens) {
      return {
        path: current.path,
        inputTokens,
        outputTokens,
        totalTokens,
        keys: Object.keys(value).slice(0, 24),
      };
    }
    Object.entries(value).forEach(([key, entry]) => {
      if (entry && typeof entry === 'object') {
        stack.push({ value: entry, path: `${current.path}.${key}`, depth: current.depth + 1 });
      }
    });
  }
  return null;
}

export function messageSourceFor(source: string) {
  return `viral-${source}`;
}

export function videoAspectRatio(width?: number, height?: number) {
  if (!width || !height) {
    return '';
  }
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : Math.abs(a));
  const divisor = gcd(width, height) || 1;
  return `${width / divisor}:${height / divisor}`;
}

export function videoResolutionLabel(width?: number, height?: number) {
  if (!width || !height) {
    return '';
  }
  const shortEdge = Math.min(width, height);
  if (shortEdge >= 2160) return '2160p';
  if (shortEdge >= 1080) return '1080p';
  if (shortEdge >= 720) return '720p';
  if (shortEdge >= 480) return '480p';
  if (shortEdge >= 320) return '320p';
  return `${shortEdge}p`;
}

export function extractVideoDurationSeconds(raw?: Record<string, unknown>) {
  const duration = isRecord(raw?.output)
    && isRecord(raw.output.task)
    && isRecord(raw.output.task.vision)
    && typeof raw.output.task.vision.duration === 'number'
    ? raw.output.task.vision.duration
    : 0;
  return duration > 0 ? duration : 0;
}

export function formatSeconds(seconds: number) {
  if (!seconds) {
    return '';
  }
  const rounded = Math.round(seconds);
  return rounded >= 60 ? `${Math.floor(rounded / 60)}分${rounded % 60}秒` : `${rounded}秒`;
}

export function estimateSpokenContentDurationSeconds(text: string) {
  const normalized = text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/[#>*_`~\-\d.、：:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) {
    return 8;
  }
  const cjkChars = normalized.match(/[\u3400-\u9fff]/g)?.length || 0;
  const latinWords = normalized.match(/[A-Za-z0-9]+/g)?.length || 0;
  const pauses = normalized.match(/[，。！？；,.!?;]/g)?.length || 0;
  const seconds = Math.ceil((cjkChars / 4.2) + (latinWords / 2.4) + Math.min(18, pauses * 0.28) + 2);
  return Math.max(8, Math.min(180, seconds));
}

export function parseStoryboardDurationSeconds(storyboard: string) {
  let maxEnd = 0;
  const normalized = storyboard.replace(/[－—–~～至到]/g, '-');
  const rangePattern = /(\d+(?:\.\d+)?)\s*(?:秒|s)?\s*-\s*(\d+(?:\.\d+)?)\s*(?:秒|s)/gi;
  for (const match of normalized.matchAll(rangePattern)) {
    const end = Number(match[2]);
    if (Number.isFinite(end) && end > maxEnd) {
      maxEnd = end;
    }
  }
  const minutePattern = /(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/g;
  for (const match of normalized.matchAll(minutePattern)) {
    const end = Number(match[3]) * 60 + Number(match[4]);
    if (Number.isFinite(end) && end > maxEnd) {
      maxEnd = end;
    }
  }
  return maxEnd > 0 ? Math.round(maxEnd) : 0;
}

function directorHasAssetCharacter(data: ViralDirectorData) {
  return directorCharacterItems(data).some((item) => item.required !== false && (item.referenceMode || (item.assetId ? 'asset' : 'prompt')) === 'asset');
}

function stripAssetCharacterAppearanceFromStoryboard(content: string, director: ViralDirectorData) {
  if (!directorHasAssetCharacter(director)) {
    return content;
  }
  const clothingPattern = /[，,、；;]?\s*(?:身穿|穿着|穿|着|佩戴|戴着)?[^，,、；;\n]*(?:上衣|裤子|长裤|短裤|裙子|连衣裙|外套|衬衫|T恤|毛衣|卫衣|西装|夹克|大衣|风衣|鞋子|帽子|围巾|粉色|白色|黑色|红色|蓝色|绿色|黄色|紫色|灰色|棕色|米色)[^，,、；;\n]*/gu;
  return content.split('\n').map((line) => {
    if (!/^\s*(?:[-*]\s*)?(?:人物\/动作|人物动作|动作)\s*[：:]/u.test(line)) {
      return line;
    }
    return line
      .replace(clothingPattern, '')
      .replace(/\s*([，,、；;])\s*([，,、；;])+/g, '$1')
      .replace(/[，,、；;]\s*$/u, '')
      .trimEnd();
  }).join('\n');
}

export function splitSpokenContentForStoryboard(text: string, targetSeconds = 12) {
  const sentences = text
    .split(/(?<=[。！？!?；;])/u)
    .map((item) => item.trim())
    .filter(Boolean);
  const source = sentences.length ? sentences : text.split(/\n+/).map((item) => item.trim()).filter(Boolean);
  if (!source.length) {
    return [{ text: '无固定口播，请根据画面节奏生成自然旁白。', seconds: 8 }];
  }
  const semanticUnits = source.flatMap((sentence) => {
    const units = sentence.match(/[^，,、]+[，,、]?/g)?.map((item) => item.trim()).filter(Boolean) || [sentence];
    const paired: string[] = [];
    for (let index = 0; index < units.length; index += 1) {
      const current = units[index] || '';
      const next = units[index + 1] || '';
      if (/^不要/.test(current) && /^要/.test(next)) {
        paired.push(`${current}${next}`);
        index += 1;
      } else {
        paired.push(current);
      }
    }
    return paired;
  });
  const chunks: Array<{ text: string; seconds: number }> = [];
  let current = '';
  let currentSeconds = 0;
  semanticUnits.forEach((unit) => {
    const unitSeconds = Math.max(2, estimateSpokenContentDurationSeconds(unit));
    if (current && currentSeconds + unitSeconds > targetSeconds + 3) {
      chunks.push({ text: current.trim(), seconds: currentSeconds });
      current = unit;
      currentSeconds = unitSeconds;
      return;
    }
    current = current ? `${current}${unit}` : unit;
    currentSeconds += unitSeconds;
  });
  if (current.trim()) {
    chunks.push({ text: current.trim(), seconds: currentSeconds });
  }
  return chunks.map((chunk) => ({
    ...chunk,
    seconds: Math.max(4, Math.min(15, Math.round(chunk.seconds))),
  }));
}

export function fallbackTimedStoryboard(input: { director: ViralDirectorData; targetSeconds: number }) {
  const chunks = splitSpokenContentForStoryboard(input.director.part);
  const estimatedTotal = chunks.reduce((sum, chunk) => sum + chunk.seconds, 0) || 1;
  const scale = input.targetSeconds > 0 ? input.targetSeconds / estimatedTotal : 1;
  const confirmedCharacterActions = directorCharacterItems(input.director)
    .filter((item) => item.required !== false)
    .map((item, index) => {
      const label = item.label || `人物 ${index + 1}`;
      const details = [item.gesture, item.expression].filter(Boolean).join('，');
      if (details) {
        return `${label}：${details}`;
      }
      if (item.assetId || item.characterPrompt || item.appearance) {
        return `${label}按已确认人物设定出镜并配合口播演示`;
      }
      return `${label}自然出镜并配合口播演示`;
    })
    .join('；') || '人物自然出镜并配合口播演示';
  const confirmedSceneDescription = directorSceneItems(input.director)
    .filter((item) => item.required !== false)
    .map((item, index) => {
      const label = item.label || `场景 ${index + 1}`;
      if (item.description) {
        return `${label}：${item.description}`;
      }
      if (item.assetId || item.groupId) {
        return `${label}：使用已确认场景素材/场景组`;
      }
      return '';
    })
    .filter(Boolean)
    .join('；') || '保持与确认场景一致';
  let cursor = 0;
  return chunks.map((chunk, index) => {
    const start = cursor;
    const scaledSeconds = index === chunks.length - 1
      ? Math.max(1, input.targetSeconds - cursor)
      : Math.max(1, Math.round(chunk.seconds * scale));
    cursor += scaledSeconds;
    const end = index === chunks.length - 1 ? Math.max(cursor, input.targetSeconds) : cursor;
    return [
      `## 镜头 ${index + 1}｜${start}-${end}秒`,
      `- 时间段：${start}-${end}秒`,
      `- 画面：${index === 0 ? '中景开场，引入人物和主题' : '近景或特写承接口播重点，展示操作细节'}`,
      `- 人物/动作：${confirmedCharacterActions}`,
      `- 台词/旁白：${chunk.text}`,
      '- 音效：轻微转场音效和环境音。',
      `- 复刻建议：${confirmedSceneDescription}，按当前时间段完成一个清晰步骤。`,
    ].join('\n');
  }).join('\n\n');
}

function storyboardDurationIsCloseToTarget(duration: number, targetSeconds: number) {
  if (!duration || !targetSeconds) {
    return false;
  }
  const tolerance = Math.max(2, Math.round(targetSeconds * 0.08));
  return Math.abs(duration - targetSeconds) <= tolerance;
}

function productTextMatchesSpokenContent(productText: string, spokenContent: string) {
  const product = productText.replace(/\s+/g, '').trim();
  const spoken = spokenContent.replace(/\s+/g, '').trim();
  return Boolean(product && spoken.includes(product));
}

function conflictingProductPhrases(input: { productText: string; spokenContent: string }) {
  const productText = input.productText.trim();
  if (!productText || productTextMatchesSpokenContent(productText, input.spokenContent)) {
    return [];
  }
  return Array.from(new Set([
    productText,
    ...productText
      .split(/[，,。；;、\s/|]+/)
      .map((item) => item.trim())
      .filter((item) => item.length >= 2),
  ]));
}

export function isEmptyJsonValue(value: unknown): boolean {
  if (value == null) {
    return true;
  }
  if (typeof value === 'string') {
    return !value.trim();
  }
  if (Array.isArray(value)) {
    return value.every(isEmptyJsonValue);
  }
  if (isRecord(value)) {
    return Object.keys(value).length === 0 || Object.values(value).every(isEmptyJsonValue);
  }
  return false;
}

export function tryParseJsonValue(text: string): unknown {
  const normalized = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  if (!normalized) {
    return undefined;
  }
  try {
    return JSON.parse(normalized);
  } catch {
    try {
      return extractJsonObject<unknown>(normalized);
    } catch {
      return undefined;
    }
  }
}

function expertFieldLabel(key: string) {
  const labels: Record<string, string> = {
    sceneDescription: '场景描述',
    characterImage: '人物形象',
    appearanceFeatures: '外貌特征',
    clothingStyle: '服装风格',
    characterAction: '人物动作',
    mainActions: '主要动作',
    bodyLanguage: '肢体语言',
    sceneInteraction: '场景互动',
    expressionDetails: '表情细节',
    facialExpression: '面部表情',
    eyeExpression: '眼神',
    emotionalState: '情绪状态',
    cameraMovement: '镜头运动',
    shotTypeChange: '景别变化',
    transitionMethod: '转场方式',
    shotRhythm: '镜头节奏',
    soundEffects: '音效',
    subtitleStyle: '字幕风格',
    visualEffects: '视觉效果',
    overallAtmosphere: '整体氛围',
    emotionalTone: '情绪基调',
    stylePositioning: '风格定位',
  };
  if (labels[key]) {
    return labels[key];
  }
  if (/^[a-z][A-Za-z0-9]*$/.test(key)) {
    return '';
  }
  return key;
}

function isNonInformativeExpertText(value: string) {
  return /^(?:无|无明确信息|无明确细节信息|暂无|未提及|未明确|不明确|unknown|n\/a|none)$/i.test(value.trim());
}

export function stringifyExpertValue(value: unknown): string {
  if (typeof value === 'string') {
    return isNonInformativeExpertText(value) ? '' : value;
  }
  const normalized = isRecord(value) && isRecord(value.content) ? value.content : value;
  if (Array.isArray(normalized)) {
    return normalized
      .map((item, index): string => {
        const text = stringifyExpertValue(item);
        return text ? `${index + 1}. ${text.replace(/\n/g, '\n   ')}` : '';
      })
      .filter(Boolean)
      .join('\n');
  }
  if (isRecord(normalized)) {
    return Object.entries(normalized).flatMap((([key, item]): string[] => {
      if (isEmptyJsonValue(item)) {
        return [];
      }
      const text = stringifyExpertValue(item);
      if (!text) {
        return [];
      }
      const label = expertFieldLabel(key);
      return label ? [`- ${label}：${text.replace(/\n/g, '\n  ')}`] : [`- ${text.replace(/\n/g, '\n  ')}`];
    })).join('\n');
  }
  return String(normalized ?? '');
}

function withoutPictureInPictureFields(value: unknown): unknown {
  if (!isRecord(value)) {
    return value;
  }
  const source = isRecord(value.content) ? value.content : value;
  const entries = Object.entries(source).filter(([key]) => {
    const normalizedKey = key.toLowerCase();
    return key !== '画中画'
      && normalizedKey !== 'pictureinpicture'
      && normalizedKey !== 'pip';
  });
  const cleaned = Object.fromEntries(entries);
  return isRecord(value.content) ? { ...value, content: cleaned } : cleaned;
}

function pictureInPictureFromVideoExpertValue(value: unknown): PictureInPictureDetection {
  const content = isRecord(value) && isRecord(value.content) ? value.content : value;
  if (!isRecord(content)) {
    return normalizePictureInPictureResult(undefined);
  }
  const pip = content.pictureInPicture ?? content['画中画'] ?? content.pip;
  return normalizePictureInPictureResult(pip);
}

export function findStringByKeys(value: unknown, keys: string[]): string {
  if (!isRecord(value) && !Array.isArray(value)) {
    return '';
  }
  if (isRecord(value)) {
    for (const key of keys) {
      const item = value[key];
      if (typeof item === 'string' && item.trim()) {
        return item.trim();
      }
    }
    for (const item of Object.values(value)) {
      const matched = findStringByKeys(item, keys);
      if (matched) {
        return matched;
      }
    }
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const matched = findStringByKeys(item, keys);
      if (matched) {
        return matched;
      }
    }
  }
  return '';
}

export function extractVideoExpertTitle(content: string) {
  const parsed = tryParseJsonValue(content);
  if (isRecord(parsed)) {
    const preferred = ['task1', '任务1', '任务一', '基础信息']
      .map((key) => parsed[key])
      .find((item) => !isEmptyJsonValue(item));
    const fromPreferred = findStringByKeys(preferred, ['视频标题', '标题', 'title', 'videoTitle', 'VideoTitle']);
    if (fromPreferred) {
      return fromPreferred;
    }
    return findStringByKeys(parsed, ['视频标题', '标题', 'title', 'videoTitle', 'VideoTitle']);
  }
  if (Array.isArray(parsed)) {
    return findStringByKeys(parsed[0], ['视频标题', '标题', 'title', 'videoTitle', 'VideoTitle']);
  }
  return '';
}

export function buildVideoBasicInfoMessage(task: VideoGenerationTask, outputs: Record<string, ViralUnderstandingOutput>) {
  const context = isRecord(task.expertContext) ? task.expertContext : {};
  const vod = isRecord(context.vod) ? context.vod : {};
  const uploadedVideo = isRecord(context.uploadedVideo) ? context.uploadedVideo : {};
  const sourceInfo = isRecord(vod.sourceInfo) ? vod.sourceInfo : {};
  const width = Number(sourceInfo.width || 0);
  const height = Number(sourceInfo.height || 0);
  const durationSeconds = vodDurationSeconds(vod) || extractVideoDurationSeconds(outputs.video_expert?.raw);
  const items = [
    ['分辨率', videoResolutionLabel(width, height)],
    ['宽高比', videoAspectRatio(width, height)],
    ['视频时长', formatSeconds(durationSeconds)],
  ].filter(([, item]) => item);
  return items.map(([label, item]) => `- ${label}：${item}`).join('\n');
}

export function normalizePictureInPictureResult(value: unknown): PictureInPictureDetection {
  const record = isRecord(value) ? value : {};
  const rawItems = Array.isArray(record.items) ? record.items : [];
  const items = rawItems.filter(isRecord).map((item, index) => ({
    id: stringValue(item.id) || `pip_${index + 1}`,
    type: stringValue(item.type) || 'unknown',
    startSecond: Number(item.startSecond ?? item.start ?? 0) || 0,
    endSecond: Number(item.endSecond ?? item.end ?? 0) || 0,
    position: stringValue(item.position),
    content: stringValue(item.content),
    confidence: Number.isFinite(Number(item.confidence)) ? Number(item.confidence) : 0,
  }));
  return {
    appeared: record.appeared === true || items.length > 0,
    summary: stringValue(record.summary),
    items,
  };
}

export function pictureInPictureParseSummary(value: PictureInPictureDetection) {
  if (!value.appeared || !value.items.length) {
    return value.summary || '未出现画中画。';
  }
  const lines = value.items.map((item, index) => {
    const time = item.endSecond > item.startSecond ? `${item.startSecond}-${item.endSecond}秒` : `${item.startSecond}秒`;
    const confidence = `；置信度：${Math.round(item.confidence * 100)}%`;
    const position = item.position ? `；位置：${item.position}` : '';
    return `${index + 1}. ${time}；类型：${item.type || 'unknown'}${position}；内容：${item.content || '未说明'}${confidence}`;
  });
  return [value.summary ? `概览：${value.summary}` : '', ...lines].filter(Boolean).join('\n');
}

function normalizePipNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

function normalizePipReplacementAssetType(value: unknown, assetId?: string): ViralDirectorPipItem['replacementAssetType'] {
  const type = stringValue(value);
  if (type === 'image' || type === 'video') {
    return type;
  }
  if (!assetId) {
    return undefined;
  }
  const asset = contentRepository.findAsset(assetId);
  if (asset?.mimeType.startsWith('video/')) {
    return 'video';
  }
  if (asset?.mimeType.startsWith('image/')) {
    return 'image';
  }
  return undefined;
}

export function normalizeDirectorPipItems(pip: Record<string, unknown>): ViralDirectorPipItem[] {
  const rawItems = [pip.items, pip.pictureInPicture, pip.pips]
    .find((item) => Array.isArray(item));
  if (!Array.isArray(rawItems)) {
    return [];
  }
  return rawItems.filter(isRecord).map((item, index) => {
    const startSecond = normalizePipNumber(item.startSecond ?? item.start);
    const endSecond = normalizePipNumber(item.endSecond ?? item.end);
    const content = stringValue(item.content);
    const replacementAssetId = stringValue(item.replacementAssetId) || stringValue(item.assetId) || stringValue(item.modelReferenceAssetId) || undefined;
    const replacementPrompt = stringValue(item.replacementPrompt) || content;
    return {
      id: stringValue(item.id) || `pip_${index + 1}`,
      label: stringValue(item.label) || `画中画 ${index + 1}`,
      type: stringValue(item.type) || 'unknown',
      startSecond,
      endSecond: endSecond > startSecond ? endSecond : startSecond,
      position: stringValue(item.position) || undefined,
      content,
      confidence: Number.isFinite(Number(item.confidence)) ? Number(item.confidence) : undefined,
      required: item.required !== false,
      referenceMode: item.referenceMode === 'asset' ? 'asset' : item.referenceMode === 'prompt' ? 'prompt' : replacementAssetId ? 'asset' : 'prompt',
      replacementPrompt,
      replacementAssetId,
      replacementAssetUrl: stringValue(item.replacementAssetUrl) || undefined,
      replacementAssetType: normalizePipReplacementAssetType(item.replacementAssetType, replacementAssetId),
      warning: stringValue(item.warning) || undefined,
      modelReferenceAssetId: stringValue(item.modelReferenceAssetId) || replacementAssetId,
      truncatedForModel: item.truncatedForModel === true,
    };
  });
}

export function fallbackDirectorPipFromEvidence(outputs: Record<string, ViralUnderstandingOutput>) {
  const pipOutput = pictureInPictureOutput(outputs);
  const evidence = mergePictureInPictureEvidence(
    pipOutput?.pictureInPicture,
    pipOutput?.pipAssets,
  );
  return {
    summary: evidence.summary || (evidence.appeared ? '检测到画中画，需要确认是否保留或替换。' : ''),
    items: evidence.items.map((item, index) => ({
      id: item.id || `pip_${index + 1}`,
      label: `画中画 ${index + 1}`,
      type: item.type || 'unknown',
      startSecond: item.startSecond,
      endSecond: item.endSecond,
      position: item.position || undefined,
      content: item.content,
      confidence: item.confidence,
      required: true,
      referenceMode: 'prompt' as const,
      replacementPrompt: item.content || '替换画中画内部素材，保留出现时间、大致位置和信息作用。',
    })),
  };
}

export function mergePictureInPictureEvidence(pip: unknown, assets: unknown) {
  const detected = normalizePictureInPictureResult(pip);
  return {
    ...detected,
    extraction: isRecord(assets) ? {
      ok: assets.ok === true,
      message: stringValue(assets.message),
      video: isRecord(assets.video) ? assets.video : undefined,
    } : undefined,
  };
}

export function pictureInPictureCompositionPlan(value: ReturnType<typeof mergePictureInPictureEvidence>) {
  if (!value.appeared || !value.items.length) {
    return '无画中画处理要求。';
  }
  return value.items.map((item, index) => {
    const time = item.endSecond > item.startSecond ? `${item.startSecond}-${item.endSecond}秒` : `${item.startSecond}秒`;
    const detection = [
      item.type ? `类型 ${item.type}` : '',
      item.position ? `位置 ${item.position}` : '',
      typeof item.confidence === 'number' ? `置信度 ${Math.round(item.confidence * 100)}%` : '',
    ].filter(Boolean).join('，');
    const replacement = `默认替换画中画内容：${item.content || '使用用户新素材或新说明内容'}。`;
    return `${index + 1}. ${time}${detection ? `（${detection}）` : ''}：保留画中画出现时段与内容角色。${replacement}`;
  }).join('\n');
}

export function formatPictureInPictureEvidence(value: ReturnType<typeof mergePictureInPictureEvidence>) {
  if (!value.appeared || !value.items.length) {
    return value.summary || '未出现画中画。';
  }
  return [
    value.summary ? `概览：${value.summary}` : '',
    ...value.items.map((item, index) => {
      const time = item.endSecond > item.startSecond ? `${item.startSecond}-${item.endSecond}秒` : `${item.startSecond}秒`;
      const detection = [
        item.type ? `类型：${item.type}` : '',
        item.position ? `位置：${item.position}` : '',
        typeof item.confidence === 'number' ? `置信度：${Math.round(item.confidence * 100)}%` : '',
      ].filter(Boolean).join('；');
      return [
        `${index + 1}. ${time}`,
        detection,
        item.content ? `内容：${item.content}` : '',
      ].filter(Boolean).join('；');
    }),
    '# 组合/替换计划',
    pictureInPictureCompositionPlan(value),
  ].filter(Boolean).join('\n');
}

export function buildVideoExpertMessages(content: string): Array<{ source: string; roleName: string; content: string }> {
  const parsed = tryParseJsonValue(content);
  const taskMeta = [
    { key: 'task2', aliases: ['task2', '任务2', '任务二', '场景人物', '场景与人物'], roleName: '场景人物专家' },
    { key: 'task3', aliases: ['task3', '任务3', '任务三', '镜头语言'], roleName: '镜头语言专家' },
    { key: 'task4', aliases: ['task4', '任务4', '任务四', '视听元素'], roleName: '视听元素专家' },
    { key: 'task5', aliases: ['task5', '任务5', '任务五', '产品识别'], roleName: '产品识别专家' },
  ];
  if (isRecord(parsed)) {
    const messages = taskMeta.flatMap((meta) => {
      const value = meta.aliases.map((alias) => parsed[alias]).find((item) => !isEmptyJsonValue(item));
      const messageValue = meta.key === 'task2' ? withoutPictureInPictureFields(value) : value;
      return isEmptyJsonValue(value) ? [] : [{
        source: `video_expert_${meta.key}`,
        roleName: meta.roleName,
        content: stringifyExpertValue(messageValue),
      }];
    });
    return messages;
  }
  if (Array.isArray(parsed)) {
    return taskMeta.flatMap((meta, index) => {
      const value = parsed[index];
      return isEmptyJsonValue(value) ? [] : [{
        source: `video_expert_${meta.key}`,
        roleName: meta.roleName,
        content: stringifyExpertValue(value),
      }];
    });
  }
  return content.trim() ? [{ source: 'video_expert_raw', roleName: '视频理解专家', content }] : [];
}

export async function buildStoryboardMessageWithDefaultLlm(input: {
  userId: string;
  audioContent: string;
  videoContent: string;
  pictureInPictureContent?: string;
  agents: ViralUnderstandingAgent[];
}) {
  const storyboardAgent = input.agents.find((agent) => agent.key === 'editing_expert');
  return callConfiguredLlm({
    userId: input.userId,
    temperature: 0.35,
    sourceType: 'storyboard_message',
    system: storyboardAgent?.prompt || '你是资深短视频分镜脚本策划。你会基于音频理解和视频理解结果，整理成给用户可直接复刻执行的中文分镜脚本。',
    sourceId: `storyboard:${input.userId}`,
    user: [
      '请基于火山引擎 SDK 返回的音频理解和视频理解结果，输出结构化分镜脚本。',
      '',
      '# 输出要求',
      '1. 按镜头顺序输出，每个镜头包含：时间段、画面、人物/动作、台词/旁白、音效、复刻建议；不要规划任何字幕或屏幕文字。',
      '2. 语言要给用户看得懂、能执行，不要暴露内部分析过程。',
      '3. 如果输入里存在不确定信息，请用“建议/可选”表达，不要编造明确事实。',
      '',
      '# 音频理解专家结果',
      input.audioContent,
      '',
      '# 视频理解专家结果',
      input.videoContent,
      '',
      '# 画中画提取与组合/替换要求',
      input.pictureInPictureContent || '未检测到结构化画中画证据。',
      '如果存在画中画：分镜只需写清每个画中画出现的时间、类型和内容；复刻建议默认替换画中画内部素材。',
      '组合规则：默认保留画中画出现时段、层级和节奏；默认替换画中画内部素材。用户替换人物/场景/产品素材时，画中画内旧品牌、旧人物、旧产品、旧 Logo 必须同步替换或删除。',
    ].join('\n'),
  });
}

export async function buildTimedStoryboardForDirector(input: {
  task: VideoGenerationTask;
  director: ViralDirectorData;
  outputs: Record<string, ViralUnderstandingOutput>;
  targetSeconds: number;
}) {
  const fallback = fallbackTimedStoryboard({
    director: input.director,
    targetSeconds: input.targetSeconds,
  });
  const productDescription = input.director.product.description.trim();
  const productMatchesSpoken = productTextMatchesSpokenContent(productDescription, input.director.part);
  const forbiddenProductPhrases = conflictingProductPhrases({
    productText: productDescription,
    spokenContent: input.director.part,
  });
  const confirmedProductText = productMatchesSpoken ? [
    productDescription ? `产品：${productDescription}` : '',
    input.director.product.presentation ? `展示方式：${input.director.product.presentation}` : '',
  ].filter(Boolean).join('\n') : '';
  const characterRules = confirmedCharacterStoryboardRules({
    director: input.director,
    userId: input.task.userId,
  });
  const storyboardDirectorContext = {
    basic: input.director.basic,
    characters: directorCharacterItems(input.director).map((item, index) => {
      const mode = item.referenceMode || (item.assetId ? 'asset' : 'prompt');
      return {
        label: item.label || `人物 ${index + 1}`,
        appearance: mode === 'asset' ? '' : item.appearance,
        characterPrompt: mode === 'asset' ? item.characterPrompt || '完全按照人物素材' : item.characterPrompt,
        gesture: item.gesture,
        expression: item.expression,
        referenceMode: mode,
        hasAsset: Boolean(item.assetId),
        required: item.required !== false,
      };
    }),
    scenes: directorSceneItems(input.director).map((item, index) => ({
      label: item.label || `场景 ${index + 1}`,
      description: item.description,
      environment: item.environment,
      props: item.props,
      lighting: item.lighting,
      composition: item.composition,
      camera: item.camera,
      atmosphere: item.atmosphere,
      referenceMode: item.referenceMode || (item.assetId || item.groupId ? 'asset' : 'prompt'),
      hasReference: Boolean(item.assetId || item.groupId),
      required: item.required !== false,
    })),
    audio: directorAudioItems(input.director).map((item, index) => ({
      label: item.label || item.characterLabel || `声音 ${index + 1}`,
      voice: item.voice,
      voiceStyle: item.voiceStyle,
      hasReference: Boolean(item.assetId || item.groupId),
    })),
    productRule: input.director.product.noProduct
      ? '不需要产品展示。'
      : '产品/品牌/型号以已确认口播内容为准；产品卡片只有在与口播一致时才可参考。',
  };
  const sceneRules = confirmedSceneStoryboardRules({
    director: input.director,
    userId: input.task.userId,
  });
  const pipOutput = pictureInPictureOutput(input.outputs);
  const pipEvidence = mergePictureInPictureEvidence(
    pipOutput?.pictureInPicture,
    pipOutput?.pipAssets,
  );
  const pipPlan = pictureInPictureCompositionPlan(pipEvidence);
  try {
    const content = await callConfiguredLlm({
      userId: input.task.userId,
      temperature: 0.28,
      sourceType: 'timed_storyboard',
      system: [
        '你是 爆款复刻的分镜脚本分析专家。你需要在用户确认口播内容后，重新生成可执行的分镜脚本。',
        '必须输出 Markdown，不要输出 JSON。',
        '已确认口播内容是最高优先级事实来源；台词/旁白必须使用已确认口播里的原句，不要改写、替换、补写台词。',
        '允许出现已确认口播内容中明确出现的自有产品/品牌/型号。',
        '已确认人物设定是最高优先级人物事实来源；人物形象、动作、表情只能来自用户确认的人物卡片/人物素材。',
        '人物参考方式为素材时，分镜脚本不得输出服装颜色、穿搭、发型、年龄、性别、妆容、体型等外观细节；只能写人物标签和动作表情。',
        '已确认场景设定是最高优先级画面事实来源；场景卡片一旦确认，就必须使用用户确认的场景，不能沿用原视频旧场景。',
        '如果产品卡片、原视频解析、历史分镜与已确认口播不一致，必须忽略它们。',
        '如果原视频解析、历史分镜与已确认人物或场景不一致，必须忽略原视频/历史分镜中的旧人物形象和旧场景。',
        '严禁复用原视频里的旧品牌、旧产品名、旧 Logo、旧包装文字或旧产品标识。',
        '复刻建议必须是本镜头自包含的具体执行要求，不得写“保持机位、光线参数和上一镜头一致”“保持拍摄参数统一”“人物不要出现大幅度位移”“不要切换景别”等依赖上一镜头或过于空泛的句子。',
        '如果已确认人物设定里包含需要持续可见的配件、道具、服饰细节或其他标识性细节，每个有人物的镜头都必须在“人物/动作”字段保留这些可见约束。',
        '每个镜头必须包含明确时间段，格式必须是“## 镜头 N｜起始-结束秒”。',
        '时间段必须连续、不重叠，从 0 秒开始，最后一个镜头结束时间必须等于或非常接近目标总时长。',
        '镜头时长必须匹配该镜头台词量，按自然语速每秒约 4 个中文字符估算；不要把过长台词塞进过短镜头。',
        '台词切分必须保持语义完整，不要截断完整句子或固定搭配；类似“不要 X，要 Y”的对比项必须放在同一个镜头台词里，不能把“不要 X”和“要 Y”拆到不同镜头。',
        '不要生成任何字幕、口播字幕、对白字幕、旁白字幕、逐字稿、屏幕文字、标题条、水印或无关 Logo。',
        '如果存在画中画，必须保留已确认的 PIP 时间点和层级；画中画内部素材默认替换为用户新素材或新内容，不得复用旧品牌、旧产品、旧人物或旧 Logo。',
        '严禁新增已确认口播之外的结束语、寒暄或行动号召，包括拜拜、再见、下期见、关注我、点赞关注、记得收藏。',
      ].join('\n'),
      sourceId: input.task.id,
      user: [
        `目标总时长：${input.targetSeconds}秒。`,
        `最后一个镜头结束时间必须在 ${Math.max(1, input.targetSeconds - Math.max(2, Math.round(input.targetSeconds * 0.08)))}-${input.targetSeconds + Math.max(2, Math.round(input.targetSeconds * 0.08))} 秒之间，优先等于 ${input.targetSeconds} 秒。`,
        '请按口播节奏拆成多个镜头块，每块建议 4-15 秒。',
        '',
        '# 已确认口播内容（最高优先级，必须逐段覆盖）',
        input.director.part,
        '只能使用以上口播原句；如果原文没有“拜拜/再见/关注/下期见”等结束语，分镜中也不能补写。',
        '',
        '# 已确认人物设定（最高优先级，必须用于每个有人物的镜头）',
        characterRules,
        '',
        '# 已确认场景设定（最高优先级，必须用于每个镜头画面）',
        sceneRules,
        '',
        '# 当前产品设定（只使用这里或口播中出现的产品/品牌）',
        input.director.product.noProduct
          ? '不需要产品展示，不要加入任何旧产品、包装或品牌标识。'
          : confirmedProductText || '产品卡片与口播不一致或未单独确认；只以已确认口播内容为准。',
        forbiddenProductPhrases.length ? `以下疑似旧产品/冲突产品严禁出现：${forbiddenProductPhrases.join('、')}` : '',
        '',
        '# 已确认导演数据（已移除旧产品字段，产品事实只看口播）',
        JSON.stringify(storyboardDirectorContext, null, 2),
        '',
        '# 画中画组合/替换计划',
        pipPlan,
        '',
        '# 输出字段要求',
        '每个镜头包含：时间段、画面、人物/动作、台词/旁白、音效、复刻建议。',
        pipEvidence.appeared ? '每个涉及画中画的镜头，复刻建议必须写出：PIP 保留的时间、大致位置和替换的内部内容。' : '',
        '人物/动作字段必须使用已确认人物标签、动作和表情；参考素材人物的外观由素材本身决定，分镜脚本不要额外描述穿搭、服饰颜色、发型、妆容、体型、年龄、身份等外观细节，也不得沿用原视频旧人物外貌、人设、服装或身份。',
        '台词/旁白字段只能摘取已确认口播原句；每个镜头的台词必须以完整语义片段结束，不能停在“不要固定”“不要黑色”等未完成对比短语上；画面和复刻建议必须使用已确认场景设定，不得沿用原视频旧场景；也不得出现已确认口播之外的品牌名、产品名或标识，不得生成任何字幕或屏幕文字。',
        '如果人物卡片写了需要持续可见的配件、道具、服饰细节或其他标识性细节，必须写进每个有人物的“人物/动作”字段；不要只写在复刻建议里。',
        '复刻建议只写本镜头具体可执行事项，不要写“保持机位、光线参数和上一镜头一致”“保持拍摄参数统一”“人物不要出现大幅度位移”“不要切换景别”等空泛连续性描述。',
        '音效字段只写环境音、动作音、轻微转场音，不要在音效字段里重复字幕、屏幕文字或可读文字禁令。',
        '每个镜头的时长必须能让该镜头台词以自然语速读完；不要安排过快口播。',
      ].join('\n'),
    });
    const sanitizedContent = stripAssetCharacterAppearanceFromStoryboard(content, input.director);
    const duration = parseStoryboardDurationSeconds(sanitizedContent);
    if (!storyboardDurationIsCloseToTarget(duration, input.targetSeconds) || forbiddenProductPhrases.some((phrase) => sanitizedContent.includes(phrase))) {
      logger.warn('timed storyboard duration mismatch, using fallback', {
        taskId: input.task.id,
        duration,
        targetSeconds: input.targetSeconds,
      });
      return fallback;
    }
    return sanitizedContent;
  } catch (error) {
    logger.warn('timed storyboard generation failed, using fallback', {
      taskId: input.task.id,
      error: errorLogContext(error),
    });
    return fallback;
  }
}

export function stringValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function numberValue(value: unknown) {
  if (value === null || value === undefined || value === '') {
    return undefined;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function firstStringValue(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = stringValue(record[key]);
    if (value) {
      return value;
    }
  }
  return '';
}

function firstNumberValue(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = numberValue(record[key]);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function stringArrayValue(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((item) => stringValue(item)).filter(Boolean);
  }
  const text = stringValue(value);
  return text ? text.split(/[，,、;；\n]/u).map((item) => item.trim()).filter(Boolean) : [];
}

function unwrapLabeledEntity(value: unknown): { label?: string; record: Record<string, unknown> } {
  const record = isRecord(value) ? value : {};
  const entries = Object.entries(record);
  if (entries.length === 1 && isRecord(entries[0][1])) {
    return { label: entries[0][0], record: entries[0][1] as Record<string, unknown> };
  }
  return { record };
}

function findArraysByKeys(value: unknown, keys: string[], depth = 0): unknown[][] {
  if (depth > 8) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => findArraysByKeys(item, keys, depth + 1));
  }
  if (!isRecord(value)) {
    return [];
  }
  const matched: unknown[][] = [];
  for (const [key, item] of Object.entries(value)) {
    if (keys.includes(key) && Array.isArray(item)) {
      matched.push(item);
      continue;
    }
    matched.push(...findArraysByKeys(item, keys, depth + 1));
  }
  return matched;
}

function formatEntityDescription(record: Record<string, unknown>, skipKeys: string[]) {
  const skipped = new Set(skipKeys);
  return Object.entries(record)
    .filter(([key, value]) => !skipped.has(key) && !isEmptyJsonValue(value))
    .map(([key, value]) => {
      const text = stringifyExpertValue(value).replace(/^- /gm, '').trim();
      return text ? `${key}：${text}` : '';
    })
    .filter(Boolean)
    .join('\n');
}

function visualExpertEntities(content: string) {
  const parsed = tryParseJsonValue(content);
  const sceneArrays = findArraysByKeys(parsed, ['场景描述', '场景信息', '场景列表', 'scenes', 'sceneDescriptions']);
  const characterArrays = findArraysByKeys(parsed, ['人物描述', '人物信息', '人物列表', 'characters', 'people']);
  const scenes: ViralDirectorScene[] = sceneArrays.flatMap((items) => items.filter(isRecord).map((item, index) => {
    const { label, record } = unwrapLabeledEntity(item);
    return {
      label: label || firstStringValue(record, ['场景名称', 'label', 'name']) || `场景 ${index + 1}`,
      description: formatEntityDescription(record, ['场景名称', 'label', 'name', '开始秒', '结束秒', 'startSecond', 'endSecond', 'start', 'end']),
      environment: firstStringValue(record, ['环境布置', 'environment']),
      props: firstStringValue(record, ['道具', '陈设', 'props']),
      lighting: firstStringValue(record, ['光线氛围', 'lighting']),
      composition: firstStringValue(record, ['空间层次', 'composition']),
      camera: firstStringValue(record, ['机位', '景别', 'camera']),
      atmosphere: firstStringValue(record, ['氛围', 'atmosphere']),
      startSecond: firstNumberValue(record, ['开始秒', '开始时间', 'startSecond', 'start']),
      endSecond: firstNumberValue(record, ['结束秒', '结束时间', 'endSecond', 'end']),
      spokenCue: firstStringValue(record, ['口播', '口播线索', 'spokenCue', 'cue']),
      keywords: stringArrayValue(record['关键词'] || record.keywords),
      required: true,
      referenceMode: 'prompt' as const,
    };
  })).filter((item) => item.description || item.environment || item.lighting || item.composition);
  const characters: ViralDirectorCharacter[] = characterArrays.flatMap((items) => items.filter(isRecord).map((item, index) => {
    const { label, record } = unwrapLabeledEntity(item);
    const appearance = firstStringValue(record, ['外观', '人物外观', 'appearance']);
    const gesture = firstStringValue(record, ['动作', '人物动作', 'gesture', 'action']);
    const expression = firstStringValue(record, ['表情', 'expression']);
    return {
      label: label || firstStringValue(record, ['人物名称', 'label', 'name']) || `人物 ${index + 1}`,
      appearance,
      characterPrompt: formatEntityDescription(record, ['人物名称', 'label', 'name', '开始秒', '结束秒', 'startSecond', 'endSecond', 'start', 'end', '动作', '人物动作', 'gesture', 'action', '表情', 'expression', '口播', '口播线索', 'spokenCue', 'cue']),
      gesture,
      expression,
      startSecond: firstNumberValue(record, ['开始秒', '开始时间', 'startSecond', 'start']),
      endSecond: firstNumberValue(record, ['结束秒', '结束时间', 'endSecond', 'end']),
      spokenCue: firstStringValue(record, ['口播', '口播线索', 'spokenCue', 'cue']),
      keywords: stringArrayValue(record['关键词'] || record.keywords),
      required: true,
      referenceMode: 'prompt' as const,
    };
  })).filter((item) => item.appearance || item.characterPrompt || item.gesture || item.expression);
  return { scenes, characters };
}

function stripCharacterTextFromSceneDescription(text: string) {
  return text
    .replace(/(?:^|[\n；;])\s*(?:人物|角色)\s*[0-9一二三四五六七八九十]+[：:][\s\S]*$/u, '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !/^(?:人物|角色)\s*[0-9一二三四五六七八九十]+[：:]/u.test(line))
    .join('\n')
    .trim();
}

export function directorCharacterPromptValue(character: Record<string, unknown>) {
  if (Object.prototype.hasOwnProperty.call(character, 'characterPrompt')) {
    return stringValue(character.characterPrompt);
  }
  return stringValue(character.appearance);
}

function directorCharacterKey(label?: string) {
  return (label || '')
    .trim()
    .replace(/\s+/g, '')
    .replace(/^角色(?=\d+$)/, '人物')
    .replace(/^person(?=\d+$)/i, '人物')
    .toLowerCase();
}

function mergeDirectorCharacterItem(base: ViralDirectorCharacter, incoming: ViralDirectorCharacter): ViralDirectorCharacter {
  const referenceMode = base.referenceMode === 'asset' || incoming.referenceMode === 'asset'
    ? 'asset'
    : incoming.referenceMode || base.referenceMode;
  return {
    label: base.label || incoming.label,
    appearance: base.appearance || incoming.appearance,
    characterPrompt: base.characterPrompt || incoming.characterPrompt,
    gesture: base.gesture || incoming.gesture,
    expression: base.expression || incoming.expression,
    startSecond: base.startSecond ?? incoming.startSecond,
    endSecond: base.endSecond ?? incoming.endSecond,
    spokenCue: base.spokenCue || incoming.spokenCue,
    keywords: base.keywords?.length ? base.keywords : incoming.keywords,
    assetId: base.assetId || incoming.assetId,
    required: base.required !== false || incoming.required !== false,
    referenceMode: referenceMode || (base.assetId || incoming.assetId ? 'asset' : 'prompt'),
  };
}

function dedupeDirectorCharacterItems(items: ViralDirectorCharacter[]) {
  const merged: ViralDirectorCharacter[] = [];
  const byKey = new Map<string, number>();
  items.forEach((item, index) => {
    const key = directorCharacterKey(item.label) || `__index_${index}`;
    const existingIndex = byKey.get(key);
    if (existingIndex === undefined) {
      byKey.set(key, merged.length);
      merged.push(item);
      return;
    }
    merged[existingIndex] = mergeDirectorCharacterItem(merged[existingIndex], item);
  });
  return merged;
}

function splitMergedIndexedEntityText(text: string, prefixes: string[]) {
  const source = text.trim();
  if (!source) {
    return [];
  }
  const prefixPattern = prefixes.map((prefix) => prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const entityPattern = new RegExp(`(?:^|[\\s,，、;；])((?:${prefixPattern})\\s*[0-9一二三四五六七八九十]+(?:[（(][^（）()]+[）)])?)`, 'gu');
  const colonIndex = source.search(/[：:]/u);
  if (colonIndex > 0) {
    const header = source.slice(0, colonIndex);
    const commonDescription = source.slice(colonIndex + 1).trim();
    const headerMatches = Array.from(header.matchAll(entityPattern));
    if (headerMatches.length >= 2 && commonDescription) {
      return headerMatches.map((match) => ({
        label: (match[1] || '').trim(),
        description: commonDescription,
      })).filter((item) => item.label);
    }
  }
  const matches = Array.from(source.matchAll(entityPattern))
    .map((match) => ({
      label: (match[1] || '').trim(),
      index: (match.index || 0) + (match[0].length - (match[1] || '').length),
    }))
    .filter((match) => match.label);
  if (matches.length < 2) {
    return [];
  }
  return matches.map((match, index) => {
    const next = matches[index + 1];
    const chunk = source.slice(match.index + match.label.length, next ? next.index : undefined)
      .replace(/^[\s：:，,、;；-]+/u, '')
      .trim();
    return {
      label: match.label,
      description: chunk,
    };
  }).filter((item) => item.description);
}

function splitMergedDirectorCharacterItem(item: ViralDirectorCharacter): ViralDirectorCharacter[] {
  if (item.assetId || item.referenceMode === 'asset') {
    return [item];
  }
  const text = [
    item.label,
    item.characterPrompt,
    item.appearance,
    item.gesture,
    item.expression,
  ].filter(Boolean).join('：');
  const parts = splitMergedIndexedEntityText(text, ['人物', '角色']);
  if (parts.length < 2) {
    return [item];
  }
  return parts.map((part) => ({
    ...item,
    label: part.label,
    appearance: part.description || item.appearance,
    characterPrompt: part.description || item.characterPrompt,
    startSecond: undefined,
    endSecond: undefined,
    spokenCue: '',
    keywords: [],
  }));
}

export function normalizeDirectorNegativePrompt(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => stringValue(item)).filter(Boolean);
  }
  const text = stringValue(value);
  return text ? text.split(/[，,\n]/).map((item) => item.trim()).filter(Boolean) : [];
}

export function spokenContentFromAudioExpert(content: string) {
  const lines = content
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line
      .replace(/^\d+[.、]\s*/, '')
      .replace(/^[-*]\s*/, '')
      .replace(/^口播[：:]\s*/, '')
      .replace(/[，,]?\s*时间[：:]\s*[^。；;\n]+[。.]?$/u, '')
      .trim())
    .filter(Boolean);
  return lines.join('\n');
}

function uniqueDirectorLabels(labels: string[]) {
  const seen = new Set<string>();
  return labels
    .map((label) => label.trim())
    .filter(Boolean)
    .filter((label) => {
      const key = directorCharacterKey(label);
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

function extractQuotedSpeechSubjects(text: string) {
  const labels: string[] = [];
  const pattern = /(?:^|\n)\s*(?:[-*]\s*)?([^：:\n]{1,12})\s*[：:]\s*\S+/g;
  for (const match of text.matchAll(pattern)) {
    const label = match[1]
      .replace(/^(?:台词\/旁白|台词|旁白|口播|人声内容|声音|音频|人物\/动作|画面|音效|复刻建议)$/u, '')
      .trim();
    if (/^(?:人物\s*[A-Za-z\d一二三四五六七八九十]+|角色\s*[A-Za-z\d一二三四五六七八九十]+|旁白\s*\d*|男声|女声|男|女|甲|乙|A|B|主持人|采访者|被访者|顾客|客户|老师|学生|妈妈|爸爸|孩子|女生|男生|女孩|男孩|主讲人|助理)$/u.test(label)) {
      labels.push(label.replace(/\s+/g, ' '));
    }
  }
  return uniqueDirectorLabels(labels);
}

function inferSpeechSubjects(input: {
  record: Record<string, unknown>;
  part: string;
  audioExpert: string;
  storyboard: string;
}) {
  const explicit = [
    ...extractQuotedSpeechSubjects(input.part),
    ...extractQuotedSpeechSubjects(input.audioExpert),
    ...extractQuotedSpeechSubjects(input.storyboard),
  ];
  if (explicit.length) {
    return explicit.map((label, index) => ({
      label: /^旁白/.test(label) ? label || `旁白 ${index + 1}` : label,
      isNarration: /^旁白/.test(label),
    }));
  }
  if (input.part.trim()) {
    return [{ label: '人物 1', isNarration: false }];
  }
  return [];
}

function storyboardActionHints(storyboard: string) {
  const hints: string[] = [];
  let inAction = false;
  for (const rawLine of storyboard.split('\n')) {
    const line = rawLine
      .trim()
      .replace(/^#{1,6}\s*/, '')
      .replace(/^[-*]\s*/, '')
      .replace(/^\*+|\*+$/g, '')
      .trim();
    if (!line) {
      continue;
    }
    if (/^(?:人物\/动作|人物动作|动作)\s*[：:]?$/.test(line)) {
      inAction = true;
      continue;
    }
    if (/^(?:画面|台词\/旁白|台词|旁白|口播|人声|音效|复刻建议|字幕|文案)\s*[：:]?$/.test(line) || /^镜头\s*\d+/.test(line)) {
      inAction = false;
      continue;
    }
    if (inAction) {
      hints.push(line.replace(/^[-*]\s*/, ''));
    }
  }
  return hints.slice(0, 8).join('；');
}

function fallbackCharacterFromSubject(label: string, index: number, actionHints: string): ViralDirectorCharacter {
  const isNarration = /^旁白/.test(label);
  return {
    label: label || (isNarration ? `旁白 ${index + 1}` : `人物 ${index + 1}`),
    appearance: isNarration ? '不需要出镜人物，仅作为音轨主体。' : '',
    characterPrompt: isNarration ? '不生成该旁白主体的可见人物。' : '',
    gesture: isNarration ? '' : actionHints,
    expression: '',
    required: !isNarration,
    referenceMode: 'prompt',
  };
}

export function normalizeDirectorCharacterItems(character: Record<string, unknown>): ViralDirectorCharacter[] {
  const rawItems = [character.items, character.people, character.characters]
    .find((item) => Array.isArray(item));
  if (!Array.isArray(rawItems)) {
    return [];
  }
  const items: ViralDirectorCharacter[] = rawItems.filter(isRecord).map((rawItem, index) => {
    const wrapped = unwrapLabeledEntity(rawItem);
    const item = wrapped.record;
    return {
      label: wrapped.label || stringValue(item.label) || stringValue(item.name) || `人物 ${index + 1}`,
      appearance: stringValue(item.appearance) || stringValue(item['外观']),
      characterPrompt: directorCharacterPromptValue(item),
      gesture: stringValue(item.gesture) || stringValue(item.action) || stringValue(item['动作']),
      expression: stringValue(item.expression) || stringValue(item['表情']),
      startSecond: firstNumberValue(item, ['startSecond', 'start', 'startTime', '开始时间', '开始秒']),
      endSecond: firstNumberValue(item, ['endSecond', 'end', 'endTime', '结束时间', '结束秒']),
      spokenCue: firstStringValue(item, ['spokenCue', 'narrationCue', 'speechCue', 'cue', '口播线索', '对应口播', '语境线索', '口播']),
      keywords: stringArrayValue(item.keywords || item.keyword || item['关键词']),
      assetId: stringValue(item.assetId) || undefined,
      required: item.required !== false,
      referenceMode: item.referenceMode === 'asset' ? 'asset' : item.referenceMode === 'prompt' ? 'prompt' : stringValue(item.assetId) ? 'asset' : 'prompt',
    };
  });
  return dedupeDirectorCharacterItems(items.flatMap(splitMergedDirectorCharacterItem));
}

export function normalizeDirectorAudioItems(audio: Record<string, unknown>, subjects: Array<{ label: string; index: number }>): ViralDirectorAudioItem[] {
  const rawItems = [audio.items, audio.voices, audio.speakers]
    .find((item) => Array.isArray(item));
  const fallbackVoice = stringValue(audio.voice) || '原声';
  const fallbackVoiceStyle = stringValue(audio.voiceStyle);
  const fallbackAssetId = stringValue(audio.assetId) || undefined;
  const fallbackGroupId = stringValue(audio.groupId) || stringValue(audio.voiceGroupId) || undefined;
  const parsedItems = Array.isArray(rawItems)
    ? rawItems.filter(isRecord).map((item, index) => ({
      label: stringValue(item.label) || stringValue(item.name) || stringValue(item.characterLabel) || subjects[index]?.label || `声音 ${index + 1}`,
      characterLabel: stringValue(item.characterLabel) || stringValue(item.character) || subjects[index]?.label || stringValue(item.label) || `人物 ${index + 1}`,
      characterIndex: Number.isFinite(Number(item.characterIndex)) ? Number(item.characterIndex) : index,
      voice: stringValue(item.voice) || fallbackVoice,
      voiceStyle: stringValue(item.voiceStyle) || stringValue(item.description) || fallbackVoiceStyle,
      assetId: stringValue(item.assetId) || undefined,
      groupId: stringValue(item.groupId) || stringValue(item.voiceGroupId) || undefined,
    }))
    : [];
  const bySubject = new Map(parsedItems.map((item) => [directorCharacterKey(item.characterLabel || item.label), item]));
  return subjects.map((subject) => {
    const matched = bySubject.get(directorCharacterKey(subject.label)) || parsedItems[subject.index];
    return {
      label: matched?.label || `${subject.label}声音`,
      characterLabel: subject.label,
      characterIndex: subject.index,
      voice: matched?.voice || fallbackVoice,
      voiceStyle: matched?.voiceStyle || fallbackVoiceStyle,
      assetId: matched?.assetId || (subjects.length === 1 ? fallbackAssetId : undefined),
      groupId: matched?.groupId || (subjects.length === 1 ? fallbackGroupId : undefined),
    };
  });
}

export function mergedDirectorSceneDescription(scene: Record<string, unknown>) {
  const description = stringValue(scene.description).trim();
  const environment = stringValue(scene.environment);
  const props = stringValue(scene.props);
  const lighting = stringValue(scene.lighting);
  const composition = stringValue(scene.composition);
  const camera = stringValue(scene.camera);
  const atmosphere = stringValue(scene.atmosphere);
  if (description) {
    return description;
  }
  return [
    environment ? `环境空间：${environment}` : '',
    props ? `道具/陈设：${props}` : '',
    lighting ? `光线氛围：${lighting}` : '',
    composition ? `构图层次：${composition}` : '',
    camera ? `机位/景别：${camera}` : '',
    atmosphere ? `背景氛围：${atmosphere}` : '',
    stringValue(scene.visualStyle) ? `视觉风格：${stringValue(scene.visualStyle)}` : '',
  ].filter(Boolean).join('\n');
}

export function normalizeDirectorSceneItems(scene: Record<string, unknown>): ViralDirectorScene[] {
  const rawItems = [scene.items, scene.scenes]
    .find((item) => Array.isArray(item));
  if (!Array.isArray(rawItems)) {
    return [];
  }
  const items: ViralDirectorScene[] = rawItems.filter(isRecord).map((rawItem, index) => {
    const wrapped = unwrapLabeledEntity(rawItem);
    const item = wrapped.record;
    return {
      label: wrapped.label || stringValue(item.label) || stringValue(item.name) || `场景 ${index + 1}`,
      description: mergedDirectorSceneDescription(item) || formatEntityDescription(item, ['label', 'name', '开始秒', '结束秒', 'startSecond', 'endSecond', 'start', 'end']),
      environment: stringValue(item.environment) || stringValue(item['环境布置']),
      props: stringValue(item.props) || stringValue(item['道具']) || stringValue(item['陈设']),
      lighting: stringValue(item.lighting) || stringValue(item['光线氛围']),
      composition: stringValue(item.composition) || stringValue(item['空间层次']),
      camera: stringValue(item.camera) || stringValue(item['机位']) || stringValue(item['景别']),
      atmosphere: stringValue(item.atmosphere) || stringValue(item['氛围']),
      startSecond: firstNumberValue(item, ['startSecond', 'start', 'startTime', '开始时间', '开始秒']),
      endSecond: firstNumberValue(item, ['endSecond', 'end', 'endTime', '结束时间', '结束秒']),
      spokenCue: firstStringValue(item, ['spokenCue', 'narrationCue', 'speechCue', 'cue', '口播线索', '对应口播', '语境线索', '口播']),
      keywords: stringArrayValue(item.keywords || item.keyword || item['关键词']),
      assetId: stringValue(item.assetId) || undefined,
      groupId: stringValue(item.groupId) || stringValue(item.sceneGroupId) || undefined,
      required: item.required !== false,
      referenceMode: item.referenceMode === 'asset' ? 'asset' : item.referenceMode === 'prompt' ? 'prompt' : (stringValue(item.assetId) || stringValue(item.groupId) || stringValue(item.sceneGroupId)) ? 'asset' : 'prompt',
    };
  });
  return items.flatMap((item) => {
    if (item.assetId || item.groupId || item.referenceMode === 'asset') {
      return [item];
    }
    const parts = splitMergedIndexedEntityText([
      item.label,
      item.description,
      item.environment,
      item.props,
      item.lighting,
      item.composition,
      item.camera,
      item.atmosphere,
    ].filter(Boolean).join('：'), ['场景', '镜头', '地点']);
    if (parts.length < 2) {
      return [item];
    }
    return parts.map((part) => ({
      ...item,
      label: part.label,
      description: part.description || item.description,
      startSecond: undefined,
      endSecond: undefined,
      spokenCue: '',
      keywords: [],
    }));
  });
}

function sceneDetailSummary(scene: Pick<ViralDirectorScene, 'environment' | 'props' | 'lighting' | 'composition' | 'camera' | 'atmosphere' | 'description'>) {
  const cleanedDescription = stripCharacterTextFromSceneDescription(scene.description || '');
  if (cleanedDescription) {
    return cleanedDescription;
  }
  return [
    scene.environment ? `环境空间：${scene.environment}` : '',
    scene.props ? `道具/陈设：${scene.props}` : '',
    scene.lighting ? `光线氛围：${scene.lighting}` : '',
    scene.composition ? `构图层次：${scene.composition}` : '',
    scene.camera ? `机位/景别：${scene.camera}` : '',
    scene.atmosphere ? `背景氛围：${scene.atmosphere}` : '',
  ].filter(Boolean).join('\n');
}

function hasDetectedVisualCharacter(input: {
  task: VideoGenerationTask;
  outputs: Record<string, ViralUnderstandingOutput>;
}) {
  const personText = [
    input.task.editableParseResult.person,
    input.task.rawParseResult.person,
    input.outputs.video_expert?.content || '',
  ].join('\n');
  if (/(人物|真人|人像|出镜|主播|达人|男生|女生|女性|男性|顾客|模特)/.test(personText)) {
    return true;
  }
  const viralAnalysis = isRecord(input.task.editableParseResult.viralAnalysis)
    ? input.task.editableParseResult.viralAnalysis
    : isRecord(input.task.rawParseResult.viralAnalysis)
      ? input.task.rawParseResult.viralAnalysis
      : undefined;
  const role = isRecord(viralAnalysis?.role) ? viralAnalysis.role : undefined;
  const details = isRecord(role?.details) ? role.details : undefined;
  return String(details?.roleType || '').trim().toLowerCase() === 'human';
}

export function viralDirectorFallbackBasic(task: VideoGenerationTask, outputs: Record<string, ViralUnderstandingOutput>) {
  const context = isRecord(task.expertContext) ? task.expertContext : {};
  const uploadedVideo = isRecord(context.uploadedVideo) ? context.uploadedVideo : {};
  const vod = isRecord(context.vod) ? context.vod : {};
  const sourceInfo = isRecord(vod.sourceInfo) ? vod.sourceInfo : {};
  const width = Number(sourceInfo.width || 0);
  const height = Number(sourceInfo.height || 0);
  return {
    title: extractVideoExpertTitle(outputs.video_expert?.content || '')
      || stringValue(uploadedVideo.originalFileName)
      || task.title,
    resolution: videoResolutionLabel(width, height),
    aspectRatio: videoAspectRatio(width, height),
  };
}

export function normalizeViralDirectorData(
  value: unknown,
  task: VideoGenerationTask,
  outputs: Record<string, ViralUnderstandingOutput>,
): ViralDirectorData {
  const record = isRecord(value) ? value : {};
  const basic = isRecord(record.basic) ? record.basic : {};
  const character = isRecord(record.character) ? record.character : {};
  const scene = isRecord(record.scene) ? record.scene : {};
  const product = isRecord(record.product) ? record.product : {};
  const pip = isRecord(record.pip) ? record.pip : {};
  const audio = isRecord(record.audio) ? record.audio : {};
  const fallbackBasic = viralDirectorFallbackBasic(task, outputs);
  const videoTitle = extractVideoExpertTitle(outputs.video_expert?.content || '');
  const audioPart = spokenContentFromAudioExpert(outputs.audio_expert?.content || '');
  const part = stringValue(record.part) || stringValue(task.editableParseResult.spokenContent) || audioPart;
  const storyboard = storyboardMessageFromTask(task);
  const actionHints = storyboardActionHints(storyboard);
  const visualEntities = visualExpertEntities(outputs.video_expert?.content || '');
  const inferredSubjects = inferSpeechSubjects({
    record,
    part,
    audioExpert: outputs.audio_expert?.content || '',
    storyboard,
  });
  const normalizedCharacterItems = dedupeDirectorCharacterItems([
    ...visualEntities.characters,
    ...normalizeDirectorCharacterItems(character),
  ]);
  const missingCharacterSubjects = inferredSubjects
    .filter((subject) => !subject.isNarration)
    .filter((subject) => !normalizedCharacterItems.some((item) => directorCharacterKey(item.label) === directorCharacterKey(subject.label)));
  const characterItems = [
    ...normalizedCharacterItems,
    ...missingCharacterSubjects.map((subject, index) => fallbackCharacterFromSubject(subject.label, normalizedCharacterItems.length + index, actionHints)),
  ].map((item) => ({
    ...item,
    gesture: item.gesture || (!/^旁白/.test(item.label || '') ? actionHints : ''),
  }));
  const audioSubjects = (characterItems.length ? characterItems : [])
    .filter((item) => item.required !== false)
    .map((item, index) => ({ label: item.label || `人物 ${index + 1}`, index }));
  inferredSubjects
    .filter((subject) => !audioSubjects.some((item) => directorCharacterKey(item.label) === directorCharacterKey(subject.label)))
    .forEach((subject) => audioSubjects.push({ label: subject.label, index: audioSubjects.length }));
  if (!audioSubjects.length && part) {
    audioSubjects.push({ label: '人物 1', index: 0 });
  }
  const normalizedSceneItems = normalizeDirectorSceneItems(scene).map((item) => ({
    ...item,
    description: stripCharacterTextFromSceneDescription(item.description),
  }));
  const sceneItems = visualEntities.scenes.length ? visualEntities.scenes : normalizedSceneItems;
  const pipItems = normalizeDirectorPipItems(pip);
  const fallbackPip = fallbackDirectorPipFromEvidence(outputs);
  return {
    basic: {
      title: videoTitle || stringValue(basic.title) || fallbackBasic.title,
      resolution: stringValue(basic.resolution) || fallbackBasic.resolution,
      aspectRatio: stringValue(basic.aspectRatio) || fallbackBasic.aspectRatio || '9:16',
    },
    character: {
      label: stringValue(character.label) || '人物 1',
      appearance: stringValue(character.appearance),
      characterPrompt: directorCharacterPromptValue(character),
      gesture: stringValue(character.gesture),
      expression: stringValue(character.expression),
      assetId: stringValue(character.assetId) || undefined,
      required: character.required !== false,
      referenceMode: character.referenceMode === 'asset' ? 'asset' : character.referenceMode === 'prompt' ? 'prompt' : stringValue(character.assetId) ? 'asset' : 'prompt',
      items: characterItems,
    },
    scene: {
      label: stringValue(scene.label) || '场景 1',
      description: stripCharacterTextFromSceneDescription(mergedDirectorSceneDescription(scene)),
      environment: stringValue(scene.environment),
      props: stringValue(scene.props),
      lighting: stringValue(scene.lighting),
      composition: stringValue(scene.composition),
      camera: stringValue(scene.camera),
      atmosphere: stringValue(scene.atmosphere),
      visualStyle: stringValue(scene.visualStyle),
      assetId: stringValue(scene.assetId) || undefined,
      groupId: stringValue(scene.groupId) || stringValue(scene.sceneGroupId) || undefined,
      required: scene.required !== false,
      referenceMode: scene.referenceMode === 'asset' ? 'asset' : scene.referenceMode === 'prompt' ? 'prompt' : (stringValue(scene.assetId) || stringValue(scene.groupId) || stringValue(scene.sceneGroupId)) ? 'asset' : 'prompt',
      items: sceneItems,
    },
    product: {
      description: stringValue(product.description),
      presentation: stringValue(product.presentation),
      assetId: stringValue(product.assetId) || undefined,
      groupId: stringValue(product.groupId) || stringValue(product.productGroupId) || undefined,
      noProduct: product.noProduct === true,
      referenceMode: product.referenceMode === 'asset' ? 'asset' : product.referenceMode === 'prompt' ? 'prompt' : (stringValue(product.assetId) || stringValue(product.groupId) || stringValue(product.productGroupId)) ? 'asset' : 'prompt',
      items: Array.isArray(product.items)
        ? product.items.filter(isRecord).map((item, index) => ({
          label: stringValue(item.label) || stringValue(item.name) || `产品 ${index + 1}`,
          description: stringValue(item.description),
          presentation: stringValue(item.presentation),
          productType: stringValue(item.productType),
          feature: stringValue(item.feature),
          brand: stringValue(item.brand),
          model: stringValue(item.model),
          startSecond: firstNumberValue(item, ['startSecond', 'start', 'startTime', '开始时间', '开始秒']),
          endSecond: firstNumberValue(item, ['endSecond', 'end', 'endTime', '结束时间', '结束秒']),
          spokenCue: firstStringValue(item, ['spokenCue', 'narrationCue', 'speechCue', 'cue', '口播线索', '对应口播', '语境线索']),
          keywords: stringArrayValue(item.keywords || item.keyword || item['关键词']),
          noProduct: item.noProduct === true,
          referenceMode: item.referenceMode === 'asset' ? 'asset' : 'prompt',
        }))
        : undefined,
    },
    pip: {
      summary: stringValue(pip.summary) || fallbackPip.summary,
      items: pipItems.length ? pipItems : fallbackPip.items,
    },
    audio: {
      voice: stringValue(audio.voice) || '原声',
      voiceStyle: stringValue(audio.voiceStyle),
      bgm: stringValue(audio.bgm),
      soundEffects: stringValue(audio.soundEffects),
      assetId: stringValue(audio.assetId) || undefined,
      groupId: stringValue(audio.groupId) || stringValue(audio.voiceGroupId) || undefined,
      items: normalizeDirectorAudioItems(audio, audioSubjects),
    },
    negativePrompt: normalizeDirectorNegativePrompt(record.negativePrompt),
    part,
  };
}

export async function buildViralDirectorDraftWithDefaultLlm(input: {
  task: VideoGenerationTask;
  outputs: Record<string, ViralUnderstandingOutput>;
  storyboard: string;
}) {
  const basic = viralDirectorFallbackBasic(input.task, input.outputs);
  const audioPart = spokenContentFromAudioExpert(input.outputs.audio_expert?.content || '');
  const fallbackPart = stringValue(input.task.editableParseResult.spokenContent) || audioPart;
  const pipOutput = pictureInPictureOutput(input.outputs);
  const visualEntities = visualExpertEntities(input.outputs.video_expert?.content || '');
  const directorHints = {
    basic,
    speechSubjects: inferSpeechSubjects({
      record: {},
      part: fallbackPart,
      audioExpert: input.outputs.audio_expert?.content || '',
      storyboard: input.storyboard,
    }),
    actionHints: storyboardActionHints(input.storyboard),
    spokenContent: fallbackPart,
    pictureInPicture: mergePictureInPictureEvidence(
      pipOutput?.pictureInPicture,
      pipOutput?.pipAssets,
    ),
    visualEntities,
  };
  const result = await callConfiguredLlm({
    userId: input.task.userId,
    temperature: 0.1,
    sourceType: 'director_material_table',
    system: [
      '你是“视频生成导演”，负责把爆款视频拆解结果整理成可供用户逐步确认的生成素材表。',
      '只输出 JSON，不要 Markdown，不要解释。',
      '目标：生成“素材确认表”，不是分镜脚本。只保留视频生成需要的结构化信息，去掉字幕样式、标题文案、平台分析话术、无关营销解释。',
      'part 字段只根据“音频理解专家结果”和导演 hints.spokenContent 整理；保留多人对话的说话主体前缀，不要改写成单人口播。',
      'character.items 必须覆盖所有可见说话人物：两人对话就至少两个人物；旁白主体如果不出镜，不要放进 character.items，而应放进 audio.items。',
      '如果视频理解中出现“人物1、人物2、人物3”或多个具名人物，严禁合并成一个 character.items；必须拆成多个 item，每个 item 的 label 对应一个人物。',
      '每个 character.items 必须尽量填 appearance、gesture、expression；gesture 必须吸收导演 hints.actionHints 里的肢体动作、手势、表情和站位细节。',
      '如果 hints 或视频理解结果显示画面里有人物出镜，即使没有明确台词，也要至少输出一个 required=true 的 character.items，用于后续人物素材替换。',
      '严禁把人物外观、动作、表情、声线、口播内容写入 scene.items；这些只能写入 character.items 或 audio/part。',
      'audio.items 必须覆盖所有 speechSubjects：每个说话人物/旁白主体一个声音项；characterLabel 必须对应 character.items[].label 或“旁白 N”。',
      '如果某项没有依据，输出空字符串或空数组，不要编造；但不要遗漏已在 hints 中出现的说话主体和动作线索。',
      '如果 hints.pictureInPicture.appeared=true，必须输出 pip.items：保留出现时间、类型、大致位置和内容作用；referenceMode 默认 prompt；replacementPrompt 写清替换画中画内部内容的提示词。',
      'scene.items 优先填写 description 作为完整场景设定；environment、props、lighting、composition、camera、atmosphere 仅在已有明确拆解信息时补充，用于兼容旧数据，不要为了凑字段重复改写 description。',
      'scene.items 只描述环境、空间、布景、光线、机位和氛围；不要包含“人物1/人物2”、人物外观、动作、表情、声线或口播。',
      '如果视频理解中出现“场景1、场景2”或多个独立地点/空间/时段，严禁合并成一个 scene.items；必须拆成多个 item，每个 item 的 label 对应一个场景。',
      'character.items、scene.items、product.items 必须尽量保留视频理解中的 startSecond、endSecond、spokenCue、keywords；无法判断时留空，不要编造全视频时间。',
      '场景和产品必须按口播语境与出现时间拆分；不要把肯德基、麦当劳、总结讲解等所有候选场景塞进每个 item。',
    ].join('\n'),
    sourceId: input.task.id,
    user: [
      '请根据以下信息输出严格 JSON，字段必须完整：',
      '{"basic":{"title":"","resolution":"","aspectRatio":""},"character":{"items":[{"label":"人物 1","appearance":"","characterPrompt":"","gesture":"","expression":"","startSecond":0,"endSecond":0,"spokenCue":"","keywords":[],"required":true,"referenceMode":"prompt"}]},"scene":{"items":[{"label":"场景 1","description":"","environment":"","props":"","lighting":"","composition":"","camera":"","atmosphere":"","startSecond":0,"endSecond":0,"spokenCue":"","keywords":[],"required":true,"referenceMode":"prompt"}]},"product":{"description":"","presentation":"","noProduct":false,"referenceMode":"prompt","items":[{"label":"产品 1","description":"","presentation":"","startSecond":0,"endSecond":0,"spokenCue":"","keywords":[],"noProduct":false,"referenceMode":"prompt"}]},"pip":{"summary":"","items":[{"id":"pip_1","label":"画中画 1","type":"unknown","startSecond":0,"endSecond":0,"position":"","content":"","confidence":0,"referenceMode":"prompt","replacementPrompt":"","replacementAssetId":"","replacementAssetUrl":"","replacementAssetType":""}]},"audio":{"voice":"原声","voiceStyle":"","bgm":"","soundEffects":"","items":[{"label":"人物 1 声音","characterLabel":"人物 1","characterIndex":0,"voice":"原声","voiceStyle":""}]},"negativePrompt":[],"part":""}',
      '',
      '# 导演 hints（最高优先级，必须覆盖）',
      JSON.stringify(directorHints, null, 2),
      '',
      '# 音频理解专家结果',
      input.outputs.audio_expert?.content || '',
      '',
      '# 视频理解专家结果',
      input.outputs.video_expert?.content || '',
      '',
      '# 从视频理解中提取的实体兜底（最高优先级，用于防止字段混淆）',
      JSON.stringify(visualEntities, null, 2),
      '',
      '# 画中画提取结果',
      formatPictureInPictureEvidence(directorHints.pictureInPicture),
      '',
      '# 画中画组合/替换计划',
      pictureInPictureCompositionPlan(directorHints.pictureInPicture),
      '',
      '# 分镜动作摘要（只用于人物 gesture/expression，不要原样塞入无关字段）',
      directorHints.actionHints,
    ].join('\n'),
  });
  const parsed = tryParseJsonValue(result);
  return normalizeViralDirectorData(parsed, input.task, input.outputs);
}

export function directorStepIsOptionalEmpty(step: ViralDirectorStep, data: ViralDirectorData) {
  if (step === 'character') {
    return directorCharacterItems(data).every((item) => item.required !== false && !item.appearance && !item.characterPrompt && !item.gesture && !item.expression && !item.assetId);
  }
  if (step === 'scene') {
    return directorSceneItems(data).every((item) => item.required !== false && !item.description && !item.assetId && !item.groupId);
  }
  if (step === 'product') {
    return !data.product.noProduct && !data.product.description && !data.product.presentation && !data.product.assetId && !data.product.groupId;
  }
  if (step === 'pip') {
    return !directorPipItems(data).length;
  }
  if (step === 'audio') {
    const audioItems = directorAudioItems(data);
    const hasSpeechSubject = audioItems.some((item) => item.voice !== '不生成')
      || Boolean(data.part.trim());
    if (hasSpeechSubject) {
      return false;
    }
    return !data.audio.voiceStyle
      && !data.audio.bgm
      && !data.audio.soundEffects
      && !data.audio.assetId
      && !data.audio.groupId
      && data.audio.voice === '原声'
      && audioItems.every((item) => item.voice === '原声' && !item.voiceStyle && !item.assetId && !item.groupId);
  }
  return false;
}

export function directorCharacterItems(data: ViralDirectorData): ViralDirectorCharacter[] {
  return data.character.items?.length ? data.character.items : [{
    label: data.character.label || '人物 1',
    appearance: data.character.appearance,
    characterPrompt: data.character.characterPrompt,
    gesture: data.character.gesture,
    expression: data.character.expression,
    assetId: data.character.assetId,
    required: data.character.required !== false,
    referenceMode: data.character.referenceMode || (data.character.assetId ? 'asset' : 'prompt'),
  }];
}

export function directorAudioItems(data: ViralDirectorData): ViralDirectorAudioItem[] {
  if (data.audio.items?.length) {
    return data.audio.items;
  }
  const subjects = directorCharacterItems(data)
    .filter((item) => item.required !== false)
    .map((item, index) => ({ label: item.label || `人物 ${index + 1}`, index }));
  if (!subjects.length && data.part.trim()) {
    subjects.push({ label: '旁白 1', index: 0 });
  }
  return normalizeDirectorAudioItems(data.audio, subjects);
}

function characterReferenceName(item: ViralDirectorCharacter, userId: string) {
  if (item.assetId) {
    const asset = contentRepository.findAsset(item.assetId);
    if (asset && asset.userId === userId) {
      return `用户已选择的人物素材「${asset.name}」`;
    }
    return '用户已选择的人物素材';
  }
  return '用户已确认的人物参考';
}

function confirmedCharacterStoryboardRules(input: { director: ViralDirectorData; userId: string }) {
  const requiredCharacters = directorCharacterItems(input.director).filter((item) => item.required !== false);
  if (!requiredCharacters.length) {
    return '用户已确认不需要可见人物；不要擅自沿用原视频人物形象。';
  }
  return requiredCharacters.map((item, index) => {
    const label = item.label || `人物 ${index + 1}`;
    const mode = item.referenceMode || (item.assetId ? 'asset' : 'prompt');
    const appearance = item.characterPrompt || item.appearance;
    const action = item.gesture ? `动作/肢体：${item.gesture}` : '';
    const expression = item.expression ? `表情：${item.expression}` : '';
    if (mode === 'asset') {
      return [
        `${label}：必须使用${characterReferenceName(item, input.userId)}作为人物形象。`,
        item.characterPrompt ? `人物描述提示词：${item.characterPrompt}` : '人物描述提示词：完全按照人物素材。',
        action,
        expression,
        '分镜脚本每个镜头的“人物/动作”只能写人物标签、动作、表情和道具动作；不得写任何服装颜色、穿搭、发型、年龄、性别、妆容、体型、身份或人设细节。人物外观全部交给素材本身决定。',
      ].filter(Boolean).join('\n');
    }
    return [
      `${label}：必须使用用户确认的人物描述：${appearance || '未填写具体外观，使用中性人物标签，不沿用原视频人物形象。'}`,
      action,
      expression,
      '分镜脚本每个镜头的“人物/动作”只能使用这个已确认人物标签和对应动作/表情；不得沿用原视频人物的发型、衣着、年龄、性别、妆容、体型、身份或人设。',
    ].filter(Boolean).join('\n');
  }).join('\n\n');
}

function sceneReferenceName(item: ViralDirectorScene, userId: string) {
  if (item.groupId) {
    const group = contentRepository.findGroup(item.groupId);
    if (group && group.userId === userId && group.resourceType === 'scene') {
      return `用户已选择的场景组「${group.name}」`;
    }
    return '用户已选择的场景组';
  }
  if (item.assetId) {
    const asset = contentRepository.findAsset(item.assetId);
    if (asset && asset.userId === userId) {
      return `用户已选择的场景素材「${asset.name}」`;
    }
    return '用户已选择的场景素材';
  }
  return '用户已选择的场景参考素材';
}

function confirmedSceneStoryboardRules(input: { director: ViralDirectorData; userId: string }) {
  const requiredScenes = directorSceneItems(input.director).filter((item) => item.required !== false);
  if (!requiredScenes.length) {
    return '用户已确认不需要固定场景；不要擅自沿用原视频场景。';
  }
  return requiredScenes.map((item, index) => {
    const label = item.label || `场景 ${index + 1}`;
    const mode = item.referenceMode || (item.assetId || item.groupId ? 'asset' : 'prompt');
    if (mode === 'asset') {
      const referenceName = sceneReferenceName(item, input.userId);
      const description = sceneDetailSummary(item) ? `补充场景细化：\n${sceneDetailSummary(item)}` : '';
      return [
        `${label}：必须使用${referenceName}作为场景。`,
        '分镜脚本每个镜头的“画面”和“复刻建议”都必须沿用这个自定义场景/参考场景，不要写成原视频解析中的室内环境、同一室内场景、客厅、卧室、化妆台等旧场景，除非这些词来自用户选择的场景素材本身。',
        '如果无法从素材名判断具体环境，就写“所选场景组参考场景/所选场景素材中的场景”，不要自行编造室内环境。',
        description,
      ].filter(Boolean).join('\n');
    }
    return [
      `${label}：必须使用用户确认的场景设定：${sceneDetailSummary(item) || item.description || '未填写场景描述'}`,
      '分镜脚本每个镜头的“画面”和“复刻建议”都必须以该描述为准，不得沿用原视频解析中的旧场景。',
    ].join('\n');
  }).join('\n\n');
}

export function directorSceneItems(data: ViralDirectorData): ViralDirectorScene[] {
  return data.scene.items?.length ? data.scene.items : [{
    label: data.scene.label || '场景 1',
    description: data.scene.description,
    environment: data.scene.environment,
    props: data.scene.props,
    lighting: data.scene.lighting,
    composition: data.scene.composition,
    camera: data.scene.camera,
    atmosphere: data.scene.atmosphere,
    assetId: data.scene.assetId,
    groupId: data.scene.groupId,
    required: data.scene.required !== false,
    referenceMode: data.scene.referenceMode || (data.scene.assetId || data.scene.groupId ? 'asset' : 'prompt'),
  }];
}

export function directorPipItems(data: ViralDirectorData): ViralDirectorPipItem[] {
  return data.pip.items?.length ? data.pip.items : [];
}

export function primaryDirectorPip(items: ViralDirectorPipItem[], summary = '') {
  return {
    summary,
    items,
  };
}

export function primaryDirectorCharacter(items: ViralDirectorCharacter[]) {
  const first = items[0] || { label: '人物 1', appearance: '', characterPrompt: '', gesture: '', expression: '' };
  return {
    label: first.label,
    appearance: first.appearance,
    characterPrompt: first.characterPrompt || first.appearance,
    gesture: first.gesture,
    expression: first.expression,
    assetId: first.assetId,
    required: first.required !== false,
    referenceMode: first.referenceMode || (first.assetId ? 'asset' : 'prompt'),
    items,
  };
}

export function primaryDirectorScene(items: ViralDirectorScene[]) {
  const first = items[0] || { label: '场景 1', description: '' };
  return {
    label: first.label,
    description: first.description,
    environment: first.environment || '',
    props: first.props || '',
    lighting: first.lighting || '',
    composition: first.composition || '',
    camera: first.camera || '',
    atmosphere: first.atmosphere || '',
    visualStyle: '',
    assetId: first.assetId,
    groupId: first.groupId,
    required: first.required !== false,
    referenceMode: first.referenceMode || (first.assetId || first.groupId ? 'asset' : 'prompt'),
    items,
  };
}

export function nextViralDirectorStep(current: ViralDirectorStep, data: ViralDirectorData): ViralDirectorStep {
  const start = Math.max(0, viralDirectorSteps.indexOf(current)) + 1;
  for (const step of viralDirectorSteps.slice(start)) {
    if (!directorStepIsOptionalEmpty(step, data)) {
      return step;
    }
  }
  return 'final';
}

export function normalizeDirectorStep(value: unknown): ViralDirectorStep {
  const step = stringValue(value) as ViralDirectorStep;
  if (!viralDirectorSteps.includes(step)) {
    throw new Error('导演卡片步骤不存在');
  }
  return step;
}

export function mergeDirectorStepValue(data: ViralDirectorData, step: ViralDirectorStep, value: unknown): ViralDirectorData {
  const patch = isRecord(value) ? value : {};
  const merged: ViralDirectorData = JSON.parse(JSON.stringify(data));
  if (step === 'basic') {
    merged.basic = {
      title: stringValue(patch.title) || merged.basic.title,
      resolution: stringValue(patch.resolution) || merged.basic.resolution,
      aspectRatio: stringValue(patch.aspectRatio) || merged.basic.aspectRatio,
    };
  } else if (step === 'character') {
    const items = normalizeDirectorCharacterItems(patch);
    merged.character = items.length
      ? primaryDirectorCharacter(items)
      : {
        label: stringValue(patch.label) || merged.character.label,
        appearance: stringValue(patch.appearance),
        characterPrompt: directorCharacterPromptValue(patch),
        gesture: stringValue(patch.gesture),
        expression: stringValue(patch.expression),
        assetId: stringValue(patch.assetId) || undefined,
        required: patch.required !== false,
        referenceMode: patch.referenceMode === 'asset' ? 'asset' : patch.referenceMode === 'prompt' ? 'prompt' : stringValue(patch.assetId) ? 'asset' : 'prompt',
        items: undefined,
      };
  } else if (step === 'scene') {
    const items = normalizeDirectorSceneItems(patch);
    merged.scene = items.length
      ? primaryDirectorScene(items)
      : {
        label: stringValue(patch.label) || merged.scene.label,
        description: mergedDirectorSceneDescription(patch),
        environment: stringValue(patch.environment),
        props: stringValue(patch.props),
        lighting: stringValue(patch.lighting),
        composition: stringValue(patch.composition),
        camera: stringValue(patch.camera),
        atmosphere: stringValue(patch.atmosphere),
        visualStyle: stringValue(patch.visualStyle),
        assetId: stringValue(patch.assetId) || undefined,
        groupId: stringValue(patch.groupId) || stringValue(patch.sceneGroupId) || undefined,
        required: patch.required !== false,
        referenceMode: patch.referenceMode === 'asset' ? 'asset' : patch.referenceMode === 'prompt' ? 'prompt' : (stringValue(patch.assetId) || stringValue(patch.groupId) || stringValue(patch.sceneGroupId)) ? 'asset' : 'prompt',
        items: undefined,
      };
  } else if (step === 'product') {
    merged.product = {
      description: stringValue(patch.description),
      presentation: stringValue(patch.presentation),
      assetId: stringValue(patch.assetId) || undefined,
      groupId: stringValue(patch.groupId) || stringValue(patch.productGroupId) || undefined,
      noProduct: patch.noProduct === true,
      referenceMode: patch.referenceMode === 'asset' ? 'asset' : patch.referenceMode === 'prompt' ? 'prompt' : (stringValue(patch.assetId) || stringValue(patch.groupId) || stringValue(patch.productGroupId)) ? 'asset' : 'prompt',
    };
  } else if (step === 'pip') {
    const items = normalizeDirectorPipItems(patch);
    merged.pip = primaryDirectorPip(items, stringValue(patch.summary) || merged.pip.summary);
  } else if (step === 'audio') {
    const subjects = directorCharacterItems(merged)
      .filter((item) => item.required !== false)
      .map((item, index) => ({ label: item.label || `人物 ${index + 1}`, index }));
    if (!subjects.length && merged.part.trim()) {
      subjects.push({ label: '旁白 1', index: 0 });
    }
    merged.audio = {
      voice: stringValue(patch.voice) || '原声',
      voiceStyle: stringValue(patch.voiceStyle),
      bgm: stringValue(patch.bgm),
      soundEffects: stringValue(patch.soundEffects),
      assetId: stringValue(patch.assetId) || undefined,
      groupId: stringValue(patch.groupId) || stringValue(patch.voiceGroupId) || undefined,
      items: normalizeDirectorAudioItems(patch, subjects),
    };
  } else if (step === 'part') {
    merged.part = stringValue(patch.part) || stringValue(value);
  }
  if (isRecord(patch) && patch.negativePrompt !== undefined) {
    merged.negativePrompt = normalizeDirectorNegativePrompt(patch.negativePrompt);
  }
  return merged;
}

export async function ensureViralDirectorDraft(input: {
  task: VideoGenerationTask;
  userId: string;
  outputs: Record<string, ViralUnderstandingOutput>;
  storyboard?: string;
  reset?: boolean;
}) {
  const latest = contentRepository.findVideoTask(input.task.id) || input.task;
  const understanding = isRecord(latest.expertContext?.viralUnderstanding) ? latest.expertContext.viralUnderstanding : {};
  if (!input.reset && isRecord(understanding.directorDraft)) {
    return latest;
  }
  let task = persistAndPublishThinkingMessage({
    task: latest,
    userId: input.userId,
    source: 'video_director',
    roleName: '视频生成导演',
    content: '视频生成导演正在整合生成要素...',
    force: input.reset,
  }) || latest;
  const conversationMessages = normalizeViralConversationMessages(understanding.conversationMessages);
  const storyboard = input.storyboard
    || conversationMessages.find((item) => item.source === 'storyboard_final')?.content
    || '';
  const directorDraft = await buildViralDirectorDraftWithDefaultLlm({
    task,
    outputs: input.outputs,
    storyboard,
  });
  const initialStep: ViralDirectorStep = hasDetectedVisualCharacter({ task, outputs: input.outputs }) ? 'character' : 'basic';
  task = mergeViralUnderstandingContext(task, {
    directorDraft,
    directorConfirmed: directorDraft,
    directorStep: initialStep,
    directorStatus: 'reviewing' as ViralDirectorStatus,
  }) || task;
  return appendAndStreamConversationMessage({
    task,
    userId: input.userId,
    source: 'video_director',
    roleName: '视频生成导演',
    content: '我已整理出可生成视频的导演初稿。请按下面卡片逐项确认或替换素材，确认完成后就可以生成成片。',
    initialDelayMs: 700,
  });
}

export function directorAssetReferences(input: { userId: string; director: ViralDirectorData }) {
  const imageIds: string[] = [];
  const videoIds: string[] = [];
  const audioIds: string[] = [];
  const isAllowedSeedanceReferenceAudio = (asset: ContentAsset) => {
    const kind = String(asset.metadata.kind || '').trim();
    const source = String(asset.metadata.source || '').trim();
    const generatedBy = String(asset.metadata.generatedBy || '').trim();
    return (generatedBy === 'audio_model' && kind === 'voice_clone_preview')
      || source === 'local_upload';
  };
  const addAsset = (assetId?: string, fallback: 'image' | 'audio' = 'image') => {
    if (!assetId) {
      return;
    }
    const asset = contentRepository.findAsset(assetId);
    if (!asset || asset.userId !== input.userId) {
      throw new Error('所选素材不存在，请重新选择');
    }
    if (asset.mimeType.startsWith('video/')) {
      videoIds.push(asset.id);
    } else if (asset.mimeType.startsWith('audio/')) {
      audioIds.push(asset.id);
    } else if (asset.mimeType.startsWith('image/') || fallback === 'image') {
      imageIds.push(asset.id);
    }
  };
  const addReferenceAudioAsset = (assetId?: string) => {
    if (!assetId) {
      return;
    }
    const asset = contentRepository.findAsset(assetId);
    if (!asset || asset.userId !== input.userId) {
      throw new Error('所选声音素材不存在，请重新选择');
    }
    if (!asset.mimeType.startsWith('audio/')) {
      throw new Error('所选声音素材不是音频，请重新选择');
    }
    if (!isAllowedSeedanceReferenceAudio(asset)) {
      throw new Error('Seedance 参考音频只能选择 AI 生成的克隆试听音频或本地上传的参考音频');
    }
    audioIds.push(asset.id);
  };
  const addSceneGroup = (groupId?: string) => {
    if (!groupId) {
      return;
    }
    const group = contentRepository.findGroup(groupId);
    if (!group || group.userId !== input.userId || group.resourceType !== 'scene') {
      throw new Error('所选场景组不存在，请重新选择');
    }
    contentRepository
      .listAssets({ userId: input.userId, groupId: group.id })
      .filter((asset) => asset.mimeType.startsWith('image/') || asset.mimeType.startsWith('video/'))
      .forEach((asset) => addAsset(asset.id, 'image'));
  };
  const addProductGroup = (groupId?: string) => {
    if (!groupId) {
      return;
    }
    const group = contentRepository.findGroup(groupId);
    if (!group || group.userId !== input.userId || group.resourceType !== 'product') {
      throw new Error('所选产品组不存在，请重新选择');
    }
    contentRepository
      .listAssets({ userId: input.userId, groupId: group.id })
      .filter((asset) => asset.mimeType.startsWith('image/') || asset.mimeType.startsWith('video/'))
      .forEach((asset) => addAsset(asset.id, 'image'));
  };
  const addVoiceGroup = (groupId?: string) => {
    if (!groupId) {
      return;
    }
    const group = contentRepository.findGroup(groupId);
    if (!group || group.userId !== input.userId || group.resourceType !== 'voice') {
      throw new Error('所选声音库不存在，请重新选择');
    }
    const audioAssets = contentRepository
      .listAssets({ userId: input.userId, groupId: group.id })
      .filter((asset) => asset.mimeType.startsWith('audio/') && isAllowedSeedanceReferenceAudio(asset));
    const preferred = audioAssets.find((asset) => asset.metadata.kind === 'voice_clone_preview')
      || audioAssets.find((asset) => asset.metadata.source === 'local_upload');
    if (!preferred) {
      throw new Error('所选声音库没有可用于 Seedance 的参考音频，请选择 AI 生成的克隆试听音频或本地上传的参考音频');
    }
    addReferenceAudioAsset(preferred?.id);
  };
  directorCharacterItems(input.director)
    .filter((item) => item.required !== false && (item.referenceMode || (item.assetId ? 'asset' : 'prompt')) === 'asset')
    .forEach((item) => addAsset(item.assetId, 'image'));
  directorSceneItems(input.director).filter((item) => (
    item.required !== false && (item.referenceMode || (item.assetId || item.groupId ? 'asset' : 'prompt')) === 'asset'
  )).forEach((item) => {
    addAsset(item.assetId, 'image');
    addSceneGroup(item.groupId);
  });
  const productReferenceMode = input.director.product.referenceMode || (input.director.product.assetId || input.director.product.groupId ? 'asset' : 'prompt');
  if (!input.director.product.noProduct && productReferenceMode === 'asset') {
    addAsset(input.director.product.assetId, 'image');
    addProductGroup(input.director.product.groupId);
  }
  directorPipItems(input.director)
    .filter((item) => item.required !== false && (item.referenceMode || (item.replacementAssetId ? 'asset' : 'prompt')) === 'asset')
    .forEach((item) => addAsset(item.modelReferenceAssetId || item.replacementAssetId, 'image'));
  directorAudioItems(input.director)
    .filter((item) => item.voice !== '不生成')
    .forEach((item) => {
      addReferenceAudioAsset(item.assetId);
      if (!item.assetId) {
        addVoiceGroup(item.groupId);
      }
    });
  return {
    referenceImageIds: Array.from(new Set(imageIds)),
    referenceVideoIds: Array.from(new Set(videoIds)),
    referenceAudioIds: Array.from(new Set(audioIds)),
  };
}

export function seedanceAssetReferenceLabels(assetId: string | undefined, references: {
  referenceImageIds: string[];
  referenceVideoIds: string[];
}) {
  if (!assetId) {
    return [];
  }
  const asset = contentRepository.findAsset(assetId);
  if (!asset) {
    return [];
  }
  if (asset.mimeType.startsWith('image/')) {
    const index = references.referenceImageIds.indexOf(asset.id);
    return index >= 0 ? [`图片${index + 1}`] : [];
  }
  if (asset.mimeType.startsWith('video/')) {
    const index = references.referenceVideoIds.indexOf(asset.id);
    return index >= 0 ? [`视频${index + 1}`] : [];
  }
  return [];
}

export function seedanceGroupReferenceLabels(input: {
  userId: string;
  groupId?: string;
  resourceType: ContentResourceType;
  references: {
    referenceImageIds: string[];
    referenceVideoIds: string[];
  };
}) {
  if (!input.groupId) {
    return [];
  }
  const group = contentRepository.findGroup(input.groupId);
  if (!group || group.userId !== input.userId || group.resourceType !== input.resourceType) {
    return [];
  }
  return contentRepository
    .listAssets({ userId: input.userId, groupId: group.id })
    .flatMap((asset) => seedanceAssetReferenceLabels(asset.id, input.references));
}

export function uniqueReferenceLabels(labels: string[]) {
  return Array.from(new Set(labels.filter(Boolean)));
}

export function formatSeedanceReferenceLabels(labels: string[]) {
  return labels.map((label) => `参考${label}`).join('、');
}

export function seedanceAudioReferenceLabels(references: { referenceAudioIds: string[] }) {
  return references.referenceAudioIds.map((_, index) => `音频${index + 1}`);
}

function buildViralSeedancePromptParts(input: {
  userId: string;
  director: ViralDirectorData;
  storyboard: string;
  references: {
    referenceImageIds: string[];
    referenceVideoIds: string[];
    referenceAudioIds: string[];
  };
  hasCharacterAsset: boolean;
  hasSceneAsset: boolean;
  hasProductAsset: boolean;
  hasAudioAsset: boolean;
}) {
  const d = input.director;
  const requiredCharacters = directorCharacterItems(d).filter((item) => item.required !== false);
  const requiredScenes = directorSceneItems(d).filter((item) => item.required !== false);
  const pipItems = directorPipItems(d);
  const skippedCharacterPrompt = directorCharacterItems(d).filter((item) => item.required === false)
    .map((item, index) => `${item.label || `人物 ${index + 1}`}：不需要当前人物，不要为这一项生成对应人物或引用其素材。`)
    .join('\n');
  const skippedScenePrompt = directorSceneItems(d).filter((item) => item.required === false)
    .map((item, index) => `${item.label || `场景 ${index + 1}`}：不需要当前场景，不要为这一项生成对应场景或引用其素材。`)
    .join('\n');
  const characterPrompt = [
    requiredCharacters.map((item, index) => [
      `${item.label || `人物 ${index + 1}`}：`,
      (() => {
        const mode = item.referenceMode || (item.assetId ? 'asset' : 'prompt');
        const prompt = mode === 'asset'
          ? ''
          : item.characterPrompt || item.appearance || '使用已确认人物标签生成中性人物形象，不沿用原视频人物外貌。';
        if (mode !== 'asset') {
          return `人物描述提示词：${prompt}`;
        }
        const labels = uniqueReferenceLabels(seedanceAssetReferenceLabels(item.assetId, input.references));
        return labels.length
          ? [
            `人物外观、服装、发型、体型和整体形象以${formatSeedanceReferenceLabels(labels)}中的人物为准。`,
            item.gesture || item.expression ? `只保留人物动作、表情和表演节奏要求；人物外观由参考人物素材决定，不沿用原视频解析出的穿衣风格或外貌细节。` : '人物外观由参考人物素材决定，不沿用原视频解析出的穿衣风格或外貌细节。',
          ].filter(Boolean).join('\n')
          : [
            '人物外观、服装、发型、体型和整体形象以对应参考图片/视频中的人物为准。',
            item.gesture || item.expression ? '只保留人物动作、表情和表演节奏要求；人物外观由参考人物素材决定，不沿用原视频解析出的穿衣风格或外貌细节。' : '人物外观由参考人物素材决定，不沿用原视频解析出的穿衣风格或外貌细节。',
          ].filter(Boolean).join('\n');
      })(),
    ].filter(Boolean).join('\n')).join('\n\n'),
    skippedCharacterPrompt,
  ].filter(Boolean).join('\n\n') || '不需要固定人物设定。';
  const scenePrompt = [
    requiredScenes.map((item, index) => [
      `${item.label || `场景 ${index + 1}`}：`,
      (() => {
        if ((item.referenceMode || (item.assetId || item.groupId ? 'asset' : 'prompt')) !== 'asset') {
          return sceneDetailSummary(item) || `场景描述：${item.description || '优先还原原视频中的环境空间、前中后景、灯光氛围、镜头距离与背景层次。'}`;
        }
        const labels = uniqueReferenceLabels([
          ...seedanceAssetReferenceLabels(item.assetId, input.references),
          ...seedanceGroupReferenceLabels({
            userId: input.userId,
            groupId: item.groupId,
            resourceType: 'scene',
            references: input.references,
          }),
        ]);
        const materialRule = labels.length
          ? `场景环境只以${formatSeedanceReferenceLabels(labels)}中的场景为准；如果镜头脚本里出现与参考场景不一致的旧场景描述，必须忽略旧场景描述。`
          : '场景环境只以对应参考图片/视频中的场景为准；如果镜头脚本里出现与参考场景不一致的旧场景描述，必须忽略旧场景描述。';
        const details = sceneDetailSummary(item);
        return details ? `${materialRule}\n在上述参考场景内继续满足以下细化要求：\n${details}` : `${materialRule}\n不使用与参考场景冲突的旧场景提示词。`;
      })(),
    ].filter(Boolean).join('\n')).join('\n\n'),
    skippedScenePrompt,
  ].filter(Boolean).join('\n\n') || '不需要固定场景设定。';
  const hasProductPrompt = Boolean(d.product.description.trim() || d.product.presentation.trim() || d.product.assetId || d.product.groupId);
  const productPrompt = d.product.noProduct || !hasProductPrompt
    ? '不需要产品展示，不要强行加入商品、包装或产品特写。'
    : (() => {
      if ((d.product.referenceMode || (d.product.assetId || d.product.groupId ? 'asset' : 'prompt')) !== 'asset') {
        return [
          `产品描述：${d.product.description || '根据原视频产品信息组织画面'}`,
          `展示方式：${d.product.presentation || '通过近景、手部动作和对比镜头展示重点卖点'}`,
        ].filter(Boolean).join('\n');
      }
      const labels = uniqueReferenceLabels([
        ...seedanceAssetReferenceLabels(d.product.assetId, input.references),
        ...seedanceGroupReferenceLabels({
          userId: input.userId,
          groupId: d.product.groupId,
          resourceType: 'product',
          references: input.references,
        }),
      ]);
      return labels.length
        ? `产品外观只以${formatSeedanceReferenceLabels(labels)}中的产品为准，不使用产品提示词。`
        : '产品外观只以对应参考图片/视频中的产品为准，不使用产品提示词。';
    })();
  const audioLabels = seedanceAudioReferenceLabels(input.references);
  const audioItems = directorAudioItems(d);
  const audioReferencePrompt = audioItems.length
    ? audioItems.map((item, index) => {
      const label = item.characterLabel || item.label || `声音 ${index + 1}`;
      const referenceLabel = audioLabels[index] || '';
      if (item.voice === '不生成') {
        return `${label}：不生成该主体人声。`;
      }
      if (item.assetId || item.groupId) {
        return `${label}：以所选声音素材的音色、声线、语速、能量和距离感为准生成口播，但不要直接复用声音素材里的原始语音内容；${item.voiceStyle || '自然清晰，中等语速，不抢拍、不加速'}`;
      }
      return `${label}：${item.voice || d.audio.voice || '原声'}；${item.voiceStyle || d.audio.voiceStyle || '自然清晰，中等语速，不抢拍、不加速'}`;
    }).join('\n')
    : '';
  const requiredPipItems = pipItems.filter((item) => item.required !== false);
  const skippedPipPrompt = pipItems.filter((item) => item.required === false)
    .map((item, index) => `${item.label || `画中画 ${index + 1}`}：不需要当前画中画，不要生成对应 PIP 窗口或叠加素材。`)
    .join('\n');
  const pipPrompt = requiredPipItems.length || skippedPipPrompt
    ? [
      requiredPipItems.map((item, index) => {
      const label = item.label || `画中画 ${index + 1}`;
      const time = item.endSecond > item.startSecond ? `${item.startSecond}-${item.endSecond}秒` : `${item.startSecond}秒`;
      const mode = item.referenceMode || (item.replacementAssetId ? 'asset' : 'prompt');
      const referenceLabels = uniqueReferenceLabels(seedanceAssetReferenceLabels(item.modelReferenceAssetId || item.replacementAssetId, input.references));
      const replacement = item.replacementPrompt || item.content || '替换为新的补充展示素材';
      return [
        `${label}：${time}。保留画中画出现时段、层级和大致位置，只替换画中画内部内容。`,
        item.position ? `大致位置：${item.position}` : '',
        item.type ? `类型：${item.type}` : '',
        item.content ? `原内容作用：${item.content}` : '',
        mode === 'asset' && referenceLabels.length
          ? `替换素材：以${formatSeedanceReferenceLabels(referenceLabels)}作为画中画内部内容参考。`
          : '',
        `替换提示词：${replacement}`,
      ].filter(Boolean).join('\n');
      }).join('\n\n'),
      skippedPipPrompt,
    ].filter(Boolean).join('\n\n')
    : '无画中画；不要额外生成 PIP 窗口。';
  const negativePrompt = [
    ...(d.negativePrompt.length ? d.negativePrompt : ['避免画面畸变', '人物手部异常', '产品变形', '低清晰度', '过曝', '跑题']),
    '口播字幕',
    '自动字幕',
    '歌词字幕',
    '人物字幕',
    '对白字幕',
    '旁白字幕',
    '台词字幕',
    '中文字幕',
    '英文字幕',
    'caption',
    'captions',
    'subtitle',
    'subtitles',
    'closed captions',
    'burned-in captions',
    'hardcoded subtitles',
    'transcript overlay',
    'speech-to-text overlay',
    '屏幕文字',
    '标题条',
    '贴纸文字',
    '角标说明',
    '文字浮层',
    '台词文字浮层',
    '逐字稿',
    '对白文字',
    '旁白文字',
    '弹幕',
    '水印',
    '无关 Logo',
    '新增 Logo',
    '拜拜',
    '再见',
    '下期见',
    '关注我',
    '点赞关注',
    '分段开头重复上一段结尾',
    '分段内容重叠',
  ].join('，');
  const globalPrompt = renderPromptTemplate(viralSeedanceGlobalPromptTemplate, {
    CHARACTER_ASSET_RULE: input.hasCharacterAsset ? '若存在人物参考素材，优先按参考素材还原对应人物。' : '',
    CHARACTER_PROMPT: characterPrompt,
    SCENE_ASSET_RULE: input.hasSceneAsset ? '若存在场景参考素材，优先按参考素材还原对应场景。' : '',
    SCENE_PROMPT: scenePrompt,
    PRODUCT_PROMPT: productPrompt,
    PIP_PROMPT: pipPrompt,
    AUDIO_PROMPT: audioReferencePrompt || `声音策略：${d.audio.voice || '原声'}`,
    BGM_PROMPT: d.audio.bgm || '轻快但不压过人声',
    SOUND_EFFECTS_PROMPT: d.audio.soundEffects || '根据镜头动作补充轻微环境音和转场音效',
  });
  return {
    director: d,
    globalPrompt,
    spokenContent: d.part || '无固定口播，请根据画面节奏生成自然旁白。',
    storyboard: input.storyboard || '按照爆款短视频节奏组织：开场吸引、核心展示、卖点强化、结尾行动提示。',
    negativePrompt,
  };
}

export function buildViralSeedanceGlobalPrompt(input: Parameters<typeof buildViralSeedancePromptParts>[0]) {
  return buildViralSeedancePromptParts(input).globalPrompt;
}

export function buildViralSeedancePrompt(input: Parameters<typeof buildViralSeedancePromptParts>[0]) {
  const parts = buildViralSeedancePromptParts(input);
  return renderPromptTemplate(viralSeedanceFullPromptTemplate, {
    GLOBAL_PROMPT: parts.globalPrompt,
    SPOKEN_CONTENT: parts.spokenContent,
    STORYBOARD: parts.storyboard,
    NEGATIVE_PROMPT: parts.negativePrompt,
  });
}

export async function appendAndStreamConversationMessage(input: {
  task: VideoGenerationTask;
  userId: string;
  source: string;
  roleName: string;
  content: string;
  initialDelayMs?: number;
  force?: boolean;
}) {
  const current = contentRepository.findVideoTask(input.task.id) || input.task;
  const context = isRecord(current.expertContext?.viralUnderstanding) ? current.expertContext.viralUnderstanding : {};
  const conversationMessages = normalizeViralConversationMessages(context.conversationMessages);
  const emittedSources = new Set(normalizeStringList(context.emittedSources));
  const existingIndex = conversationMessages.findIndex((item) => item.source === input.source);
  if (
    (!input.force && emittedSources.has(input.source) && (existingIndex < 0 || !conversationMessages[existingIndex].thinking))
    || !input.content.trim()
  ) {
    return current;
  }
  const message: ViralConversationOutput = {
    id: messageSourceFor(input.source),
    roleName: input.roleName,
    content: input.content,
    source: input.source,
    createdAt: new Date().toISOString(),
    thinking: false,
  };
  emittedSources.add(input.source);
  const nextConversationMessages = existingIndex >= 0
    ? conversationMessages.map((item, index) => (index === existingIndex ? { ...message, createdAt: item.createdAt } : item))
    : [...conversationMessages, message];
  const nextTask = mergeViralUnderstandingContext(current, {
    conversationMessages: nextConversationMessages,
    emittedSources: [...emittedSources],
  }) || current;
  await streamAnalysisMessage({
    userId: input.userId,
    taskId: input.task.id,
    messageId: message.id,
    roleName: input.roleName,
    text: input.content,
    initialDelayMs: input.initialDelayMs,
  });
  return nextTask;
}

export function persistAndPublishThinkingMessage(input: {
  task: VideoGenerationTask;
  userId: string;
  source: string;
  roleName: string;
  content: string;
  force?: boolean;
}) {
  const current = contentRepository.findVideoTask(input.task.id) || input.task;
  const context = isRecord(current.expertContext?.viralUnderstanding) ? current.expertContext.viralUnderstanding : {};
  const conversationMessages = normalizeViralConversationMessages(context.conversationMessages);
  const emittedSources = new Set(normalizeStringList(context.emittedSources));
  if (emittedSources.has(input.source) && !input.force) {
    return current;
  }
  const message: ViralConversationOutput = {
    id: messageSourceFor(input.source),
    roleName: input.roleName,
    content: input.content,
    source: input.source,
    createdAt: new Date().toISOString(),
    thinking: true,
  };
  const existingIndex = conversationMessages.findIndex((item) => item.source === input.source);
  const nextConversationMessages = existingIndex >= 0
    ? conversationMessages.map((item, index) => (index === existingIndex ? { ...message, createdAt: item.createdAt } : item))
    : [...conversationMessages, message];
  const nextTask = mergeViralUnderstandingContext(current, {
    conversationMessages: nextConversationMessages,
  }) || current;
  publishContentEvent({
    type: 'viral-video-analysis-status',
    userId: input.userId,
    taskId: input.task.id,
    phase: 'message-start',
    status: 'running',
    messageId: message.id,
    roleName: input.roleName,
    message: input.content,
    task: nextTask,
    at: new Date().toISOString(),
  });
  return nextTask;
}

export async function processViralConversationQueue(input: {
  task: VideoGenerationTask;
  userId: string;
  outputs: Record<string, ViralUnderstandingOutput>;
}) {
  let task = contentRepository.findVideoTask(input.task.id) || input.task;
  const context = isRecord(task.expertContext?.viralUnderstanding) ? task.expertContext.viralUnderstanding : {};
  const emittedSources = new Set(normalizeStringList(context.emittedSources));
  const agents = normalizeViralUnderstandingAgents(context.agents);
  const executions = Array.isArray(context.executions) ? context.executions.filter(isRecord) : [];
  const sdkAgents = viralUnderstandingSdkAgentList(agents);
  const expectsPipExpert = sdkAgents.some((agent) => agent.key === 'picture_in_picture_expert')
    || executions.some((execution) => execution.role === 'picture_in_picture_expert');
  const audio = input.outputs.audio_expert?.content || '';
  const video = input.outputs.video_expert?.content || '';
  const pipOutput = input.outputs.picture_in_picture_expert;
  const hasPipOutput = hasCompletedUnderstandingOutput('picture_in_picture_expert', pipOutput);

  const basicInfo = buildVideoBasicInfoMessage(task, input.outputs);
  if (basicInfo && !emittedSources.has('video_basic_info')) {
    task = await appendAndStreamConversationMessage({
      task,
      userId: input.userId,
      source: 'video_basic_info',
      roleName: '视频基础信息',
      content: basicInfo,
    }) || task;
  }

  const latestAfterBasic = contentRepository.findVideoTask(input.task.id) || task;
  const afterBasicContext = isRecord(latestAfterBasic.expertContext?.viralUnderstanding) ? latestAfterBasic.expertContext.viralUnderstanding : {};
  const afterBasicSources = new Set(normalizeStringList(afterBasicContext.emittedSources));
  if (audio && !afterBasicSources.has('audio_expert')) {
    task = await appendAndStreamConversationMessage({
      task: latestAfterBasic,
      userId: input.userId,
      source: 'audio_expert',
      roleName: '音频理解专家',
      content: audio,
    }) || latestAfterBasic;
  }

  const latestAfterAudio = contentRepository.findVideoTask(input.task.id) || task;
  const afterAudioContext = isRecord(latestAfterAudio.expertContext?.viralUnderstanding) ? latestAfterAudio.expertContext.viralUnderstanding : {};
  const afterAudioSources = new Set(normalizeStringList(afterAudioContext.emittedSources));
  if (!afterAudioSources.has('audio_expert')) {
    return latestAfterAudio;
  }

  if (!video) {
    const latestBeforePending = contentRepository.findVideoTask(input.task.id) || task;
    task = persistAndPublishThinkingMessage({
      task: latestBeforePending,
      userId: input.userId,
      source: videoExpertPendingSource,
      roleName: '',
      content: '视频解析中...',
    }) || latestBeforePending;
  } else {
    const latestWithPending = contentRepository.findVideoTask(input.task.id) || latestAfterAudio;
    const pendingContext = isRecord(latestWithPending.expertContext?.viralUnderstanding) ? latestWithPending.expertContext.viralUnderstanding : {};
    const pendingMessages = normalizeViralConversationMessages(pendingContext.conversationMessages);
    const cleanedMessages = pendingMessages.filter((item) => item.source !== videoExpertPendingSource);
    const latestBeforeBasic = cleanedMessages.length !== pendingMessages.length
      ? mergeViralUnderstandingContext(latestWithPending, { conversationMessages: cleanedMessages }) || latestWithPending
      : latestWithPending;
    task = latestBeforeBasic;
    const videoMessages = buildVideoExpertMessages(video);
    for (const [index, item] of videoMessages.entries()) {
      task = await appendAndStreamConversationMessage({
        task,
        userId: input.userId,
        source: item.source,
        roleName: item.roleName,
        content: item.content,
        initialDelayMs: index === 0 ? 550 : 900,
      }) || task;
    }
    const latestBeforePip = contentRepository.findVideoTask(input.task.id) || task;
    const beforePipContext = isRecord(latestBeforePip.expertContext?.viralUnderstanding) ? latestBeforePip.expertContext.viralUnderstanding : {};
    const beforePipSources = new Set(normalizeStringList(beforePipContext.emittedSources));
    if (hasPipOutput && !beforePipSources.has('picture_in_picture_expert')) {
      task = await appendAndStreamConversationMessage({
        task: latestBeforePip,
        userId: input.userId,
        source: 'picture_in_picture_expert',
        roleName: '画中画解析专家',
        content: pictureInPictureParseSummary(mergePictureInPictureEvidence(
          pipOutput?.pictureInPicture,
          pipOutput?.pipAssets,
        )),
        initialDelayMs: 1150,
      }) || task;
    }
  }

  const latestAfterVideo = contentRepository.findVideoTask(input.task.id) || task;
  const afterVideoContext = isRecord(latestAfterVideo.expertContext?.viralUnderstanding) ? latestAfterVideo.expertContext.viralUnderstanding : {};
  const afterVideoSources = new Set(normalizeStringList(afterVideoContext.emittedSources));
  const hasPendingVideoMessage = buildVideoExpertMessages(video).some((item) => !afterVideoSources.has(item.source));
  if (!audio || !video || hasPendingVideoMessage) {
    return latestAfterVideo;
  }
  if (expectsPipExpert && (!hasPipOutput || !afterVideoSources.has('picture_in_picture_expert'))) {
    return latestAfterVideo;
  }
  if (afterVideoSources.has('storyboard_final')) {
    return ensureViralDirectorDraft({
      task: latestAfterVideo,
      userId: input.userId,
      outputs: input.outputs,
    });
  }

  const thinkingTask = persistAndPublishThinkingMessage({
    task: latestAfterVideo,
    userId: input.userId,
    source: 'storyboard_final',
    roleName: '分镜脚本分析专家',
    content: '分镜脚本分析中...',
  }) || latestAfterVideo;
  const storyboard = await buildStoryboardMessageWithDefaultLlm({
    userId: input.userId,
    audioContent: audio,
    videoContent: video,
    pictureInPictureContent: pipOutput?.content || '',
    agents: agents.length ? agents : await getViralUnderstandingAgentsWithWorker(),
  });
  const storyboardTask = await appendAndStreamConversationMessage({
    task: thinkingTask,
    userId: input.userId,
    source: 'storyboard_final',
    roleName: '分镜脚本分析专家',
    content: storyboard,
    initialDelayMs: 1000,
  });
  return ensureViralDirectorDraft({
    task: storyboardTask || thinkingTask,
    userId: input.userId,
    outputs: input.outputs,
    storyboard,
  });
}

export function normalizeUnderstandingOutputs(value: unknown) {
  const outputs: Record<string, ViralUnderstandingOutput> = {};
  if (!isRecord(value)) {
    return outputs;
  }
  Object.entries(value).forEach(([key, item]) => {
    if (!isRecord(item) || typeof item.content !== 'string') {
      return;
    }
    const raw = isRecord(item.raw) ? item.raw : undefined;
    const pictureInPicture = isRecord(item.pictureInPicture) ? item.pictureInPicture : undefined;
    const pipAssets = isRecord(item.pipAssets) ? item.pipAssets : undefined;
    if (!item.content && !raw && !pictureInPicture && !pipAssets) {
      return;
    }
    outputs[key] = {
      roleName: typeof item.roleName === 'string' ? item.roleName : key,
      content: item.content,
      raw,
      pictureInPicture,
      pipAssets,
    };
  });
  return outputs;
}

export function pollViralUnderstandingExecutions(
  taskId: string,
  userId: string,
  executions: VodUnderstandingExecution[],
  initialOutputs: Record<string, ViralUnderstandingOutput> = {},
) {
  const intervalMs = Number(process.env.VIRAL_UNDERSTANDING_POLL_INTERVAL_MS || 10000);
  const maxAttempts = Number(process.env.VIRAL_UNDERSTANDING_POLL_MAX_ATTEMPTS || 120);
  void (async () => {
    const outputs: Record<string, ViralUnderstandingOutput> = { ...initialOutputs };
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const current = contentRepository.findVideoTask(taskId);
      if (!current) {
        return;
      }
      const currentUnderstanding = isRecord(current.expertContext?.viralUnderstanding) ? current.expertContext.viralUnderstanding : {};
      const billedRunIds = new Set(normalizeStringList(currentUnderstanding.billedRunIds));
      try {
        const results = await Promise.all(executions.map(async (execution) => ({
          execution,
          result: await getViralUnderstandingExecutionWithWorker(execution.runId),
        })));
        const failed = results.find((item) => isUnderstandingFailed(item.result.status || ''));
        if (failed) {
          const failedTask = mergeViralUnderstandingContext(current, {
            status: 'failed',
            failedRunId: failed.execution.runId,
            failedStep: failed.execution.role,
            failedStepName: failed.execution.roleName,
            failureReason: `${failed.execution.roleName} 分析失败：${failed.result.status || 'unknown'}`,
          }) || current;
          publishContentEvent({
            type: 'viral-video-analysis-status',
            userId,
            taskId,
            phase: 'failed',
            status: 'failed',
            message: '视频理解失败',
            task: failedTask,
            at: new Date().toISOString(),
          });
          return;
        }
        results.forEach(({ execution, result }) => {
          if (isUnderstandingCompleted(result.status || '') && (
            result.content
            || isRecord(result.raw)
            || isRecord(result.pictureInPicture)
            || isRecord(result.pipAssets)
          )) {
            outputs[execution.role] = {
              roleName: execution.roleName,
              content: result.content || '',
              raw: result.raw,
              pictureInPicture: isRecord(result.pictureInPicture) ? result.pictureInPicture : undefined,
              pipAssets: isRecord(result.pipAssets) ? result.pipAssets : undefined,
            };
            if (!billedRunIds.has(execution.runId)) {
              const tokenUsage = normalizeUnderstandingTokenUsage({
                raw: result.raw,
                prompt: execution.prompt,
                content: result.content,
              });
              const tokenFieldSummary = findUnderstandingTokenFieldSummary(result.raw);
              logger.info('viral understanding token usage captured', {
                taskId,
                runId: execution.runId,
                role: execution.role,
                roleName: execution.roleName,
                tokenUsage,
                tokenFieldSummary,
                usedFallbackEstimate: !tokenFieldSummary && tokenUsage.totalTokens > 0,
                rawType: typeof result.raw,
              });
              recordVodUnderstandingUsage({
                userId,
                sourceType: 'viral_upload_parse_understanding',
                sourceId: execution.runId,
                taskId,
                runId: execution.runId,
                inputTokens: tokenUsage.inputTokens,
                outputTokens: tokenUsage.outputTokens,
                requestSnapshot: {
                  taskId,
                  runId: execution.runId,
                  role: execution.role,
                  roleName: execution.roleName,
                },
                responseSnapshot: {
                  status: result.status,
                  contentChars: (result.content || '').length,
                  tokenUsage,
                  tokenFieldSummary,
                },
                usageRaw: isRecord(result.raw) ? result.raw : {},
              });
              billedRunIds.add(execution.runId);
              mergeViralUnderstandingContext(current, {
                billedRunIds: Array.from(billedRunIds),
              });
            }
          }
        });
        const taskWithOutputs = mergeViralUnderstandingContext(current, {
          status: 'polling',
          attempt,
          executions: results.map(({ execution, result }) => ({
            ...execution,
            status: result.status,
            hasContent: Boolean(result.content),
          })),
          outputs,
          billedRunIds: Array.from(billedRunIds),
        }) || current;
        try {
          await processViralConversationQueue({ task: taskWithOutputs, userId, outputs });
        } catch (error) {
          const latestOnFailure = contentRepository.findVideoTask(taskId) || taskWithOutputs;
          const latestUnderstanding = isRecord(latestOnFailure.expertContext?.viralUnderstanding) ? latestOnFailure.expertContext.viralUnderstanding : {};
          const hasStoryboard = normalizeStringList(latestUnderstanding.emittedSources).includes('storyboard_final');
          const failedTask = mergeViralUnderstandingContext(taskWithOutputs, {
            status: 'failed',
            failedStep: hasStoryboard ? 'video_director' : 'storyboard_final',
            failedStepName: hasStoryboard ? '视频生成导演' : '分镜脚本整理',
            failureReason: error instanceof Error ? error.message : String(error),
          }) || current;
          publishContentEvent({
            type: 'viral-video-analysis-status',
            userId,
            taskId,
            phase: 'failed',
            status: 'failed',
            message: error instanceof Error ? error.message : '分镜脚本整理失败',
            task: failedTask,
            at: new Date().toISOString(),
          });
          return;
        }
        publishContentEvent({
          type: 'viral-video-analysis-status',
          userId,
          taskId,
          phase: 'polling',
          status: 'running',
          message: '思考中...',
          at: new Date().toISOString(),
        });
        if (executions.every((execution) => hasCompletedUnderstandingOutput(execution.role, outputs[execution.role]))) {
          const latest = contentRepository.findVideoTask(taskId) || current;
          const withParse = appendAnalysisProcessFromUnderstanding(latest, outputs) || latest;
          const completed = mergeViralUnderstandingContext(withParse, {
            status: 'completed',
            outputs,
          }) || withParse;
          publishContentEvent({
            type: 'viral-video-analysis-complete',
            userId,
            taskId,
            phase: 'completed',
            status: 'success',
            message: '视频理解完成',
            task: completed,
            at: new Date().toISOString(),
          });
          return;
        }
      } catch (error) {
        logger.warn('viral video understanding poll attempt failed', {
          taskId,
          attempt,
          error: errorLogContext(error),
        });
        if (shouldFailViralUnderstandingPoll(error, attempt)) {
          const latestOnFailure = contentRepository.findVideoTask(taskId) || current;
          const failedTask = mergeViralUnderstandingContext(latestOnFailure, {
            status: 'failed',
            failedStep: 'polling',
            failedStepName: '视频理解轮询',
            failureReason: error instanceof Error ? error.message : String(error),
          }) || latestOnFailure;
          publishContentEvent({
            type: 'viral-video-analysis-status',
            userId,
            taskId,
            phase: 'failed',
            status: 'failed',
            message: error instanceof Error ? error.message : '视频理解轮询失败',
            task: failedTask,
            at: new Date().toISOString(),
          });
          return;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    const current = contentRepository.findVideoTask(taskId);
    if (current) {
      const failedTask = mergeViralUnderstandingContext(current, {
        status: 'failed',
        failedStep: 'polling',
        failedStepName: '视频理解轮询',
        failureReason: '视频理解轮询超时',
      }) || current;
      publishContentEvent({
        type: 'viral-video-analysis-status',
        userId,
        taskId,
        phase: 'failed',
        status: 'failed',
        message: '视频理解轮询超时',
        task: failedTask,
        at: new Date().toISOString(),
      });
    }
  })();
}

export async function submitViralUnderstandingForTask(task: VideoGenerationTask, userId: string, agents?: ViralUnderstandingAgent[]) {
  const context = isRecord(task.expertContext) ? task.expertContext : {};
  const vod = isRecord(context.vod) ? context.vod : {};
  const uploadedVideo = isRecord(context.uploadedVideo) ? context.uploadedVideo : {};
  const understandingContext = isRecord(context.viralUnderstanding) ? context.viralUnderstanding : {};
  const previousOutputs = normalizeUnderstandingOutputs(understandingContext.outputs);
  const previousExecutions = Array.isArray(understandingContext.executions)
    ? understandingContext.executions.filter(isRecord)
    : [];
  const vid = typeof vod.vid === 'string' ? vod.vid : '';
  if (!vid) {
    throw new Error('任务缺少 VOD Vid，无法重试视频理解');
  }
  const allAgents = await getViralUnderstandingAgentsWithWorker();
  const sdkAgents = viralUnderstandingSdkAgentList(allAgents);
  const selectedAgents = agents || sdkAgents;
  const understanding = await startViralUnderstandingWithWorker({
    vid,
    spaceName: vodSpaceNameFromUploadResult(vod),
    filePath: typeof uploadedVideo.filePath === 'string' ? uploadedVideo.filePath : undefined,
    roles: selectedAgents,
    billingContext: {
      userId,
      sourceType: 'viral_understanding_retry',
      sourceId: task.id,
      taskId: task.id,
      durationSeconds: Number(understandingContext.durationSeconds || vodDurationSeconds(vod)),
    },
  });
  const retryAgentKeys = new Set(selectedAgents.map((agent) => agent.key));
  const executions = [
    ...previousExecutions.filter((execution) => typeof execution.role === 'string' && !retryAgentKeys.has(execution.role as ViralUnderstandingAgent['key'])),
    ...(understanding.executions || []),
  ];
  const nextOutputs = Object.fromEntries(
    Object.entries(previousOutputs).filter(([key]) => !retryAgentKeys.has(key as ViralUnderstandingAgent['key'])),
  );
  const resetDirectorState = resetViralDirectorStateForUnderstandingRetry(understandingContext, retryAgentKeys);
  const nextTask = mergeViralUnderstandingContext(task, {
    ...resetDirectorState,
    status: 'submitted',
    failedRunId: '',
    failedStep: '',
    failedStepName: '',
    failureReason: '',
    vid,
    agents: allAgents,
    sdkAgents,
    retryingAgents: selectedAgents.map((agent) => agent.key),
    executions,
    outputs: nextOutputs,
  }) || task;
  publishContentEvent({
    type: 'viral-video-analysis-status',
    userId,
    taskId: task.id,
    phase: 'submitted',
    status: 'running',
    message: '视频分析中...',
    task: nextTask,
    at: new Date().toISOString(),
  });
  pollViralUnderstandingExecutions(task.id, userId, understanding.executions || [], nextOutputs);
  return nextTask;
}

export function failViralAnalysisStep(input: {
  task: VideoGenerationTask;
  userId: string;
  failedStep: string;
  failedStepName: string;
  error: unknown;
  fallbackMessage: string;
}) {
  const failedTask = mergeViralUnderstandingContext(input.task, {
    status: 'failed',
    failedStep: input.failedStep,
    failedStepName: input.failedStepName,
    failureReason: input.error instanceof Error ? input.error.message : String(input.error),
  }) || input.task;
  publishContentEvent({
    type: 'viral-video-analysis-status',
    userId: input.userId,
    taskId: input.task.id,
    phase: 'failed',
    status: 'failed',
    message: input.error instanceof Error ? input.error.message : input.fallbackMessage,
    task: failedTask,
    at: new Date().toISOString(),
  });
  return failedTask;
}

export async function retryViralVodUploadAndSubmit(task: VideoGenerationTask, userId: string) {
  const context = isRecord(task.expertContext) ? task.expertContext : {};
  const uploadedVideo = isRecord(context.uploadedVideo) ? context.uploadedVideo : {};
  const filePath = typeof uploadedVideo.filePath === 'string' ? uploadedVideo.filePath : '';
  const originalFileName = typeof uploadedVideo.originalFileName === 'string' ? uploadedVideo.originalFileName : task.title;
  const fileSizeBytes = Number(uploadedVideo.fileSize || 0) || (filePath && existsSync(filePath) ? statSync(filePath).size : 0);
  if (!filePath || !existsSync(filePath)) {
    return failViralAnalysisStep({
      task,
      userId,
      failedStep: 'vod_upload',
      failedStepName: '上传到视频点播',
      error: new Error('上传视频本地文件不存在，请重新上传视频'),
      fallbackMessage: '视频上传到点播失败',
    });
  }
  const runningTask = mergeViralUnderstandingContext(task, {
    status: 'uploading',
    failedRunId: '',
    failedStep: '',
    failedStepName: '',
    failureReason: '',
  }) || task;
  publishContentEvent({
    type: 'viral-video-analysis-status',
    userId,
    taskId: task.id,
    phase: 'uploading',
    status: 'running',
    message: '正在重新上传视频...',
    task: runningTask,
    at: new Date().toISOString(),
  });
  try {
    const vod = await uploadLocalVideoToVodWithWorker({
      filePath,
      originalFileName,
      title: task.title || originalFileName,
      fileSizeBytes,
      taskId: task.id,
      userId,
    });
    const durationSeconds = vodDurationSeconds(vod as Record<string, unknown>);
    const estimatedAnalysisTime = formatAnalysisEstimate(durationSeconds);
    const uploadedTask = contentRepository.updateVideoTaskContext(task.id, {
      selectedSkillIds: task.selectedSkillIds || [],
      expertContext: {
        ...(runningTask.expertContext || {}),
        vod,
        stageOutputs: {
          ...(isRecord(runningTask.expertContext?.stageOutputs) ? runningTask.expertContext.stageOutputs : {}),
          control_center: '视频已重新上传并同步到视频点播，等待解析。',
        },
        viralUnderstanding: {
          ...(isRecord(runningTask.expertContext?.viralUnderstanding) ? runningTask.expertContext.viralUnderstanding : {}),
          status: 'vod_uploaded',
          vid: vod.vid || '',
          durationSeconds,
          estimatedAnalysisTime,
          updatedAt: new Date().toISOString(),
        },
        updatedAt: new Date().toISOString(),
      },
    }) || runningTask;
    publishContentEvent({
      type: 'viral-video-analysis-status',
      userId,
      taskId: task.id,
      phase: 'vod-uploaded',
      status: 'running',
      message: estimatedAnalysisTime ? `视频解析中...\n\n预计解析用时：${estimatedAnalysisTime}` : '视频解析中...',
      task: uploadedTask,
      at: new Date().toISOString(),
    });
    try {
      return await submitViralUnderstandingForTask(uploadedTask, userId);
    } catch (error) {
      return failViralAnalysisStep({
        task: uploadedTask,
        userId,
        failedStep: 'start_execution',
        failedStepName: '提交长视频理解',
        error,
        fallbackMessage: '视频理解提交失败',
      });
    }
  } catch (error) {
    return failViralAnalysisStep({
      task: runningTask,
      userId,
      failedStep: 'vod_upload',
      failedStepName: '上传到视频点播',
      error,
      fallbackMessage: '视频上传到点播失败',
    });
  }
}

export function storyboardMessageFromTask(task: VideoGenerationTask) {
  const understanding = isRecord(task.expertContext?.viralUnderstanding) ? task.expertContext.viralUnderstanding : {};
  return normalizeViralConversationMessages(understanding.conversationMessages)
    .find((item) => item.source === 'storyboard_final')?.content || '';
}

export function resolveDirectorRequestedDurationSeconds(input: {
  task: VideoGenerationTask;
  director: ViralDirectorData;
  outputs: Record<string, ViralUnderstandingOutput>;
  storyboard?: string;
}) {
  const understanding = isRecord(input.task.expertContext?.viralUnderstanding) ? input.task.expertContext.viralUnderstanding : {};
  const context = isRecord(input.task.expertContext) ? input.task.expertContext : {};
  const vod = isRecord(context.vod) ? context.vod : {};
  const storyboardDuration = parseStoryboardDurationSeconds(input.storyboard || storyboardMessageFromTask(input.task));
  const storedStoryboardDuration = Number(understanding.storyboardDurationSeconds || 0);
  const sourceDuration = extractVideoDurationSeconds(input.outputs.video_expert?.raw) || vodDurationSeconds(vod);
  const spokenDuration = estimateSpokenContentDurationSeconds(input.director.part);
  const candidate = sourceDuration > 0
    ? sourceDuration
    : Math.max(
      storyboardDuration,
      Number.isFinite(storedStoryboardDuration) ? storedStoryboardDuration : 0,
      spokenDuration,
      8,
    );
  return Math.max(8, Math.round(candidate));
}

export async function regenerateViralDirectorStoryboardForTask(input: {
  task: VideoGenerationTask;
  userId: string;
  director: ViralDirectorData;
  outputs: Record<string, ViralUnderstandingOutput>;
}) {
  const targetSeconds = resolveDirectorRequestedDurationSeconds({
    task: input.task,
    director: input.director,
    outputs: input.outputs,
  });
  const thinkingTask = persistAndPublishThinkingMessage({
    task: input.task,
    userId: input.userId,
    source: 'storyboard_final',
    roleName: '分镜脚本分析专家',
    content: '正在根据已确认口播重新生成带时间切片的分镜脚本...',
    force: true,
  }) || input.task;
  const storyboard = await buildTimedStoryboardForDirector({
    task: thinkingTask,
    director: input.director,
    outputs: input.outputs,
    targetSeconds,
  });
  const durationSeconds = resolveDirectorRequestedDurationSeconds({
    task: thinkingTask,
    director: input.director,
    outputs: input.outputs,
    storyboard,
  });
  const storyboardTask = await appendAndStreamConversationMessage({
    task: thinkingTask,
    userId: input.userId,
    source: 'storyboard_final',
    roleName: '分镜脚本分析专家',
    content: storyboard,
    initialDelayMs: 300,
    force: true,
  }) || thinkingTask;
  return mergeViralUnderstandingContext(storyboardTask, {
    directorConfirmed: input.director,
    directorStep: 'storyboard',
    directorStatus: 'storyboard_reviewing' as ViralDirectorStatus,
    storyboardDurationSeconds: durationSeconds,
    storyboardUpdatedAt: new Date().toISOString(),
  }) || storyboardTask;
}

export function queueViralDirectorStoryboardGeneration(input: {
  task: VideoGenerationTask;
  userId: string;
  director: ViralDirectorData;
  outputs: Record<string, ViralUnderstandingOutput>;
}) {
  const thinkingTask = persistAndPublishThinkingMessage({
    task: input.task,
    userId: input.userId,
    source: 'storyboard_final',
    roleName: '分镜脚本分析专家',
    content: '正在根据已确认口播重新生成带时间切片的分镜脚本...',
    force: true,
  }) || input.task;
  const queuedTask = mergeViralUnderstandingContext(thinkingTask, {
    directorConfirmed: input.director,
    directorStep: 'storyboard',
    directorStatus: 'storyboard_reviewing' as ViralDirectorStatus,
    storyboardDurationSeconds: resolveDirectorRequestedDurationSeconds({
      task: thinkingTask,
      director: input.director,
      outputs: input.outputs,
    }),
    storyboardUpdatedAt: new Date().toISOString(),
  }) || thinkingTask;
  void (async () => {
    try {
      const completed = await regenerateViralDirectorStoryboardForTask({
        task: queuedTask,
        userId: input.userId,
        director: input.director,
        outputs: input.outputs,
      });
      publishContentEvent({
        type: 'viral-video-analysis-status',
        userId: input.userId,
        taskId: input.task.id,
        phase: 'storyboard-ready',
        status: 'success',
        message: '分镜脚本已生成，请确认后进入视频生成。',
        task: completed,
        at: new Date().toISOString(),
      });
    } catch (error) {
      const failedTask = mergeViralUnderstandingContext(queuedTask, {
        directorStatus: 'reviewing' as ViralDirectorStatus,
        directorStep: 'part',
        directorFailureReason: error instanceof Error ? error.message : String(error),
      }) || queuedTask;
      publishContentEvent({
        type: 'viral-video-analysis-status',
        userId: input.userId,
        taskId: input.task.id,
        phase: 'storyboard-failed',
        status: 'failed',
        message: error instanceof Error ? error.message : '分镜脚本生成失败',
        task: failedTask,
        at: new Date().toISOString(),
      });
    }
  })();
  return queuedTask;
}
