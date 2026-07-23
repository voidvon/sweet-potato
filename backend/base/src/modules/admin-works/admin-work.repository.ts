import { db } from '../../db/database.js'
import type { AdminWork, AdminWorkListInput, AdminWorkListResult, AdminWorkMediaType } from './admin-work.types.js'

type AdminWorkRow = {
  id: string
  user_id: string
  username: string
  display_name: string
  name: string
  description: string
  mime_type: string
  file_url: string
  file_size: number
  metadata: string
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

function metadataText(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key]
  return typeof value === 'string' ? value.trim() : ''
}

function mapWork(row: AdminWorkRow): AdminWork {
  const metadata = parseMetadata(row.metadata)
  const mediaType: AdminWorkMediaType = row.mime_type.startsWith('image/') ? 'image' : 'video'
  return {
    id: row.id,
    userId: row.user_id,
    username: row.username,
    displayName: row.display_name,
    name: row.name,
    description: row.description,
    mediaType,
    mimeType: row.mime_type,
    fileUrl: row.file_url,
    fileSize: Number(row.file_size || 0),
    mode: metadataText(metadata, 'mode'),
    modeTitle: metadataText(metadata, 'modeTitle'),
    provider: metadataText(metadata, 'provider'),
    model: metadataText(metadata, 'model'),
    generatedAt: metadataText(metadata, 'generatedAt') || metadataText(metadata, 'completedAt') || row.updated_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

const completedWorkFilter = `
  a.resource_type = 'finished_video'
  AND TRIM(COALESCE(a.file_url, '')) <> ''
  AND LOWER(COALESCE(
    CASE WHEN json_valid(a.metadata) THEN json_extract(a.metadata, '$.generationStatus') END,
    ''
  )) NOT IN ('pending', 'queued', 'running', 'generating', 'failed')
`

export const adminWorkRepository = {
  list(input: AdminWorkListInput): AdminWorkListResult {
    const params: Record<string, string | number> = {
      limit: input.pageSize,
      offset: (input.page - 1) * input.pageSize,
    }
    const usernameFilter = input.username
      ? "AND LOWER(COALESCE(u.username, '')) LIKE @username"
      : ''
    if (input.username) params.username = `%${input.username.toLowerCase()}%`
    const searchFilter = input.search
      ? "AND (LOWER(a.name) LIKE @search OR LOWER(COALESCE(u.username, '')) LIKE @search OR LOWER(COALESCE(u.display_name, '')) LIKE @search)"
      : ''
    if (input.search) params.search = `%${input.search.toLowerCase()}%`

    const rows = db.prepare(`
      SELECT
        a.id,
        a.user_id,
        COALESCE(u.username, '') AS username,
        COALESCE(u.display_name, '') AS display_name,
        a.name,
        a.description,
        a.mime_type,
        a.file_url,
        a.file_size,
        a.metadata,
        a.created_at,
        a.updated_at
      FROM content_assets a
      LEFT JOIN users u ON u.id = a.user_id
      WHERE ${completedWorkFilter}
      ${usernameFilter}
      ${searchFilter}
      ORDER BY a.updated_at DESC, a.id DESC
      LIMIT @limit OFFSET @offset
    `).all(params) as AdminWorkRow[]

    const total = Number((db.prepare(`
      SELECT COUNT(*) AS total
      FROM content_assets a
      LEFT JOIN users u ON u.id = a.user_id
      WHERE ${completedWorkFilter}
      ${usernameFilter}
      ${searchFilter}
    `).get(params) as { total: number } | undefined)?.total || 0)

    return {
      items: rows.map(mapWork),
      page: input.page,
      pageSize: input.pageSize,
      total,
    }
  },
}
