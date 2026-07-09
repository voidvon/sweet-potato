import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import {
volcengineRealPersonConfig,
volcengineVirtualPortraitConfig
} from '../../../config/env.js';
import { dataDir } from '../../../db/database.js';
import { createTraceId,logger,logToFile } from '../../../shared/logger.js';
import { contentRepository } from '../content.repository.js';
import type {
ContentAsset,
ContentAssetGroup,
ContentResourceType,
CreateAssetPayload,
UpdateAssetPayload
} from '../content.types.js';
import {
isVolcenginePrivateAssetMissingError,
volcenginePrivateAssetClient,
type VolcenginePrivateAssetResult,
type VolcenginePrivateAssetType,
} from '../volcengine-private-asset.client.js';
import {
isVolcengineRealPersonAssetMissingError,
volcengineRealPersonClient,
} from '../volcengine-real-person.client.js';

import { absolutizeMaterialUrl } from './content-voice-clone.js';

export const execFileAsync = promisify(execFile);

export const resourceTypes: ContentResourceType[] = ['digital_human', 'virtual_portrait', 'voice', 'scene', 'product', 'finished_video', 'real_person', 'other'];

export const contentFilesDir = path.join(dataDir, 'files');

export const threeViewImageSize = '2048x2048';

export const mimoVoiceCloneProviderId = 'mimo-v2.5-tts-voiceclone';

export const realPersonValidationExpiresInSeconds = 120;

export const virtualPortraitRemoteSyncCooldownMs = 30 * 1000;

export const realPersonCallbackPath = '/api/content/real-person/callback';

export type RealPersonAssetFile = {
  originalFileName: string;
  storedFileName: string;
  mimeType: string;
  fileSize: number;
  filePath: string;
  fileUrl: string;
  publicFileUrl?: string;
};

export type UploadedAssetFile = RealPersonAssetFile;

mkdirSync(contentFilesDir, { recursive: true });

export type GeneratedMediaKind = 'image' | 'video';
export type InputMediaKind = 'image' | 'video' | 'audio';

