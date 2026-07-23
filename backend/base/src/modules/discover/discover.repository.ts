import { randomUUID } from 'node:crypto'
import { db } from '../../db/database.js'
import type { DiscoverCategory, DiscoverItem, DiscoverMediaType, DiscoverReferenceAsset, DiscoverStatus } from './discover.types.js'

type CategoryRow = { id: string; name: string; slug: string; sort_order: number; status: 'active' | 'disabled'; created_at: string; updated_at: string }
type ItemRow = { id: string; category_id: string; source_asset_id: string; title: string; description: string; media_type: DiscoverMediaType; mime_type: string; file_url: string; original_file_name: string; file_size: number; like_count: number; view_count: number; duration: number; source_created_at: string | null; source_completed_at: string | null; reference_assets: string; aspect_ratio: string; status: DiscoverStatus; sort_order: number; published_at: string | null; created_at: string; updated_at: string }

const mapCategory = (row: CategoryRow): DiscoverCategory => ({ id: row.id, name: row.name, slug: row.slug, sortOrder: row.sort_order, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at })
const parseReferenceAssets = (value: string): DiscoverReferenceAsset[] => {
  try {
    const parsed = JSON.parse(value || '[]')
    return Array.isArray(parsed) ? parsed as DiscoverReferenceAsset[] : []
  } catch {
    return []
  }
}
const mapItem = (row: ItemRow): DiscoverItem => ({ id: row.id, categoryId: row.category_id, sourceAssetId: row.source_asset_id, title: row.title, description: row.description, mediaType: row.media_type, mimeType: row.mime_type, fileUrl: row.file_url, originalFileName: row.original_file_name, fileSize: Number(row.file_size || 0), likeCount: Number(row.like_count || 0), viewCount: Number(row.view_count || 0), duration: Number(row.duration || 0), sourceCreatedAt: row.source_created_at, sourceCompletedAt: row.source_completed_at, referenceAssets: parseReferenceAssets(row.reference_assets), aspectRatio: row.aspect_ratio || '1 / 1', status: row.status, sortOrder: row.sort_order, publishedAt: row.published_at, createdAt: row.created_at, updatedAt: row.updated_at })

function incrementPublicItemCount(id: string, column: 'like_count' | 'view_count') {
  const result = db.prepare(`
    UPDATE discover_items
    SET ${column} = ${column} + 1
    WHERE id = ?
      AND status = 'published'
      AND EXISTS (
        SELECT 1 FROM discover_categories c
        WHERE c.id = discover_items.category_id AND c.status = 'active'
      )
  `).run(id)
  if (!result.changes) return null

  return db.prepare('SELECT like_count AS likeCount, view_count AS viewCount FROM discover_items WHERE id = ?')
    .get(id) as Pick<DiscoverItem, 'likeCount' | 'viewCount'>
}

