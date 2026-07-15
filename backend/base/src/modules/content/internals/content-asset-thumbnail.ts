import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { dataDir } from '../../../db/database.js';
import type { ContentAsset } from '../content.types.js';
import { resolveLocalContentFilePathFromUrl } from './content-common.js';

const defaultThumbnailSize = 256;
const maxThumbnailJobs = 3;
const thumbnailDir = path.join(dataDir, 'files', 'thumbnails');
const pendingThumbnails = new Map<string, Promise<string>>();
const thumbnailJobWaiters: Array<() => void> = [];
let activeThumbnailJobs = 0;

function metadataString(asset: ContentAsset, key: string) {
  const value = asset.metadata?.[key];
  return typeof value === 'string' ? value.trim() : '';
}

function localThumbnailSourcePath(asset: ContentAsset) {
  const localUrls = [metadataString(asset, 'localMirrorUrl'), asset.fileUrl];
  for (const url of localUrls) {
    const filePath = resolveLocalContentFilePathFromUrl(url);
    if (filePath && existsSync(filePath)) {
      return filePath;
    }
  }
  return asset.filePath && existsSync(asset.filePath) ? asset.filePath : '';
}

async function withThumbnailJobSlot<T>(job: () => Promise<T>) {
  if (activeThumbnailJobs >= maxThumbnailJobs) {
    await new Promise<void>((resolve) => thumbnailJobWaiters.push(resolve));
  }
  activeThumbnailJobs += 1;
  try {
    return await job();
  } finally {
    activeThumbnailJobs -= 1;
    thumbnailJobWaiters.shift()?.();
  }
}

export function normalizeContentThumbnailSize(value: unknown) {
  const parsed = Math.floor(Number(value || defaultThumbnailSize));
  if (!Number.isFinite(parsed)) {
    return defaultThumbnailSize;
  }
  return Math.max(64, Math.min(512, parsed));
}

export async function contentAssetThumbnailPath(
  asset: ContentAsset,
  size = defaultThumbnailSize,
  cacheDir = thumbnailDir,
) {
  if (!asset.mimeType.startsWith('image/')) {
    throw new Error('当前素材不是图片');
  }
  const normalizedSize = normalizeContentThumbnailSize(size);
  const cacheKey = createHash('sha256')
    .update(`${asset.id}:${asset.updatedAt}:${normalizedSize}`)
    .digest('hex')
    .slice(0, 24);
  const filePath = path.join(cacheDir, `${cacheKey}.webp`);
  if (existsSync(filePath)) {
    return filePath;
  }
  const pending = pendingThumbnails.get(filePath);
  if (pending) {
    return pending;
  }

  const nextThumbnail = withThumbnailJobSlot(async () => {
    if (existsSync(filePath)) {
      return filePath;
    }
    await mkdir(cacheDir, { recursive: true });
    const sourcePath = localThumbnailSourcePath(asset);
    if (!sourcePath) {
      throw new Error('素材没有可用的本地图片或本地镜像');
    }
    const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
    try {
      await sharp(sourcePath)
        .rotate()
        .resize(normalizedSize, normalizedSize, {
          fit: 'cover',
          position: 'centre',
          withoutEnlargement: true,
        })
        .webp({ effort: 4, quality: 78 })
        .toFile(temporaryPath);
      await rename(temporaryPath, filePath);
      return filePath;
    } finally {
      await rm(temporaryPath, { force: true });
    }
  });
  pendingThumbnails.set(filePath, nextThumbnail);
  try {
    return await nextThumbnail;
  } finally {
    pendingThumbnails.delete(filePath);
  }
}