export function generatedMediaMonth(now = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}${month}`;
}

function generatedMediaDirectoryName(kind: GeneratedMediaKind) {
  return kind === 'image' ? 'generated_images' : 'generated_videos';
}

function inputMediaDirectoryName(kind: InputMediaKind) {
  if (kind === 'image') {
    return 'input_images';
  }
  if (kind === 'video') {
    return 'input_videos';
  }
  return 'input_audios';
}

export function generatedMediaRelativePath(kind: GeneratedMediaKind, fileName: string, now = new Date()) {
  return path.posix.join(generatedMediaDirectoryName(kind), generatedMediaMonth(now), fileName);
}

export function inputMediaRelativePath(kind: InputMediaKind, fileName: string, now = new Date()) {
  return path.posix.join(inputMediaDirectoryName(kind), generatedMediaMonth(now), fileName);
}

export function inputMediaKindForMimeType(mimeType: string): InputMediaKind | null {
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

export function fileUrlForContentRelativePath(relativePath: string) {
  return `/files/${relativePath.split('/').map((part) => encodeURIComponent(part)).join('/')}`;
}

export function contentFilePathForRelativePath(relativePath: string) {
  return path.join(contentFilesDir, ...relativePath.split('/').filter(Boolean));
}

export function resolveLocalContentFilePathFromUrl(value: string) {
  const rawPath = value.trim();
  if (!rawPath.startsWith('/files/')) {
    return '';
  }
  const relativePath = rawPath.slice('/files/'.length).split(/[?#]/u)[0] || '';
  const parts = relativePath.split('/').map((part) => decodeURIComponent(part)).filter(Boolean);
  if (!parts.length || parts.some((part) => part === '..' || part.includes('\\'))) {
    return '';
  }
  return path.join(contentFilesDir, ...parts);
}

export function virtualPortraitLogFile(now = new Date()) {
  const iso = now.toISOString();
  return `virtual-portrait-assets/${iso.slice(0, 10)}/${iso.slice(11, 13)}.log`;
}

export function logVirtualPortraitAsset(
  level: Parameters<typeof logToFile>[1],
  message: string,
  context?: Record<string, unknown>,
) {
  logToFile(virtualPortraitLogFile(), level, message, context);
}

export async function sha256File(filePath: string) {
  return createHash('sha256').update(await readFile(filePath)).digest('hex');
}

export function assertUserId(userId: string) {
  if (!userId?.trim()) {
    throw new Error('缺少用户信息');
  }
}

export function isResourceType(value: string): value is ContentResourceType {
  return resourceTypes.includes(value as ContentResourceType);
}

export function normalizeMetadata(value: unknown) {
  if (!value) {
    return {};
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      throw new Error('metadata 必须是合法 JSON');
    }
  }
  return typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function normalizeJsonObject(value: unknown, fieldName: string): Record<string, unknown> {
  if (!value) {
    return {};
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    } catch {
      throw new Error(`${fieldName} 必须是合法 JSON`);
    }
  }
  return typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function normalizeSelectedSkillIds(value: unknown): string[] {
  if (!value) {
    return [];
  }
  const items = Array.isArray(value) ? value : String(value).split(',');
  return Array.from(new Set(items
    .map((item) => String(item).trim())
    .filter(Boolean)));
}

export function createContentAssetRecord(payload: CreateAssetPayload) {
  assertUserId(payload.userId);
  if (!payload.groupId) {
    throw new Error('请选择素材分组');
  }
  const group = contentRepository.findGroup(payload.groupId);
  if (!group) {
    throw new Error('素材分组不存在');
  }
  if (group.userId !== payload.userId) {
    throw new Error('素材分组不存在');
  }
  if (!isResourceType(payload.resourceType)) {
    throw new Error('素材类型不存在');
  }
  if (group.resourceType !== payload.resourceType) {
    throw new Error('素材类型与当前集合不匹配');
  }
  if (!payload.name?.trim()) {
    throw new Error('请输入素材名称');
  }
  return contentRepository.createAsset({
    ...payload,
    metadata: normalizeMetadata(payload.metadata),
  });
}

export function errorLogContext(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  return { message: String(error) };
}

export function stringMetadataField(metadata: Record<string, unknown>, fieldName: string) {
  const value = metadata[fieldName];
  return typeof value === 'string' ? value.trim() : '';
}

export function nestedStringMetadataField(metadata: Record<string, unknown>, objectName: string, fieldName: string) {
  const value = metadata[objectName];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return '';
  }
  const nested = value as Record<string, unknown>;
  const fieldValue = nested[fieldName];
  return typeof fieldValue === 'string' ? fieldValue.trim() : '';
}

export function realPersonProjectName(metadata: Record<string, unknown>) {
  return stringMetadataField(metadata, 'projectName') || volcengineRealPersonConfig.projectName;
}

export function realPersonVolcGroupId(metadata: Record<string, unknown>) {
  return stringMetadataField(metadata, 'volcGroupId');
}

export function realPersonVolcAssetId(metadata: Record<string, unknown>) {
  return stringMetadataField(metadata, 'volcAssetId');
}

export function realPersonBytedToken(metadata: Record<string, unknown>) {
  return nestedStringMetadataField(metadata, 'validationSession', 'bytedToken')
    || stringMetadataField(metadata, 'bytedToken');
}

export function buildRealPersonCallbackUrl(input: { userId: string; groupId: string; bytedToken?: string }) {
  if (!volcengineRealPersonConfig.callbackBaseUrl) {
    throw new Error('缺少火山真人认证回调地址配置：请配置 VOLC_REAL_PERSON_CALLBACK_BASE_URL');
  }
  let url: URL;
  try {
    url = new URL(volcengineRealPersonConfig.callbackBaseUrl);
  } catch {
    throw new Error('火山真人认证回调地址配置不合法：VOLC_REAL_PERSON_CALLBACK_BASE_URL 必须是可访问 URL');
  }
  const normalizedPath = url.pathname.replace(/\/+$/, '');
  if (!normalizedPath.endsWith('/real-person/callback')) {
    url.pathname = `${normalizedPath}${realPersonCallbackPath}`.replace(/\/{2,}/g, '/');
  }
  url.searchParams.set('userId', input.userId);
  url.searchParams.set('groupId', input.groupId);
  if (input.bytedToken) {
    url.searchParams.set('bytedToken', input.bytedToken);
  }
  return url.toString();
}

export function assertRealPersonGroupAccess(group: { userId: string; resourceType: ContentResourceType }, userId: string) {
  if (group.userId !== userId) {
    throw new Error('无权操作该真人素材分组');
  }
  if (group.resourceType !== 'real_person') {
    throw new Error('当前分组不是真人素材分组');
  }
}

export function assertHttpAssetUrl(url: string) {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error();
    }
  } catch {
    throw new Error('请输入合法的素材 URL');
  }
}

export function inferRealPersonAssetType(input: { mimeType?: string; url?: string }) {
  const probe = `${input.mimeType || ''} ${input.url || ''}`;
  if (/image\/|\.avif($|\?)|\.jpe?g($|\?)|\.png($|\?)|\.webp($|\?)/i.test(probe)) {
    return 'Image' as const;
  }
  if (/video\/|\.mp4($|\?)|\.mov($|\?)|\.webm($|\?)/i.test(probe)) {
    return 'Video' as const;
  }
  if (/audio\/|\.mp3($|\?)|\.wav($|\?)|\.m4a($|\?)/i.test(probe)) {
    return 'Audio' as const;
  }
  throw new Error('真人素材仅支持图片、视频或音频文件');
}

export function inferPrivateAssetType(input: { mimeType?: string; url?: string }): VolcenginePrivateAssetType {
  const probe = `${input.mimeType || ''} ${input.url || ''}`;
  if (/image\/|\.avif($|\?)|\.jpe?g($|\?)|\.png($|\?)|\.webp($|\?)/i.test(probe)) {
    return 'Image';
  }
  if (/video\/|\.mp4($|\?)|\.mov($|\?)|\.webm($|\?)/i.test(probe)) {
    return 'Video';
  }
  if (/audio\/|\.mp3($|\?)|\.wav($|\?)|\.m4a($|\?)/i.test(probe)) {
    return 'Audio';
  }
  throw new Error('人物素材仅支持图片、视频或音频文件');
}

export function originalNameFromUrl(url: string) {
  try {
    const parsed = new URL(url);
    return decodeURIComponent(path.basename(parsed.pathname)) || 'real-person-asset';
  } catch {
    return 'real-person-asset';
  }
}

export function realPersonAssetUri(assetId: string) {
  return assetId ? `asset://${assetId}` : '';
}

