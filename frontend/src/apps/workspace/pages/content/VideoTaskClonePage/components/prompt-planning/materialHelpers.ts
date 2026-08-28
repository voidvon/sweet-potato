import type { MutableRefObject } from 'react';
import {
  createContentAssetGroup,
  deleteReferenceVideo,
  listContentAssetGroups,
  uploadContentAsset,
} from '../../../../../api/content';
import type { PlanningSession } from '../../../../../api/content-planning';
import { resolveAssetUrl } from '../../../../../api/request';
import type { ContentAssetResourceType, User } from '../../../../../types';
import type {
  LocalMaterialFile,
  MaterialKind,
  SelectedMaterialValue,
  SelectedMaterials,
} from '../../types';
import type { ConfirmedReferenceVideo } from '../ReferenceVideoCard';
import { t } from '@shared/i18n';

export function getLocalFiles(value: SelectedMaterialValue): LocalMaterialFile[] {
  return Array.isArray(value) ? value : [];
}

export function getLimit(kind: MaterialKind) {
  if (kind.maxCount !== undefined) {
    return kind.maxCount;
  }
  if (kind.key === 'image') {
    return 9;
  }
  return 1;
}

export function getRemainingCapacity(kind: MaterialKind, current: SelectedMaterialValue) {
  return Math.max(getLimit(kind) - getLocalFiles(current).length, 0);
}

export function createOwnedObjectUrl(file: File, ownedObjectUrls: Set<string>) {
  const url = URL.createObjectURL(file);
  ownedObjectUrls.add(url);
  return url;
}

export function isAllowedAudioFile(file: File) {
  const mimeType = file.type.toLowerCase();
  const name = file.name.toLowerCase();
  return mimeType === 'audio/mpeg'
    || mimeType === 'audio/mp3'
    || mimeType === 'audio/wav'
    || mimeType === 'audio/x-wav'
    || name.endsWith('.mp3')
    || name.endsWith('.wav');
}

export function readAudioDuration(file: File) {
  return new Promise<number | undefined>((resolve) => {
    const audio = document.createElement('audio');
    const objectUrl = URL.createObjectURL(file);
    const cleanup = () => {
      audio.removeAttribute('src');
      URL.revokeObjectURL(objectUrl);
    };
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => {
      const duration = Number.isFinite(audio.duration) ? audio.duration : undefined;
      cleanup();
      resolve(duration);
    };
    audio.onerror = () => {
      cleanup();
      resolve(undefined);
    };
    audio.src = objectUrl;
  });
}

export function revokeLocalMaterialList(files: LocalMaterialFile[], ownedObjectUrls: Set<string>) {
  files.forEach((file) => {
    if (ownedObjectUrls.has(file.url)) {
      URL.revokeObjectURL(file.url);
      ownedObjectUrls.delete(file.url);
    }
  });
}

export function revokeSelectedMaterials(materials: SelectedMaterials, ownedObjectUrls: Set<string>) {
  Object.values(materials).forEach((value) => revokeLocalMaterialList(getLocalFiles(value), ownedObjectUrls));
}

export function replaceSeedMaterials(current: SelectedMaterials, next: SelectedMaterials, ownedObjectUrls: Set<string>) {
  revokeSelectedMaterials(current, ownedObjectUrls);
  return next;
}

export function hasSessionMaterialBundle(session: PlanningSession) {
  return session.materialBundle.imageMaterials.length > 0
    || Boolean(session.materialBundle.documentMaterials?.length)
    || Boolean(session.materialBundle.referenceVideo)
    || Boolean(session.materialBundle.referenceAudio);
}

export function implicitUploadGroupName(resourceType: ContentAssetResourceType) {
  if (resourceType === 'voice') {
    return t("视频制作参考音频");
  }
  return t("视频制作参考素材");
}

export async function ensureUploadGroupId(input: {
  currentUser: User;
  resourceType: ContentAssetResourceType;
  uploadGroupIdsRef: MutableRefObject<Partial<Record<ContentAssetResourceType, string>>>;
}) {
  const cached = input.uploadGroupIdsRef.current[input.resourceType];
  if (cached) {
    return cached;
  }
  const groups = await listContentAssetGroups(input.currentUser.id, input.resourceType);
  const existing = groups.find((group) => group.metadata?.systemDefault === true || group.name === implicitUploadGroupName(input.resourceType));
  if (existing) {
    input.uploadGroupIdsRef.current[input.resourceType] = existing.id;
    return existing.id;
  }
  const created = await createContentAssetGroup({
    userId: input.currentUser.id,
    resourceType: input.resourceType,
    name: implicitUploadGroupName(input.resourceType),
    metadata: {
      hiddenFromGroupUi: true,
      source: 'local_upload',
      systemDefault: true,
    },
  });
  input.uploadGroupIdsRef.current[input.resourceType] = created.id;
  return created.id;
}

export async function ensureMaterialAssetIds(input: {
  currentUser: User;
  resourceType: ContentAssetResourceType;
  files: LocalMaterialFile[];
  uploadGroupIdsRef: MutableRefObject<Partial<Record<ContentAssetResourceType, string>>>;
}) {
  if (!input.files.length) {
    return [];
  }
  const groupId = await ensureUploadGroupId({
    currentUser: input.currentUser,
    resourceType: input.resourceType,
    uploadGroupIdsRef: input.uploadGroupIdsRef,
  });
  return Promise.all(input.files.map(async (file) => {
    if (file.assetId) {
      return file.assetId;
    }
    if (!file.file) {
      throw new Error(t("缺少待上传素材文件：{{0}}", { "0": file.name }));
    }
    const uploaded = await uploadContentAsset({
      file: file.file,
      userId: input.currentUser.id,
      groupId,
      resourceType: input.resourceType,
      name: file.name,
      metadata: {
        ...(file.audioDuration ? { duration: file.audioDuration } : {}),
        ...(file.trimDuration ? { duration: file.trimDuration } : {}),
        source: 'local_upload',
        temporary: true,
        kind: 'video_create_reference_upload',
        assetKind: `${file.type}_input`,
      },
    });
    file.assetId = uploaded.id;
    file.serverFileUrl = uploaded.fileUrl;
    file.storedFileName = uploaded.storedFileName;
    file.url = resolveAssetUrl(uploaded.fileUrl);
    return uploaded.id;
  }));
}

export function toConfirmedReferenceVideo(file: LocalMaterialFile): ConfirmedReferenceVideo {
  const duration = file.trimDuration ?? 15;
  return {
    assetId: file.assetId,
    duration,
    end: file.trimEnd ?? duration,
    fileUrl: file.serverFileUrl ?? file.url,
    name: file.name,
    start: file.trimStart ?? 0,
    storedFileName: file.storedFileName ?? '',
    videoUrl: file.url,
  };
}

export async function deleteServerReferenceVideo(video: ConfirmedReferenceVideo) {
  if (!video.storedFileName && (!video.fileUrl || video.fileUrl.startsWith('blob:'))) {
    return;
  }
  try {
    await deleteReferenceVideo({
      assetId: video.assetId,
      fileUrl: video.fileUrl,
      storedFileName: video.storedFileName,
    });
  } catch {
    // Best-effort cleanup only.
  }
}
