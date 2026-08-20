import type {
  ContentAsset,
  ContentAssetGroup,
  ContentAssetResourceType,
  MarketingVideoStoryboard,
  VideoGenerationTask,
  PaginatedResult,
} from '../../types';
import { request } from '../request';
import { t } from '@shared/i18n';

enum Api {
  realPersonValidationSession = '/api/content/real-person/validation-session',
  realPersonValidationResult = '/api/content/real-person/validation-result',
  groups = '/api/content/asset-groups',
  assets = '/api/content/assets',
  uploadAsset = '/api/content/assets/upload',
  prepareDirectUpload = '/api/content/assets/direct-upload/prepare',
  completeDirectUpload = '/api/content/assets/direct-upload/complete',
  referenceVideo = '/api/content/reference-video',
  trimReferenceVideo = '/api/content/reference-video/trim',
  videoTasks = '/api/content/video-tasks',
  videoProductions = '/api/content/video-productions',
  marketingVideoStoryboards = '/api/content/marketing-video-storyboards',
  videoEnhancements = '/api/content/video-enhancements',
  subtitleRemovals = '/api/content/subtitle-removals',
  videoTranslations = '/api/content/video-translations',
}

export type TrimReferenceVideoResult = {
  assetId: string;
  duration: number;
  end: number;
  fileUrl: string;
  name: string;
  originalFileName: string;
  start: number;
  storedFileName: string;
};

const groupPageRequests = new Map<string, Promise<PaginatedResult<ContentAssetGroup>>>();

export type RealPersonValidationSessionResult = {
  group: ContentAssetGroup;
  h5Link?: string;
  H5Link?: string;
  validationUrl?: string;
  expiresInSeconds?: number;
  bytedToken?: string;
};

export type RealPersonValidationResultResponse = ContentAssetGroup | {
  group: ContentAssetGroup;
};

export function listContentAssetGroups(userId: string, resourceType?: ContentAssetResourceType) {
  void userId;
  const params = new URLSearchParams();
  if (resourceType) {
    params.set('resourceType', resourceType);
  }
  return request<ContentAssetGroup[]>(`${Api.groups}?${params.toString()}`);
}

export function listContentAssetGroupsPage(input: {
  userId: string;
  resourceType?: ContentAssetResourceType;
  page: number;
  pageSize: number;
}) {
  void input.userId;
  const params = new URLSearchParams({
    page: String(input.page),
    pageSize: String(input.pageSize),
  });
  if (input.resourceType) {
    params.set('resourceType', input.resourceType);
  }
  const url = `${Api.groups}?${params.toString()}`;
  const pendingRequest = groupPageRequests.get(url);
  if (pendingRequest) {
    return pendingRequest;
  }
  const nextRequest = request<PaginatedResult<ContentAssetGroup>>(url).finally(() => {
    groupPageRequests.delete(url);
  });
  groupPageRequests.set(url, nextRequest);
  return nextRequest;
}

export function createContentAssetGroup(payload: { userId: string; resourceType: ContentAssetResourceType; name: string; description?: string; metadata?: Record<string, unknown> }) {
  const { userId: _userId, ...requestPayload } = payload;
  return request<ContentAssetGroup>(Api.groups, {
    method: 'POST',
    body: JSON.stringify(requestPayload),
  });
}

