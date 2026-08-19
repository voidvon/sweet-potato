import { request } from '@shared/api/core/request'

export type DiscoverCategory = { id: string; name: string; slug: string; sortOrder: number; status: 'active' | 'disabled' }
export type DiscoverItem = { id: string; categoryId: string; sourceAssetId: string; title: string; description: string; mediaType: 'image' | 'video'; mimeType: string; fileUrl: string; coverUrl: string; likeCount: number; viewCount: number }
export const listDiscoverCategories = () => request<{ items: DiscoverCategory[] }>('/api/admin/discover/categories', { dedupe: false })
export const createDiscoverCategory = (input: { name: string; slug?: string }) => request<DiscoverCategory>('/api/admin/discover/categories', { method: 'POST', body: JSON.stringify(input) })
export const updateDiscoverCategory = (id: string, input: Partial<Pick<DiscoverCategory, 'name' | 'slug' | 'sortOrder' | 'status'>>) => request<DiscoverCategory>(`/api/admin/discover/categories/${id}`, { method: 'PATCH', body: JSON.stringify(input) })
export const deleteDiscoverCategory = (id: string) => request<{ ok: boolean }>(`/api/admin/discover/categories/${id}`, { method: 'DELETE' })
export const listDiscoverItems = () => request<{ items: DiscoverItem[] }>('/api/admin/discover/items', { dedupe: false })
export const createDiscoverItem = (input: { sourceAssetId: string; categoryId: string; title?: string; description?: string }) => request<DiscoverItem>('/api/admin/discover/items', { method: 'POST', body: JSON.stringify(input) })
export const updateDiscoverItem = (id: string, input: Partial<Pick<DiscoverItem, 'categoryId' | 'title' | 'description'>>) => request<DiscoverItem>(`/api/admin/discover/items/${id}`, { method: 'PATCH', body: JSON.stringify(input) })
export const deleteDiscoverItem = (id: string) => request<{ ok: boolean }>(`/api/admin/discover/items/${id}`, { method: 'DELETE' })
