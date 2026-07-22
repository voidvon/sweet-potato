import { db } from '../../db/database.js'
import type {
  ManagedFile,
  ManagedFileListInput,
  ManagedFileListResult,
  ManagedFileMediaType,
  ManagedFileStorageProvider,
} from './file-management.types.js'

type ManagedFileRow = {
  id: string
  name: string
  original_file_name: string
  mime_type: string
  file_size: number
  file_url: string
  resource_type: string
  asset_kind: string
  lifecycle_status: string
  metadata: string
  storage_provider: ManagedFileStorageProvider
  reference_count: number
  user_id: string
  username: string
  created_at: string
  updated_at: string
}

function parseMetadata(value: string) {
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

function mediaTypeForMimeType(mimeType: string): ManagedFileMediaType {
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType.startsWith('video/')) return 'video'
  if (mimeType.startsWith('audio/')) return 'audio'
  if (mimeType.startsWith('text/') || mimeType.startsWith('application/')) return 'document'
  return 'other'
}

function mapFile(row: ManagedFileRow): ManagedFile {
  const metadata = parseMetadata(row.metadata)
  return {
    id: row.id,
    name: row.name,
    originalFileName: row.original_file_name,
    mimeType: row.mime_type,
    fileSize: Number(row.file_size || 0),
    fileUrl: row.file_url,
    resourceType: row.resource_type,
    assetKind: row.asset_kind,
    lifecycleStatus: row.lifecycle_status,
    storageProvider: row.storage_provider,
    storageKey: typeof metadata.storageKey === 'string' ? metadata.storageKey : row.original_file_name,
    storageBucket: typeof metadata.storageBucket === 'string' ? metadata.storageBucket : '',
    mediaType: mediaTypeForMimeType(row.mime_type),
    referenceCount: Number(row.reference_count || 0),
    userId: row.user_id,
    username: row.username,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

const storageProviderSql = `
  CASE
    WHEN json_valid(a.metadata)
      AND LOWER(COALESCE(json_extract(a.metadata, '$.storageProvider'), '')) = 'tos'
    THEN 'tos'
    ELSE 'local'
  END
`

function mediaTypeFilterSql(mediaType: ManagedFileMediaType) {
  if (mediaType === 'image') return "a.mime_type LIKE 'image/%'"
  if (mediaType === 'video') return "a.mime_type LIKE 'video/%'"
  if (mediaType === 'audio') return "a.mime_type LIKE 'audio/%'"
  if (mediaType === 'document') return "(a.mime_type LIKE 'text/%' OR a.mime_type LIKE 'application/%')"
  return "(a.mime_type NOT LIKE 'image/%' AND a.mime_type NOT LIKE 'video/%' AND a.mime_type NOT LIKE 'audio/%' AND a.mime_type NOT LIKE 'text/%' AND a.mime_type NOT LIKE 'application/%')"
}

function buildFilters(input: ManagedFileListInput) {
  const filters: string[] = []
  const params: Record<string, string | number> = {}
  if (input.search) {
    filters.push(`(
      LOWER(a.name) LIKE @search
      OR LOWER(a.original_file_name) LIKE @search
      OR LOWER(a.stored_file_name) LIKE @search
      OR LOWER(COALESCE(u.username, '')) LIKE @search
    )`)
    params.search = `%${input.search.toLowerCase()}%`
  }
  if (input.storageProvider) {
    filters.push(`${storageProviderSql} = @storageProvider`)
    params.storageProvider = input.storageProvider
  }
  if (input.mediaType) {
    filters.push(mediaTypeFilterSql(input.mediaType))
  }
  if (input.lifecycleStatus) {
    filters.push('a.lifecycle_status = @lifecycleStatus')
    params.lifecycleStatus = input.lifecycleStatus
  }
  if (input.createdAtFrom) {
    filters.push('a.created_at >= @createdAtFrom')
    params.createdAtFrom = input.createdAtFrom
  }
  if (input.createdAtTo) {
    filters.push('a.created_at <= @createdAtTo')
    params.createdAtTo = input.createdAtTo
  }
  return {
    where: filters.length ? `WHERE ${filters.join(' AND ')}` : '',
    params,
  }
}

export const fileManagementRepository = {
  findAssetByStorageKey(storageKey: string) {
    const row = db.prepare(`
      SELECT id
      FROM content_assets
      WHERE json_valid(metadata)
        AND json_extract(metadata, '$.storageKey') = ?
      LIMIT 1
    `).get(storageKey) as { id: string } | undefined
    return row?.id || null
  },

  list(input: ManagedFileListInput): ManagedFileListResult {
    const { where, params } = buildFilters(input)
    const pageParams = {
      ...params,
      limit: input.pageSize,
      offset: (input.page - 1) * input.pageSize,
    }
    const rows = db.prepare(`
      SELECT
        a.id,
        a.name,
        a.original_file_name,
        a.mime_type,
        a.file_size,
        a.file_url,
        a.resource_type,
        a.asset_kind,
        a.lifecycle_status,
        a.metadata,
        ${storageProviderSql} AS storage_provider,
        (
          SELECT COUNT(*)
          FROM content_asset_references r
          WHERE r.asset_id = a.id
        ) AS reference_count,
        a.user_id,
        COALESCE(u.username, '') AS username,
        a.created_at,
        a.updated_at
      FROM content_assets a
      LEFT JOIN users u ON u.id = a.user_id
      ${where}
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT @limit OFFSET @offset
    `).all(pageParams) as ManagedFileRow[]
    const total = Number((db.prepare(`
      SELECT COUNT(*) AS total
      FROM content_assets a
      LEFT JOIN users u ON u.id = a.user_id
      ${where}
    `).get(params) as { total: number } | undefined)?.total || 0)
    const summary = db.prepare(`
      SELECT
        COUNT(*) AS totalCount,
        COALESCE(SUM(a.file_size), 0) AS totalBytes,
        SUM(CASE WHEN ${storageProviderSql} = 'local' THEN 1 ELSE 0 END) AS localCount,
        COALESCE(SUM(CASE WHEN ${storageProviderSql} = 'local' THEN a.file_size ELSE 0 END), 0) AS localBytes,
        SUM(CASE WHEN ${storageProviderSql} = 'tos' THEN 1 ELSE 0 END) AS tosCount,
        COALESCE(SUM(CASE WHEN ${storageProviderSql} = 'tos' THEN a.file_size ELSE 0 END), 0) AS tosBytes
      FROM content_assets a
    `).get() as {
      totalCount: number
      totalBytes: number
      localCount: number
      localBytes: number
      tosCount: number
      tosBytes: number
    }
    return {
      items: rows.map(mapFile),
      page: input.page,
      pageSize: input.pageSize,
      total,
      summary: {
        totalCount: Number(summary.totalCount || 0),
        totalBytes: Number(summary.totalBytes || 0),
        localCount: Number(summary.localCount || 0),
        localBytes: Number(summary.localBytes || 0),
        tosCount: Number(summary.tosCount || 0),
        tosBytes: Number(summary.tosBytes || 0),
      },
    }
  },
}