export function updateContentAssetGroup(id: string, payload: { name?: string; description?: string; metadata?: Record<string, unknown> }) {
  return request<ContentAssetGroup>(`${Api.groups}/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function deleteContentAssetGroup(id: string) {
  return request<{ ok: boolean }>(`${Api.groups}/${id}`, { method: 'DELETE' });
}

export function createRealPersonValidationSession(payload: {
  userId: string;
  name: string;
  description?: string;
}) {
  const { userId: _userId, ...requestPayload } = payload;
  return request<RealPersonValidationSessionResult>(Api.realPersonValidationSession, {
    method: 'POST',
    body: JSON.stringify(requestPayload),
  });
}

export function getRealPersonValidationResult(payload: {
  userId: string;
  groupId: string;
  bytedToken?: string;
}) {
  const { userId: _userId, ...requestPayload } = payload;
  return request<RealPersonValidationResultResponse>(Api.realPersonValidationResult, {
    method: 'POST',
    body: JSON.stringify(requestPayload),
  });
}

export function generateDigitalHumanThreeView(groupId: string, payload: { userId: string }) {
  const { userId: _userId } = payload;
  return request<ContentAsset>(`${Api.groups}/${groupId}/digital-human/three-view`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export function generateVirtualPortraitThreeView(groupId: string, payload: { userId: string }) {
  const { userId: _userId } = payload;
  return request<ContentAsset>(`${Api.groups}/${groupId}/virtual-portrait/three-view`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export function startVoiceClone(groupId: string, payload: { userId: string; sampleAssetId?: string }) {
  const { userId: _userId, ...requestPayload } = payload;
  return request<ContentAssetGroup>(`${Api.groups}/${groupId}/voice/clone`, {
    method: 'POST',
    body: JSON.stringify(requestPayload),
  });
}

export function listContentAssets(input: { userId: string; groupId?: string; resourceType?: ContentAssetResourceType }) {
  void input.userId;
  const params = new URLSearchParams();
  if (input.groupId) {
    params.set('groupId', input.groupId);
  }
  if (input.resourceType) {
    params.set('resourceType', input.resourceType);
  }
  return request<ContentAsset[]>(`${Api.assets}?${params.toString()}`);
}

export function listContentAssetsPage(input: {
  userId: string;
  groupId?: string;
  resourceType?: ContentAssetResourceType;
  page: number;
  pageSize: number;
}) {
  void input.userId;
  const params = new URLSearchParams({
    page: String(input.page),
    pageSize: String(input.pageSize),
  });
  if (input.groupId) {
    params.set('groupId', input.groupId);
  }
  if (input.resourceType) {
    params.set('resourceType', input.resourceType);
  }
  return request<PaginatedResult<ContentAsset>>(`${Api.assets}?${params.toString()}`);
}

export function uploadContentAsset(payload: {
  file: File;
  userId: string;
  groupId?: string;
  resourceType: ContentAssetResourceType;
  name: string;
  description?: string;
  metadata?: Record<string, unknown>;
}) {
  const { userId: _userId, ...requestPayload } = payload;
  const formData = new FormData();
  formData.set('file', requestPayload.file);
  if (requestPayload.groupId) {
    formData.set('groupId', requestPayload.groupId);
  }
  formData.set('resourceType', requestPayload.resourceType);
  formData.set('name', requestPayload.name);
  formData.set('description', requestPayload.description || '');
  formData.set('metadata', JSON.stringify(requestPayload.metadata || {}));
  return request<ContentAsset>(Api.uploadAsset, {
    method: 'POST',
    body: formData,
  });
}

type PrepareDirectUploadResult = {
  directUpload: false;
} | {
  directUpload: true;
  intentId: string;
  uploadUrl: string;
  headers: Record<string, string>;
  expiresAt: string;
};

export async function uploadContentAssetDirect(payload: {
  file: File;
  userId: string;
  groupId: string;
  resourceType: ContentAssetResourceType;
  name: string;
  description?: string;
  metadata?: Record<string, unknown>;
}) {
  const prepared = await request<PrepareDirectUploadResult>(Api.prepareDirectUpload, {
    method: 'POST',
    body: JSON.stringify({
      groupId: payload.groupId,
      resourceType: payload.resourceType,
      name: payload.name,
      description: payload.description || '',
      originalFileName: payload.file.name,
      mimeType: payload.file.type || 'application/octet-stream',
      fileSize: payload.file.size,
      metadata: payload.metadata || {},
    }),
  });
  if (!prepared.directUpload) {
    return uploadContentAsset(payload);
  }

  const uploadResponse = await fetch(prepared.uploadUrl, {
    method: 'PUT',
    headers: prepared.headers,
    body: payload.file,
  });
  if (!uploadResponse.ok) {
    throw new Error(t("文件上传到对象存储失败（{{0}}）", { "0": uploadResponse.status }));
  }
  return request<ContentAsset>(Api.completeDirectUpload, {
    method: 'POST',
    body: JSON.stringify({ intentId: prepared.intentId }),
  });
}

export function trimReferenceVideo(payload: {
  file: File;
  start: number;
  end: number;
}) {
  const formData = new FormData();
  formData.set('file', payload.file);
  formData.set('start', String(payload.start));
  formData.set('end', String(payload.end));
  return request<TrimReferenceVideoResult>(Api.trimReferenceVideo, {
    method: 'POST',
    body: formData,
  });
}

export function deleteReferenceVideo(payload: {
  assetId?: string;
  fileUrl?: string;
  storedFileName?: string;
}) {
  return request<{ ok: boolean }>(Api.referenceVideo, {
    method: 'DELETE',
    body: JSON.stringify(payload),
  });
}

export function uploadRealPersonAsset(groupId: string, payload: {
  file: File;
  userId: string;
  name?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}) {
  const { userId: _userId, ...requestPayload } = payload;
  const formData = new FormData();
  formData.set('file', requestPayload.file);
  formData.set('name', requestPayload.name || requestPayload.file.name);
  formData.set('description', requestPayload.description || '');
  formData.set('metadata', JSON.stringify(requestPayload.metadata || {}));
  return request<ContentAsset>(`${Api.groups}/${groupId}/real-person/assets`, {
    method: 'POST',
    body: formData,
  });
}

export function uploadVirtualPortraitAsset(groupId: string, payload: {
  file: File;
  userId: string;
  name?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}) {
  const { userId: _userId, ...requestPayload } = payload;
  const formData = new FormData();
  formData.set('file', requestPayload.file);
  formData.set('name', requestPayload.name || requestPayload.file.name);
  formData.set('description', requestPayload.description || '');
  formData.set('metadata', JSON.stringify(requestPayload.metadata || {}));
  return request<ContentAsset>(`${Api.groups}/${groupId}/virtual-portrait/assets`, {
    method: 'POST',
    body: formData,
  });
}

export function syncRealPersonAsset(assetId: string, payload: { userId: string }) {
  const { userId: _userId } = payload;
  return request<ContentAsset>(`${Api.assets}/${assetId}/real-person/sync`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export function syncVirtualPortraitAsset(assetId: string, payload: { userId: string }) {
  const { userId: _userId } = payload;
  return request<ContentAsset>(`${Api.assets}/${assetId}/virtual-portrait/sync`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export type VirtualPortraitRemoteLibrarySyncResult = {
  projectName: string;
  totalRemoteGroups: number;
  createdGroups: number;
  updatedGroups: number;
  syncedAssetGroups: number;
  failedGroups: number;
  groups: Array<{
    remoteGroupId: string;
    remoteGroupName: string;
    localGroupId?: string;
    userId?: string;
    assetCount?: number;
    status: 'synced' | 'failed';
    error?: string;
  }>;
};

export function syncVirtualPortraitRemoteLibrary(payload: {
  userId: string;
  projectName?: string;
  pageSize?: number;
  includeAssets?: boolean;
}) {
  const { userId: _userId, ...requestPayload } = payload;
  return request<VirtualPortraitRemoteLibrarySyncResult>('/api/content/virtual-portrait/remote-library/sync', {
    method: 'POST',
    body: JSON.stringify(requestPayload),
  });
}

export function deleteContentAsset(id: string) {
  return request<{ ok: boolean }>(`${Api.assets}/${id}`, { method: 'DELETE' });
}

export function getContentAsset(id: string) {
  return request<ContentAsset>(`${Api.assets}/${id}`);
}

export function listVideoTasks(userId: string) {
  void userId;
  return request<VideoGenerationTask[]>(Api.videoTasks);
}

export function getVideoTask(id: string) {
  return request<VideoGenerationTask>(`${Api.videoTasks}/${id}`);
}

export function deleteVideoTask(id: string) {
  return request<{ ok: boolean }>(`${Api.videoTasks}/${id}`, { method: 'DELETE' });
}

export function renameVideoTask(id: string, payload: { userId: string; title: string }) {
  const { userId: _userId, ...requestPayload } = payload;
  return request<VideoGenerationTask>(`${Api.videoTasks}/${id}/title`, {
    method: 'PATCH',
    body: JSON.stringify(requestPayload),
  });
}

export function listVideoProductions(userId: string, filters: {
  createdAtFrom?: string;
  createdAtTo?: string;
  ratio?: string;
  search?: string;
  status?: string;
} = {}) {
  void userId;
  const params = new URLSearchParams();
  if (filters.search?.trim()) {
    params.set('search', filters.search.trim());
  }
  if (filters.createdAtFrom?.trim()) {
    params.set('createdAtFrom', filters.createdAtFrom.trim());
  }
  if (filters.createdAtTo?.trim()) {
    params.set('createdAtTo', filters.createdAtTo.trim());
  }
  if (filters.ratio?.trim() && filters.ratio !== '全部比例') {
    params.set('ratio', filters.ratio.trim());
  }
  if (filters.status?.trim() && filters.status !== '全部状态') {
    params.set('status', filters.status.trim());
  }
  const query = params.toString();
  return request<VideoGenerationTask[]>(query ? `${Api.videoProductions}?${query}` : Api.videoProductions);
}

export function listVideoProductionsPage(userId: string, filters: {
  createdAtFrom?: string;
  createdAtTo?: string;
  page: number;
  pageSize: number;
  ratio?: string;
  search?: string;
  status?: string;
}) {
  void userId;
  const params = new URLSearchParams({
    page: String(filters.page),
    pageSize: String(filters.pageSize),
  });
  if (filters.search?.trim()) {
    params.set('search', filters.search.trim());
  }
  if (filters.createdAtFrom?.trim()) {
    params.set('createdAtFrom', filters.createdAtFrom.trim());
  }
  if (filters.createdAtTo?.trim()) {
    params.set('createdAtTo', filters.createdAtTo.trim());
  }
  if (filters.ratio?.trim() && filters.ratio !== '全部比例') {
    params.set('ratio', filters.ratio.trim());
  }
  if (filters.status?.trim() && filters.status !== '全部状态') {
    params.set('status', filters.status.trim());
  }
  return request<PaginatedResult<VideoGenerationTask>>(`${Api.videoProductions}?${params.toString()}`);
}

export function createVideoProduction(payload: {
  userId: string;
  taskMode?: 'video_create' | 'talking_video' | 'dance_remake' | 'subject_replace';
  retryTaskId?: string;
  prompt?: string;
  quality: string;
  ratio: string;
  duration: string;
  videoModelProviderId?: string;
  videoModelId?: string;
  referenceImageGroupId?: string;
  referenceVideoGroupId?: string;
  referenceAudioGroupId?: string;
  referenceImageIds?: string[];
  referenceVideoIds?: string[];
  referenceAudioIds?: string[];
  characterReferenceImageIds?: string[];
  subjectReplaceType?: string;
  subjectReplaceRemoteVideo?: {
    input: string;
    trimEnd?: number;
    trimStart?: number;
  };
  generateAudio?: boolean;
}) {
  const { userId: _userId, ...requestPayload } = payload;
  return request<VideoGenerationTask>(Api.videoProductions, {
    method: 'POST',
    body: JSON.stringify(requestPayload),
  });
}

export function listMarketingVideoStoryboards() {
  return request<MarketingVideoStoryboard[]>(Api.marketingVideoStoryboards);
}

export function createMarketingVideoStoryboard(payload: {
  productName: string;
  productCategory: string;
  sellingPoints: string;
  additionalPrompt: string;
  referenceImageIds: string[];
}) {
  return request<MarketingVideoStoryboard>(Api.marketingVideoStoryboards, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function retryMarketingVideoStoryboard(id: string, optimizationInstruction: string) {
  return request<MarketingVideoStoryboard>(`${Api.marketingVideoStoryboards}/${encodeURIComponent(id)}/retry`, {
    method: 'POST',
    body: JSON.stringify({ optimizationInstruction }),
  });
}

export function deleteMarketingVideoStoryboard(id: string) {
  return request<void>(`${Api.marketingVideoStoryboards}/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export function generateVideoFromMarketingStoryboard(id: string, payload: {
  quality: string;
  ratio: string;
  duration: string;
  videoModelProviderId: string;
  videoModelId: string;
}) {
  return request<VideoGenerationTask>(`${Api.marketingVideoStoryboards}/${encodeURIComponent(id)}/generate-video`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function createVideoEnhancement(payload: {
  userId: string;
  sourceAssetId: string;
  resolution?: '1080p' | '2k' | '4k';
}) {
  const { userId: _userId, ...requestPayload } = payload;
  return request<VideoGenerationTask>(Api.videoEnhancements, {
    method: 'POST',
    body: JSON.stringify(requestPayload),
  });
}

export function createSubtitleRemoval(payload: {
  userId: string;
  sourceAssetId: string;
  mode: 'auto' | 'auto_region' | 'manual';
  contentType: 'subtitle' | 'text';
  locations: Array<{
    topLeftX: number;
    topLeftY: number;
    bottomRightX: number;
    bottomRightY: number;
  }>;
  clipFilter: {
    mode: 'all' | 'selected' | 'skip';
    clips: Array<{
      start: number;
      end: number;
    }>;
  };
}) {
  const { userId: _userId, ...requestPayload } = payload;
  return request<VideoGenerationTask>(Api.subtitleRemovals, {
    method: 'POST',
    body: JSON.stringify(requestPayload),
  });
}

export type CreateVideoTranslationRequest = {
  userId: string;
  sourceAssetId: string;
  sourceLanguage: string;
  targetLanguage: string;
  translationTypes: Array<'subtitle' | 'voice' | 'face'>;
  subtitleSource: 'ocr' | 'asr';
  subtitleConfig: {
    isHardSubtitle: boolean;
    isEraseSource: boolean;
    fontSize?: number;
    marginL?: number;
    marginR?: number;
    marginV?: number;
    showLines?: number;
  };
};

export function createVideoTranslation(payload: CreateVideoTranslationRequest) {
  const { userId: _userId, ...requestPayload } = payload;
  return request<VideoGenerationTask>(Api.videoTranslations, {
    method: 'POST',
    body: JSON.stringify(requestPayload),
  });
}
