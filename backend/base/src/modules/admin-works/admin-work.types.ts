export type AdminWorkMediaType = 'image' | 'video'

export type AdminWork = {
  id: string
  userId: string
  username: string
  displayName: string
  name: string
  description: string
  mediaType: AdminWorkMediaType
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

export type AdminWorkListInput = {
  page: number
  pageSize: number
  username?: string
  search?: string
}

export type AdminWorkListResult = {
  items: AdminWork[]
  page: number
  pageSize: number
  total: number
}
