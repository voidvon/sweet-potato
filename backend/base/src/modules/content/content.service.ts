import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { TosClient } from '@volcengine/tos-sdk';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';
import {
  volcengineTosConfig,
  volcengineRealPersonConfig,
  volcengineVirtualPortraitConfig
} from '../../config/env.js';
import { createTraceId, logger } from '../../shared/logger.js';
import { chatRepository } from '../chat/chat.repository.js';
import { releaseReservedFixedBillableUsage } from '../billing/billing.service.js';
import { contentModules } from './content.defaults.js';
import { publishContentEvent } from './content.events.js';
import { contentRepository } from './content.repository.js';
import type {
  ContentAsset,
  ContentAssetGroup,
  ContentResourceType,
  CreateAssetGroupPayload,
  CreateAssetPayload,
  CreateRealPersonAssetPayload,
  CreateRealPersonValidationSessionPayload,
  CreateSubtitleRemovalPayload,
  CreateVideoEnhancementPayload,
  CreateVideoTranslationPayload,
  CreateVideoProductionPayload,
  GenerateDigitalHumanThreeViewPayload,
  GenerateVideoPayload,
  GetRealPersonValidationResultPayload,
  SyncRealPersonAssetPayload,
  UpdateAssetGroupPayload,
  UpdateAssetPayload,
  UpdateVideoParsePayload,
  VideoGenerationTask,
  VideoGenerationResult,
  VideoParseResult
} from './content.types.js';
import type { UserRole } from '../users/user.types.js';
import {
  isVolcenginePrivateAssetMissingError,
  volcenginePrivateAssetClient
} from './volcengine-private-asset.client.js';
import {
  volcengineRealPersonClient
} from './volcengine-real-person.client.js';
import {
  allowedContentResourceTypes,
  permissionForContentModule,
  permissionForContentResourceType,
} from '../../shared/resource-permission.js';

import { RealPersonAssetFile, UploadedAssetFile, assertHttpAssetUrl, assertRealPersonGroupAccess, assertUserId, assertVirtualPortraitGroupAccess, buildRealPersonCallbackUrl, contentFilePathForRelativePath, contentFilesDir, createContentAssetRecord, deleteRemoteRealPersonAsset, deleteRemoteVirtualPortraitAsset, deleteRemoteVirtualPortraitGroup, ensureVirtualPortraitRemoteGroup, errorLogContext, execFileAsync, generatedMediaRelativePath, inferPrivateAssetType, inferRealPersonAssetType, isResourceType, listVirtualPortraitRemoteAssets, logVirtualPortraitAsset, normalizeMetadata, originalNameFromUrl, privateAssetGroupId, privateAssetId, privateAssetProjectName, privateAssetUri, realPersonAssetUri, realPersonBytedToken, realPersonCallbackResult, realPersonProjectName, realPersonValidationExpiresInSeconds, realPersonVolcAssetId, realPersonVolcGroupId, refreshVirtualPortraitAssetsForGroup, remoteAssetGroupId, remoteAssetGroupName, remoteAssetMimeType, remoteAssetName, resolveLocalContentFilePathFromUrl, stringMetadataField, upsertVirtualPortraitRemoteGroup, virtualPortraitAssetMetadataFromRemote, virtualPortraitUpdateAssetUrl } from './internals/content-common.js';
import { buildThreeViewPrompt, createFinishedVideoAsset, deleteContentAssetFile, editImageWithConfiguredModel, extensionForMimeType, isThreeViewFailureAsset, isThreeViewResultAsset, isThreeViewRunningAsset, linkedVideoTaskId } from './internals/content-image-assets.js';
import { callConfiguredVideoModel, formatDurationLabel, isSegmentedVideoGenerationState, persistPendingVideoGenerationResult, resolveConfiguredVideoOption, resolveConfiguredVideoProvider, resolveDefaultVideoModel, userFacingVideoGenerationError } from './internals/content-video-generation.js';
import { mirrorGeneratedVideoToLocalInBackground, schedulePendingGeneratedVideoMirrors } from './internals/content-video-local-mirror.js';
import { createVideoEnhancementTask, refreshVideoEnhancementTask, resumeVideoEnhancementTasks } from './internals/content-video-enhancement.js';
import { assertCreateVideoSourcesDuration } from './internals/content-video-duration.js';
import { createSubtitleRemovalTask, refreshSubtitleRemovalTask, resumeSubtitleRemovalTasks } from './internals/content-subtitle-removal.js';
import { createVideoTranslationTask, refreshVideoTranslationTask, resumeVideoTranslationTasks } from './internals/content-video-translation.js';
import { composeVideoProductionPrompt, generationResultForTask, pollRunningVideoGenerationTask, refreshVideoTaskGenerationStatus, resolveVideoMaterialContext, updateVideoTaskParseResult } from './internals/content-video-task-runtime.js';
import { buildImmediateVideoProductionParseResult, flattenNegativePrompts, isRecord, normalizeParseResult } from './internals/content-viral-analysis.js';
import { absolutizeMaterialUrl, cloneVoiceLibrary, fileUrlFor } from './internals/content-voice-clone.js';

dayjs.extend(customParseFormat);

const temporaryContentAssetTtlMs = 24 * 60 * 60 * 1000;
const temporaryContentAssetCleanupIntervalMs = 60 * 60 * 1000;

export function temporaryContentAssetExpiresAt(now = Date.now()) {
  return new Date(now + temporaryContentAssetTtlMs).toISOString();
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function localAssetFilePaths(asset: ContentAsset) {
  const paths = new Set<string>();
  if (asset.filePath) {
    paths.add(asset.filePath);
  }
  for (const value of [asset.fileUrl, asset.metadata.localVideoUrl]) {
    if (typeof value !== 'string') {
      continue;
    }
    const filePath = resolveLocalContentFilePathFromUrl(value);
    if (filePath) {
      paths.add(filePath);
    }
  }
  return [...paths];
}

function finishedAssetInputIds(asset: ContentAsset) {
  const assetIds = new Set<string>();
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!isRecord(value)) {
      return;
    }
    const sourceAssetId = typeof value.sourceAssetId === 'string' ? value.sourceAssetId.trim() : '';
    if (sourceAssetId) {
      assetIds.add(sourceAssetId);
    }
    const serializedAssetId = typeof value.id === 'string'
      && (typeof value.fileUrl === 'string' || typeof value.resourceType === 'string')
      ? value.id.trim()
      : '';
    if (serializedAssetId) {
      assetIds.add(serializedAssetId);
    }
    Object.values(value).forEach(visit);
  };
  visit(asset.metadata.materialContext);
  visit({ sourceAssetId: asset.metadata.sourceAssetId });
  return [...assetIds];
}

function isTransientInputAsset(asset: ContentAsset) {
  if (asset.resourceType === 'finished_video') {
    return false;
  }
  const group = contentRepository.findGroup(asset.groupId);
  const isHiddenUploadGroup = group?.metadata.source === 'local_upload'
    && (group.metadata.systemDefault === true || group.metadata.hiddenFromGroupUi === true);
  return isHiddenUploadGroup
    || asset.metadata.kind === 'video_create_reference_upload';
}

function isAssetIdReferenced(value: unknown, assetId: string): boolean {
  if (typeof value === 'string') {
    return value === assetId;
  }
  if (Array.isArray(value)) {
    return value.some((item) => isAssetIdReferenced(item, assetId));
  }
  return isRecord(value) && Object.values(value).some((item) => isAssetIdReferenced(item, assetId));
}

async function cleanupUnreferencedFinishedAssetInputs(finishedAsset: ContentAsset) {
  const linkedTaskId = linkedVideoTaskId(finishedAsset);
  for (const inputAssetId of finishedAssetInputIds(finishedAsset)) {
    const inputAsset = contentRepository.findAsset(inputAssetId);
    if (!inputAsset || inputAsset.userId !== finishedAsset.userId || !isTransientInputAsset(inputAsset)) {
      continue;
    }
    const referencedByAsset = contentRepository
      .listAssets({ userId: finishedAsset.userId })
      .some((asset) => asset.id !== inputAsset.id && isAssetIdReferenced(asset.metadata, inputAsset.id));
    const referencedByTask = contentRepository
      .listVideoTasks(finishedAsset.userId, { limit: 500 })
      .some((task) => task.id !== linkedTaskId
        && (isAssetIdReferenced(task.editableParseResult, inputAsset.id)
          || isAssetIdReferenced(task.expertContext, inputAsset.id)));
    if (referencedByAsset || referencedByTask) {
      continue;
    }
    const inputFilePaths = localAssetFilePaths(inputAsset);
    contentRepository.deleteAsset(inputAsset.id);
    await Promise.all(inputFilePaths.map((filePath) => rm(filePath, { force: true })));
  }
}

async function cleanupReleasedVideoTaskInputs(task: VideoGenerationTask, assetIds: string[]) {
  for (const assetId of assetIds) {
    const asset = contentRepository.findAsset(assetId);
    if (!asset || asset.userId !== task.userId || !isTransientInputAsset(asset)) {
      continue;
    }
    const referencedByTask = contentRepository.hasAssetReferences(asset.id)
      || contentRepository
        .listVideoTasks(task.userId, { limit: 500 })
        .some((candidate) => candidate.id !== task.id
          && (isAssetIdReferenced(candidate.editableParseResult, asset.id)
            || isAssetIdReferenced(candidate.expertContext, asset.id)));
    if (referencedByTask) {
      continue;
    }
    const parentAssetId = asset.parentAssetId;
    const filePaths = localAssetFilePaths(asset);
    contentRepository.deleteAsset(asset.id);
    await Promise.all(filePaths.map((filePath) => rm(filePath, { force: true })));

    if (!parentAssetId) continue;
    const parent = contentRepository.findAsset(parentAssetId);
    const hasRemainingChildren = contentRepository
      .listAssets({ userId: task.userId })
      .some((candidate) => candidate.parentAssetId === parentAssetId);
    if (!parent || parent.lifecycleStatus !== 'temporary' || hasRemainingChildren
      || contentRepository.hasAssetReferences(parent.id)) {
      continue;
    }
    const parentFilePaths = localAssetFilePaths(parent);
    contentRepository.deleteAsset(parent.id);
    await Promise.all(parentFilePaths.map((filePath) => rm(filePath, { force: true })));
  }
}

async function cleanupReleasedChatInputAssets(finishedAsset: ContentAsset, inputAssetIds: string[]) {
  for (const inputAssetId of inputAssetIds) {
    const inputAsset = contentRepository.findAsset(inputAssetId);
    if (!inputAsset || inputAsset.userId !== finishedAsset.userId || !isTransientInputAsset(inputAsset)
      || contentRepository.hasAssetReferences(inputAsset.id)) {
      continue;
    }
    if (chatRepository.isAttachmentUrlReferenced(inputAsset.fileUrl)) {
      contentRepository.markAssetTemporaryIfUnreferenced(inputAsset.id, temporaryContentAssetExpiresAt());
      continue;
    }
    const filePaths = localAssetFilePaths(inputAsset);
    contentRepository.deleteAsset(inputAsset.id);
    await Promise.all(filePaths.map((filePath) => rm(filePath, { force: true })));
  }
}

async function cleanupChatGeneratedImageInputs(finishedAsset: ContentAsset, inputAssetIds: string[] = []) {
  const conversationId = typeof finishedAsset.metadata.conversationId === 'string'
    ? finishedAsset.metadata.conversationId.trim()
    : '';
  if (!conversationId || finishedAsset.metadata.generatedBy !== 'image_model') {
    return;
  }
  const messages = chatRepository.listMessages(conversationId);
  const assistantMessageIndex = messages.findIndex((message) => message.role === 'assistant'
    && (message.attachments || []).some((attachment) => attachment.url === finishedAsset.fileUrl));
  if (assistantMessageIndex < 0) {
    await cleanupReleasedChatInputAssets(finishedAsset, inputAssetIds);
    return;
  }
  const assistantMessage = messages[assistantMessageIndex];
  const sourceMessage = messages
    .slice(0, assistantMessageIndex)
    .reverse()
    .find((message) => message.role === 'user');
  if (!sourceMessage) {
    await cleanupReleasedChatInputAssets(finishedAsset, inputAssetIds);
    return;
  }
  const remainingOutputUrls = new Set(contentRepository
    .listAssets({ userId: finishedAsset.userId, resourceType: 'finished_video' })
    .map((asset) => asset.fileUrl));
  const hasRemainingSiblingOutput = (assistantMessage.attachments || [])
    .some((attachment) => attachment.url !== finishedAsset.fileUrl && remainingOutputUrls.has(attachment.url));
  if (hasRemainingSiblingOutput) {
    return;
  }
  for (const attachment of sourceMessage.attachments || []) {
    if (!/^\/files\/input_(?:images|videos|audios)\//u.test(attachment.url)) {
      continue;
    }
    const inputAsset = attachment.assetId
      ? contentRepository.findAsset(attachment.assetId)
      : contentRepository
        .listAssets({ userId: finishedAsset.userId })
        .find((asset) => asset.fileUrl === attachment.url);
    if (inputAsset && contentRepository.hasAssetReferences(inputAsset.id)) {
      continue;
    }
    if (chatRepository.isAttachmentUrlReferencedElsewhere(attachment.url, sourceMessage.id)) {
      if (inputAsset) {
        contentRepository.markAssetTemporaryIfUnreferenced(inputAsset.id, temporaryContentAssetExpiresAt());
      }
      continue;
    }
    const referencedByAsset = contentRepository
      .listAssets({ userId: finishedAsset.userId })
      .some((asset) => asset.id !== inputAsset?.id && asset.fileUrl === attachment.url);
    if (referencedByAsset) {
      if (inputAsset) {
        contentRepository.markAssetTemporaryIfUnreferenced(inputAsset.id, temporaryContentAssetExpiresAt());
      }
      continue;
    }
    if (inputAsset && isTransientInputAsset(inputAsset)) {
      const filePaths = localAssetFilePaths(inputAsset);
      contentRepository.deleteAsset(inputAsset.id);
      await Promise.all(filePaths.map((filePath) => rm(filePath, { force: true })));
    } else {
      const filePath = resolveLocalContentFilePathFromUrl(attachment.url);
      if (filePath) {
        await rm(filePath, { force: true });
      }
    }
  }
}

function segmentedVideoRequestFingerprint(input: {
  title: string;
  prompt: string;
  negativePrompts: string[];
  ratio: string;
  resolution?: string;
  totalSeconds: number;
  maxSegmentSeconds: number;
  materialContext: Record<string, unknown>;
  providerId: string;
  modelId: string;
  seedanceOptions: Record<string, unknown>;
}) {
  return stableJson({
    title: input.title,
    prompt: input.prompt,
    negativePrompts: input.negativePrompts,
    ratio: input.ratio,
    resolution: input.resolution,
    totalSeconds: input.totalSeconds,
    maxSegmentSeconds: input.maxSegmentSeconds,
    materialContext: input.materialContext,
    providerId: input.providerId,
    modelId: input.modelId,
    seedanceOptions: input.seedanceOptions,
  });
}

function resumeThrottleDelayMs() {
  const raw = Number(process.env.VIDEO_GENERATION_RESUME_SCAN_DELAY_MS || 1500);
  return Number.isFinite(raw) && raw >= 0 ? Math.round(raw) : 1500;
}

