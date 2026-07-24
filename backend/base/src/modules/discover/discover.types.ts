export type DiscoverMediaType = 'image' | 'video'

export type DiscoverReferenceAsset = {
  id: string
  name: string
  originalFileName: string
  mimeType: string
  fileUrl: string
  metadata: Record<string, unknown>
}

export type DiscoverCategory = {
  id: string
  name: string
  slug: string
  sortOrder: number
  status: 'active' | 'disabled'
  createdAt: string
  updatedAt: string
}

export type DiscoverItem = {
  id: string
  categoryId: string
  sourceAssetId: string
  title: string
  description: string
  mediaType: DiscoverMediaType
  mimeType: string
  fileUrl: string
  coverUrl: string
  originalFileName: string
  fileSize: number
  likeCount: number
  viewCount: number
  duration: number
  sourceCreatedAt: string | null
  sourceCompletedAt: string | null
  referenceAssets: DiscoverReferenceAsset[]
  aspectRatio: string
  publishedAt: string | null
  createdAt: string
  updatedAt: string
}