export function privateAssetProjectName(metadata: Record<string, unknown>) {
  return stringMetadataField(metadata, 'projectName') || volcengineVirtualPortraitConfig.projectName;
}

export function privateAssetGroupId(metadata: Record<string, unknown>) {
  return stringMetadataField(metadata, 'volcAssetGroupId') || stringMetadataField(metadata, 'volcGroupId');
}

export function privateAssetId(metadata: Record<string, unknown>) {
  return stringMetadataField(metadata, 'volcAssetId');
}

export function privateAssetUri(assetId: string) {
  return assetId ? `asset://${assetId}` : '';
}

export function assertVirtualPortraitGroupAccess(group: { userId: string; resourceType: ContentResourceType }, userId: string) {
  if (group.userId !== userId) {
    throw new Error('无权操作该人物素材分组');
  }
  if (group.resourceType !== 'virtual_portrait') {
    throw new Error('当前分组不是人物素材分组');
  }
}

export function realPersonCallbackResult(query: Record<string, unknown>, receivedAt: string) {
  return {
    resultCode: String(query.resultCode || '').trim(),
    algorithmBaseRespCode: String(query.algorithmBaseRespCode || '').trim(),
    reqMeasureInfoValue: String(query.reqMeasureInfoValue || '').trim(),
    bytedToken: String(query.bytedToken || query.BytedToken || '').trim(),
    verifyType: String(query.verify_type || query.verifyType || '').trim(),
    raw: query,
    receivedAt,
  };
}