async function waitMs(ms: number) {
  if (ms <= 0) {
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function uploadedSourceUrl(file?: RealPersonAssetFile | UploadedAssetFile) {
  if (!file) {
    return '';
  }
  return String(file.publicFileUrl || '').trim()
    || absolutizeMaterialUrl(file.fileUrl);
}

function fallbackMimeTypeForAssetType(assetType: 'Image' | 'Video' | 'Audio') {
  if (assetType === 'Image') {
    return 'image/*';
  }
  if (assetType === 'Video') {
    return 'video/*';
  }
  return 'audio/*';
}

function persistedAssetMimeType(input: {
  mimeType?: string;
  assetType: 'Image' | 'Video' | 'Audio';
}) {
  return String(input.mimeType || '').trim() || fallbackMimeTypeForAssetType(input.assetType);
}

function assertOwnsGroup(group: ContentAssetGroup, userId: string) {
  assertUserId(userId);
  if (group.userId !== userId) {
    throw new Error('分组不存在');
  }
}

function assertCanReadAsset(actor: { userId: string; role: UserRole }, asset: ContentAsset) {
  assertUserId(actor.userId);
  if (asset.userId === actor.userId) {
    return;
  }
  if (actor.role === 'admin' && asset.resourceType === 'virtual_portrait') {
    return;
  }
  throw new Error('素材不存在');
}

function assertOwnsAsset(asset: ContentAsset, userId: string) {
  assertUserId(userId);
  if (asset.userId !== userId) {
    throw new Error('素材不存在');
  }
}

function assertOwnsVideoTask(task: VideoGenerationTask, userId: string) {
  assertUserId(userId);
  if (task.userId !== userId) {
    throw new Error('视频任务不存在');
  }
}

function canAdminManageVirtualPortrait(actor: { userId: string; role: UserRole }, resourceType: ContentResourceType) {
  return actor.role === 'admin' && resourceType === 'virtual_portrait';
}

function actorHasPermission(actor: { role: UserRole; permissions?: readonly string[] }, permissionKey: string | null) {
  if (actor.role === 'admin') {
    return true;
  }
  if (!permissionKey) {
    return false;
  }
  return Boolean(actor.permissions?.includes(permissionKey));
}

function assertActorPermissionForResourceType(
  actor: { userId: string; role: UserRole; permissions?: readonly string[] },
  resourceType: ContentResourceType,
) {
  const permissionKey = permissionForContentResourceType(resourceType);
  if (!actorHasPermission(actor, permissionKey)) {
    throw new Error('当前账号无权访问该功能');
  }
}

function filterContentModulesByPermissions(
  actor: { role: UserRole; permissions?: readonly string[] },
) {
  if (actor.role === 'admin') {
    return contentModules;
  }

  return contentModules.filter((moduleItem) => actorHasPermission(actor, permissionForContentModule(moduleItem.code)));
}

function filterAssetsByPermissions(
  actor: { role: UserRole; permissions?: readonly string[] },
  assets: ContentAsset[],
) {
  if (actor.role === 'admin') {
    return assets;
  }

  return assets.filter((asset) => actorHasPermission(actor, permissionForContentResourceType(asset.resourceType)));
}

function filterGroupsByPermissions(
  actor: { role: UserRole; permissions?: readonly string[] },
  groups: ContentAssetGroup[],
) {
  if (actor.role === 'admin') {
    return groups;
  }

  return groups.filter((group) => actorHasPermission(actor, permissionForContentResourceType(group.resourceType)));
}

function filterHiddenGroupsForUi(groups: ContentAssetGroup[]) {
  return groups.filter((group) => group.metadata?.hiddenFromGroupUi !== true);
}

function isUserUploadedVirtualPortraitAsset(asset: ContentAsset) {
  return asset.resourceType === 'virtual_portrait'
    && stringMetadataField(asset.metadata, 'syncPolicy') === 'user_uploaded_remote_mirror';
}

function shouldUseImplicitDefaultGroup(resourceType: ContentResourceType) {
  return resourceType === 'scene' || resourceType === 'product';
}

function implicitDefaultGroupName(resourceType: ContentResourceType) {
  return resourceType === 'scene' ? '场景素材' : '产品素材';
}

function implicitUploadGroupName(resourceType: ContentResourceType) {
  if (resourceType === 'voice') return '视频制作参考音频';
  if (resourceType === 'other') return '视频制作参考素材';
  return implicitDefaultGroupName(resourceType);
}

export function shouldUseImplicitUploadGroup(metadata?: Record<string, unknown>) {
  return metadata?.source === 'local_upload'
    || (metadata?.temporary === true && metadata?.kind === 'video_create_reference_upload');
}

async function deleteLocalVirtualPortraitAsset(asset: ContentAsset) {
  contentRepository.deleteAsset(asset.id);
  if (asset.filePath && existsSync(asset.filePath)) {
    await rm(asset.filePath, { force: true });
  }
}

async function deleteLocalVirtualPortraitGroup(group: ContentAssetGroup) {
  const assets = contentRepository.listAssets({
    userId: group.userId,
    groupId: group.id,
    resourceType: 'virtual_portrait',
  });
  contentRepository.deleteGroup(group.id);
  await Promise.all(assets
    .filter((asset) => asset.filePath && existsSync(asset.filePath))
    .map((asset) => rm(asset.filePath, { force: true })));
  return assets;
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
}

function videoTaskInputAssetIds(context: Record<string, unknown>) {
  return Array.from(new Set([
    ...stringArray(context.referenceImageIds),
    ...stringArray(context.originalReferenceImageIds),
    ...stringArray(context.referenceVideoIds),
    ...stringArray(context.referenceAudioIds),
    typeof context.sourceAssetId === 'string' ? context.sourceAssetId.trim() : '',
  ].filter(Boolean)));
}

function retainVideoTaskInputAssets(task: VideoGenerationTask) {
  const assetIds = videoTaskInputAssetIds(task.expertContext || {});
  if (!assetIds.length) return;
  contentRepository.retainAssetsForReference({
    assetIds,
    userId: task.userId,
    referenceType: 'video_generation_task',
    referenceId: task.id,
  });
}

function characterKeywordPattern() {
  return /(人物|角色|人像|真人|模特|女生|男生|女人|男人|小姐姐|小哥哥|美女|帅哥|肖像)/;
}

function inferCharacterReferenceIndexes(prompt: string) {
  const normalizedPrompt = String(prompt || '').trim();
  if (!normalizedPrompt) {
    return [];
  }
  const indexes = new Set<number>();
  const clauses = normalizedPrompt.split(/[，,。；;\n]/u).map((clause) => clause.trim()).filter(Boolean);
  const clauseHasKeyword = clauses.map((clause) => characterKeywordPattern().test(clause));
  clauses.forEach((clause, clauseIndex) => {
    const matches = Array.from(clause.matchAll(/@图片(\d+)/gu));
    if (!matches.length) {
      return;
    }
    const hasNearbyCharacterKeyword = clauseHasKeyword[clauseIndex]
      || clauseHasKeyword[clauseIndex - 1]
      || clauseHasKeyword[clauseIndex + 1]
      || clauseHasKeyword[clauseIndex - 2]
      || clauseHasKeyword[clauseIndex + 2];
    if (!hasNearbyCharacterKeyword) {
      return;
    }
    matches.forEach((match) => {
      const index = Number(match[1]) - 1;
      if (Number.isFinite(index) && index >= 0) {
        indexes.add(index);
      }
    });
  });
  if (!indexes.size && characterKeywordPattern().test(normalizedPrompt)) {
    for (const match of normalizedPrompt.matchAll(/@图片(\d+)/gu)) {
      const index = Number(match[1]) - 1;
      if (Number.isFinite(index) && index >= 0) {
        indexes.add(index);
      }
    }
  }
  return Array.from(indexes).sort((left, right) => left - right);
}

export function resolveCharacterReferenceImageIds(input: {
  prompt?: string;
  referenceImageIds?: string[];
  characterReferenceImageIds?: string[];
}) {
  const explicitIds = stringArray(input.characterReferenceImageIds);
  const referenceImageIds = stringArray(input.referenceImageIds);
  if (!referenceImageIds.length) {
    return Array.from(new Set(explicitIds));
  }
  const inferredIndexes = inferCharacterReferenceIndexes(String(input.prompt || ''));
  const inferredIds = inferredIndexes
    .map((index) => referenceImageIds[index])
    .filter(Boolean);
  return Array.from(new Set([...explicitIds, ...inferredIds]));
}

function collectCharacterReferenceImageIds(input: {
  prompt?: string;
  referenceImageIds?: string[];
  explicitIds?: string[];
}) {
  return resolveCharacterReferenceImageIds({
    prompt: input.prompt,
    referenceImageIds: input.referenceImageIds,
    characterReferenceImageIds: input.explicitIds,
  });
}

export function resolveSeedanceRejectedSourceAssetIds(input: {
  message?: string;
  originalReferenceImageIds?: string[];
  characterReferenceImageIds?: string[];
}) {
  const originalReferenceImageIds = stringArray(input.originalReferenceImageIds);
  if (!originalReferenceImageIds.length) {
    return [];
  }
  const contentIndexMatch = String(input.message || '').match(/content\[(\d+)\]/i);
  if (contentIndexMatch) {
    const imageIndex = Number(contentIndexMatch[1]) - 1;
    const assetId = Number.isFinite(imageIndex) && imageIndex >= 0
      ? originalReferenceImageIds[imageIndex]
      : undefined;
    return assetId ? [assetId] : [];
  }
  // Ark/Seedance often reports only a generic "input image may contain real person"
  // without content[N]. In that case we cannot know which reference image tripped
  // moderation. Upload every original reference image to the virtual portrait
  // library so multi-image person/product references do not leave one ordinary
  // data:image payload behind and fail again.
  return originalReferenceImageIds;
}

function isSensitiveRealPersonError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }
  return /InputImageSensitiveContentDetected\.PrivacyInformation|input image may contain real person/i.test(error.message);
}

function isSensitiveRealPersonVideoError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }
  return /input video may contain real person/i.test(error.message);
}

let cachedTosClient: TosClient | null = null;

function assertVolcengineTosConfigured() {
  if (!volcengineTosConfig.accessKey || !volcengineTosConfig.secretKey) {
    throw new Error('缺少火山 TOS 配置：请配置 VOLC_ACCESSKEY 和 VOLC_SECRETKEY');
  }
  if (!volcengineTosConfig.endpoint) {
    throw new Error('缺少火山 TOS 配置：请配置 VOLCENGINE_TOS_ENDPOINT');
  }
  if (!volcengineTosConfig.bucket) {
    throw new Error('缺少火山 TOS 配置：请配置 VOLCENGINE_TOS_BUCKET');
  }
}

function normalizeTosEndpoint(endpoint: string) {
  const raw = String(endpoint || '').trim();
  if (!raw) {
    return raw;
  }
  return raw.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
}

function ensureTosClient() {
  assertVolcengineTosConfigured();
  if (!cachedTosClient) {
    cachedTosClient = new TosClient({
      accessKeyId: volcengineTosConfig.accessKey,
      accessKeySecret: volcengineTosConfig.secretKey,
      region: volcengineTosConfig.region,
      endpoint: normalizeTosEndpoint(volcengineTosConfig.endpoint),
    });
  }
  return cachedTosClient;
}

function tosPublicBaseUrl() {
  if (volcengineTosConfig.publicBaseUrl) {
    return volcengineTosConfig.publicBaseUrl;
  }
  try {
    const endpoint = new URL(volcengineTosConfig.endpoint);
    return `https://${volcengineTosConfig.bucket}.${endpoint.host}`;
  } catch {
    return '';
  }
}

function fileExtensionForTemporaryReference(asset: ContentAsset) {
  const extension = extensionForMimeType(asset.mimeType)
    || path.extname(asset.originalFileName || '')
    || path.extname(asset.filePath || '')
    || path.extname(asset.fileUrl || '')
    || '.png';
  return extension.startsWith('.') ? extension : `.${extension}`;
}

function temporaryCharacterReferenceTosKey(input: { taskId: string; sourceAsset: ContentAsset }) {
  const day = new Date().toISOString().slice(0, 10);
  const keyPrefix = volcengineTosConfig.keyPrefix || 'video-generation-temp';
  return [
    keyPrefix,
    'character-reference',
    day,
    input.taskId,
    `${input.sourceAsset.id}-${randomUUID()}${fileExtensionForTemporaryReference(input.sourceAsset)}`,
  ].filter(Boolean).join('/');
}

function encodeObjectKeyForUrl(key: string) {
  return key.split('/').map((part) => encodeURIComponent(part)).join('/');
}

async function uploadLocalFileToTos(input: {
  taskId: string;
  userId: string;
  sourceAsset: ContentAsset;
}) {
  if (!input.sourceAsset.filePath || !existsSync(input.sourceAsset.filePath)) {
    throw new Error(`人物参考图源文件不存在：${input.sourceAsset.name || input.sourceAsset.id}`);
  }
  const client = ensureTosClient();
  const key = temporaryCharacterReferenceTosKey(input);
  const response = await client.putObjectFromFile({
    bucket: volcengineTosConfig.bucket,
    key,
    filePath: input.sourceAsset.filePath,
  });
  const publicBaseUrl = tosPublicBaseUrl();
  if (!publicBaseUrl) {
    throw new Error('火山 TOS 公网访问地址缺失：请配置 VOLCENGINE_TOS_PUBLIC_BASE_URL');
  }
  const headerRecord = response && typeof response === 'object' && 'headers' in response
    ? response.headers as Record<string, unknown>
    : {};
  return {
    bucket: volcengineTosConfig.bucket,
    key,
    publicUrl: `${publicBaseUrl}/${encodeObjectKeyForUrl(key)}`,
    requestId: typeof headerRecord['x-tos-request-id'] === 'string' ? headerRecord['x-tos-request-id'] : '',
  };
}

async function deleteTemporaryTosObject(key: string) {
  const normalizedKey = String(key || '').trim();
  if (!normalizedKey) {
    return;
  }
  try {
    const client = ensureTosClient();
    await client.deleteObject({
      bucket: volcengineTosConfig.bucket,
      key: normalizedKey,
    });
  } catch (error) {
    logger.warn('temporary character reference tos object delete failed', {
      key: normalizedKey,
      error: errorLogContext(error),
    });
  }
}

async function cleanupTemporaryCharacterReferenceGroup(input: {
  groupId?: string;
  userId: string;
}) {
  const groupId = String(input.groupId || '').trim();
  if (!groupId) {
    return;
  }
  const group = contentRepository.findGroup(groupId);
  if (!group || group.userId !== input.userId || group.resourceType !== 'virtual_portrait') {
    return;
  }
  const assets = contentRepository.listAssets({
    userId: input.userId,
    groupId,
    resourceType: 'virtual_portrait',
  });
  await Promise.all(assets.map(async (asset) => {
    try {
      await deleteRemoteVirtualPortraitAsset(asset);
    } catch (error) {
      logger.warn('temporary character reference remote asset delete failed', {
        groupId,
        assetId: asset.id,
        error: errorLogContext(error),
      });
    }
  }));
  try {
    await deleteRemoteVirtualPortraitGroup(group);
  } catch (error) {
    logger.warn('temporary character reference remote group delete failed', {
      groupId,
      error: errorLogContext(error),
    });
  }
  const deletedAssets = await deleteLocalVirtualPortraitGroup(group);
  await Promise.all(deletedAssets.map((asset) => deleteTemporaryTosObject(stringMetadataField(asset.metadata, 'tosKey'))));
}

