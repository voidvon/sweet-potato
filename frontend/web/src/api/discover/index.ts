import { request } from '@shared/api/core/request'

export type DiscoverCategory = {
  id: string
  name: string
  slug: string
  sortOrder: number
  status: 'active' | 'disabled'
}

export type DiscoverItem = {
  id: string
  categoryId: string
  sourceAssetId: string
  title: string
  description: string
  mediaType: 'image' | 'video'
  mimeType: string
  fileUrl: string
  originalFileName: string
  fileSize: number
  likeCount: number
  viewCount: number
  duration: number
  sourceCreatedAt: string | null
  sourceCompletedAt: string | null
  referenceAssets: Array<{
    id: string
    name: string
    originalFileName: string
    mimeType: string
    fileUrl: string
    metadata: Record<string, unknown>
  }>
  aspectRatio: string
  status: 'published'
  sortOrder: number
  publishedAt: string | null
}

export function listDiscoverCategories() {
  return request<{ items: DiscoverCategory[] }>('/api/discover/categories', { dedupe: false })
}

export type DiscoverItemListResult = {
  items: DiscoverItem[]
  page: number
  pageSize: number
  total: number
}

export type DiscoverItemCounts = Pick<DiscoverItem, 'likeCount' | 'viewCount'>

export function listDiscoverItems(input: {
  page?: number
  pageSize?: number
  categoryId?: string
  mediaType?: DiscoverItem['mediaType']
  search?: string
} = {}) {
  const params = new URLSearchParams({
    page: String(input.page || 1),
    pageSize: String(input.pageSize || 20),
  })
  if (input.categoryId) params.set('categoryId', input.categoryId)
  if (input.mediaType) params.set('mediaType', input.mediaType)
  if (input.search) params.set('search', input.search)
  return request<DiscoverItemListResult>(`/api/discover/items?${params.toString()}`, { dedupe: false })
}

export function likeDiscoverItem(id: string) {
  return request<DiscoverItemCounts>(`/api/discover/items/${encodeURIComponent(id)}/like`, { method: 'POST' })
}

export function viewDiscoverItem(id: string) {
  return request<DiscoverItemCounts>(`/api/discover/items/${encodeURIComponent(id)}/view`, { method: 'POST' })
}