export async function deleteRemoteRealPersonAsset(asset: ContentAsset) {
  if (asset.resourceType !== 'real_person') {
    return;
  }
  const assetId = realPersonVolcAssetId(asset.metadata);
  if (!assetId) {
    return;
  }
  try {
    await volcengineRealPersonClient.deleteAsset({
      assetId,
      projectName: realPersonProjectName(asset.metadata),
    });
  } catch (error) {
    if (isVolcengineRealPersonAssetMissingError(error)) {
      logger.warn('remote real person asset already missing, continue local delete', {
        assetId,
        localAssetId: asset.id,
        error: errorLogContext(error),
      });
      return;
    }
    throw error;
  }
}

export async function deleteRemoteVirtualPortraitAsset(asset: ContentAsset) {
  if (asset.resourceType !== 'virtual_portrait') {
    return;
  }
  const assetId = privateAssetId(asset.metadata);
  if (!assetId) {
    return;
  }
  const traceId = createTraceId('virtual-portrait-delete-asset');
  logVirtualPortraitAsset('info', 'remote virtual portrait asset delete started', {
    traceId,
    assetId,
    localAssetId: asset.id,
    groupId: asset.groupId,
    projectName: privateAssetProjectName(asset.metadata),
  });
  try {
    await volcenginePrivateAssetClient.deleteAsset({
      assetId,
      projectName: privateAssetProjectName(asset.metadata),
    });
    logVirtualPortraitAsset('info', 'remote virtual portrait asset delete completed', {
      traceId,
      assetId,
      localAssetId: asset.id,
    });
  } catch (error) {
    if (isVolcenginePrivateAssetMissingError(error)) {
      logger.warn('remote virtual portrait asset already missing, continue local delete', {
        assetId,
        localAssetId: asset.id,
        error: errorLogContext(error),
      });
      logVirtualPortraitAsset('warn', 'remote virtual portrait asset already missing, continue local delete', {
        traceId,
        assetId,
        localAssetId: asset.id,
        error: errorLogContext(error),
      });
      return;
    }
    logVirtualPortraitAsset('error', 'remote virtual portrait asset delete failed', {
      traceId,
      assetId,
      localAssetId: asset.id,
      error: errorLogContext(error),
    });
    throw error;
  }
}

export async function deleteRemoteVirtualPortraitGroup(group: { id: string; resourceType: ContentResourceType; metadata: Record<string, unknown> }) {
  if (group.resourceType !== 'virtual_portrait') {
    return;
  }
  const groupId = privateAssetGroupId(group.metadata);
  if (!groupId) {
    return;
  }
  const traceId = createTraceId('virtual-portrait-delete-group');
  logVirtualPortraitAsset('info', 'remote virtual portrait asset group delete started', {
    traceId,
    remoteGroupId: groupId,
    localGroupId: group.id,
    projectName: privateAssetProjectName(group.metadata),
  });
  try {
    await volcenginePrivateAssetClient.deleteAssetGroup({
      groupId,
      projectName: privateAssetProjectName(group.metadata),
    });
    logVirtualPortraitAsset('info', 'remote virtual portrait asset group delete completed', {
      traceId,
      remoteGroupId: groupId,
      localGroupId: group.id,
    });
  } catch (error) {
    if (isVolcenginePrivateAssetMissingError(error)) {
      logger.warn('remote virtual portrait asset group already missing, continue local delete', {
        groupId,
        localGroupId: group.id,
        error: errorLogContext(error),
      });
      logVirtualPortraitAsset('warn', 'remote virtual portrait asset group already missing, continue local delete', {
        traceId,
        remoteGroupId: groupId,
        localGroupId: group.id,
        error: errorLogContext(error),
      });
      return;
    }
    logVirtualPortraitAsset('error', 'remote virtual portrait asset group delete failed', {
      traceId,
      remoteGroupId: groupId,
      localGroupId: group.id,
      error: errorLogContext(error),
    });
    throw error;
  }
}