function clearTemporaryCharacterReferenceContext(task: VideoGenerationTask) {
  const groupId = String(task.expertContext?.temporaryCharacterReferenceGroupId || '').trim();
  const assetIds = stringArray(task.expertContext?.temporaryCharacterReferenceAssetIds);
  if (!groupId && !assetIds.length) {
    return task;
  }
  return contentRepository.updateVideoTaskContext(task.id, {
    selectedSkillIds: task.selectedSkillIds,
    expertContext: {
      ...restorePersistentReferenceImageIds(task.expertContext || {}),
      temporaryCharacterReferenceGroupId: '',
      temporaryCharacterReferenceAssetIds: [],
      updatedAt: new Date().toISOString(),
    },
  }) || task;
}

export function restorePersistentReferenceImageIds(context: Record<string, unknown>) {
  const originalReferenceImageIds = stringArray(context.originalReferenceImageIds);
  return originalReferenceImageIds.length
    ? { ...context, referenceImageIds: originalReferenceImageIds }
    : context;
}

function normalizeVideoProductionSearch(value: unknown) {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }
  const dateMatch = raw.match(/(\d{4})\s*(?:年|-|\/|\.|年\s*)\s*(\d{1,2})\s*(?:月|-|\/|\.)\s*(\d{1,2})\s*(?:日|号)?/);
  if (!dateMatch?.[0]) {
    return raw;
  }
  const parsed = dayjs(`${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`, 'YYYY-M-D', true);
  if (!parsed.isValid()) {
    return raw;
  }
  const normalizedDate = parsed.format('YYYY-MM-DD');
  return raw.replace(dateMatch[0], normalizedDate);
}

function normalizeVideoProductionBoundary(value: unknown) {
  const raw = String(value || '').trim();
  if (!raw) {
    return undefined;
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }
  return parsed.toISOString();
}

function videoProductionStatusLabel(task: VideoGenerationTask) {
  const result = task.editableParseResult.videoGenerationResult
    || (isRecord(task.expertContext?.videoGenerationResult) ? task.expertContext.videoGenerationResult as VideoGenerationResult : undefined);
  const isOrphanPending = task.status !== 'generating'
    && !task.generatedVideoUrl
    && !result?.videoUrl
    && !String(result?.jobId || '').trim()
    && (result?.status === 'pending' || result?.renderStatus === 'queued');
  if (task.generatedVideoUrl || result?.videoUrl) {
    return '已完成';
  }
  if (task.status === 'failed' || result?.status === 'failed' || isOrphanPending) {
    return '失败';
  }
  return '生成中';
}

function filterVideoProductionsOnServer(tasks: VideoGenerationTask[], input: {
  status?: unknown;
}) {
  const status = String(input.status || '').trim();
  const matchesStatus = (task: VideoGenerationTask) => (
    !status
    || status === '全部状态'
    || videoProductionStatusLabel(task) === status
  );
  return tasks.filter(matchesStatus);
}

function isCompletedFinishedAsset(asset: ContentAsset) {
  if (!String(asset.fileUrl || '').trim()) {
    return false;
  }
  const generationStatus = String(asset.metadata?.generationStatus || '').trim().toLowerCase();
  return !['pending', 'queued', 'running', 'generating', 'failed'].includes(generationStatus);
}

function appendVideoProductionFailureHistory(
  nextContext: Record<string, unknown>,
  previousTask: VideoGenerationTask | null,
) {
  if (!previousTask || previousTask.status !== 'failed') {
    return nextContext;
  }
  const previousContext = isRecord(previousTask.expertContext) ? previousTask.expertContext : {};
  const previousResult = generationResultForTask(previousTask);
  const existingHistory = Array.isArray(previousContext.failureHistory)
    ? previousContext.failureHistory.filter(isRecord)
    : [];
  const failedAt = previousTask.updatedAt || new Date().toISOString();
  const snapshot = {
    taskId: previousTask.id,
    failedAt,
    failureReason: previousTask.failureReason || previousResult?.errorMessage || '',
    status: previousTask.status,
    title: previousTask.title,
    prompt: previousTask.prompt,
    generatedVideoUrl: previousTask.generatedVideoUrl,
    videoGenerationResult: previousResult,
    context: {
      mode: previousContext.mode,
      ratio: previousContext.ratio,
      duration: previousContext.duration,
      quality: previousContext.quality,
      videoModelProviderId: previousContext.videoModelProviderId,
      videoModelId: previousContext.videoModelId,
      currentStep: previousContext.currentStep,
      requiredUserAction: previousContext.requiredUserAction,
      temporaryCharacterReferenceGroupId: previousContext.temporaryCharacterReferenceGroupId,
      temporaryCharacterReferenceAssetIds: previousContext.temporaryCharacterReferenceAssetIds,
      referenceImageIds: previousContext.referenceImageIds,
      referenceVideoIds: previousContext.referenceVideoIds,
      referenceAudioIds: previousContext.referenceAudioIds,
    },
  };
  const snapshotKey = `${snapshot.taskId}:${previousResult?.jobId || failedAt}`;
  const nextHistory = existingHistory
    .filter((item) => {
      const result = isRecord(item.videoGenerationResult) ? item.videoGenerationResult : {};
      return `${String(item.taskId || '')}:${String(result.jobId || item.failedAt || '')}` !== snapshotKey;
    })
    .slice(-9);
  nextHistory.push(snapshot);
  return {
    ...nextContext,
    failureHistory: nextHistory,
  };
}

async function waitForVirtualPortraitAssetReady(input: {
  assetId: string;
  userId: string;
  maxAttempts?: number;
  intervalMs?: number;
}) {
  const maxAttempts = Number.isFinite(input.maxAttempts) ? Math.max(1, Math.floor(input.maxAttempts || 0)) : 40;
  const intervalMs = Number.isFinite(input.intervalMs) ? Math.max(200, Math.floor(input.intervalMs || 0)) : 3000;
  let lastAsset = contentRepository.findAsset(input.assetId);
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const synced = await contentService.syncVirtualPortraitAsset(input.assetId, { userId: input.userId });
    lastAsset = synced.asset;
    const status = String(synced.asset.metadata.volcStatus || '').trim();
    if (status === 'Active') {
      return synced.asset;
    }
    if (status === 'Failed') {
      const failureReason = String(synced.asset.metadata.failureReason || '').trim();
      throw new Error(failureReason || '火山虚拟人物素材处理失败');
    }
    if (attempt < maxAttempts) {
      await waitMs(intervalMs);
    }
  }
  throw new Error(`火山虚拟人物素材仍在处理中，请稍后重试（assetId: ${input.assetId}）`);
}

async function createTemporaryCharacterReferenceAssets(input: {
  taskId: string;
  userId: string;
  prompt: string;
  referenceImageIds: string[];
  characterReferenceImageIds: string[];
}) {
  const sourceAssetIds = collectCharacterReferenceImageIds({
    prompt: input.prompt,
    referenceImageIds: input.referenceImageIds,
    explicitIds: input.characterReferenceImageIds,
  });
  if (!sourceAssetIds.length) {
    throw new Error('当前任务没有可用于人物审核兜底的参考图片');
  }
  const group = await contentService.createGroup({
    userId: input.userId,
    resourceType: 'virtual_portrait',
    name: `视频生成人物兜底-${new Date().toISOString().slice(11, 19).replace(/:/g, '')}`,
    description: '视频生成真人图片审核兜底临时素材组',
    metadata: {
      source: 'video_generation_character_fallback',
      kind: 'video_generation_character_reference_group',
      hiddenFromGroupUi: true,
      temporary: true,
      taskId: input.taskId,
    },
  });
  if (!group) {
    throw new Error('视频生成兜底人物素材组创建失败');
  }
  const assetIdBySourceId: Record<string, string> = {};
  try {
    for (const [index, sourceAssetId] of sourceAssetIds.entries()) {
      const sourceAsset = contentRepository.findAsset(sourceAssetId);
      if (!sourceAsset || sourceAsset.userId !== input.userId) {
        throw new Error(`人物参考图不存在：${sourceAssetId}`);
      }
      const tosUpload = await uploadLocalFileToTos({
        taskId: input.taskId,
        userId: input.userId,
        sourceAsset,
      });
      const created = await contentService.createVirtualPortraitAsset(group.id, {
        userId: input.userId,
        name: sourceAsset.name || sourceAsset.originalFileName || `人物参考${index + 1}`,
        description: '视频生成真人审核兜底临时素材',
        url: tosUpload.publicUrl,
        metadata: {
          source: 'video_generation_character_fallback',
          kind: 'video_generation_character_reference_asset',
          hiddenFromGroupUi: true,
          temporary: true,
          taskId: input.taskId,
          sourceAssetId: sourceAsset.id,
          sourceGroupId: sourceAsset.groupId,
          tosBucket: tosUpload.bucket,
          tosKey: tosUpload.key,
          tosPublicUrl: tosUpload.publicUrl,
          tosRequestId: tosUpload.requestId,
        },
      });
      await waitForVirtualPortraitAssetReady({
        assetId: created.asset.id,
        userId: input.userId,
      });
      assetIdBySourceId[sourceAsset.id] = created.asset.id;
    }
  } catch (error) {
    await cleanupTemporaryCharacterReferenceGroup({ groupId: group.id, userId: input.userId });
    throw error;
  }
  return {
    groupId: group.id,
    assetIdBySourceId,
    assetIds: Object.values(assetIdBySourceId),
  };
}

const virtualPortraitSyncIntervalMs = 60 * 1000;
let virtualPortraitMirrorSyncTimer: ReturnType<typeof setInterval> | null = null;
let virtualPortraitMirrorSyncRunning = false;
let temporaryAssetCleanupTimer: ReturnType<typeof setInterval> | null = null;
let temporaryAssetCleanupRunning = false;

