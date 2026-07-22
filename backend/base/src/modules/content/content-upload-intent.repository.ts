import { db } from '../../db/database.js'
import type { ContentAssetLifecycleStatus, ContentResourceType } from './content.types.js'

export type FileUploadIntent = {
  id: string
  userId: string
  groupId: string
  provider: 'tos'
  bucket: string
  objectKey: string
  publicFileUrl: string
  resourceType: ContentResourceType
  originalFileName: string
  storedFileName: string
  mimeType: string
  fileSize: number
  name: string
  description: string
  assetKind: string
  lifecycleStatus: ContentAssetLifecycleStatus
  metadata: Record<string, unknown>
  status: 'pending' | 'completed'
  assetId: string | null
  expiresAt: string
  createdAt: string
  completedAt: string | null
}

type FileUploadIntentRow = {
  id: string
  user_id: string
  group_id: string
  provider: 'tos'
  bucket: string
  object_key: string
  public_file_url: string
  resource_type: ContentResourceType
  original_file_name: string
  stored_file_name: string
  mime_type: string
  file_size: number
  name: string
  description: string
  asset_kind: string
  lifecycle_status: ContentAssetLifecycleStatus
  metadata: string
  status: 'pending' | 'completed'
  asset_id: string | null
  expires_at: string
  created_at: string
  completed_at: string | null
}

function serialize(row: FileUploadIntentRow): FileUploadIntent {
  let metadata: Record<string, unknown> = {}
  try {
    const parsed = JSON.parse(row.metadata)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) metadata = parsed
  } catch {}
  return {
    id: row.id,
    userId: row.user_id,
    groupId: row.group_id,
    provider: row.provider,
    bucket: row.bucket,
    objectKey: row.object_key,
    publicFileUrl: row.public_file_url,
    resourceType: row.resource_type,
    originalFileName: row.original_file_name,
    storedFileName: row.stored_file_name,
    mimeType: row.mime_type,
    fileSize: row.file_size,
    name: row.name,
    description: row.description,
    assetKind: row.asset_kind,
    lifecycleStatus: row.lifecycle_status,
    metadata,
    status: row.status,
    assetId: row.asset_id,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  }
}

export const contentUploadIntentRepository = {
  create(intent: FileUploadIntent) {
    db.prepare(`
      INSERT INTO file_upload_intents (
        id, user_id, group_id, provider, bucket, object_key, public_file_url, resource_type,
        original_file_name, stored_file_name, mime_type, file_size, name,
        description, asset_kind, lifecycle_status, metadata, status, asset_id,
        expires_at, created_at, completed_at
      ) VALUES (
        @id, @userId, @groupId, @provider, @bucket, @objectKey, @publicFileUrl, @resourceType,
        @originalFileName, @storedFileName, @mimeType, @fileSize, @name,
        @description, @assetKind, @lifecycleStatus, @metadata, @status, @assetId,
        @expiresAt, @createdAt, @completedAt
      )
    `).run({ ...intent, metadata: JSON.stringify(intent.metadata) })
    return this.find(intent.id)
  },

  find(id: string) {
    const row = db.prepare('SELECT * FROM file_upload_intents WHERE id = ?').get(id) as FileUploadIntentRow | undefined
    return row ? serialize(row) : null
  },

  complete(id: string, assetId: string) {
    const completedAt = new Date().toISOString()
    db.prepare(`
      UPDATE file_upload_intents
      SET status = 'completed', asset_id = ?, completed_at = ?
      WHERE id = ? AND status = 'pending'
    `).run(assetId, completedAt, id)
    return this.find(id)
  },
}