export function remoteAssetName(asset: VolcenginePrivateAssetResult) {
  return stringMetadataField(asset as Record<string, unknown>, 'Name')
    || stringMetadataField(asset as Record<string, unknown>, 'Id')
    || '人物素材';
}

export function remoteAssetMimeType(asset: VolcenginePrivateAssetResult) {
  const assetType = String(asset.AssetType || '').toLowerCase();
  if (assetType === 'video') {
    return 'video/mp4';
  }
  if (assetType === 'audio') {
    return 'audio/mpeg';
  }
  return 'image/*';
}

export function virtualPortraitGroupSource(group?: ContentAssetGroup) {
  if (!group) {
    return 'local_upload';
  }
  if (stringMetadataField(group.metadata, 'source') === 'ai_generate') {
    return 'ai_generate';
  }
  const assets = contentRepository.listAssets({
    userId: group.userId,
    groupId: group.id,
    resourceType: 'virtual_portrait',
  });
  return assets.some((asset) => stringMetadataField(asset.metadata, 'source') === 'ai_generate' || asset.metadata.kind === 'training_photo')
    ? 'ai_generate'
    : 'local_upload';
}

export function virtualPortraitAssetSource(existing?: ContentAsset) {
  return stringMetadataField(existing?.metadata || {}, 'source') === 'ai_generate'
    ? 'ai_generate'
    : 'local_upload';
}

export function virtualPortraitUpdateAssetUrl(payload: UpdateAssetPayload, current: ContentAsset) {
  const metadata = normalizeMetadata(payload.metadata);
  const raw = String(
    payload.url
    || payload.fileUrl
    || metadata.url
    || metadata.remoteSourceUrl
    || metadata.fileUrl
    || '',
  ).trim();
  if (!raw) {
    return '';
  }
  return absolutizeMaterialUrl(raw) || raw;
}

export function virtualPortraitAssetMetadataFromRemote(input: {
  group: ContentAssetGroup;
  remote: VolcenginePrivateAssetResult;
  existing?: ContentAsset;
  syncedAt: string;
}) {
  const remoteAssetId = stringMetadataField(input.remote as Record<string, unknown>, 'Id')
    || privateAssetId(input.existing?.metadata || {});
  const remoteUrl = stringMetadataField(input.remote as Record<string, unknown>, 'URL');
  const status = stringMetadataField(input.remote as Record<string, unknown>, 'Status') || 'Active';
  return {
    ...(input.existing?.metadata || {}),
    version: 1,
    kind: input.existing?.metadata.kind || 'three_view_result',
    source: virtualPortraitAssetSource(input.existing),
    provider: 'volcengine_ark_private_asset',
    projectName: stringMetadataField(input.remote as Record<string, unknown>, 'ProjectName') || privateAssetProjectName(input.group.metadata),
    volcAssetGroupId: privateAssetGroupId(input.group.metadata),
    volcAssetId: remoteAssetId,
    assetUri: privateAssetUri(remoteAssetId),
    volcStatus: status,
    remoteSourceUrl: remoteUrl || stringMetadataField(input.existing?.metadata || {}, 'remoteSourceUrl'),
    remotePreviewUrl: remoteUrl || stringMetadataField(input.existing?.metadata || {}, 'remotePreviewUrl'),
    failureReason: failureReasonOfPrivateAsset(input.remote),
    getAssetRaw: input.remote,
    syncedAt: input.syncedAt,
    updatedAt: input.syncedAt,
  };
}