export const contentService = {
  listModules(actor?: { role: UserRole; permissions?: readonly string[] }) {
    if (!actor) {
      return contentModules;
    }
    return filterContentModulesByPermissions(actor);
  },

  async listGroups(actor: { userId: string; role: UserRole; permissions?: readonly string[] }, resourceType?: string) {
    assertUserId(actor.userId);
    let normalizedType: ContentResourceType | undefined;
    if (resourceType) {
      if (!isResourceType(resourceType)) {
        throw new Error('素材类型不存在');
      }
      normalizedType = resourceType;
      assertActorPermissionForResourceType(actor, normalizedType);
    }
    const groups = contentRepository.listGroups({
      userId: normalizedType === 'virtual_portrait' && actor.role === 'admin' ? undefined : actor.userId,
      resourceType: normalizedType,
    });
    return filterHiddenGroupsForUi(filterGroupsByPermissions(actor, groups));
  },

  async listGroupsPage(input: {
    actor: { userId: string; role: UserRole; permissions?: readonly string[] };
    resourceType?: string;
    page?: number;
    pageSize?: number;
  }) {
    assertUserId(input.actor.userId);
    let normalizedType: ContentResourceType | undefined;
    if (input.resourceType) {
      if (!isResourceType(input.resourceType)) {
        throw new Error('素材类型不存在');
      }
      normalizedType = input.resourceType;
      assertActorPermissionForResourceType(input.actor, normalizedType);
    }
    const page = Math.max(1, Math.floor(Number(input.page || 1)));
    const pageSize = Math.max(1, Math.min(50, Math.floor(Number(input.pageSize || 12))));
    const result = contentRepository.listGroupsPage({
      userId: normalizedType === 'virtual_portrait' && input.actor.role === 'admin' ? undefined : input.actor.userId,
      resourceType: normalizedType,
      page,
      pageSize,
    });
    const items = filterHiddenGroupsForUi(filterGroupsByPermissions(input.actor, result.items));
    return {
      ...result,
      items,
      total: normalizedType ? result.total : items.length,
    };
  },

  async createGroup(payload: CreateAssetGroupPayload) {
    assertUserId(payload.userId);
    if (!isResourceType(payload.resourceType)) {
      throw new Error('素材类型不存在');
    }
    if (!payload.name?.trim()) {
      throw new Error('请输入分组名称');
    }
    if (payload.resourceType !== 'virtual_portrait') {
      return contentRepository.createGroup(payload);
    }
    if (stringMetadataField(normalizeMetadata(payload.metadata), 'source') === 'ai_generate') {
      const now = new Date().toISOString();
      const group = contentRepository.createGroup({
        ...payload,
        metadata: {
          ...normalizeMetadata(payload.metadata),
          version: 1,
          kind: 'virtual_portrait_profile',
          provider: 'volcengine_ark_private_asset',
          projectName: typeof payload.metadata?.projectName === 'string'
            ? payload.metadata.projectName
            : volcengineVirtualPortraitConfig.projectName,
          remoteStatus: 'PendingTraining',
          createdAt: now,
          updatedAt: now,
        },
      });
      if (!group) {
        throw new Error('人物素材分组创建失败');
      }
      logVirtualPortraitAsset('info', 'virtual portrait ai group create deferred remote sync', {
        userId: payload.userId,
        localGroupId: group.id,
        name: group.name,
        projectName: privateAssetProjectName(group.metadata),
      });
      return group;
    }
    const traceId = createTraceId('virtual-portrait-create-group');
    const now = new Date().toISOString();
    logVirtualPortraitAsset('info', 'virtual portrait group create started', {
      traceId,
      userId: payload.userId,
      name: payload.name.trim(),
      projectName: typeof payload.metadata?.projectName === 'string' ? payload.metadata.projectName : undefined,
    });
    try {
      const remote = await volcenginePrivateAssetClient.createAssetGroup({
        name: payload.name.trim(),
        description: payload.description?.trim(),
        projectName: typeof payload.metadata?.projectName === 'string' ? payload.metadata.projectName : undefined,
      });
      const group = contentRepository.createGroup({
        ...payload,
        metadata: {
          ...normalizeMetadata(payload.metadata),
          version: 1,
          kind: 'virtual_portrait_profile',
          provider: 'volcengine_ark_private_asset',
          projectName: remote.projectName,
          volcAssetGroupId: remote.groupId,
          createAssetGroupRaw: remote.raw,
          createdAt: now,
          updatedAt: now,
        },
      });
      if (!group) {
        await volcenginePrivateAssetClient.deleteAssetGroup({ groupId: remote.groupId, projectName: remote.projectName });
        throw new Error('人物素材分组创建失败');
      }
      logVirtualPortraitAsset('info', 'virtual portrait group create completed', {
        traceId,
        userId: payload.userId,
        localGroupId: group.id,
        remoteGroupId: remote.groupId,
        projectName: remote.projectName,
      });
      return group;
    } catch (error) {
      logVirtualPortraitAsset('error', 'virtual portrait group create failed', {
        traceId,
        userId: payload.userId,
        name: payload.name.trim(),
        error: errorLogContext(error),
      });
      throw error;
    }
  },

  async updateGroup(id: string, payload: UpdateAssetGroupPayload & { userId: string }) {
    if (!id) {
      throw new Error('缺少分组 ID');
    }
    const current = contentRepository.findGroup(id);
    if (!current) {
      throw new Error('分组不存在');
    }
    assertOwnsGroup(current, payload.userId);
    if (current.resourceType === 'virtual_portrait') {
      const remoteGroupId = privateAssetGroupId(current.metadata);
      const nextName = payload.name?.trim() || current.name;
      const shouldUpdateRemote = payload.name !== undefined || payload.description !== undefined;
      if (remoteGroupId && shouldUpdateRemote) {
        const traceId = createTraceId('virtual-portrait-update-group');
        logVirtualPortraitAsset('info', 'virtual portrait asset group update started', {
          traceId,
          localGroupId: current.id,
          remoteGroupId,
          name: nextName,
          projectName: privateAssetProjectName(current.metadata),
        });
        try {
          const remote = await volcenginePrivateAssetClient.updateAssetGroup({
            groupId: remoteGroupId,
            name: nextName,
            description: payload.description?.trim(),
            projectName: privateAssetProjectName(current.metadata),
          });
          payload = {
            ...payload,
            metadata: {
              ...current.metadata,
              ...normalizeMetadata(payload.metadata),
              projectName: remote.projectName,
              updateAssetGroupRaw: remote.raw,
              updatedAt: new Date().toISOString(),
            },
          };
          logVirtualPortraitAsset('info', 'virtual portrait asset group update completed', {
            traceId,
            localGroupId: current.id,
            remoteGroupId,
            projectName: remote.projectName,
          });
        } catch (error) {
          logVirtualPortraitAsset('error', 'virtual portrait asset group update failed', {
            traceId,
            localGroupId: current.id,
            remoteGroupId,
            error: errorLogContext(error),
          });
          throw error;
        }
      }
    }
    const group = contentRepository.updateGroup(id, payload);
    if (!group) {
      throw new Error('分组不存在');
    }
    return group;
  },

  async cloneVoiceGroup(id: string, payload: { userId: string; sampleAssetId?: string }) {
    return cloneVoiceLibrary(id, payload);
  },

  async deleteGroup(id: string, actor: { userId: string; role: UserRole }) {
    if (!id) {
      throw new Error('缺少分组 ID');
    }
    const group = contentRepository.findGroup(id);
    if (!group) {
      throw new Error('分组不存在');
    }
    assertActorPermissionForResourceType(actor, group.resourceType);
    if (!canAdminManageVirtualPortrait(actor, group.resourceType)) {
      assertOwnsGroup(group, actor.userId);
    }
    const assets = contentRepository.listAssets({ userId: group.userId, groupId: id });
    if (group.resourceType === 'virtual_portrait') {
      await Promise.all(assets.map(deleteRemoteVirtualPortraitAsset));
      await deleteRemoteVirtualPortraitGroup(group);
    }
    if (!contentRepository.deleteGroup(id)) {
      throw new Error('分组不存在');
    }
    await Promise.all(assets
      .filter((asset) => Boolean(asset.filePath))
      .map((asset) => rm(asset.filePath, { force: true })));
    return { ok: true };
  },

  async createRealPersonValidationSession(payload: CreateRealPersonValidationSessionPayload) {
    assertUserId(payload.userId);
    const now = new Date().toISOString();
    const groupId = randomUUID();
    const callbackUrl = buildRealPersonCallbackUrl({ userId: payload.userId, groupId });
    const projectName = payload.metadata?.projectName && typeof payload.metadata.projectName === 'string'
      ? payload.metadata.projectName
      : volcengineRealPersonConfig.projectName;
    const session = await volcengineRealPersonClient.createVisualValidateSession({
      callbackUrl,
      projectName,
    });
    const sessionCreatedAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + realPersonValidationExpiresInSeconds * 1000).toISOString();
    const group = contentRepository.createGroup({
      id: groupId,
      userId: payload.userId,
      resourceType: 'real_person',
      name: payload.name?.trim() || `真人素材-${now.slice(0, 10)}`,
      description: payload.description?.trim() || '',
      metadata: {
        ...normalizeMetadata(payload.metadata),
        version: 1,
        kind: 'real_person_profile',
        provider: 'volcengine_ark',
        projectName: session.projectName,
        validationStatus: 'pending',
        validationSession: {
          bytedToken: session.bytedToken,
          h5Link: session.h5Link,
          callbackUrl: session.callbackUrl,
          expiresAt,
          createdAt: sessionCreatedAt,
        },
        createdAt: now,
        updatedAt: sessionCreatedAt,
      },
    });
    if (!group) {
      throw new Error('真人素材分组创建失败');
    }
    return {
      group,
      validationSession: {
        bytedToken: session.bytedToken,
        h5Link: session.h5Link,
        callbackUrl: session.callbackUrl,
        expiresAt,
        projectName: session.projectName,
      },
      raw: session.raw,
    };
  },

  async getRealPersonValidationResult(payload: GetRealPersonValidationResultPayload) {
    assertUserId(payload.userId);
    if (!payload.groupId) {
      throw new Error('缺少真人素材分组 ID');
    }
    const group = contentRepository.findGroup(payload.groupId);
    if (!group) {
      throw new Error('真人素材分组不存在');
    }
    assertRealPersonGroupAccess(group, payload.userId);
    const bytedToken = payload.bytedToken?.trim() || realPersonBytedToken(group.metadata);
    if (!bytedToken) {
      throw new Error('缺少真人认证 BytedToken');
    }
    const result = await volcengineRealPersonClient.getVisualValidateResult({
      bytedToken,
      projectName: realPersonProjectName(group.metadata),
    });
    const verifiedAt = new Date().toISOString();
    const updatedGroup = contentRepository.updateGroup(group.id, {
      metadata: {
        ...group.metadata,
        projectName: result.projectName,
        validationStatus: 'verified',
        verifiedAt,
        volcGroupId: result.groupId,
        validationResult: {
          bytedToken,
          groupId: result.groupId,
          raw: result.raw,
          fetchedAt: verifiedAt,
        },
        updatedAt: verifiedAt,
      },
    });
    if (!updatedGroup) {
      throw new Error('真人认证结果保存失败');
    }
    return {
      group: updatedGroup,
      volcGroupId: result.groupId,
      raw: result.raw,
    };
  },

  async handleRealPersonCallback(query: Record<string, unknown>) {
    const resultCode = String(query.resultCode || '').trim();
    const userId = String(query.userId || '').trim();
    const groupId = String(query.groupId || '').trim();
    const bytedToken = String(query.bytedToken || query.BytedToken || '').trim();
    const callbackAt = new Date().toISOString();
    const callbackResult = realPersonCallbackResult(query, callbackAt);
    if (!userId || !groupId) {
      return {
        ok: false,
        resultCode,
        message: '回调缺少 userId 或 groupId',
      };
    }
    if (resultCode !== '10000') {
      const group = contentRepository.findGroup(groupId);
      if (group && group.userId === userId && group.resourceType === 'real_person') {
        contentRepository.updateGroup(groupId, {
          metadata: {
            ...group.metadata,
            validationStatus: 'failed',
            callbackResult,
            updatedAt: callbackAt,
          },
        });
      }
      return {
        ok: false,
        resultCode,
        message: '真人认证未通过',
      };
    }
    const result = await this.getRealPersonValidationResult({ userId, groupId, bytedToken });
    const group = contentRepository.updateGroup(groupId, {
      metadata: {
        ...result.group.metadata,
        callbackResult,
        updatedAt: callbackAt,
      },
    }) || result.group;
    return {
      ok: true,
      resultCode,
      group,
      volcGroupId: result.volcGroupId,
    };
  },

  async createRealPersonAsset(groupId: string, payload: CreateRealPersonAssetPayload, file?: RealPersonAssetFile) {
    assertUserId(payload.userId);
    if (!groupId) {
      throw new Error('缺少真人素材分组 ID');
    }
    const group = contentRepository.findGroup(groupId);
    if (!group) {
      throw new Error('真人素材分组不存在');
    }
    assertRealPersonGroupAccess(group, payload.userId);
    const volcGroupId = realPersonVolcGroupId(group.metadata);
    if (group.metadata.validationStatus !== 'verified' || !volcGroupId) {
      throw new Error('真人认证通过后才能上传真人素材');
    }
    const sourceUrl = file
      ? uploadedSourceUrl(file)
      : String(payload.url || '').trim();
    if (!sourceUrl) {
      throw new Error(file
        ? '本地上传真人素材缺少可公网访问地址。请通过可外网访问的域名访问后端，或正确配置 CONTENT_PUBLIC_BASE_URL 指向当前后端服务的 /files 静态文件地址。'
        : '请上传真人素材文件或填写素材 URL');
    }
    assertHttpAssetUrl(sourceUrl);
    const assetType = inferRealPersonAssetType({ mimeType: file?.mimeType, url: sourceUrl });
    const name = (payload.name || file?.originalFileName || originalNameFromUrl(sourceUrl)).trim().slice(0, 64);
    if (!name) {
      throw new Error('请输入真人素材名称');
    }
    const projectName = realPersonProjectName(group.metadata);
    const remote = await volcengineRealPersonClient.createAsset({
      groupId: volcGroupId,
      url: sourceUrl,
      name,
      assetType,
      projectName,
    });
    const createdAt = new Date().toISOString();
    const metadata = {
      ...normalizeMetadata(payload.metadata),
      version: 1,
      kind: 'real_person_asset',
      provider: 'volcengine_ark',
      projectName: remote.projectName,
      volcGroupId,
      volcAssetId: remote.assetId,
      assetUri: remote.assetUri,
      volcStatus: 'Processing',
      remoteSourceUrl: sourceUrl,
      remotePreviewUrl: '',
      failureReason: '',
      createAssetRaw: remote.raw,
      uploadedAt: createdAt,
      updatedAt: createdAt,
    };
    const asset = this.createAsset({
      userId: payload.userId,
      groupId,
      resourceType: 'real_person',
      name,
      description: payload.description || '',
      originalFileName: file?.originalFileName || originalNameFromUrl(sourceUrl),
      storedFileName: file?.storedFileName || '',
      mimeType: persistedAssetMimeType({ mimeType: file?.mimeType, assetType }),
      fileSize: file?.fileSize || 0,
      filePath: file?.filePath || '',
      fileUrl: file?.fileUrl || sourceUrl,
      metadata,
    });
    if (!asset) {
      throw new Error('真人素材本地保存失败');
    }
    return {
      asset,
      remote: {
        assetId: remote.assetId,
        assetUri: remote.assetUri,
        projectName: remote.projectName,
      },
      raw: remote.raw,
    };
  },

  async syncRealPersonAsset(id: string, payload: SyncRealPersonAssetPayload) {
    assertUserId(payload.userId);
    const asset = contentRepository.findAsset(id);
    if (!asset || asset.userId !== payload.userId) {
      throw new Error('真人素材不存在');
    }
    if (asset.resourceType !== 'real_person') {
      throw new Error('当前素材不是真人素材');
    }
    const assetId = realPersonVolcAssetId(asset.metadata);
    if (!assetId) {
      throw new Error('当前真人素材缺少火山 Asset ID');
    }
    const remote = await volcengineRealPersonClient.getAsset({
      assetId,
      projectName: realPersonProjectName(asset.metadata),
    });
    const syncedAt = new Date().toISOString();
    const updated = contentRepository.updateAsset(asset.id, {
      metadata: {
        ...asset.metadata,
        projectName: remote.projectName,
        volcAssetId: remote.assetId,
        assetUri: realPersonAssetUri(remote.assetId),
        volcStatus: remote.status,
        remotePreviewUrl: remote.url,
        failureReason: remote.failureReason,
        getAssetRaw: remote.raw,
        syncedAt,
        updatedAt: syncedAt,
      },
    });
    if (!updated) {
      throw new Error('真人素材同步结果保存失败');
    }
    return {
      asset: updated,
      remote: {
        assetId: remote.assetId,
        status: remote.status,
        url: remote.url,
        failureReason: remote.failureReason,
        projectName: remote.projectName,
      },
      raw: remote.raw,
    };
  },

  async createVirtualPortraitAsset(groupId: string, payload: CreateRealPersonAssetPayload, file?: UploadedAssetFile) {
    assertUserId(payload.userId);
    if (!groupId) {
      throw new Error('缺少人物素材分组 ID');
    }
    const group = contentRepository.findGroup(groupId);
    if (!group) {
      throw new Error('人物素材分组不存在');
    }
    assertVirtualPortraitGroupAccess(group, payload.userId);
    const remoteGroupId = privateAssetGroupId(group.metadata);
    if (!remoteGroupId) {
      throw new Error('当前人物素材分组缺少火山 Asset Group ID');
    }
    const sourceRef = file
      ? uploadedSourceUrl(file)
      : String(payload.url || '').trim();
    if (!sourceRef) {
      throw new Error(file
        ? '本地上传虚拟人像缺少可公网访问地址。请通过可外网访问的域名访问后端，或正确配置 CONTENT_PUBLIC_BASE_URL 指向当前后端服务的 /files 静态文件地址。'
        : '请上传人物素材文件或填写素材 URL');
    }
    assertHttpAssetUrl(sourceRef);
    const assetType = inferPrivateAssetType({ mimeType: file?.mimeType, url: sourceRef });
    const name = (payload.name || file?.originalFileName || originalNameFromUrl(sourceRef)).trim().slice(0, 64);
    if (!name) {
      throw new Error('请输入人物素材名称');
    }
    const projectName = privateAssetProjectName(group.metadata);
    const traceId = createTraceId('virtual-portrait-create-asset');
    logVirtualPortraitAsset('info', 'virtual portrait asset create started', {
      traceId,
      userId: payload.userId,
      localGroupId: groupId,
      remoteGroupId,
      name,
      assetType,
      projectName,
      source: sourceRef,
      uploadMode: 'url',
    });
    try {
      const remote = await volcenginePrivateAssetClient.createAsset({
        groupId: remoteGroupId,
        url: sourceRef,
        name,
        assetType,
        projectName,
      });
      const createdAt = new Date().toISOString();
      const metadata = {
        ...normalizeMetadata(payload.metadata),
        version: 1,
        kind: 'three_view_result',
        source: 'local_upload',
        syncPolicy: 'user_uploaded_remote_mirror',
        syncStatus: 'active',
        provider: 'volcengine_ark_private_asset',
        projectName: remote.projectName,
        volcAssetGroupId: remoteGroupId,
        volcAssetId: remote.assetId,
        assetUri: remote.assetUri,
        volcStatus: 'Active',
        remoteSourceUrl: sourceRef,
        remotePreviewUrl: sourceRef,
        failureReason: '',
        createAssetRaw: remote.raw,
        uploadedAt: createdAt,
        lastSyncedAt: createdAt,
        lastSyncError: '',
        updatedAt: createdAt,
      };
      const asset = contentRepository.createAsset({
        userId: payload.userId,
        groupId,
        resourceType: 'virtual_portrait',
        name,
        description: payload.description || '',
        originalFileName: file?.originalFileName || originalNameFromUrl(sourceRef),
        storedFileName: file?.storedFileName || '',
        mimeType: persistedAssetMimeType({ mimeType: file?.mimeType, assetType }),
        fileSize: file?.fileSize || 0,
        filePath: file?.filePath || '',
        fileUrl: file?.fileUrl || sourceRef,
        metadata,
      });
      if (!asset) {
        await volcenginePrivateAssetClient.deleteAsset({ assetId: remote.assetId, projectName: remote.projectName });
        throw new Error('人物素材本地保存失败');
      }
      logVirtualPortraitAsset('info', 'virtual portrait asset create completed', {
        traceId,
        userId: payload.userId,
        localAssetId: asset.id,
        localGroupId: groupId,
        remoteGroupId,
        remoteAssetId: remote.assetId,
        assetUri: remote.assetUri,
        projectName: remote.projectName,
      });
      return {
        asset,
        remote: {
          assetId: remote.assetId,
          assetUri: remote.assetUri,
          projectName: remote.projectName,
        },
        raw: remote.raw,
      };
    } catch (error) {
      logVirtualPortraitAsset('error', 'virtual portrait asset create failed', {
        traceId,
        userId: payload.userId,
        localGroupId: groupId,
        remoteGroupId,
        name,
        source: sourceRef,
        error: errorLogContext(error),
      });
      throw error;
    }
  },

  async syncVirtualPortraitAsset(id: string, payload: SyncRealPersonAssetPayload) {
    assertUserId(payload.userId);
    const asset = contentRepository.findAsset(id);
    if (!asset || asset.userId !== payload.userId) {
      throw new Error('人物素材不存在');
    }
    if (asset.resourceType !== 'virtual_portrait') {
      throw new Error('当前素材不是人物素材');
    }
    const assetId = privateAssetId(asset.metadata);
    if (!assetId) {
      throw new Error('当前人物素材缺少火山 Asset ID');
    }
    const traceId = createTraceId('virtual-portrait-sync-asset');
    logVirtualPortraitAsset('info', 'virtual portrait asset sync started', {
      traceId,
      userId: payload.userId,
      localAssetId: asset.id,
      remoteAssetId: assetId,
      projectName: privateAssetProjectName(asset.metadata),
    });
    try {
      const remote = await volcenginePrivateAssetClient.getAsset({
        assetId,
        projectName: privateAssetProjectName(asset.metadata),
      });
      const syncedAt = new Date().toISOString();
      const updated = contentRepository.updateAsset(asset.id, {
        metadata: {
          ...asset.metadata,
          projectName: remote.projectName,
          volcAssetId: remote.assetId,
          assetUri: privateAssetUri(remote.assetId),
          volcStatus: remote.status,
          remotePreviewUrl: remote.url || asset.metadata.remotePreviewUrl,
          failureReason: remote.failureReason,
          syncStatus: 'active',
          getAssetRaw: remote.raw,
          lastSyncedAt: syncedAt,
          lastSyncError: '',
          syncedAt,
          updatedAt: syncedAt,
        },
      });
      if (!updated) {
        throw new Error('人物素材同步结果保存失败');
      }
      logVirtualPortraitAsset('info', 'virtual portrait asset sync completed', {
        traceId,
        userId: payload.userId,
        localAssetId: updated.id,
        remoteAssetId: remote.assetId,
        status: remote.status,
        projectName: remote.projectName,
      });
      return {
        asset: updated,
        remote: {
          assetId: remote.assetId,
          status: remote.status,
          url: remote.url,
          failureReason: remote.failureReason,
          projectName: remote.projectName,
        },
        raw: remote.raw,
      };
    } catch (error) {
      logVirtualPortraitAsset('error', 'virtual portrait asset sync failed', {
        traceId,
        userId: payload.userId,
        localAssetId: asset.id,
        remoteAssetId: assetId,
        error: errorLogContext(error),
      });
      throw error;
    }
  },

  async listAssets(input: {
    actor: { userId: string; role: UserRole; permissions?: readonly string[] };
    groupId?: string;
    resourceType?: string;
    page?: number;
    pageSize?: number;
  }) {
    assertUserId(input.actor.userId);
    let resourceType: ContentResourceType | undefined;
    if (input.resourceType) {
      if (!isResourceType(input.resourceType)) {
        throw new Error('素材类型不存在');
      }
      resourceType = input.resourceType;
      assertActorPermissionForResourceType(input.actor, resourceType);
    }
    const group = input.groupId ? contentRepository.findGroup(input.groupId) : null;
    if (group) {
      assertActorPermissionForResourceType(input.actor, group.resourceType);
    }
    const isAdminVirtualPortraitScope = input.actor.role === 'admin'
      && (resourceType === 'virtual_portrait' || group?.resourceType === 'virtual_portrait');
    const scope = {
      userId: isAdminVirtualPortraitScope ? undefined : input.actor.userId,
      groupId: input.groupId,
      resourceType,
    };
    if (input.page || input.pageSize) {
      const page = Math.max(1, Math.floor(Number(input.page || 1)));
      const pageSize = Math.max(1, Math.min(50, Math.floor(Number(input.pageSize || 20))));
      if (resourceType === 'finished_video') {
        const completedAssets = filterAssetsByPermissions(
          input.actor,
          contentRepository.listAssets(scope).filter(isCompletedFinishedAsset),
        );
        schedulePendingGeneratedVideoMirrors({
          userId: scope.userId,
          limit: 20,
        });
        const offset = (page - 1) * pageSize;
        return {
          items: completedAssets.slice(offset, offset + pageSize),
          page,
          pageSize,
          total: completedAssets.length,
        };
      }
      const result = contentRepository.listAssetsPage({
        ...scope,
        page,
        pageSize,
      });
      const items = filterAssetsByPermissions(input.actor, result.items);
      if (group?.resourceType === 'finished_video') {
        schedulePendingGeneratedVideoMirrors({
          userId: scope.userId,
          limit: 20,
        });
      }
      return {
        ...result,
        items,
      };
    }
    const assets = contentRepository
      .listAssets(scope)
      .filter((asset) => resourceType !== 'finished_video' || isCompletedFinishedAsset(asset));
    if (resourceType === 'finished_video' || group?.resourceType === 'finished_video') {
      schedulePendingGeneratedVideoMirrors({
        userId: scope.userId,
        limit: 20,
      });
    }
    return filterAssetsByPermissions(input.actor, assets);
  },

  async listVideoProductions(userId: string, filters: {
    createdAtFrom?: unknown;
    createdAtTo?: unknown;
    ratio?: unknown;
    search?: unknown;
    status?: unknown;
    page?: unknown;
    pageSize?: unknown;
  } = {}) {
    assertUserId(userId);
    const tasks = contentRepository
      .listVideoTasks(userId, {
        modes: ['video_create', 'talking_video', 'dance_remake', 'video_upscale', 'subtitle_removal', 'video_translation'],
        createdAtFrom: normalizeVideoProductionBoundary(filters.createdAtFrom),
        createdAtTo: normalizeVideoProductionBoundary(filters.createdAtTo),
        aspectRatio: String(filters.ratio || '').trim() === '全部比例'
          ? undefined
          : String(filters.ratio || '').trim() || undefined,
        search: normalizeVideoProductionSearch(filters.search),
        limit: 500,
      });
    const refreshed = await Promise.all(tasks.map(async (task) => {
      try {
        const nextTask = task.expertContext?.mode === 'video_upscale'
          ? await refreshVideoEnhancementTask(task)
          : task.expertContext?.mode === 'subtitle_removal'
            ? await refreshSubtitleRemovalTask(task)
            : task.expertContext?.mode === 'video_translation'
              ? await refreshVideoTranslationTask(task)
            : await refreshVideoTaskGenerationStatus(task);
        if (nextTask && nextTask.status !== 'generating' && nextTask.expertContext?.temporaryCharacterReferenceGroupId) {
          await cleanupTemporaryCharacterReferenceGroup({
            groupId: String(nextTask.expertContext.temporaryCharacterReferenceGroupId || '').trim(),
            userId,
          });
          return clearTemporaryCharacterReferenceContext(nextTask);
        }
        return nextTask;
      } catch (error) {
        logger.warn('refresh video production status failed', {
          taskId: task.id,
          userId,
          error: errorLogContext(error),
        });
        return task;
      }
    }));
    schedulePendingGeneratedVideoMirrors({ userId, limit: 20 });
    const filtered = filterVideoProductionsOnServer(
      refreshed.filter((task): task is NonNullable<typeof task> => Boolean(task)),
      { status: filters.status },
    );
    const requestedPage = Number(filters.page);
    if (!Number.isFinite(requestedPage) || requestedPage < 1) {
      return filtered;
    }
    const page = Math.max(1, Math.floor(requestedPage));
    const requestedPageSize = Number(filters.pageSize);
    const pageSize = Number.isFinite(requestedPageSize)
      ? Math.max(1, Math.min(100, Math.floor(requestedPageSize)))
      : 20;
    const offset = (page - 1) * pageSize;
    return {
      items: filtered.slice(offset, offset + pageSize),
      page,
      pageSize,
      total: filtered.length,
    };
  },

  async createVideoEnhancement(payload: CreateVideoEnhancementPayload) {
    assertUserId(payload.userId);
    const task = await createVideoEnhancementTask(payload);
    contentRepository.retainAssetsForReference({
      assetIds: [payload.sourceAssetId],
      userId: payload.userId,
      referenceType: 'video_generation_task',
      referenceId: task.id,
    });
    return task;
  },

  async createSubtitleRemoval(payload: CreateSubtitleRemovalPayload) {
    assertUserId(payload.userId);
    const task = await createSubtitleRemovalTask(payload);
    contentRepository.retainAssetsForReference({
      assetIds: [payload.sourceAssetId],
      userId: payload.userId,
      referenceType: 'video_generation_task',
      referenceId: task.id,
    });
    return task;
  },

  async createVideoTranslation(payload: CreateVideoTranslationPayload) {
    assertUserId(payload.userId);
    const task = await createVideoTranslationTask(payload);
    contentRepository.retainAssetsForReference({
      assetIds: [payload.sourceAssetId],
      userId: payload.userId,
      referenceType: 'video_generation_task',
      referenceId: task.id,
    });
    return task;
  },

  async getAsset(id: string, actor: { userId: string; role: UserRole; permissions?: readonly string[] }) {
    const asset = contentRepository.findAsset(id);
    if (!asset) {
      throw new Error('素材不存在');
    }
    assertActorPermissionForResourceType(actor, asset.resourceType);
    assertCanReadAsset(actor, asset);
    return asset;
  },

  createAsset(payload: CreateAssetPayload) {
    const usesImplicitUploadGroup = shouldUseImplicitUploadGroup(payload.metadata);
    if (!payload.groupId && (shouldUseImplicitDefaultGroup(payload.resourceType) || usesImplicitUploadGroup)) {
      const groupName = usesImplicitUploadGroup
        ? implicitUploadGroupName(payload.resourceType)
        : implicitDefaultGroupName(payload.resourceType);
      const existingGroup = contentRepository
        .listGroups({ userId: payload.userId, resourceType: payload.resourceType })
        .find((group) => group.metadata?.systemDefault === true || group.name === groupName);
      const targetGroup = existingGroup || contentRepository.createGroup({
        userId: payload.userId,
        resourceType: payload.resourceType,
        name: groupName,
        metadata: {
          systemDefault: true,
          hiddenFromGroupUi: true,
          source: 'local_upload',
        },
      });
      if (!targetGroup) {
        throw new Error('默认素材库创建失败');
      }
      return createContentAssetRecord({
        ...payload,
        groupId: targetGroup.id,
      });
    }
    return createContentAssetRecord(payload);
  },

  async updateAsset(id: string, payload: UpdateAssetPayload & { userId: string }) {
    let nextPayload = {
      ...payload,
      metadata: payload.metadata === undefined ? undefined : normalizeMetadata(payload.metadata),
    };
    const current = contentRepository.findAsset(id);
    if (!current) {
      throw new Error('素材不存在');
    }
    assertOwnsAsset(current, payload.userId);
    const targetGroupId = payload.groupId || current.groupId;
    const targetGroup = contentRepository.findGroup(targetGroupId);
    if (!targetGroup) {
      throw new Error('素材分组不存在');
    }
    assertOwnsGroup(targetGroup, payload.userId);
    const nextResourceType = payload.resourceType || current.resourceType;
    if (!isResourceType(nextResourceType)) {
      throw new Error('素材类型不存在');
    }
    if (targetGroup.resourceType !== nextResourceType) {
      throw new Error('素材类型与当前集合不匹配');
    }
    if (current.resourceType === 'virtual_portrait') {
      const remoteAssetId = privateAssetId(current.metadata);
      const nextName = payload.name?.trim();
      const nextAssetUrl = virtualPortraitUpdateAssetUrl(payload, current);
      if (remoteAssetId && (nextName || nextAssetUrl)) {
        if (nextAssetUrl) {
          assertHttpAssetUrl(nextAssetUrl);
        }
        const traceId = createTraceId('virtual-portrait-update-asset');
        logVirtualPortraitAsset('info', 'virtual portrait asset update started', {
          traceId,
          localAssetId: current.id,
          remoteAssetId,
          name: nextName,
          source: nextAssetUrl,
          uploadMode: nextAssetUrl ? 'url' : undefined,
          projectName: privateAssetProjectName(current.metadata),
        });
        try {
          const remote = await volcenginePrivateAssetClient.updateAsset({
            assetId: remoteAssetId,
            name: nextName,
            url: nextAssetUrl || undefined,
            projectName: privateAssetProjectName(current.metadata),
          });
          const updatedAt = new Date().toISOString();
          nextPayload = {
            ...nextPayload,
            fileUrl: nextAssetUrl || payload.fileUrl,
            metadata: {
              ...current.metadata,
              ...(nextPayload.metadata || {}),
              projectName: remote.projectName,
              remoteSourceUrl: nextAssetUrl || stringMetadataField(current.metadata, 'remoteSourceUrl'),
              remotePreviewUrl: nextAssetUrl || stringMetadataField(current.metadata, 'remotePreviewUrl'),
              updateAssetRaw: remote.raw,
              updatedAt,
            },
          };
          logVirtualPortraitAsset('info', 'virtual portrait asset update completed', {
            traceId,
            localAssetId: current.id,
            remoteAssetId,
            source: nextAssetUrl,
            projectName: remote.projectName,
          });
        } catch (error) {
          logVirtualPortraitAsset('error', 'virtual portrait asset update failed', {
            traceId,
            localAssetId: current.id,
            remoteAssetId,
            error: errorLogContext(error),
          });
          throw error;
        }
      }
    }
    const asset = contentRepository.updateAsset(id, nextPayload);
    if (!asset) {
      throw new Error('素材不存在');
    }
    return asset;
  },

  async deleteAsset(id: string, actor: { userId: string; role: UserRole }) {
    const current = contentRepository.findAsset(id);
    if (!current) {
      throw new Error('素材不存在');
    }
    assertActorPermissionForResourceType(actor, current.resourceType);
    if (!canAdminManageVirtualPortrait(actor, current.resourceType)) {
      assertOwnsAsset(current, actor.userId);
    }
    await deleteRemoteRealPersonAsset(current);
    await deleteRemoteVirtualPortraitAsset(current);
    // Remote deletion can yield while a generated video finishes mirroring. Re-read so
    // the deletion captures the latest local path before removing the database record.
    const latest = contentRepository.findAsset(id);
    if (!latest) {
      throw new Error('素材不存在');
    }
    const localFilePaths = localAssetFilePaths(latest);
    const contentAssetInputIds = contentRepository.listAssetIdsForReference('content_asset', id);
    const asset = contentRepository.deleteAsset(id);
    if (!asset) {
      throw new Error('素材不存在');
    }
    const videoTaskId = linkedVideoTaskId(asset);
    const linkedVideoTask = videoTaskId ? contentRepository.findVideoTask(videoTaskId) : null;
    contentRepository.deleteAssetReferences('content_asset', asset.id);
    await Promise.all(localFilePaths.map((filePath) => rm(filePath, { force: true })));
    if (linkedVideoTask?.userId === asset.userId) {
      await this.deleteVideoTask(linkedVideoTask.id, asset.userId);
    }
    if (asset.resourceType === 'finished_video') {
      await cleanupUnreferencedFinishedAssetInputs(asset);
      await cleanupChatGeneratedImageInputs(asset, contentAssetInputIds);
    }
    return { ok: true };
  },

  async generateDigitalHumanThreeView(
    groupId: string,
    payload: GenerateDigitalHumanThreeViewPayload,
    options: { resourceType?: 'digital_human' | 'virtual_portrait'; label?: string; syncToPrivateAsset?: boolean } = {},
  ) {
    const resourceType = options.resourceType || 'digital_human';
    const label = options.label || '数字人';
    assertUserId(payload.userId);
    if (!groupId) {
      throw new Error(`缺少${label}分组 ID`);
    }
    const group = contentRepository.findGroup(groupId);
    if (!group) {
      throw new Error(`${label}分组不存在`);
    }
    if (group.userId !== payload.userId) {
      throw new Error(`无权操作该${label}分组`);
    }
    if (group.resourceType !== resourceType) {
      throw new Error(`当前分组不是${label}分组`);
    }
    const assets = contentRepository.listAssets({
      userId: payload.userId,
      groupId,
      resourceType,
    });
    const trainingAssets = assets.filter((asset) => !isThreeViewResultAsset(asset) && !isThreeViewFailureAsset(asset) && !isThreeViewRunningAsset(asset));
    if (!trainingAssets.length) {
      throw new Error('请先上传本人训练照片');
    }
    const referenceAssets = trainingAssets.filter((asset) => asset.mimeType.startsWith('image/'));
    if (!referenceAssets.length) {
      throw new Error('请先上传 JPG、PNG 或 WEBP 格式的训练照片');
    }

    const previousStateAssets = assets.filter((asset) => isThreeViewResultAsset(asset) || isThreeViewFailureAsset(asset) || isThreeViewRunningAsset(asset));
    await Promise.all(previousStateAssets.filter(isThreeViewRunningAsset).map(deleteContentAssetFile));
    const runningAt = new Date().toISOString();
    const runningStoredFileName = `digital-human-three-view-running-${groupId}-${Date.now()}.json`;
    const runningFilePath = path.join(contentFilesDir, runningStoredFileName);
    const runningPayload = {
      kind: 'three_view_running',
      runningAt,
      trainingAssetIds: trainingAssets.map((asset) => asset.id),
    };
    const runningBuffer = Buffer.from(JSON.stringify(runningPayload, null, 2), 'utf8');
    await writeFile(runningFilePath, runningBuffer);
    const runningAsset = this.createAsset({
      userId: payload.userId,
      groupId,
      resourceType,
      name: `${group.name}-三视图生成中`,
      description: '三视图正在生成中',
      originalFileName: 'digital-human-three-view-running.json',
      storedFileName: runningStoredFileName,
      mimeType: 'application/json',
      fileSize: runningBuffer.byteLength,
      filePath: runningFilePath,
      fileUrl: fileUrlFor(runningStoredFileName),
      metadata: runningPayload,
    });
    publishContentEvent({
      type: 'digital-human-three-view-status',
      userId: payload.userId,
      groupId,
      status: 'running',
      at: new Date().toISOString(),
    });
    try {
      const prompt = buildThreeViewPrompt({
        trainingAssets,
      });
      const generated = await editImageWithConfiguredModel({
        prompt,
        referenceAssets,
        billingContext: {
          userId: payload.userId,
          sourceType: resourceType === 'virtual_portrait' ? 'virtual_portrait_three_view' : 'digital_human_three_view',
          sourceId: groupId,
          groupId,
        },
      });
      const extension = extensionForMimeType(generated.mimeType);
      const storedFileName = `digital-human-three-view-${groupId}-${Date.now()}.${extension}`;
      const storedRelativePath = generatedMediaRelativePath('image', storedFileName);
      const filePath = contentFilePathForRelativePath(storedRelativePath);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, generated.buffer);
      let privateAssetMetadata: Record<string, unknown> = {};
      if (options.syncToPrivateAsset) {
        const remoteGroup = await ensureVirtualPortraitRemoteGroup(group);
        const remoteGroupId = remoteGroup.remoteGroupId;
        const sourceRef = absolutizeMaterialUrl(fileUrlFor(storedRelativePath));
        if (!sourceRef) {
          await rm(filePath, { force: true });
          throw new Error('火山 CreateAsset 官方示例使用 JSON URL 入库；请配置 CONTENT_PUBLIC_BASE_URL，确保火山可访问 AI 训练生成的人物素材文件');
        }
        assertHttpAssetUrl(sourceRef);
        const traceId = createTraceId('virtual-portrait-three-view-asset');
        const assetType = inferPrivateAssetType({ mimeType: generated.mimeType, url: sourceRef });
        logVirtualPortraitAsset('info', 'virtual portrait three view remote asset create started', {
          traceId,
          userId: payload.userId,
          localGroupId: groupId,
          remoteGroupId,
          name: `${group.name}-三视图成品`,
          assetType,
          projectName: remoteGroup.projectName,
          source: sourceRef,
          uploadMode: 'url',
        });
        let remote: Awaited<ReturnType<typeof volcenginePrivateAssetClient.createAsset>>;
        try {
          remote = await volcenginePrivateAssetClient.createAsset({
            groupId: remoteGroupId,
            url: sourceRef,
            name: `${group.name}-三视图成品`,
            assetType,
            projectName: remoteGroup.projectName,
          });
        } catch (error) {
          logVirtualPortraitAsset('error', 'virtual portrait three view remote asset create failed', {
            traceId,
            userId: payload.userId,
            localGroupId: groupId,
            remoteGroupId,
            source: sourceRef,
            error: errorLogContext(error),
          });
          throw error;
        }
        logVirtualPortraitAsset('info', 'virtual portrait three view remote asset create completed', {
          traceId,
          userId: payload.userId,
          localGroupId: groupId,
          remoteGroupId,
          remoteAssetId: remote.assetId,
          assetUri: remote.assetUri,
          projectName: remote.projectName,
        });
        privateAssetMetadata = {
          provider: 'volcengine_ark_private_asset',
          source: 'ai_generate',
          syncPolicy: 'local_only',
          syncStatus: 'active',
          projectName: remote.projectName,
          volcAssetGroupId: remoteGroupId,
          volcAssetId: remote.assetId,
          assetUri: remote.assetUri,
          volcStatus: 'Active',
          remoteSourceUrl: sourceRef,
          remotePreviewUrl: sourceRef,
          failureReason: '',
          createAssetRaw: remote.raw,
          lastSyncedAt: new Date().toISOString(),
          lastSyncError: '',
        };
      }
      await Promise.all([
        ...previousStateAssets.map(deleteContentAssetFile),
        ...(runningAsset ? [deleteContentAssetFile(runningAsset)] : []),
      ]);
      const asset = this.createAsset({
        userId: payload.userId,
        groupId,
        resourceType,
        name: `${group.name}-三视图成品`,
        description: `由图片模型生成的${label}三视图/多视图成品`,
        originalFileName: `digital-human-three-view.${extension}`,
        storedFileName: storedRelativePath,
        mimeType: generated.mimeType,
        fileSize: generated.buffer.byteLength,
        filePath,
        fileUrl: fileUrlFor(storedRelativePath),
        metadata: {
          generatedBy: 'image_model',
          kind: 'three_view_result',
          model: generated.model,
          source: generated.source,
          generatedAt: new Date().toISOString(),
          trainingAssetIds: trainingAssets.map((asset) => asset.id),
          ...privateAssetMetadata,
        },
      });
      if (!asset) {
        await rm(filePath, { force: true });
        throw new Error('三视图素材创建失败');
      }
      if (options.syncToPrivateAsset) {
        logVirtualPortraitAsset('info', 'virtual portrait three view local asset create completed', {
          userId: payload.userId,
          localGroupId: groupId,
          localAssetId: asset.id,
          remoteAssetId: privateAssetId(asset.metadata),
          assetUri: stringMetadataField(asset.metadata, 'assetUri'),
        });
      }
      publishContentEvent({
        type: 'digital-human-three-view-status',
        userId: payload.userId,
        groupId,
        status: 'success',
        asset,
        at: new Date().toISOString(),
      });
      return asset;
    } catch (error) {
      const failureReason = error instanceof Error ? error.message : '三视图生成失败，请检查模型配置';
      if (options.syncToPrivateAsset) {
        logVirtualPortraitAsset('error', 'virtual portrait three view generation failed', {
          userId: payload.userId,
          localGroupId: groupId,
          failureReason,
          error: errorLogContext(error),
        });
      }
      await Promise.all([
        ...previousStateAssets.filter(isThreeViewFailureAsset).map(deleteContentAssetFile),
        ...(runningAsset ? [deleteContentAssetFile(runningAsset)] : []),
      ]);
      const storedFileName = `digital-human-three-view-failure-${groupId}-${Date.now()}.json`;
      const filePath = path.join(contentFilesDir, storedFileName);
      const failedAt = new Date().toISOString();
      const failurePayload = {
        kind: 'three_view_failure',
        failureReason,
        failedAt,
        trainingAssetIds: trainingAssets.map((asset) => asset.id),
      };
      const buffer = Buffer.from(JSON.stringify(failurePayload, null, 2), 'utf8');
      await writeFile(filePath, buffer);
      this.createAsset({
        userId: payload.userId,
        groupId,
        resourceType,
        name: `${group.name}-三视图失败`,
        description: failureReason,
        originalFileName: 'digital-human-three-view-failure.json',
        storedFileName,
        mimeType: 'application/json',
        fileSize: buffer.byteLength,
        filePath,
        fileUrl: fileUrlFor(storedFileName),
        metadata: failurePayload,
      });
      publishContentEvent({
        type: 'digital-human-three-view-status',
        userId: payload.userId,
        groupId,
        status: 'failed',
        failureReason,
        at: failedAt,
      });
      throw new Error(failureReason);
    }
  },

  async generateVirtualPortraitThreeView(groupId: string, payload: GenerateDigitalHumanThreeViewPayload) {
    return this.generateDigitalHumanThreeView(groupId, payload, {
      resourceType: 'virtual_portrait',
      label: '虚拟人像',
      syncToPrivateAsset: true,
    });
  },

  listVideoTasks(userId: string) {
    assertUserId(userId);
    schedulePendingGeneratedVideoMirrors({ userId, limit: 20 });
    return contentRepository.listVideoTasks(userId);
  },

  getVideoTask(id: string, userId?: string) {
    const task = contentRepository.findVideoTask(id);
    if (!task) {
      throw new Error('视频任务不存在');
    }
    if (userId) {
      assertOwnsVideoTask(task, userId);
    }
    return task;
  },

  async getVideoTaskView(id: string, userId?: string) {
    const task = this.getVideoTask(id, userId);
    schedulePendingGeneratedVideoMirrors({ userId: task.userId, limit: 20 });
    try {
      const refreshed = task.expertContext?.mode === 'video_upscale'
        ? await refreshVideoEnhancementTask(task)
        : task.expertContext?.mode === 'subtitle_removal'
          ? await refreshSubtitleRemovalTask(task)
          : task.expertContext?.mode === 'video_translation'
            ? await refreshVideoTranslationTask(task)
          : await refreshVideoTaskGenerationStatus(task);
      if (refreshed && refreshed.status !== 'generating' && refreshed.expertContext?.temporaryCharacterReferenceGroupId && userId) {
        await cleanupTemporaryCharacterReferenceGroup({
          groupId: String(refreshed.expertContext.temporaryCharacterReferenceGroupId || '').trim(),
          userId,
        });
        return clearTemporaryCharacterReferenceContext(refreshed);
      }
      return refreshed;
    } catch (error) {
      logger.warn('refresh video task status failed', {
        taskId: id,
        error: errorLogContext(error),
      });
      return task;
    }
  },

  resumeRunningVideoGenerations() {
    contentRepository.listGeneratingVideoTasks()
      .filter((task) => task.expertContext?.mode === 'dance_remake'
        && task.expertContext?.currentStep === 'dance_remake_preparing')
      .forEach((task) => {
        const reservationId = String(task.expertContext?.videoBillingReservationId || '').trim();
        if (reservationId) releaseReservedFixedBillableUsage(reservationId);
        contentRepository.updateVideoTaskContext(task.id, {
          selectedSkillIds: task.selectedSkillIds,
          expertContext: {
            ...task.expertContext,
            currentStep: 'dance_remake_preparation_failed',
            danceRemakePreparationStatus: 'failed',
            requiredUserAction: 'resubmit',
            updatedAt: new Date().toISOString(),
          },
        });
        contentRepository.markVideoTaskFailed(task.id, '服务重启前参考视频尚未准备完成，请重新提交');
      });
    this.resumePersistedRunningVideoGenerations();
    resumeVideoEnhancementTasks();
    resumeSubtitleRemovalTasks();
    resumeVideoTranslationTasks();
  },

  resumePendingGeneratedVideoMirrors() {
    schedulePendingGeneratedVideoMirrors({ limit: 100 });
  },

  async syncVirtualPortraitRemoteLibrary(input: {
    actor: { userId: string; role: UserRole };
    projectName?: string;
    pageSize?: number;
    includeAssets?: boolean;
  }) {
    assertUserId(input.actor.userId);
    if (input.actor.role !== 'admin') {
      throw new Error('需要管理员权限');
    }

    const pageSize = Math.max(1, Math.min(100, Math.floor(Number(input.pageSize || 100))));
    const includeAssets = input.includeAssets !== false;
    const allRemoteGroups: Array<Record<string, unknown>> = [];
    let pageNumber = 1;
    let resolvedProjectName = input.projectName?.trim() || '';

    while (true) {
      const remotePage = await volcenginePrivateAssetClient.listAssetGroups({
        pageNumber,
        pageSize,
        projectName: resolvedProjectName || undefined,
      });
      resolvedProjectName = remotePage.projectName;
      allRemoteGroups.push(...remotePage.groups);
      if (remotePage.groups.length < pageSize) {
        break;
      }
      pageNumber += 1;
    }

    const syncedAt = new Date().toISOString();
    const localGroups = contentRepository.listGroups({ resourceType: 'virtual_portrait' });
    const localByRemoteGroupId = new Map<string, ContentAssetGroup>();
    for (const group of localGroups) {
      const remoteGroupKey = privateAssetGroupId(group.metadata);
      if (remoteGroupKey && !localByRemoteGroupId.has(remoteGroupKey)) {
        localByRemoteGroupId.set(remoteGroupKey, group);
      }
    }

    const groups: Array<{
      remoteGroupId: string;
      remoteGroupName: string;
      localGroupId?: string;
      userId?: string;
      assetCount?: number;
      status: 'synced' | 'failed';
      error?: string;
    }> = [];
    let createdGroups = 0;
    let updatedGroups = 0;
    let syncedAssetGroups = 0;
    let failedGroups = 0;

    for (const remoteGroup of allRemoteGroups) {
      const nextRemoteGroupId = remoteAssetGroupId(remoteGroup);
      const nextRemoteGroupName = remoteAssetGroupName(remoteGroup);
      if (!nextRemoteGroupId) {
        failedGroups += 1;
        groups.push({
          remoteGroupId: '',
          remoteGroupName: nextRemoteGroupName,
          status: 'failed',
          error: '云端分组缺少 Group ID',
        });
        continue;
      }

      const existing = localByRemoteGroupId.get(nextRemoteGroupId);
      try {
        const upserted = await upsertVirtualPortraitRemoteGroup({
          userId: existing?.userId || input.actor.userId,
          remoteGroup,
          existing,
          syncedAt,
        });
        if (!upserted) {
          throw new Error('虚拟人像云端分组落库失败');
        }

        localByRemoteGroupId.set(nextRemoteGroupId, upserted);
        if (existing) {
          updatedGroups += 1;
        } else {
          createdGroups += 1;
        }

        let assetCount: number | undefined;
        if (includeAssets) {
          const syncedAssets = await refreshVirtualPortraitAssetsForGroup(upserted, { force: true });
          assetCount = syncedAssets.length;
          syncedAssetGroups += 1;
        }

        groups.push({
          remoteGroupId: nextRemoteGroupId,
          remoteGroupName: nextRemoteGroupName,
          localGroupId: upserted.id,
          userId: upserted.userId,
          assetCount,
          status: 'synced',
        });
      } catch (error) {
        failedGroups += 1;
        groups.push({
          remoteGroupId: nextRemoteGroupId,
          remoteGroupName: nextRemoteGroupName,
          localGroupId: existing?.id,
          userId: existing?.userId,
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
        });
        logger.warn('virtual portrait remote library sync failed', {
          remoteGroupId: nextRemoteGroupId,
          remoteGroupName: nextRemoteGroupName,
          existingLocalGroupId: existing?.id,
          error: errorLogContext(error),
        });
      }
    }

    return {
      projectName: resolvedProjectName,
      totalRemoteGroups: allRemoteGroups.length,
      createdGroups,
      updatedGroups,
      syncedAssetGroups,
      failedGroups,
      groups,
    };
  },

  startVirtualPortraitMirrorSyncScheduler() {
    if (virtualPortraitMirrorSyncTimer) {
      return;
    }
    void this.syncVirtualPortraitMirrorAssets();
    virtualPortraitMirrorSyncTimer = setInterval(() => {
      void this.syncVirtualPortraitMirrorAssets();
    }, virtualPortraitSyncIntervalMs);
  },

  startTemporaryAssetCleanupScheduler() {
    if (temporaryAssetCleanupTimer) {
      return;
    }
    void this.cleanupExpiredTemporaryAssets();
    temporaryAssetCleanupTimer = setInterval(() => {
      void this.cleanupExpiredTemporaryAssets();
    }, temporaryContentAssetCleanupIntervalMs);
  },

  listTemporaryAssetCleanupCandidates(input: { page?: unknown; pageSize?: unknown }) {
    const page = Number(input.page);
    const pageSize = Number(input.pageSize);
    return contentRepository.listTemporaryAssetCleanupCandidates({
      page: Number.isFinite(page) ? page : 1,
      pageSize: Number.isFinite(pageSize) ? pageSize : 20,
    });
  },

  listTemporaryAssetCleanupLogs() {
    return contentRepository.listTemporaryAssetCleanupLogs();
  },

  async cleanupExpiredTemporaryAssets(triggerType: 'scheduled' | 'manual' = 'scheduled') {
    if (temporaryAssetCleanupRunning) {
      return { deleted: 0 };
    }
    temporaryAssetCleanupRunning = true;
    let deleted = 0;
    try {
      while (true) {
        const now = new Date().toISOString();
        const expired = contentRepository.listExpiredTemporaryAssets(now, 100);
        if (!expired.length) break;
        for (const candidate of expired) {
          const asset = contentRepository.deleteExpiredTemporaryAsset(candidate.id, now);
          if (!asset) continue;
          await Promise.all(localAssetFilePaths(asset).map((filePath) => rm(filePath, { force: true })));
          contentRepository.recordTemporaryAssetCleanup(asset, triggerType);
          deleted += 1;
        }
      }
      if (deleted) {
        logger.info('expired temporary content assets cleaned', { deleted });
      }
      return { deleted };
    } finally {
      temporaryAssetCleanupRunning = false;
    }
  },

  async syncVirtualPortraitMirrorAssets() {
    if (virtualPortraitMirrorSyncRunning) {
      return;
    }
    virtualPortraitMirrorSyncRunning = true;
    try {
      const groups = contentRepository.listGroups({ resourceType: 'virtual_portrait' });
      for (const group of groups) {
        const localAssets = contentRepository
          .listAssets({ userId: group.userId, groupId: group.id, resourceType: 'virtual_portrait' })
          .filter(isUserUploadedVirtualPortraitAsset);
        if (!localAssets.length) {
          continue;
        }
        const remoteGroupId = privateAssetGroupId(group.metadata);
        if (!remoteGroupId) {
          continue;
        }
        try {
          const remoteAssets = await listVirtualPortraitRemoteAssets(group);
          if (!remoteAssets) {
            continue;
          }
          const syncedAt = new Date().toISOString();
          const remoteById = new Map(remoteAssets.assets
            .map((item) => [stringMetadataField(item as Record<string, unknown>, 'Id'), item] as const)
            .filter(([id]) => Boolean(id)));
          for (const asset of localAssets) {
            const remoteAssetId = privateAssetId(asset.metadata);
            if (!remoteAssetId) {
              continue;
            }
            const remoteAsset = remoteById.get(remoteAssetId);
            if (!remoteAsset) {
              await deleteLocalVirtualPortraitAsset(asset);
              continue;
            }
            const remoteUrl = stringMetadataField(remoteAsset as Record<string, unknown>, 'URL');
            contentRepository.updateAssetFileInfo(asset.id, {
              fileUrl: asset.fileUrl,
              originalFileName: asset.originalFileName,
              mimeType: remoteAssetMimeType(remoteAsset),
              name: remoteAssetName(remoteAsset),
              metadata: {
                ...virtualPortraitAssetMetadataFromRemote({
                  group,
                  remote: remoteAsset,
                  existing: asset,
                  syncedAt,
                }),
                syncPolicy: 'user_uploaded_remote_mirror',
                syncStatus: 'active',
                lastSyncedAt: syncedAt,
                lastSyncError: '',
              },
            });
          }
          const remainingAssets = contentRepository.listAssets({
            userId: group.userId,
            groupId: group.id,
            resourceType: 'virtual_portrait',
          });
          if (!remainingAssets.length) {
            contentRepository.deleteGroup(group.id);
            continue;
          }
          contentRepository.updateGroup(group.id, {
            metadata: {
              ...group.metadata,
              projectName: remoteAssets.projectName,
              listAssetsRaw: remoteAssets.raw,
              assetsSyncedAt: syncedAt,
              updatedAt: syncedAt,
            },
          });
        } catch (error) {
          if (isVolcenginePrivateAssetMissingError(error)) {
            await deleteLocalVirtualPortraitGroup(group);
            continue;
          }
          const failedAt = new Date().toISOString();
          for (const asset of localAssets) {
            contentRepository.updateAssetFileInfo(asset.id, {
              metadata: {
                ...asset.metadata,
                syncStatus: 'sync_failed',
                lastSyncAttemptAt: failedAt,
                lastSyncError: error instanceof Error ? error.message : String(error),
                updatedAt: failedAt,
              },
            });
          }
          logger.warn('virtual portrait mirror group sync failed', {
            groupId: group.id,
            remoteGroupId,
            userId: group.userId,
            localAssetIds: localAssets.map((asset) => asset.id),
            error: errorLogContext(error),
          });
        }
      }
    } finally {
      virtualPortraitMirrorSyncRunning = false;
    }
  },

  resumePersistedRunningVideoGenerations() {
    const tasks = contentRepository.listGeneratingVideoTasks();
    const resumable = tasks.filter((task) => {
      if (task.expertContext?.mode === 'video_upscale'
        || task.expertContext?.mode === 'subtitle_removal'
        || task.expertContext?.mode === 'video_translation') {
        return false;
      }
      const segmentState = task.expertContext?.videoGenerationSegments;
      if (isSegmentedVideoGenerationState(segmentState) && segmentState.status === 'running') {
        return true;
      }
      const result = generationResultForTask(task);
      return Boolean(result?.jobId && (result.status === 'pending' || result.status === 'running'));
    });
    if (!resumable.length) {
      logger.info('no running video generations to resume');
      return;
    }
    logger.info('resuming running video generations', {
      count: resumable.length,
      taskIds: resumable.map((task) => task.id),
    });
    const delayMs = resumeThrottleDelayMs();
    void (async () => {
      for (const [index, task] of resumable.entries()) {
        try {
          if (index > 0) {
            await waitMs(delayMs);
          }
          await pollRunningVideoGenerationTask(task.id);
        } catch (error) {
          logger.warn('resume video generation polling failed', {
            taskId: task.id,
            error: errorLogContext(error),
          });
        }
      }
    })();
  },

  async createVideoProduction(payload: CreateVideoProductionPayload) {
    assertUserId(payload.userId);
    const traceId = createTraceId('video-production');
    const precreatedTaskId = String(payload.precreatedTaskId || '').trim();
    const retryTaskId = String(payload.retryTaskId || '').trim();
    const userPrompt = String(payload.prompt || '').trim();
    const resolvedConfig = resolveDefaultVideoModel(payload.videoModelProviderId);
    const resolvedProvider = resolveConfiguredVideoProvider(resolvedConfig);
    const resolvedModelOption = resolveConfiguredVideoOption(resolvedProvider, resolvedConfig, payload.videoModelId);
    const quality = payload.quality || '标清 (720p)';
    const ratio = payload.ratio || '9:16';
    const duration = payload.duration || formatDurationLabel(resolvedModelOption.durationPolicy.defaultSeconds);
    const materialContext = resolveVideoMaterialContext({
      userId: payload.userId,
      referenceImageGroupId: payload.referenceImageGroupId,
      referenceVideoGroupId: payload.referenceVideoGroupId,
      referenceAudioGroupId: payload.referenceAudioGroupId,
      referenceImageIds: payload.referenceImageIds,
      referenceVideoIds: payload.referenceVideoIds,
      referenceAudioIds: payload.referenceAudioIds,
    });
    await assertCreateVideoSourcesDuration([
      ...(materialContext.references.videoGroup?.assets || []),
      ...materialContext.references.videos,
    ]);
    const prompt = composeVideoProductionPrompt({
      userPrompt,
      quality,
      ratio,
      duration,
      modelOption: resolvedModelOption,
      materialContext,
    });
    const characterReferenceImageIds = collectCharacterReferenceImageIds({
      prompt: userPrompt || prompt,
      referenceImageIds: payload.referenceImageIds,
      explicitIds: payload.characterReferenceImageIds,
    });
    let stage: 'create_task' | 'queue_video_model' = 'create_task';
    logger.info('video production request started', {
      traceId,
      userId: payload.userId,
      userPrompt,
      prompt,
      quality,
      ratio,
      duration,
      videoModelProviderId: payload.videoModelProviderId || '',
      videoModelId: payload.videoModelId || '',
      referenceImageGroupId: payload.referenceImageGroupId || '',
      referenceVideoGroupId: payload.referenceVideoGroupId || '',
      referenceAudioGroupId: payload.referenceAudioGroupId || '',
      referenceImageCount: payload.referenceImageIds?.length || 0,
      referenceVideoCount: payload.referenceVideoIds?.length || 0,
      referenceAudioCount: payload.referenceAudioIds?.length || 0,
    });
    try {
      const pendingResult: VideoGenerationResult = {
        version: 1,
        taskId: '',
        status: 'pending',
        duration,
        ratio,
        renderMode: 'provider_generation',
        renderStatus: 'queued',
        audioSource: 'silent_fallback',
        generatedAt: new Date().toISOString(),
      };
      const parseResult = buildImmediateVideoProductionParseResult({
        prompt,
        quality,
        ratio,
        duration,
        generationResult: pendingResult,
      });
      const taskMode = payload.taskMode || 'video_create';
      const title = taskMode === 'dance_remake'
        ? `跳舞复刻 ${duration}`
        : taskMode === 'talking_video'
          ? `口播视频生成 ${ratio} ${duration}`
          : `视频制作 ${ratio} ${duration}`;
      const expertContext = {
        mode: taskMode,
        traceId,
        quality,
        ratio,
        duration,
        videoModelProviderId: payload.videoModelProviderId || '',
        videoModelId: payload.videoModelId || '',
        referenceImageGroupId: payload.referenceImageGroupId || '',
        referenceVideoGroupId: payload.referenceVideoGroupId || '',
        referenceAudioGroupId: payload.referenceAudioGroupId || '',
        referenceImageIds: payload.referenceImageIds || [],
        originalReferenceImageIds: payload.referenceImageIds || [],
        referenceVideoIds: payload.referenceVideoIds || [],
        referenceAudioIds: payload.referenceAudioIds || [],
        characterReferenceImageIds,
        generateAudio: payload.generateAudio !== false,
        skipVideoBilling: payload.skipVideoBilling === true,
        videoBillingReservationId: String(payload.videoBillingReservationId || ''),
        userPrompt,
      };
      const precreatedTask = precreatedTaskId ? this.getVideoTask(precreatedTaskId, payload.userId) : null;
      if (precreatedTask && (
        payload.taskMode !== 'dance_remake'
        || precreatedTask.expertContext?.mode !== 'dance_remake'
        || precreatedTask.expertContext?.currentStep !== 'dance_remake_preparing'
      )) {
        throw new Error('跳舞复刻准备任务状态无效');
      }
      const retryTask = retryTaskId ? this.getVideoTask(retryTaskId, payload.userId) : null;
      const shouldReuseRetryTask = retryTask?.status === 'failed';
      const nextExpertContext = shouldReuseRetryTask
        ? appendVideoProductionFailureHistory(expertContext, retryTask)
        : expertContext;
      const task = precreatedTask
        ? contentRepository.resetVideoTaskFromPrompt(precreatedTask.id, {
          userId: payload.userId,
          prompt,
          selectedSkillIds: precreatedTask.selectedSkillIds,
          title,
          parseResult,
          expertContext: nextExpertContext,
          aspectRatio: ratio,
        })
        : shouldReuseRetryTask
        ? contentRepository.resetVideoTaskFromPrompt(retryTask.id, {
          userId: payload.userId,
          prompt,
          selectedSkillIds: retryTask.selectedSkillIds,
          title,
          parseResult,
          expertContext: nextExpertContext,
          aspectRatio: ratio,
        })
        : contentRepository.createVideoTaskFromPrompt({
          userId: payload.userId,
          prompt,
          selectedSkillIds: [],
          title,
          parseResult,
          expertContext: nextExpertContext,
          aspectRatio: ratio,
        });
      if (!task) {
        throw new Error('视频制作任务创建失败');
      }
      retainVideoTaskInputAssets(task);
      const taskIdPendingResult: VideoGenerationResult = {
        ...pendingResult,
        taskId: task.id,
      };
      const taskWithPendingResult = this.updateVideoParseResult(task.id, {
        editableParseResult: buildImmediateVideoProductionParseResult({
          prompt,
          quality,
          ratio,
          duration,
          generationResult: taskIdPendingResult,
        }),
        selectedDigitalHumanId: task.selectedDigitalHumanId,
        selectedSceneId: task.selectedSceneId,
        selectedVoiceId: task.selectedVoiceId,
      });
      const queuedTask = contentRepository.updateVideoTaskContext(task.id, {
        selectedSkillIds: taskWithPendingResult.selectedSkillIds,
        expertContext: {
          ...taskWithPendingResult.expertContext,
          videoResult: taskIdPendingResult,
          videoGenerationResult: taskIdPendingResult,
          currentStep: 'video_generation_submitted',
          requiredUserAction: null,
          updatedAt: new Date().toISOString(),
        },
      });
      const generatingTask = contentRepository.markVideoTaskGenerating(task.id);
      if (!queuedTask || !generatingTask) {
        throw new Error('视频制作任务排队失败');
      }
      stage = 'queue_video_model';
      void this.generateVideo(task.id)
        .then((generatedTask) => {
          logger.info('video production background generation completed', {
            traceId,
            userId: payload.userId,
            taskId: generatedTask.id,
            status: generatedTask.status,
            videoUrl: generatedTask.generatedVideoUrl || '',
            videoGenerationResult: generatedTask.editableParseResult.videoGenerationResult || generatedTask.expertContext.videoGenerationResult,
          });
        })
        .catch((error) => {
          logger.error('video production background generation failed', {
            traceId,
            endpoint: 'POST /api/content/video-productions',
            stage: 'queue_video_model',
            userId: payload.userId,
            taskId: task.id,
            error: errorLogContext(error),
          });
        });
      logger.info('video production request queued', {
        traceId,
        userId: payload.userId,
        taskId: generatingTask.id,
        status: generatingTask.status,
      });
      return generatingTask;
    } catch (error) {
      logger.error('video production request failed', {
        traceId,
        endpoint: 'POST /api/content/video-productions',
        stage,
        userId: payload.userId,
        prompt,
        quality,
        ratio,
        duration,
        error: errorLogContext(error),
      });
      throw error;
    }
  },

  updateVideoParseResult(id: string, payload: UpdateVideoParsePayload) {
    if (payload.userId) {
      this.getVideoTask(id, payload.userId);
    }
    return updateVideoTaskParseResult(id, payload);
  },

  async generateVideo(id: string, payload: GenerateVideoPayload = {}) {
    const current = contentRepository.findVideoTask(id);
    if (!current) {
      throw new Error('视频任务不存在');
    }
    if (payload.userId && current.userId !== payload.userId) {
      throw new Error('无权操作该视频任务');
    }
    retainVideoTaskInputAssets(current);
    const replicationPlan = payload.replicationPlan || current.editableParseResult.replicationPlan;
    let taskContext = isRecord(current.expertContext) ? current.expertContext : {};
    const voiceContext = isRecord(taskContext.voice) ? taskContext.voice : {};
    const ratio = String(taskContext.ratio || current.editableParseResult.viralAnalysis?.dimensions.formatQuality.details.ratio || '9:16');
    const duration = String(replicationPlan ? '25秒' : taskContext.duration || '30秒');
    const prompt = replicationPlan?.visualPrompt
      || [
        current.editableParseResult.spokenContent,
        current.editableParseResult.scene,
        current.editableParseResult.shotLanguage,
        current.editableParseResult.product,
      ].filter(Boolean).join('\n');
    if (!prompt.trim()) {
      throw new Error('缺少视频生成提示词，请先完成解析或复刻计划');
    }
    contentRepository.markVideoTaskGenerating(id);
    let providerResult: Awaited<ReturnType<typeof callConfiguredVideoModel>>;
    let materialContext: ReturnType<typeof resolveVideoMaterialContext> = {
      digitalHuman: undefined,
      scene: undefined,
      voice: undefined,
      references: {
        imageGroup: undefined,
        videoGroup: undefined,
        audioGroup: undefined,
        images: [],
        videos: [],
        audios: [],
      },
      audio: undefined,
    };
    try {
      const selectedDigitalHumanId = current.selectedDigitalHumanId || (typeof taskContext.digitalHumanId === 'string' ? taskContext.digitalHumanId : undefined);
      const selectedSceneId = current.selectedSceneId || (typeof taskContext.sceneId === 'string' ? taskContext.sceneId : undefined);
      const selectedVoiceId = current.selectedVoiceId || (typeof voiceContext.voiceId === 'string' ? voiceContext.voiceId : undefined);
      const audioUrl = typeof voiceContext.audioUrl === 'string' ? voiceContext.audioUrl : undefined;
      const referenceImageGroupId = typeof taskContext.referenceImageGroupId === 'string' ? taskContext.referenceImageGroupId : '';
      const referenceVideoGroupId = typeof taskContext.referenceVideoGroupId === 'string' ? taskContext.referenceVideoGroupId : '';
      const referenceAudioGroupId = typeof taskContext.referenceAudioGroupId === 'string' ? taskContext.referenceAudioGroupId : '';
      let referenceImageIds = stringArray(taskContext.referenceImageIds);
      const referenceVideoIds = stringArray(taskContext.referenceVideoIds);
      const referenceAudioIds = stringArray(taskContext.referenceAudioIds);
      const originalReferenceImageIds = stringArray(taskContext.originalReferenceImageIds).length
        ? stringArray(taskContext.originalReferenceImageIds)
        : [...referenceImageIds];
      const characterReferenceImageIds = collectCharacterReferenceImageIds({
        prompt: typeof taskContext.userPrompt === 'string' ? taskContext.userPrompt : prompt,
        referenceImageIds: originalReferenceImageIds,
        explicitIds: stringArray(taskContext.characterReferenceImageIds),
      });
      let temporaryCharacterReferenceGroupId = String(taskContext.temporaryCharacterReferenceGroupId || '').trim();
      const videoModelProviderId = typeof taskContext.videoModelProviderId === 'string' ? taskContext.videoModelProviderId : undefined;
      const videoModelId = typeof taskContext.videoModelId === 'string' ? taskContext.videoModelId : undefined;
      const buildMaterialContext = (imageIds: string[]) => resolveVideoMaterialContext({
        userId: current.userId,
        selectedDigitalHumanId,
        selectedSceneId,
        selectedVoiceId,
        audioUrl,
        referenceImageGroupId,
        referenceVideoGroupId,
        referenceAudioGroupId,
        referenceImageIds: imageIds,
        referenceVideoIds,
        referenceAudioIds,
      });
      const enableAnonymizedReferenceVideoRetry = () => {
        taskContext = {
          ...taskContext,
          seedanceAnonymizeReferenceVideos: true,
          currentStep: 'video_generation_reference_video_anonymized',
          updatedAt: new Date().toISOString(),
        };
        contentRepository.updateVideoTaskContext(id, {
          selectedSkillIds: current.selectedSkillIds,
          expertContext: taskContext,
        });
      };
      const submitVideoRequest = async () => callConfiguredVideoModel({
        taskId: id,
        title: current.title,
        prompt,
        negativePrompts: replicationPlan?.negativePrompts
          || (current.editableParseResult.viralAnalysis ? flattenNegativePrompts(current.editableParseResult.viralAnalysis) : []),
        ratio,
        duration,
        audioUrl,
        context: {
          ...taskContext,
          materialContext,
          selectedDigitalHumanId,
          selectedSceneId,
          selectedVoiceId,
          audioUrl,
          allowSeedanceAudioReference: referenceAudioIds.length > 0,
        },
        providerId: videoModelProviderId,
        modelId: videoModelId,
        seedanceOptions: {
          generateAudio: taskContext.generateAudio !== false,
        },
      });
      materialContext = buildMaterialContext(referenceImageIds);
      try {
        providerResult = await submitVideoRequest();
      } catch (error) {
        const rejectedSourceAssetIds = resolveSeedanceRejectedSourceAssetIds({
          message: error instanceof Error ? error.message : String(error || ''),
          originalReferenceImageIds,
          characterReferenceImageIds,
        });
        if (
          isSensitiveRealPersonError(error)
          && rejectedSourceAssetIds.length > 0
          && !temporaryCharacterReferenceGroupId
        ) {
          logger.warn('video generation real person rejection detected, fallback upload started', {
            taskId: id,
            userId: current.userId,
            characterReferenceImageIds,
            rejectedSourceAssetIds,
            referenceImageIds,
          });
          const temporaryReferences = await createTemporaryCharacterReferenceAssets({
            taskId: id,
            userId: current.userId,
            prompt: typeof taskContext.userPrompt === 'string' ? taskContext.userPrompt : prompt,
            referenceImageIds: originalReferenceImageIds,
            characterReferenceImageIds: rejectedSourceAssetIds,
          });
          temporaryCharacterReferenceGroupId = temporaryReferences.groupId;
          referenceImageIds = referenceImageIds.map((assetId) => temporaryReferences.assetIdBySourceId[assetId] || assetId);
          taskContext = {
            ...taskContext,
            referenceImageIds,
            originalReferenceImageIds,
            characterReferenceImageIds: Array.from(new Set([...characterReferenceImageIds, ...rejectedSourceAssetIds])),
            temporaryCharacterReferenceGroupId,
            temporaryCharacterReferenceAssetIds: temporaryReferences.assetIds,
            currentStep: 'video_generation_character_fallback_uploaded',
            updatedAt: new Date().toISOString(),
          };
          contentRepository.updateVideoTaskContext(id, {
            selectedSkillIds: current.selectedSkillIds,
            expertContext: taskContext,
          });
          materialContext = buildMaterialContext(referenceImageIds);
          try {
            providerResult = await submitVideoRequest();
          } catch (retryError) {
            if (
              isSensitiveRealPersonVideoError(retryError)
              && referenceVideoIds.length > 0
              && taskContext.seedanceAnonymizeReferenceVideos !== true
            ) {
              logger.warn('video generation real person video rejection detected after image fallback, anonymized video retry started', {
                taskId: id,
                userId: current.userId,
                referenceVideoIds,
              });
              enableAnonymizedReferenceVideoRetry();
              providerResult = await submitVideoRequest();
            } else {
              throw retryError;
            }
          }
        } else if (
          isSensitiveRealPersonVideoError(error)
          && referenceVideoIds.length > 0
          && taskContext.seedanceAnonymizeReferenceVideos !== true
        ) {
          logger.warn('video generation real person video rejection detected, anonymized video retry started', {
            taskId: id,
            userId: current.userId,
            referenceVideoIds,
          });
          enableAnonymizedReferenceVideoRetry();
          providerResult = await submitVideoRequest();
        } else {
          throw error;
        }
      }
      persistPendingVideoGenerationResult({
        taskId: id,
        providerResult,
        duration,
        ratio,
        sourceType: 'video_generation',
        audioSource: audioUrl ? 'confirmed_audio' : 'silent_fallback',
        usedReplicationPlan: replicationPlan,
      });
    } catch (error) {
      const failureReason = userFacingVideoGenerationError(error);
      if (typeof taskContext.videoBillingReservationId === 'string') {
        releaseReservedFixedBillableUsage(taskContext.videoBillingReservationId);
      }
      logger.error('video generation failed', {
        taskId: id,
        userId: current.userId,
        title: current.title,
        ratio,
        duration,
        promptChars: prompt.length,
        materialContext,
        error: errorLogContext(error),
      });
      await cleanupTemporaryCharacterReferenceGroup({
        groupId: String(taskContext.temporaryCharacterReferenceGroupId || '').trim(),
        userId: current.userId,
      });
      contentRepository.markVideoTaskFailed(id, failureReason);
      const failedResult: VideoGenerationResult = {
        version: 1,
        taskId: id,
        status: 'failed',
        errorMessage: failureReason,
        duration,
        ratio,
        usedReplicationPlan: replicationPlan,
        generatedAt: new Date().toISOString(),
      };
      this.updateVideoParseResult(id, {
        editableParseResult: {
          ...current.editableParseResult,
          videoGenerationResult: failedResult,
        },
        selectedDigitalHumanId: current.selectedDigitalHumanId,
        selectedSceneId: current.selectedSceneId,
        selectedVoiceId: current.selectedVoiceId,
      });
      contentRepository.updateVideoTaskContext(id, {
        selectedSkillIds: current.selectedSkillIds,
        expertContext: {
          ...restorePersistentReferenceImageIds(taskContext),
          videoResult: failedResult,
          videoGenerationResult: failedResult,
          temporaryCharacterReferenceGroupId: '',
          temporaryCharacterReferenceAssetIds: [],
          currentStep: 'video_generation_failed',
          requiredUserAction: 'configure_video_model_or_retry',
          updatedAt: new Date().toISOString(),
        },
      });
      throw error;
    }
    const task = providerResult.videoUrl
      ? contentRepository.markVideoTaskGenerated(id, providerResult.videoUrl)
      : contentRepository.findVideoTask(id);
    if (!task) {
      throw new Error('视频任务不存在');
    }
    const finishedVideoAsset = providerResult.videoUrl
      ? createFinishedVideoAsset({
        userId: current.userId,
        taskId: id,
        title: current.title,
        videoUrl: providerResult.videoUrl,
        provider: providerResult.provider,
        model: providerResult.model,
        ratio,
        duration,
        mode: String(taskContext.mode || 'video_generation'),
        materialContext: materialContext as Record<string, unknown>,
      })
      : undefined;
    const videoGenerationResult: VideoGenerationResult = {
      version: 1,
      taskId: id,
      status: providerResult.status,
      sourceType: 'video_generation',
      provider: providerResult.provider,
      model: providerResult.model,
      jobId: providerResult.jobId,
      videoUrl: providerResult.videoUrl || null,
      coverUrl: providerResult.coverUrl,
      duration,
      ratio,
      usedReplicationPlan: replicationPlan,
      renderMode: 'provider_generation',
      renderStatus: providerResult.status === 'completed' ? 'rendered' : 'queued',
      audioSource: typeof voiceContext.audioUrl === 'string' ? 'confirmed_audio' : 'silent_fallback',
      assetId: finishedVideoAsset?.id,
      generatedAt: new Date().toISOString(),
    };
    const taskWithResult = this.updateVideoParseResult(id, {
      editableParseResult: {
        ...task.editableParseResult,
        videoGenerationResult,
      },
      selectedDigitalHumanId: task.selectedDigitalHumanId,
      selectedSceneId: task.selectedSceneId,
      selectedVoiceId: task.selectedVoiceId,
    });
    const savedTask = contentRepository.updateVideoTaskContext(id, {
      selectedSkillIds: taskWithResult.selectedSkillIds,
      expertContext: {
        ...taskWithResult.expertContext,
        videoResult: videoGenerationResult,
        videoGenerationResult,
        currentStep: providerResult.videoUrl ? 'video_generated' : 'video_generation_submitted',
        requiredUserAction: null,
        updatedAt: new Date().toISOString(),
      },
    });
    if (!savedTask) {
      throw new Error('视频生成结果保存失败');
    }
    if (providerResult.videoUrl) {
      mirrorGeneratedVideoToLocalInBackground({
        taskId: id,
        userId: current.userId,
        remoteVideoUrl: providerResult.videoUrl,
        assetId: finishedVideoAsset?.id,
        provider: providerResult.provider,
        model: providerResult.model,
      });
    }
    if (savedTask.status !== 'generating' && savedTask.expertContext?.temporaryCharacterReferenceGroupId) {
      await cleanupTemporaryCharacterReferenceGroup({
        groupId: String(savedTask.expertContext.temporaryCharacterReferenceGroupId || '').trim(),
        userId: savedTask.userId,
      });
      return clearTemporaryCharacterReferenceContext(savedTask);
    }
    return savedTask;
  },

  async deleteVideoTask(id: string, userId: string) {
    const current = this.getVideoTask(id, userId);
    await cleanupTemporaryCharacterReferenceGroup({
      groupId: String(current.expertContext?.temporaryCharacterReferenceGroupId || '').trim(),
      userId,
    });
    const referencedAssetIds = contentRepository.listAssetIdsForReference('video_generation_task', id);
    const task = contentRepository.deleteVideoTask(id) || current;
    contentRepository.deleteAssetReferences('video_generation_task', id);
    const generatedAssets = contentRepository
      .listAssets({ userId: task.userId, resourceType: 'finished_video' })
      .filter((asset) => asset.metadata.videoTaskId === id);
    await Promise.all(generatedAssets.map(async (asset) => {
      contentRepository.deleteAsset(asset.id);
      await Promise.all(localAssetFilePaths(asset).map((filePath) => rm(filePath, { force: true })));
    }));
    await cleanupReleasedVideoTaskInputs(task, referencedAssetIds);
    return { ok: true };
  },

  renameVideoTask(id: string, payload: { userId: string; title: string }) {
    assertUserId(payload.userId);
    const current = contentRepository.findVideoTask(id);
    if (!current || current.userId !== payload.userId) {
      throw new Error('视频任务不存在');
    }
    const title = String(payload.title || '').trim();
    if (!title) {
      throw new Error('任务名称不能为空');
    }
    const task = contentRepository.renameVideoTask(id, title.slice(0, 80));
    if (!task) {
      throw new Error('视频任务不存在');
    }
    return task;
  },

};

export type ContentService = typeof contentService;
