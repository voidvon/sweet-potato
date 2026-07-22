import { fileStorageSettingsService } from '../file-storage-settings/file-storage-settings.service.js'
import { tosClient, tosPublicUrl } from '../../shared/file-storage.js'
import type { ManagedFile, ManagedFileMediaType } from './file-management.types.js'

export type TosStorageSummary = {
  bucket: string
  keyPrefix: string
  objectCount: number
  totalBytes: number
  prefixObjectCount: number
  prefixBytes: number
}

let cachedSummary: TosStorageSummary | null = null
let cachedObjects: TosObject[] = []
let cachedFingerprint = ''
let cachedAt = 0
const cacheDurationMs = 30_000

type TosObject = {
  key: string
  size: number
  lastModified: string
}

function mediaTypeForKey(key: string): ManagedFileMediaType {
  const extension = key.split('.').pop()?.toLowerCase() || ''
  if (['avif', 'bmp', 'gif', 'heic', 'jpeg', 'jpg', 'png', 'svg', 'webp'].includes(extension)) return 'image'
  if (['avi', 'm4v', 'mkv', 'mov', 'mp4', 'mpeg', 'webm'].includes(extension)) return 'video'
  if (['aac', 'flac', 'm4a', 'mp3', 'ogg', 'wav'].includes(extension)) return 'audio'
  if (['csv', 'doc', 'docx', 'json', 'pdf', 'ppt', 'pptx', 'txt', 'xls', 'xlsx', 'xml'].includes(extension)) return 'document'
  return 'other'
}

function fileNameForKey(key: string) {
  const segments = key.split('/').filter(Boolean)
  return segments.at(-1) || key
}

export function summarizeTosObjects(input: {
  bucket: string
  keyPrefix: string
  objects: Array<{ Key: string; Size: number }>
}): TosStorageSummary {
  const normalizedPrefix = input.keyPrefix.replace(/^\/+|\/+$/g, '')
  let prefixObjectCount = 0
  let prefixBytes = 0
  let totalBytes = 0
  input.objects.forEach((object) => {
    const size = Math.max(0, Number(object.Size || 0))
    totalBytes += size
    if (object.Key === normalizedPrefix || object.Key.startsWith(`${normalizedPrefix}/`)) {
      prefixObjectCount += 1
      prefixBytes += size
    }
  })
  return {
    bucket: input.bucket,
    keyPrefix: normalizedPrefix,
    objectCount: input.objects.length,
    totalBytes,
    prefixObjectCount,
    prefixBytes,
  }
}

export const fileManagementTosService = {
  invalidateCache() {
    cachedSummary = null
    cachedObjects = []
    cachedFingerprint = ''
    cachedAt = 0
  },

  async listObjects() {
    const config = fileStorageSettingsService.getRuntimeSettings()
    if (!config.endpoint || !config.bucket || !config.accessKey || !config.secretKey) {
      throw new Error('TOS 配置不完整，请先在系统设置中填写连接信息')
    }
    const fingerprint = [
      config.endpoint,
      config.region,
      config.bucket,
      config.keyPrefix,
      config.accessKey,
      config.secretKey,
    ].join('\n')
    if (cachedSummary && cachedFingerprint === fingerprint && Date.now() - cachedAt < cacheDurationMs) {
      return { config, objects: cachedObjects }
    }

    const objects: TosObject[] = []
    let continuationToken: string | undefined
    do {
      const response = await tosClient().listObjectsType2({
        bucket: config.bucket,
        maxKeys: 1000,
        ...(continuationToken ? { continuationToken } : {}),
        listOnlyOnce: true,
      })
      objects.push(...(response.data.Contents || []).map((object) => ({
        key: object.Key,
        size: Number(object.Size || 0),
        lastModified: object.LastModified,
      })))
      continuationToken = response.data.IsTruncated
        ? response.data.NextContinuationToken
        : undefined
    } while (continuationToken)

    cachedSummary = summarizeTosObjects({
      bucket: config.bucket,
      keyPrefix: config.keyPrefix,
      objects: objects.map((object) => ({ Key: object.key, Size: object.size })),
    })
    cachedObjects = objects
    cachedFingerprint = fingerprint
    cachedAt = Date.now()
    return { config, objects }
  },

  async getSummary() {
    await this.listObjects()
    return cachedSummary!
  },

  async list(input: Record<string, unknown>) {
    const { config, objects } = await this.listObjects()
    const page = Math.max(1, Math.floor(Number(input.page || 1)))
    const pageSize = Math.max(1, Math.min(100, Math.floor(Number(input.pageSize || 20))))
    const search = String(input.search || '').trim().toLowerCase()
    const mediaType = String(input.mediaType || '').trim()
    const createdAtFrom = input.createdAtFrom ? new Date(String(input.createdAtFrom)).getTime() : null
    const createdAtTo = input.createdAtTo ? new Date(String(input.createdAtTo)).getTime() : null
    const filtered = objects
      .filter((object) => {
        if (search && !object.key.toLowerCase().includes(search)) return false
        if (mediaType && mediaTypeForKey(object.key) !== mediaType) return false
        const modifiedAt = new Date(object.lastModified).getTime()
        if (createdAtFrom !== null && modifiedAt < createdAtFrom) return false
        if (createdAtTo !== null && modifiedAt > createdAtTo) return false
        return true
      })
      .sort((left, right) => {
        const timeDifference = new Date(right.lastModified).getTime() - new Date(left.lastModified).getTime()
        return timeDifference || right.key.localeCompare(left.key)
      })
    const offset = (page - 1) * pageSize
    const items: ManagedFile[] = filtered.slice(offset, offset + pageSize).map((object) => {
      const fileName = fileNameForKey(object.key)
      return {
        id: `tos:${object.key}`,
        name: fileName,
        originalFileName: fileName,
        mimeType: '',
        fileSize: object.size,
        fileUrl: tosPublicUrl(object.key),
        resourceType: 'other',
        assetKind: 'storage_object',
        lifecycleStatus: 'permanent',
        storageProvider: 'tos',
        storageKey: object.key,
        storageBucket: config.bucket,
        mediaType: mediaTypeForKey(object.key),
        referenceCount: 0,
        userId: '',
        username: '',
        createdAt: object.lastModified,
        updatedAt: object.lastModified,
      }
    })
    return {
      items,
      page,
      pageSize,
      total: filtered.length,
      summary: {
        totalCount: cachedSummary!.objectCount,
        totalBytes: cachedSummary!.totalBytes,
        localCount: 0,
        localBytes: 0,
        tosCount: cachedSummary!.objectCount,
        tosBytes: cachedSummary!.totalBytes,
      },
    }
  },
}