export function failureReasonOfPrivateAsset(asset: VolcenginePrivateAssetResult) {
  return [asset.Error?.Code, asset.Error?.Message].filter(Boolean).join('：');
}

function parseIsoTime(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) {
    return 0;
  }
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? ts : 0;
}

function shouldSkipRemoteSync(lastSyncedAt: unknown, cooldownMs = virtualPortraitRemoteSyncCooldownMs) {
  const lastTs = parseIsoTime(lastSyncedAt);
  return lastTs > 0 && (Date.now() - lastTs) < cooldownMs;
}

export async function refreshVirtualPortraitGroupFromRemote(group: ContentAssetGroup) {
  if (group.resourceType !== 'virtual_portrait') {
    return group;
  }
  const remoteGroupId = privateAssetGroupId(group.metadata);
  if (!remoteGroupId) {
    return group;
  }
  if (shouldSkipRemoteSync(group.metadata.remoteSyncedAt)) {
    return group;
  }
  try {
    const remote = await volcenginePrivateAssetClient.getAssetGroup({
      groupId: remoteGroupId,
      projectName: privateAssetProjectName(group.metadata),
    });
    const syncedAt = new Date().toISOString();
    return contentRepository.updateGroup(group.id, {
      name: stringMetadataField(remote.group as Record<string, unknown>, 'Name') || group.name,
      description: stringMetadataField(remote.group as Record<string, unknown>, 'Description') || group.description,
      metadata: {
        ...group.metadata,
        provider: 'volcengine_ark_private_asset',
        projectName: remote.projectName,
        volcAssetGroupId: remoteGroupId,
        getAssetGroupRaw: remote.raw,
        remoteSyncedAt: syncedAt,
        updatedAt: syncedAt,
      },
    }) || group;
  } catch (error) {
    if (isVolcenginePrivateAssetMissingError(error)) {
      const syncedAt = new Date().toISOString();
      return contentRepository.updateGroup(group.id, {
        metadata: {
          ...group.metadata,
          remoteStatus: 'Deleted',
          failureReason: error instanceof Error ? error.message : String(error),
          remoteSyncedAt: syncedAt,
          updatedAt: syncedAt,
        },
      }) || group;
    }
    throw error;
  }
}

export function remoteAssetGroupId(group: Record<string, unknown>) {
  return stringMetadataField(group, 'Id') || stringMetadataField(group, 'GroupId');
}

export function remoteAssetGroupName(group: Record<string, unknown>) {
  return stringMetadataField(group, 'Name') || remoteAssetGroupId(group) || '人物素材';
}

export async function upsertVirtualPortraitRemoteGroup(input: {
  userId: string;
  remoteGroup: Record<string, unknown>;
  existing?: ContentAssetGroup;
  syncedAt: string;
}) {
  const remoteGroupId = remoteAssetGroupId(input.remoteGroup);
  if (!remoteGroupId) {
    return input.existing || null;
  }
  const existingById = contentRepository.findGroup(remoteGroupId) || undefined;
  const existing = input.existing
    || (existingById?.userId === input.userId && existingById.resourceType === 'virtual_portrait' ? existingById : undefined);
  const metadata = {
    ...(existing?.metadata || {}),
    version: 1,
    kind: 'virtual_portrait_profile',
    source: virtualPortraitGroupSource(existing),
    provider: 'volcengine_ark_private_asset',
    projectName: stringMetadataField(input.remoteGroup, 'ProjectName') || volcengineVirtualPortraitConfig.projectName,
    volcAssetGroupId: remoteGroupId,
    remoteStatus: 'Active',
    listAssetGroupRaw: input.remoteGroup,
    remoteSyncedAt: input.syncedAt,
    updatedAt: input.syncedAt,
  };
  if (existing?.userId === input.userId && existing.resourceType === 'virtual_portrait') {
    return contentRepository.updateGroup(existing.id, {
      name: remoteAssetGroupName(input.remoteGroup),
      description: stringMetadataField(input.remoteGroup, 'Description') || existing.description,
      metadata,
    }) || existing;
  }
  if (existingById) {
    logger.warn('create virtual portrait remote group with generated local id because remote id is already used', {
      userId: input.userId,
      existingUserId: existingById.userId,
      existingResourceType: existingById.resourceType,
      remoteGroupId,
    });
  }
  return contentRepository.createGroup({
    id: existingById ? undefined : remoteGroupId,
    userId: input.userId,
    resourceType: 'virtual_portrait',
    name: remoteAssetGroupName(input.remoteGroup),
    description: stringMetadataField(input.remoteGroup, 'Description'),
    metadata: {
      ...metadata,
      createdAt: input.syncedAt,
    },
  });
}

