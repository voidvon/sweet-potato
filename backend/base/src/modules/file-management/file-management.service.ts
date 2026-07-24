import { contentPublicBaseUrl } from '../../config/env.js'
import { deleteTosObject } from '../../shared/file-storage.js'
import { contentRepository } from '../content/content.repository.js'
import { contentService } from '../content/content.service.js'
import { fileManagementRepository } from './file-management.repository.js'
import { fileManagementTosService } from './file-management-tos.service.js'
import type { ManagedFile, ManagedFileMediaType, ManagedFileStorageProvider } from './file-management.types.js'

const storageProviders = new Set<ManagedFileStorageProvider>(['local', 'tos'])
const mediaTypes = new Set<ManagedFileMediaType>(['image', 'video', 'audio', 'document', 'other'])
const lifecycleStatuses = new Set(['temporary', 'retained', 'permanent'])

function optionalText(value: unknown) {
  const normalized = String(value || '').trim()
  return normalized || undefined
}

function optionalDate(value: unknown) {
  const normalized = optionalText(value)
  if (!normalized) return undefined
  const parsed = new Date(normalized)
  if (Number.isNaN(parsed.getTime())) throw new Error('时间筛选格式无效')
  return parsed.toISOString()
}

export function managedFilePublicUrl(file: Pick<ManagedFile, 'fileUrl' | 'storageProvider'>, publicBaseUrl = contentPublicBaseUrl) {
  const rawUrl = String(file.fileUrl || '').trim()
  if (!rawUrl || file.storageProvider === 'tos' || !publicBaseUrl) return rawUrl
  let filePath = rawUrl
  try {
    const parsed = new URL(rawUrl)
    filePath = `${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch {
    filePath = rawUrl.startsWith('/') ? rawUrl : `/${rawUrl}`
  }
  return `${publicBaseUrl.replace(/\/+$/, '')}/${filePath.replace(/^\/+/, '')}`
}

export const fileManagementService = {
  list(input: Record<string, unknown>) {
    const page = Math.max(1, Math.floor(Number(input.page || 1)))
    const pageSize = Math.max(1, Math.min(100, Math.floor(Number(input.pageSize || 20))))
    const storageProvider = optionalText(input.storageProvider)
    const mediaType = optionalText(input.mediaType)
    const lifecycleStatus = optionalText(input.lifecycleStatus)
    if (storageProvider && !storageProviders.has(storageProvider as ManagedFileStorageProvider)) {
      throw new Error('存储来源筛选无效')
    }
    if (mediaType && !mediaTypes.has(mediaType as ManagedFileMediaType)) {
      throw new Error('文件类型筛选无效')
    }
    if (lifecycleStatus && !lifecycleStatuses.has(lifecycleStatus)) {
      throw new Error('文件状态筛选无效')
    }
    const result = fileManagementRepository.list({
      page,
      pageSize,
      search: optionalText(input.search),
      storageProvider: storageProvider as ManagedFileStorageProvider | undefined,
      mediaType: mediaType as ManagedFileMediaType | undefined,
      lifecycleStatus,
      createdAtFrom: optionalDate(input.createdAtFrom),
      createdAtTo: optionalDate(input.createdAtTo),
    })
    return {
      ...result,
      items: result.items.map((file) => ({
        ...file,
        fileUrl: managedFilePublicUrl(file),
        coverUrl: file.coverUrl
          ? managedFilePublicUrl({ fileUrl: file.coverUrl, storageProvider: file.coverUrl.startsWith('http') ? 'tos' : 'local' })
          : '',
      })),
    }
  },

  async delete(input: Record<string, unknown>) {
    const id = optionalText(input.id)
    const storageKey = optionalText(input.storageKey)
    if (!id) throw new Error('缺少文件 ID')

    let assetId = id
    if (id.startsWith('tos:')) {
      if (!storageKey) throw new Error('缺少 TOS 文件 Key')
      assetId = fileManagementRepository.findAssetByStorageKey(storageKey) || ''
      if (!assetId) {
        await deleteTosObject(storageKey)
        fileManagementTosService.invalidateCache()
        return { ok: true }
      }
    }

    const asset = contentRepository.findAsset(assetId)
    if (!asset) throw new Error('文件记录不存在')
    if (contentRepository.hasAssetReferences(asset.id)) {
      throw new Error('文件仍被业务引用，不能删除')
    }
    await contentService.deleteAsset(asset.id, {
      userId: asset.userId,
      role: 'admin',
    })
    if (asset.metadata.storageProvider === 'tos') {
      fileManagementTosService.invalidateCache()
    }
    return { ok: true }
  },
}
