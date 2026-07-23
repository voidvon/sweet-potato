import { randomUUID } from 'node:crypto'
import { managedFilePublicUrl } from '../file-management/file-management.service.js'
import { contentRepository } from '../content/content.repository.js'
import { temporaryContentAssetExpiresAt } from '../content/content.service.js'
import { discoverRepository } from './discover.repository.js'
import type { ContentAsset } from '../content/content.types.js'
import type { DiscoverItem, DiscoverReferenceAsset } from './discover.types.js'

const text = (value: unknown, fallback = '') => String(value ?? fallback).trim()
const status = (value: unknown) => ['draft', 'published', 'hidden'].includes(String(value)) ? String(value) as 'draft' | 'published' | 'hidden' : 'draft'
const nonNegativeCount = (value: unknown) => Math.max(0, Math.floor(Number(value) || 0))
const optionalText = (value: unknown) => text(value) || undefined
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const dateValue = (value: unknown) => typeof value === 'string' && value.trim() ? value : null
const durationSeconds = (value: unknown) => {
  const matched = String(value ?? '').match(/[\d.]+/)
  const parsed = matched ? Number(matched[0]) : 0
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}
const positiveNumber = (value: unknown) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}
function aspectRatio(asset: ContentAsset) {
  const metadata = asset.metadata
  const ratio = String(metadata.ratio || metadata.aspectRatio || '').trim().match(/^(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)$/)
  if (ratio) return `${ratio[1]} / ${ratio[2]}`
  const width = positiveNumber(metadata.width ?? metadata.videoWidth)
  const height = positiveNumber(metadata.height ?? metadata.videoHeight)
  return width && height ? `${width} / ${height}` : '1 / 1'
}

function referenceAssetIds(asset: ContentAsset) {
  const ids = new Set<string>()
  const visit = (value: unknown) => {
    if (Array.isArray(value)) return value.forEach(visit)
    const item = record(value)
    if (!Object.keys(item).length) return
    const sourceAssetId = typeof item.sourceAssetId === 'string' ? item.sourceAssetId.trim() : ''
    if (sourceAssetId) ids.add(sourceAssetId)
    const id = typeof item.id === 'string' && (typeof item.fileUrl === 'string' || typeof item.resourceType === 'string') ? item.id.trim() : ''
    if (id) ids.add(id)
    Object.values(item).forEach(visit)
  }
  visit(asset.metadata.materialContext)
  visit({ sourceAssetId: asset.metadata.sourceAssetId })
  return [...ids]
}

function referenceAssetSnapshot(asset: ContentAsset): DiscoverReferenceAsset {
  return { id: asset.id, name: asset.name, originalFileName: asset.originalFileName, mimeType: asset.mimeType, fileUrl: asset.fileUrl, metadata: asset.metadata }
}

function publicItem(item: DiscoverItem) {
  return {
    ...item,
    fileUrl: managedFilePublicUrl({ fileUrl: item.fileUrl, storageProvider: item.fileUrl.startsWith('http') ? 'tos' : 'local' }),
    referenceAssets: item.referenceAssets.map((asset) => ({
      ...asset,
      fileUrl: managedFilePublicUrl({ fileUrl: asset.fileUrl, storageProvider: asset.fileUrl.startsWith('http') ? 'tos' : 'local' }),
    })),
  }
}