export async function refreshVirtualPortraitGroupsForUser(userId: string) {
  const localGroups = contentRepository.listGroups({ userId, resourceType: 'virtual_portrait' });
  return Promise.all(localGroups.map(refreshVirtualPortraitGroupFromRemote));
}

export async function refreshVirtualPortraitAssetsForGroup(
  group: ContentAssetGroup,
  options: { force?: boolean } = {},
) {
  if (group.resourceType !== 'virtual_portrait') {
    return contentRepository.listAssets({ userId: group.userId, groupId: group.id });
  }
  const remoteGroupId = privateAssetGroupId(group.metadata);
  if (!remoteGroupId) {
    return contentRepository.listAssets({
      userId: group.userId,
      groupId: group.id,
      resourceType: 'virtual_portrait',
    });
  }
  if (!options.force && shouldSkipRemoteSync(group.metadata.assetsSyncedAt)) {
    return contentRepository.listAssets({
      userId: group.userId,
      groupId: group.id,
      resourceType: 'virtual_portrait',
    });
  }
  const remoteAssets = await listVirtualPortraitRemoteAssets(group);
  if (!remoteAssets) {
    return contentRepository.listAssets({
      userId: group.userId,
      groupId: group.id,
      resourceType: 'virtual_portrait',
    });
  }
  const localAssets = contentRepository.listAssets({
    userId: group.userId,
    groupId: group.id,
    resourceType: 'virtual_portrait',
  });
  const localByRemoteId = new Map(localAssets
    .map((asset) => [privateAssetId(asset.metadata), asset] as const)
    .filter(([assetId]) => Boolean(assetId)));
  const syncedAt = new Date().toISOString();
  for (const remoteAsset of remoteAssets.assets) {
    const remoteAssetId = stringMetadataField(remoteAsset as Record<string, unknown>, 'Id');
    if (!remoteAssetId) {
      continue;
    }
    const existing = localByRemoteId.get(remoteAssetId);
    const remoteUrl = stringMetadataField(remoteAsset as Record<string, unknown>, 'URL');
    const name = remoteAssetName(remoteAsset);
    const metadata = virtualPortraitAssetMetadataFromRemote({
      group,
      remote: remoteAsset,
      existing,
      syncedAt,
    });
    if (existing) {
      contentRepository.updateAssetFileInfo(existing.id, {
        fileUrl: existing.fileUrl,
        originalFileName: existing.originalFileName,
        mimeType: remoteAssetMimeType(remoteAsset),
        name,
        metadata,
      });
      continue;
    }
    contentRepository.createAsset({
      userId: group.userId,
      groupId: group.id,
      resourceType: 'virtual_portrait',
      name,
      description: '从火山私域人物素材资产库同步',
      originalFileName: remoteUrl ? originalNameFromUrl(remoteUrl) : `${remoteAssetId}.asset`,
      storedFileName: '',
      mimeType: remoteAssetMimeType(remoteAsset),
      fileSize: 0,
      filePath: '',
      fileUrl: remoteUrl,
      metadata,
    });
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
  return contentRepository.listAssets({
    userId: group.userId,
    groupId: group.id,
    resourceType: 'virtual_portrait',
  });
}

export async function listVirtualPortraitRemoteAssets(group: ContentAssetGroup, pageSize = 100) {
  if (group.resourceType !== 'virtual_portrait') {
    return null;
  }
  const remoteGroupId = privateAssetGroupId(group.metadata);
  if (!remoteGroupId) {
    return null;
  }
  const projectName = privateAssetProjectName(group.metadata);
  const pages: Array<{ raw: unknown; assets: VolcenginePrivateAssetResult[] }> = [];
  let pageNumber = 1;
  while (true) {
    const remote = await volcenginePrivateAssetClient.listAssets({
      groupId: remoteGroupId,
      projectName,
      pageNumber,
      pageSize,
    });
    pages.push({
      raw: remote.raw,
      assets: remote.assets,
    });
    if (remote.assets.length < pageSize) {
      break;
    }
    pageNumber += 1;
  }
  return {
    remoteGroupId,
    projectName,
    assets: pages.flatMap((page) => page.assets),
    raw: {
      pageSize,
      pageCount: pages.length,
      pages: pages.map((page) => page.raw),
    },
  };
}

export async function refreshVirtualPortraitAssetFromRemote(asset: ContentAsset) {
  if (asset.resourceType !== 'virtual_portrait') {
    return asset;
  }
  const assetId = privateAssetId(asset.metadata);
  if (!assetId) {
    return asset;
  }
  if (shouldSkipRemoteSync(asset.metadata.syncedAt)) {
    return asset;
  }
  const group = contentRepository.findGroup(asset.groupId);
  if (!group) {
    return asset;
  }
  const remote = await volcenginePrivateAssetClient.getAsset({
    assetId,
    projectName: privateAssetProjectName(asset.metadata),
  });
  const syncedAt = new Date().toISOString();
  return contentRepository.updateAssetFileInfo(asset.id, {
    fileUrl: asset.fileUrl,
    originalFileName: asset.originalFileName,
    mimeType: remoteAssetMimeType(remote.asset),
    name: remote.asset.Name || asset.name,
    metadata: {
      ...asset.metadata,
      projectName: remote.projectName,
      volcAssetId: remote.assetId,
      assetUri: privateAssetUri(remote.assetId),
      volcStatus: remote.status,
      remotePreviewUrl: remote.url || asset.metadata.remotePreviewUrl,
      failureReason: remote.failureReason,
      getAssetRaw: remote.raw,
      syncedAt,
      updatedAt: syncedAt,
    },
  }) || asset;
}

export async function ensureVirtualPortraitRemoteGroup(group: ContentAssetGroup) {
  const existingRemoteGroupId = privateAssetGroupId(group.metadata);
  if (existingRemoteGroupId) {
    return {
      remoteGroupId: existingRemoteGroupId,
      projectName: privateAssetProjectName(group.metadata),
    };
  }
  const traceId = createTraceId('virtual-portrait-create-group');
  logVirtualPortraitAsset('info', 'virtual portrait remote group create started', {
    traceId,
    userId: group.userId,
    localGroupId: group.id,
    name: group.name,
    projectName: privateAssetProjectName(group.metadata),
    source: group.metadata.source,
  });
  const remote = await volcenginePrivateAssetClient.createAssetGroup({
    name: group.name,
    description: group.description,
    projectName: privateAssetProjectName(group.metadata),
  });
  const now = new Date().toISOString();
  contentRepository.updateGroup(group.id, {
    metadata: {
      ...group.metadata,
      provider: 'volcengine_ark_private_asset',
      projectName: remote.projectName,
      volcAssetGroupId: remote.groupId,
      createAssetGroupRaw: remote.raw,
      remoteStatus: 'Active',
      remoteCreatedAt: now,
      updatedAt: now,
    },
  });
  logVirtualPortraitAsset('info', 'virtual portrait remote group create completed', {
    traceId,
    userId: group.userId,
    localGroupId: group.id,
    remoteGroupId: remote.groupId,
    projectName: remote.projectName,
  });
  return {
    remoteGroupId: remote.groupId,
    projectName: remote.projectName,
  };
}