export const discoverRepository = {
  listCategories() {
    return (db.prepare('SELECT * FROM discover_categories ORDER BY sort_order ASC, name ASC').all() as CategoryRow[]).map(mapCategory)
  },
  findCategory(id: string) {
    const row = db.prepare('SELECT * FROM discover_categories WHERE id = ?').get(id) as CategoryRow | undefined
    return row ? mapCategory(row) : null
  },
  createCategory(input: { name: string; slug: string; sortOrder: number }) {
    const now = new Date().toISOString(); const id = randomUUID()
    db.prepare('INSERT INTO discover_categories (id, name, slug, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, input.name, input.slug, input.sortOrder, now, now)
    return this.findCategory(id)!
  },
  updateCategory(id: string, input: { name?: string; slug?: string; sortOrder?: number; status?: 'active' | 'disabled' }) {
    const current = this.findCategory(id); if (!current) return null
    const now = new Date().toISOString()
    db.prepare('UPDATE discover_categories SET name = ?, slug = ?, sort_order = ?, status = ?, updated_at = ? WHERE id = ?').run(input.name ?? current.name, input.slug ?? current.slug, input.sortOrder ?? current.sortOrder, input.status ?? current.status, now, id)
    return this.findCategory(id)
  },
  deleteCategory(id: string) {
    return db.prepare('DELETE FROM discover_categories WHERE id = ? AND NOT EXISTS (SELECT 1 FROM discover_items WHERE category_id = ?)').run(id, id).changes > 0
  },
  listItems(input: { status?: DiscoverStatus; categoryId?: string; publicOnly?: boolean }) {
    const clauses = [input.publicOnly
      ? "i.status = 'published' AND EXISTS (SELECT 1 FROM discover_categories c WHERE c.id = i.category_id AND c.status = 'active')"
      : '1 = 1']
    const params: Record<string, string> = {}
    if (input.status) { clauses.push('i.status = @status'); params.status = input.status }
    if (input.categoryId) { clauses.push('i.category_id = @categoryId'); params.categoryId = input.categoryId }
    return (db.prepare(`SELECT i.* FROM discover_items i WHERE ${clauses.join(' AND ')} ORDER BY i.sort_order ASC, i.published_at DESC, i.updated_at DESC`).all(params) as ItemRow[]).map(mapItem)
  },
  listPublicItems(input: { page: number; pageSize: number; categoryId?: string; mediaType?: DiscoverMediaType; search?: string }) {
    const clauses = ["i.status = 'published' AND EXISTS (SELECT 1 FROM discover_categories c WHERE c.id = i.category_id AND c.status = 'active')"]
    const params: Record<string, string | number> = {
      limit: input.pageSize,
      offset: (input.page - 1) * input.pageSize,
    }
    if (input.categoryId) { clauses.push('i.category_id = @categoryId'); params.categoryId = input.categoryId }
    if (input.mediaType) { clauses.push('i.media_type = @mediaType'); params.mediaType = input.mediaType }
    if (input.search) {
      clauses.push("(LOWER(i.title) LIKE @search OR LOWER(i.description) LIKE @search)")
      params.search = `%${input.search.toLowerCase()}%`
    }
    const where = clauses.join(' AND ')
    const items = (db.prepare(`SELECT i.* FROM discover_items i WHERE ${where} ORDER BY i.sort_order ASC, i.published_at DESC, i.updated_at DESC, i.id DESC LIMIT @limit OFFSET @offset`).all(params) as ItemRow[]).map(mapItem)
    const total = Number((db.prepare(`SELECT COUNT(*) AS total FROM discover_items i WHERE ${where}`).get(params) as { total: number } | undefined)?.total || 0)
    return { items, page: input.page, pageSize: input.pageSize, total }
  },
  findItem(id: string) {
    const row = db.prepare('SELECT * FROM discover_items WHERE id = ?').get(id) as ItemRow | undefined
    return row ? mapItem(row) : null
  },
  incrementLikeCount(id: string) { return incrementPublicItemCount(id, 'like_count') },
  incrementViewCount(id: string) { return incrementPublicItemCount(id, 'view_count') },
  createItem(input: Omit<DiscoverItem, 'id' | 'createdAt' | 'updatedAt' | 'publishedAt'> & { publishedAt?: string | null }) {
    const now = new Date().toISOString(); const id = randomUUID()
    db.prepare(`INSERT INTO discover_items (id, category_id, source_asset_id, title, description, media_type, mime_type, file_url, original_file_name, file_size, like_count, view_count, duration, source_created_at, source_completed_at, reference_assets, aspect_ratio, status, sort_order, published_at, created_at, updated_at) VALUES (@id, @categoryId, @sourceAssetId, @title, @description, @mediaType, @mimeType, @fileUrl, @originalFileName, @fileSize, @likeCount, @viewCount, @duration, @sourceCreatedAt, @sourceCompletedAt, @referenceAssetsJson, @aspectRatio, @status, @sortOrder, @publishedAt, @createdAt, @updatedAt)`).run({ id, ...input, referenceAssetsJson: JSON.stringify(input.referenceAssets), createdAt: now, updatedAt: now, publishedAt: input.status === 'published' ? (input.publishedAt || now) : null })
    return this.findItem(id)!
  },
  updateItem(id: string, input: Partial<Pick<DiscoverItem, 'categoryId' | 'title' | 'description' | 'status' | 'sortOrder'>>) {
    const current = this.findItem(id); if (!current) return null
    const now = new Date().toISOString(); const status = input.status ?? current.status
    db.prepare('UPDATE discover_items SET category_id = ?, title = ?, description = ?, status = ?, sort_order = ?, published_at = ?, updated_at = ? WHERE id = ?').run(input.categoryId ?? current.categoryId, input.title ?? current.title, input.description ?? current.description, status, input.sortOrder ?? current.sortOrder, status === 'published' ? (current.publishedAt || now) : null, now, id)
    return this.findItem(id)
  },
  deleteItem(id: string) { return db.prepare('DELETE FROM discover_items WHERE id = ?').run(id).changes > 0 },
}
