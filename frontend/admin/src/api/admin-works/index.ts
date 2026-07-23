import { request } from '@shared/api/core/request'

export type AdminWork = {
  id: string
  userId: string
  username: string
  displayName: string
  name: string
  description: string
  mediaType: 'image' | 'video'
  mimeType: string
  fileUrl: string
  fileSize: number
  mode: string
  modeTitle: string
  provider: string
  model: string
  generatedAt: string
  createdAt: string
  updatedAt: string
}

export type AdminWorkListResult = {
  items: AdminWork[]
  page: number
  pageSize: number
  total: number
}

export function listAdminWorks(page = 1, pageSize = 20, username = '', search = '') {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
  if (username) params.set('username', username)
  if (search) params.set('search', search)
  return request<AdminWorkListResult>(`/api/admin/works?${params.toString()}`, { dedupe: false })
}
