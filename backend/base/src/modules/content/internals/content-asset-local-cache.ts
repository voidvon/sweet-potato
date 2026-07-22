import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import { downloadTosObjectToFile } from '../../../shared/file-storage.js'
import { contentRepository } from '../content.repository.js'
import type { ContentAsset } from '../content.types.js'
import { contentFilePathForRelativePath, inputMediaKindForMimeType, inputMediaRelativePath } from './content-common.js'

const pendingLocalCaches = new Map<string, Promise<ContentAsset>>()

function metadataString(asset: ContentAsset, key: string) {
  const value = asset.metadata[key]
  return typeof value === 'string' ? value.trim() : ''
}

function cacheExtension(asset: ContentAsset) {
  const extension = path.extname(asset.originalFileName || asset.storedFileName || '').toLowerCase()
  return /^\.[a-z0-9]{1,8}$/.test(extension) ? extension : ''
}

async function createLocalCache(asset: ContentAsset) {
  const latest = contentRepository.findAsset(asset.id)
  if (!latest) throw new Error('素材不存在')
  if (latest.filePath && existsSync(latest.filePath)) return latest

  const provider = metadataString(latest, 'storageProvider')
  const storageKey = metadataString(latest, 'storageKey')
  const storageBucket = metadataString(latest, 'storageBucket')
  if (provider !== 'tos' || !storageKey) {
    throw new Error('素材尚未保存到本地，且没有可用的对象存储记录')
  }
  const mediaKind = inputMediaKindForMimeType(latest.mimeType)
  if (!mediaKind) throw new Error('素材文件类型不支持本地缓存')

  const relativePath = inputMediaRelativePath(
    mediaKind,
    `${latest.id}-cache${cacheExtension(latest)}`,
  )
  const filePath = contentFilePathForRelativePath(relativePath)
  const temporaryPath = `${filePath}.part-${randomUUID()}`
  await mkdir(path.dirname(filePath), { recursive: true })
  try {
    await downloadTosObjectToFile({
      key: storageKey,
      bucket: storageBucket || undefined,
      filePath: temporaryPath,
    })
    await rename(temporaryPath, filePath)
  } catch (error) {
    await rm(temporaryPath, { force: true })
    throw error
  }
  const updated = contentRepository.updateAssetFileInfo(latest.id, { filePath })
  if (!updated) {
    await rm(filePath, { force: true })
    throw new Error('素材本地缓存记录更新失败')
  }
  return updated
}

export function ensureContentAssetLocalFile(asset: ContentAsset) {
  if (asset.filePath && existsSync(asset.filePath)) return Promise.resolve(asset)
  const pending = pendingLocalCaches.get(asset.id)
  if (pending) return pending
  const next = createLocalCache(asset).finally(() => {
    if (pendingLocalCaches.get(asset.id) === next) pendingLocalCaches.delete(asset.id)
  })
  pendingLocalCaches.set(asset.id, next)
  return next
}