export const discoverService = {
  listCategories() { return discoverRepository.listCategories() },
  createCategory(input: Record<string, unknown>) { const name = text(input.name); const generatedSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); const slug = text(input.slug) || generatedSlug || `category-${randomUUID().slice(0, 8)}`; if (!name) throw new Error('分类名称不能为空'); return discoverRepository.createCategory({ name, slug, sortOrder: Number(input.sortOrder || 0) }) },
  updateCategory(id: string, input: Record<string, unknown>) { return discoverRepository.updateCategory(id, { name: input.name === undefined ? undefined : text(input.name), slug: input.slug === undefined ? undefined : text(input.slug), sortOrder: input.sortOrder === undefined ? undefined : Number(input.sortOrder), status: input.status === 'disabled' ? 'disabled' : input.status === 'active' ? 'active' : undefined }) },
  deleteCategory(id: string) { if (!discoverRepository.deleteCategory(id)) throw new Error('分类不存在或仍包含作品') },
  listItems(input: Record<string, unknown>, publicOnly = false) { return discoverRepository.listItems({ status: input.status as never, categoryId: text(input.categoryId) || undefined, publicOnly }).map(publicItem) },
  listPublicItems(input: Record<string, unknown>) {
    const page = Math.max(1, Math.floor(Number(input.page || 1)))
    const pageSize = Math.max(1, Math.min(100, Math.floor(Number(input.pageSize || 20))))
    const requestedMediaType = optionalText(input.mediaType)
    const result = discoverRepository.listPublicItems({
      page,
      pageSize,
      categoryId: optionalText(input.categoryId),
      mediaType: requestedMediaType === 'image' || requestedMediaType === 'video' ? requestedMediaType : undefined,
      search: optionalText(input.search),
    })
    return { ...result, items: result.items.map(publicItem) }
  },
  likeItem(id: string) { return discoverRepository.incrementLikeCount(id) },
  viewItem(id: string) { return discoverRepository.incrementViewCount(id) },
  createItem(input: Record<string, unknown>) {
    const sourceAssetId = text(input.sourceAssetId); const categoryId = text(input.categoryId); const asset = sourceAssetId ? contentRepository.findAsset(sourceAssetId) : null
    if (!asset || !categoryId || !discoverRepository.findCategory(categoryId)) throw new Error('来源作品或分类不存在')
    const retainedReferenceAssets = referenceAssetIds(asset).map((id) => contentRepository.findAsset(id)).filter((item): item is ContentAsset => Boolean(item && item.userId === asset.userId))
    const item = discoverRepository.createItem({ categoryId, sourceAssetId, title: text(input.title, asset.name), description: text(input.description, asset.description), mediaType: asset.mimeType.startsWith('image/') ? 'image' : 'video', mimeType: asset.mimeType, fileUrl: asset.fileUrl, originalFileName: asset.originalFileName, fileSize: asset.fileSize, likeCount: nonNegativeCount(asset.metadata.likeCount), viewCount: nonNegativeCount(asset.metadata.viewCount), duration: durationSeconds(asset.metadata.duration), sourceCreatedAt: asset.createdAt, sourceCompletedAt: dateValue(asset.metadata.completedAt) || dateValue(asset.metadata.generatedAt) || asset.updatedAt, referenceAssets: retainedReferenceAssets.map(referenceAssetSnapshot), aspectRatio: aspectRatio(asset), status: status(input.status), sortOrder: Number(input.sortOrder || 0) })
    contentRepository.retainAssetsForReference({ assetIds: [asset.id], userId: asset.userId, referenceType: 'discover_item', referenceId: item.id, role: 'output' })
    contentRepository.retainAssetsForReference({ assetIds: retainedReferenceAssets.map((item) => item.id), userId: asset.userId, referenceType: 'discover_item', referenceId: item.id, role: 'input' })
    return item
  },
  updateItem(id: string, input: Record<string, unknown>) { const nextCategoryId = input.categoryId ? text(input.categoryId) : undefined; if (nextCategoryId && !discoverRepository.findCategory(nextCategoryId)) throw new Error('分类不存在'); const item = discoverRepository.updateItem(id, { categoryId: nextCategoryId, title: input.title === undefined ? undefined : text(input.title), description: input.description === undefined ? undefined : text(input.description), status: input.status ? status(input.status) : undefined, sortOrder: input.sortOrder === undefined ? undefined : Number(input.sortOrder) }); if (!item) throw new Error('发现条目不存在'); return item },
  deleteItem(id: string) { const item = discoverRepository.findItem(id); const retainedAssetIds = contentRepository.listAssetIdsForReference('discover_item', id); if (!item || !discoverRepository.deleteItem(id)) throw new Error('发现条目不存在'); contentRepository.deleteAssetReferences('discover_item', id); retainedAssetIds.forEach((assetId) => contentRepository.markAssetTemporaryIfUnreferenced(assetId, temporaryContentAssetExpiresAt())) },
}
