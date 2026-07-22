export type ManagedFileStorageProvider = 'local' | 'tos'
export type ManagedFileMediaType = 'image' | 'video' | 'audio' | 'document' | 'other'

export type ManagedFile = {
  id: string
  name: string
  originalFileName: string
  mimeType: string
  fileSize: number
  fileUrl: string
  resourceType: string
  assetKind: string
  lifecycleStatus: string
  storageProvider: ManagedFileStorageProvider
  storageKey: string
  storageBucket: string
  mediaType: ManagedFileMediaType
  referenceCount: number
  userId: string
  username: string
  createdAt: string
  updatedAt: string
}

export type ManagedFileSummary = {
  totalCount: number
  totalBytes: number
  localCount: number
  localBytes: number
  tosCount: number
  tosBytes: number
}

export type ManagedFileListInput = {
  page: number
  pageSize: number
  search?: string
  storageProvider?: ManagedFileStorageProvider
  mediaType?: ManagedFileMediaType
  lifecycleStatus?: string
  createdAtFrom?: string
  createdAtTo?: string
}

export type ManagedFileListResult = {
  items: ManagedFile[]
  page: number
  pageSize: number
  total: number
  summary: ManagedFileSummary
}
