import { randomUUID } from 'node:crypto';
import { db } from '../../db/database.js';
import type {
  ContentAsset,
  ContentAssetGroup,
  ContentAssetLifecycleStatus,
  ContentResourceType,
  CreateAssetGroupPayload,
  CreateAssetPayload,
  CreateVideoTaskFromPromptPayload,
  UpdateAssetGroupPayload,
  UpdateAssetPayload,
  UpdateVideoTaskContextPayload,
  UpdateVideoParsePayload,
  TemporaryAssetCleanupCandidate,
  TemporaryAssetCleanupLog,
  VideoGenerationResult,
  VideoGenerationTask,
  VideoParseResult,
  VideoTaskStatus,
  ViralReplicationPlan,
  ViralVideoAnalysis,
} from './content.types.js';

type AssetGroupRow = {
  id: string;
  user_id: string;
  resource_type: ContentResourceType;
  name: string;
  description: string;
  metadata: string;
  created_at: string;
  updated_at: string;
};

type AssetRow = {
  id: string;
  group_id: string;
  user_id: string;
  resource_type: ContentResourceType;
  name: string;
  description: string;
  original_file_name: string;
  stored_file_name: string;
  mime_type: string;
  file_size: number;
  file_path: string;
  file_url: string;
  asset_kind: string;
  lifecycle_status: ContentAssetLifecycleStatus;
  parent_asset_id: string | null;
  expires_at: string | null;
  retained_at: string | null;
  metadata: string;
  created_at: string;
  updated_at: string;
};

type VideoTaskRow = {
  id: string;
  user_id: string;
  source_url: string;
  prompt: string;
  title: string;
  status: VideoTaskStatus;
  raw_parse_result: string;
  editable_parse_result: string;
  selected_skill_ids: string;
  expert_context: string;
  selected_digital_human_id: string | null;
  selected_voice_id: string | null;
  selected_scene_id: string | null;
  generated_video_url: string | null;
  aspect_ratio: string;
  credit_cost?: number | null;
  failure_reason: string | null;
  created_at: string;
  updated_at: string;
};

function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function parseJsonArray(value: string): unknown[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseStringArray(value: string): string[] {
  return parseJsonArray(value)
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeSearchToken(value: string) {
  return value.trim().toLowerCase().replace(/：/g, ':');
}

function isAspectRatioSearchToken(value: string) {
  return /^\d{1,2}:\d{1,2}$/.test(value);
}

function isVideoTaskIdSearchToken(value: string) {
  return /^[0-9a-f]{8}(?:-[0-9a-f]{0,12}){0,4}$/.test(value);
}

const emptyParseResult: VideoParseResult = {
  person: '',
  scene: '',
  voice: '',
  shotLanguage: '',
  product: '',
  pip: '',
  spokenContent: '',
  extraDetails: '',
  analysisProcess: [],
};

function parseVideoResult(value: string): VideoParseResult {
  const parsed = parseJsonObject(value);
  return {
    person: String(parsed.person || ''),
    scene: String(parsed.scene || ''),
    voice: String(parsed.voice || ''),
    shotLanguage: String(parsed.shotLanguage || ''),
    product: String(parsed.product || ''),
    pip: String(parsed.pip || ''),
    pictureInPicture: parseJsonObject(JSON.stringify(parsed.pictureInPicture || {})) as VideoParseResult['pictureInPicture'],
    spokenContent: String(parsed.spokenContent || ''),
    extraDetails: String(parsed.extraDetails || ''),
    analysisProcess: Array.isArray(parsed.analysisProcess)
      ? parsed.analysisProcess
        .map((item) => parseJsonObject(JSON.stringify(item)))
        .map((item) => ({
          key: String(item.key || ''),
          label: String(item.label || ''),
          items: Array.isArray(item.items)
            ? item.items
              .map((entry) => parseJsonObject(JSON.stringify(entry)))
              .map((entry) => ({ label: String(entry.label || ''), value: String(entry.value || '') }))
              .filter((entry) => entry.label || entry.value)
            : [],
          conclusion: String(item.conclusion || ''),
        }))
        .filter((item) => item.key || item.label || item.items.length || item.conclusion)
      : [],
    viralAnalysis: parsed.viralAnalysis as ViralVideoAnalysis | undefined,
    replicationPlan: parsed.replicationPlan as ViralReplicationPlan | undefined,
    videoGenerationResult: parsed.videoGenerationResult as VideoGenerationResult | undefined,
  };
}

function serializeGroup(row: AssetGroupRow & { username?: string }): ContentAssetGroup {
  return {
    id: row.id,
    userId: row.user_id,
    username: row.username,
    resourceType: row.resource_type,
    name: row.name,
    description: row.description,
    metadata: parseJsonObject(row.metadata),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function serializeAsset(row: AssetRow): ContentAsset {
  return {
    id: row.id,
    groupId: row.group_id,
    userId: row.user_id,
    resourceType: row.resource_type,
    name: row.name,
    description: row.description,
    originalFileName: row.original_file_name,
    storedFileName: row.stored_file_name,
    mimeType: row.mime_type,
    fileSize: row.file_size,
    filePath: row.file_path,
    fileUrl: row.file_url,
    assetKind: row.asset_kind,
    lifecycleStatus: row.lifecycle_status,
    parentAssetId: row.parent_asset_id,
    expiresAt: row.expires_at,
    retainedAt: row.retained_at,
    metadata: parseJsonObject(row.metadata),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function serializeVideoTask(row: VideoTaskRow): VideoGenerationTask {
  const expertContext = parseJsonObject(row.expert_context);
  return {
    id: row.id,
    userId: row.user_id,
    sourceUrl: row.source_url,
    prompt: row.prompt,
    title: row.title,
    status: row.status,
    rawParseResult: parseVideoResult(row.raw_parse_result),
    editableParseResult: parseVideoResult(row.editable_parse_result),
    selectedSkillIds: parseStringArray(row.selected_skill_ids),
    expertContext,
    selectedDigitalHumanId: row.selected_digital_human_id,
    selectedVoiceId: row.selected_voice_id,
    selectedSceneId: row.selected_scene_id,
    generatedVideoUrl: row.generated_video_url,
    aspectRatio: row.aspect_ratio,
    creditCost: videoTaskCreditCost(row, expertContext),
    failureReason: row.failure_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function videoTaskCreditCost(row: VideoTaskRow, expertContext: Record<string, unknown>) {
  if (typeof row.credit_cost === 'number') {
    return Number(row.credit_cost || 0);
  }
  const mode = String(expertContext.mode || '').trim();
  const isCompletedProduction = row.status === 'success'
    && (!mode || ['video_create', 'video_generation', 'video_upscale', 'subtitle_removal', 'video_translation'].includes(mode));
  if (!isCompletedProduction) {
    return null;
  }
  // Older completed tasks predate usage records. Keep their display-only fallback stable across requests.
  const seed = [...row.id].reduce((total, character) => total + character.charCodeAt(0), 0);
  return 10 + seed % 31;
}

const videoTaskSelectSql = `
  v.*,
  (
    SELECT SUM(b.credit_cost)
    FROM billable_usage_records b
    WHERE b.category IN ('video_generation', 'video_upscale')
      AND b.task_id = v.id
      AND b.status = 'completed'
  ) AS credit_cost
`;

export const emptyVideoParseResult = emptyParseResult;

export const contentRepository = {
  listGroups(input: { userId?: string; resourceType?: ContentResourceType }) {
    const filters: string[] = [];
    const params: Record<string, string> = {};
    if (input.userId) {
      filters.push('user_id = @userId');
      params.userId = input.userId;
    }
    if (input.resourceType) {
      filters.push('resource_type = @resourceType');
      params.resourceType = input.resourceType;
    }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const rows = db.prepare(`
      SELECT * FROM content_asset_groups
      ${where}
      ORDER BY updated_at DESC
    `).all(params) as AssetGroupRow[];
    return rows.map(serializeGroup);
  },

  listGroupsPage(input: { userId?: string; resourceType?: ContentResourceType; page: number; pageSize: number }) {
    const filters: string[] = [];
    const params: Record<string, string | number> = {
      limit: input.pageSize,
      offset: (input.page - 1) * input.pageSize,
    };
    if (input.userId) {
      filters.push('user_id = @userId');
      params.userId = input.userId;
    }
    if (input.resourceType) {
      filters.push('resource_type = @resourceType');
      params.resourceType = input.resourceType;
    }
    const where = filters.join(' AND ');
    const rows = db.prepare(`
      SELECT g.*, u.username FROM content_asset_groups g
      LEFT JOIN users u ON g.user_id = u.id
      ${where ? `WHERE ${where}` : ''}
      ORDER BY g.updated_at DESC
      LIMIT @limit OFFSET @offset
    `).all(params) as (AssetGroupRow & { username?: string })[];
    const total = Number((db.prepare(`
      SELECT COUNT(*) as total FROM content_asset_groups
      ${where ? `WHERE ${where}` : ''}
    `).get(params) as { total: number } | undefined)?.total || 0);
    const groups = rows.map(serializeGroup);
    if (!groups.length) {
      return { items: groups, page: input.page, pageSize: input.pageSize, total };
    }
    const groupIds = groups.map((group) => group.id);
    const placeholders = groupIds.map((_, index) => `@groupId${index}`).join(',');
    const groupParams = Object.fromEntries(groupIds.map((id, index) => [`groupId${index}`, id]));
    const counts = db.prepare(`
      SELECT group_id as groupId, COUNT(*) as count
      FROM content_assets
      WHERE group_id IN (${placeholders})
        AND NOT (
          resource_type = 'digital_human'
          AND (
            metadata LIKE '%"kind":"three_view_result"%'
            OR metadata LIKE '%"kind":"three_view_failure"%'
            OR metadata LIKE '%"kind":"three_view_running"%'
          )
        )
      GROUP BY group_id
    `).all(groupParams) as Array<{ groupId: string; count: number }>;
    const countMap = new Map(counts.map((item) => [item.groupId, item.count]));
    const coverRows = db.prepare(`
      SELECT * FROM content_assets
      WHERE group_id IN (${placeholders})
      ORDER BY group_id ASC, updated_at DESC
    `).all(groupParams) as AssetRow[];
    const coverMap = new Map<string, ReturnType<typeof serializeAsset>[]>();
    coverRows.forEach((row) => {
      const list = coverMap.get(row.group_id) || [];
      if (list.length < 3) {
        list.push(serializeAsset(row));
        coverMap.set(row.group_id, list);
      }
    });
    return {
      items: groups.map((group) => ({
        ...group,
        assetCount: countMap.get(group.id) || 0,
        coverAssets: coverMap.get(group.id) || [],
      })),
      page: input.page,
      pageSize: input.pageSize,
      total,
    };
  },

  findGroup(id: string) {
    const row = db.prepare('SELECT * FROM content_asset_groups WHERE id = ?').get(id) as AssetGroupRow | undefined;
    return row ? serializeGroup(row) : null;
  },

  createGroup(payload: CreateAssetGroupPayload) {
    const now = new Date().toISOString();
    const id = payload.id || randomUUID();
    db.prepare(`
      INSERT INTO content_asset_groups (id, user_id, resource_type, name, description, metadata, created_at, updated_at)
      VALUES (@id, @userId, @resourceType, @name, @description, @metadata, @now, @now)
    `).run({
      id,
      userId: payload.userId,
      resourceType: payload.resourceType,
      name: payload.name.trim(),
      description: payload.description?.trim() || '',
      metadata: JSON.stringify(payload.metadata || {}),
      now,
    });
    return this.findGroup(id);
  },

  updateGroup(id: string, payload: UpdateAssetGroupPayload) {
    const current = this.findGroup(id);
    if (!current) {
      return null;
    }
    const updatedAt = new Date().toISOString();
    db.prepare(`
      UPDATE content_asset_groups
      SET resource_type = @resourceType,
          name = @name,
          description = @description,
          metadata = @metadata,
          updated_at = @updatedAt
      WHERE id = @id
    `).run({
      id,
      resourceType: payload.resourceType || current.resourceType,
      name: payload.name?.trim() || current.name,
      description: payload.description?.trim() ?? current.description,
      metadata: JSON.stringify(payload.metadata ?? current.metadata),
      updatedAt,
    });
    return this.findGroup(id);
  },

  deleteGroup(id: string) {
    const remove = db.transaction(() => {
      db.prepare(`
        DELETE FROM content_asset_references
        WHERE asset_id IN (SELECT id FROM content_assets WHERE group_id = ?)
      `).run(id);
      db.prepare('DELETE FROM content_assets WHERE group_id = ?').run(id);
      return db.prepare('DELETE FROM content_asset_groups WHERE id = ?').run(id);
    });
    const result = remove();
    return result.changes > 0;
  },

  listAssets(input: { userId?: string; groupId?: string; resourceType?: ContentResourceType }) {
    const filters: string[] = [];
    const params: Record<string, string> = {};
    if (input.userId) {
      filters.push('user_id = @userId');
      params.userId = input.userId;
    }
    if (input.groupId) {
      filters.push('group_id = @groupId');
      params.groupId = input.groupId;
    }
    if (input.resourceType) {
      filters.push('resource_type = @resourceType');
      params.resourceType = input.resourceType;
    }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const rows = db.prepare(`
      SELECT * FROM content_assets
      ${where}
      ORDER BY updated_at DESC
    `).all(params) as AssetRow[];
    return rows.map(serializeAsset);
  },

  listAssetsPage(input: { userId?: string; groupId?: string; resourceType?: ContentResourceType; page: number; pageSize: number }) {
    const filters: string[] = [];
    const params: Record<string, string | number> = {
      limit: input.pageSize,
      offset: (input.page - 1) * input.pageSize,
    };
    if (input.userId) {
      filters.push('user_id = @userId');
      params.userId = input.userId;
    }
    if (input.groupId) {
      filters.push('group_id = @groupId');
      params.groupId = input.groupId;
    }
    if (input.resourceType) {
      filters.push('resource_type = @resourceType');
      params.resourceType = input.resourceType;
    }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const rows = db.prepare(`
      SELECT * FROM content_assets
      ${where}
      ORDER BY updated_at DESC
      LIMIT @limit OFFSET @offset
    `).all(params) as AssetRow[];
    const total = Number((db.prepare(`
      SELECT COUNT(*) as total FROM content_assets
      ${where}
    `).get(params) as { total: number } | undefined)?.total || 0);
    return {
      items: rows.map(serializeAsset),
      page: input.page,
      pageSize: input.pageSize,
      total,
    };
  },

  findAsset(id: string) {
    const row = db.prepare('SELECT * FROM content_assets WHERE id = ?').get(id) as AssetRow | undefined;
    return row ? serializeAsset(row) : null;
  },

  createAsset(payload: CreateAssetPayload) {
    const now = new Date().toISOString();
    const id = randomUUID();
    db.prepare(`
      INSERT INTO content_assets (
        id, group_id, user_id, resource_type, type, name, description, source_url, original_file_name,
        stored_file_name, mime_type, file_size, size, file_path, file_url, asset_kind, lifecycle_status,
        parent_asset_id, expires_at, retained_at, metadata, created_at, updated_at
      )
      VALUES (
        @id, @groupId, @userId, @resourceType, 'file', @name, @description, NULL, @originalFileName,
        @storedFileName, @mimeType, @fileSize, @fileSize, @filePath, @fileUrl, @assetKind, @lifecycleStatus,
        @parentAssetId, @expiresAt, @retainedAt, @metadata, @now, @now
      )
    `).run({
      id,
      ...payload,
      description: payload.description?.trim() || '',
      assetKind: payload.assetKind?.trim() || 'library',
      lifecycleStatus: payload.lifecycleStatus || 'permanent',
      parentAssetId: payload.parentAssetId || null,
      expiresAt: payload.expiresAt || null,
      retainedAt: payload.retainedAt || null,
      metadata: JSON.stringify(payload.metadata || {}),
      now,
    });
    return this.findAsset(id);
  },

  updateAsset(id: string, payload: UpdateAssetPayload) {
    const current = this.findAsset(id);
    if (!current) {
      return null;
    }
    const updatedAt = new Date().toISOString();
    db.prepare(`
      UPDATE content_assets
      SET group_id = @groupId,
          resource_type = @resourceType,
          name = @name,
          description = @description,
          file_url = @fileUrl,
          metadata = @metadata,
          updated_at = @updatedAt
      WHERE id = @id
    `).run({
      id,
      groupId: payload.groupId || current.groupId,
      resourceType: payload.resourceType || current.resourceType,
      name: payload.name?.trim() || current.name,
      description: payload.description?.trim() ?? current.description,
      fileUrl: payload.fileUrl || current.fileUrl,
      metadata: JSON.stringify(payload.metadata || current.metadata),
      updatedAt,
    });
    return this.findAsset(id);
  },

  updateAssetFileInfo(id: string, payload: {
    name?: string;
    description?: string;
    originalFileName?: string;
    storedFileName?: string;
    mimeType?: string;
    fileSize?: number;
    filePath?: string;
    fileUrl?: string;
    metadata?: Record<string, unknown>;
    updatedAt?: string;
  }) {
    const current = this.findAsset(id);
    if (!current) {
      return null;
    }
    const updatedAt = payload.updatedAt || new Date().toISOString();
    db.prepare(`
      UPDATE content_assets
      SET name = @name,
          description = @description,
          original_file_name = @originalFileName,
          stored_file_name = @storedFileName,
          mime_type = @mimeType,
          file_size = @fileSize,
          size = @fileSize,
          file_path = @filePath,
          file_url = @fileUrl,
          metadata = @metadata,
          updated_at = @updatedAt
      WHERE id = @id
    `).run({
      id,
      name: payload.name?.trim() || current.name,
      description: payload.description ?? current.description,
      originalFileName: payload.originalFileName ?? current.originalFileName,
      storedFileName: payload.storedFileName ?? current.storedFileName,
      mimeType: payload.mimeType ?? current.mimeType,
      fileSize: payload.fileSize ?? current.fileSize,
      filePath: payload.filePath ?? current.filePath,
      fileUrl: payload.fileUrl ?? current.fileUrl,
      metadata: JSON.stringify(payload.metadata || current.metadata),
      updatedAt,
    });
    return this.findAsset(id);
  },

  updateFinishedVideoAssetFile(id: string, payload: {
    description?: string;
    originalFileName?: string;
    storedFileName?: string;
    mimeType?: string;
    fileSize?: number;
    filePath?: string;
    fileUrl?: string;
    metadata?: Record<string, unknown>;
    updatedAt?: string;
  }) {
    const current = this.findAsset(id);
    if (!current || current.resourceType !== 'finished_video') {
      return null;
    }
    const updatedAt = payload.updatedAt || new Date().toISOString();
    db.prepare(`
      UPDATE content_assets
      SET description = @description,
          original_file_name = @originalFileName,
          stored_file_name = @storedFileName,
          mime_type = @mimeType,
          file_size = @fileSize,
          size = @fileSize,
          file_path = @filePath,
          file_url = @fileUrl,
          metadata = @metadata,
          updated_at = @updatedAt
      WHERE id = @id
    `).run({
      id,
      description: payload.description ?? current.description,
      originalFileName: payload.originalFileName ?? current.originalFileName,
      storedFileName: payload.storedFileName ?? current.storedFileName,
      mimeType: payload.mimeType ?? current.mimeType,
      fileSize: payload.fileSize ?? current.fileSize,
      filePath: payload.filePath ?? current.filePath,
      fileUrl: payload.fileUrl ?? current.fileUrl,
      metadata: JSON.stringify(payload.metadata || current.metadata),
      updatedAt,
    });
    return this.findAsset(id);
  },

  deleteAsset(id: string) {
    const current = this.findAsset(id);
    if (!current) {
      return null;
    }
    const remove = db.transaction(() => {
      db.prepare('DELETE FROM content_asset_references WHERE asset_id = ?').run(id);
      db.prepare('DELETE FROM content_assets WHERE id = ?').run(id);
    });
    remove();
    return current;
  },

  listExpiredTemporaryAssets(now: string, limit = 100) {
    const rows = db.prepare(`
      SELECT * FROM content_assets
      WHERE lifecycle_status = 'temporary'
        AND expires_at IS NOT NULL
        AND expires_at <= @now
        AND NOT EXISTS (
          SELECT 1 FROM content_asset_references r WHERE r.asset_id = content_assets.id
        )
      ORDER BY expires_at ASC
      LIMIT @limit
    `).all({ now, limit: Math.max(1, Math.min(1000, limit)) }) as AssetRow[];
    return rows.map(serializeAsset);
  },

  deleteExpiredTemporaryAsset(id: string, now: string) {
    const remove = db.transaction(() => {
      const row = db.prepare(`
        SELECT * FROM content_assets
        WHERE id = @id
          AND lifecycle_status = 'temporary'
          AND expires_at IS NOT NULL
          AND expires_at <= @now
          AND NOT EXISTS (
            SELECT 1 FROM content_asset_references r WHERE r.asset_id = content_assets.id
          )
      `).get({ id, now }) as AssetRow | undefined;
      if (!row) return null;
      db.prepare('DELETE FROM content_assets WHERE id = ?').run(id);
      return serializeAsset(row);
    });
    return remove();
  },

  retainAssetsForReference(input: {
    assetIds: string[];
    userId: string;
    referenceType: string;
    referenceId: string;
    role?: string;
  }) {
    const assetIds = Array.from(new Set(input.assetIds.map((id) => id.trim()).filter(Boolean)));
    const retain = db.transaction(() => {
      const now = new Date().toISOString();
      const findAsset = db.prepare('SELECT user_id FROM content_assets WHERE id = ?');
      const insertReference = db.prepare(`
        INSERT OR IGNORE INTO content_asset_references (
          asset_id, reference_type, reference_id, role, created_at
        ) VALUES (?, ?, ?, ?, ?)
      `);
      const markRetained = db.prepare(`
        UPDATE content_assets
        SET lifecycle_status = 'retained', expires_at = NULL, retained_at = ?, updated_at = ?
        WHERE id = ? AND lifecycle_status = 'temporary'
      `);
      for (const assetId of assetIds) {
        const asset = findAsset.get(assetId) as { user_id: string } | undefined;
        if (!asset || asset.user_id !== input.userId) {
          throw new Error('引用素材不存在');
        }
        insertReference.run(assetId, input.referenceType, input.referenceId, input.role || 'input', now);
        markRetained.run(now, now, assetId);
      }
    });
    retain();
  },

  deleteAssetReferences(referenceType: string, referenceId: string) {
    db.prepare(`
      DELETE FROM content_asset_references
      WHERE reference_type = ? AND reference_id = ?
    `).run(referenceType, referenceId);
  },

  listAssetIdsForReference(referenceType: string, referenceId: string) {
    const rows = db.prepare(`
      SELECT DISTINCT asset_id
      FROM content_asset_references
      WHERE reference_type = ? AND reference_id = ?
    `).all(referenceType, referenceId) as Array<{ asset_id: string }>;
    return rows.map((row) => row.asset_id);
  },

  hasAssetReferences(assetId: string) {
    return Boolean(db.prepare(`
      SELECT 1 FROM content_asset_references WHERE asset_id = ? LIMIT 1
    `).get(assetId));
  },

  markAssetTemporaryIfUnreferenced(assetId: string, expiresAt: string) {
    const updatedAt = new Date().toISOString();
    return db.prepare(`
      UPDATE content_assets
      SET lifecycle_status = 'temporary', expires_at = @expiresAt, retained_at = NULL, updated_at = @updatedAt
      WHERE id = @assetId
        AND lifecycle_status = 'retained'
        AND NOT EXISTS (
          SELECT 1 FROM content_asset_references WHERE asset_id = @assetId
        )
    `).run({ assetId, expiresAt, updatedAt }).changes > 0;
  },

  listTemporaryAssetCleanupCandidates(input: { page: number; pageSize: number }) {
    const page = Math.max(1, Math.floor(input.page));
    const pageSize = Math.max(1, Math.min(100, Math.floor(input.pageSize)));
    const totalRow = db.prepare(`
      SELECT COUNT(*) AS total
      FROM content_assets
      WHERE lifecycle_status = 'temporary' AND expires_at IS NOT NULL
    `).get() as { total: number };
    const rows = db.prepare(`
      SELECT
        a.id,
        a.user_id,
        COALESCE(u.username, '') AS username,
        a.asset_kind,
        a.name,
        a.mime_type,
        a.file_size,
        a.file_url,
        a.parent_asset_id,
        a.expires_at,
        a.created_at
      FROM content_assets a
      LEFT JOIN users u ON u.id = a.user_id
      WHERE a.lifecycle_status = 'temporary' AND a.expires_at IS NOT NULL
      ORDER BY a.expires_at ASC, a.created_at ASC
      LIMIT @pageSize OFFSET @offset
    `).all({ pageSize, offset: (page - 1) * pageSize }) as Array<{
      id: string;
      user_id: string;
      username: string;
      asset_kind: string;
      name: string;
      mime_type: string;
      file_size: number;
      file_url: string;
      parent_asset_id: string | null;
      expires_at: string;
      created_at: string;
    }>;
    const items: TemporaryAssetCleanupCandidate[] = rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      username: row.username,
      assetKind: row.asset_kind,
      name: row.name,
      mimeType: row.mime_type,
      fileSize: row.file_size,
      fileUrl: row.file_url,
      parentAssetId: row.parent_asset_id,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
    }));
    return { items, page, pageSize, total: totalRow.total };
  },

  recordTemporaryAssetCleanup(asset: ContentAsset, triggerType: 'scheduled' | 'manual') {
    const usernameRow = db.prepare('SELECT username FROM users WHERE id = ?').get(asset.userId) as { username: string } | undefined;
    const insert = db.transaction(() => {
      const result = db.prepare(`
        INSERT INTO temporary_asset_cleanup_logs (
          asset_id, user_id, username, asset_kind, name, file_url, file_size,
          expires_at, trigger_type, cleaned_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        asset.id,
        asset.userId,
        usernameRow?.username || '',
        asset.assetKind,
        asset.name,
        asset.fileUrl,
        asset.fileSize,
        asset.expiresAt,
        triggerType,
        new Date().toISOString(),
      );
      db.prepare(`
        DELETE FROM temporary_asset_cleanup_logs
        WHERE id NOT IN (
          SELECT id FROM temporary_asset_cleanup_logs
          ORDER BY cleaned_at DESC, id DESC
          LIMIT 100
        )
      `).run();
      return Number(result.lastInsertRowid);
    });
    return insert();
  },

  listTemporaryAssetCleanupLogs() {
    const rows = db.prepare(`
      SELECT * FROM temporary_asset_cleanup_logs
      ORDER BY cleaned_at DESC, id DESC
      LIMIT 100
    `).all() as Array<{
      id: number;
      asset_id: string;
      user_id: string;
      username: string;
      asset_kind: string;
      name: string;
      file_url: string;
      file_size: number;
      expires_at: string | null;
      trigger_type: 'scheduled' | 'manual';
      cleaned_at: string;
    }>;
    return rows.map((row): TemporaryAssetCleanupLog => ({
      id: row.id,
      assetId: row.asset_id,
      userId: row.user_id,
      username: row.username,
      assetKind: row.asset_kind,
      name: row.name,
      fileUrl: row.file_url,
      fileSize: row.file_size,
      expiresAt: row.expires_at,
      triggerType: row.trigger_type,
      cleanedAt: row.cleaned_at,
    }));
  },

  listVideoTasks(userId: string, options: {
    mode?: string;
    modes?: string[];
    search?: string;
    createdAtFrom?: string;
    createdAtTo?: string;
    aspectRatio?: string;
    limit?: number;
  } = {}) {
    const clauses = ['user_id = @userId'];
    const params: Record<string, unknown> = {
      userId,
      limit: Math.max(1, Math.min(500, Math.floor(options.limit || 80))),
    };
    if (options.mode) {
      clauses.push("json_extract(expert_context, '$.mode') = @mode");
      params.mode = options.mode;
    }
    if (options.modes?.length) {
      const modes = Array.from(new Set(options.modes.map((item) => item.trim()).filter(Boolean)));
      if (modes.length) {
        const modeParams = modes.map((mode, index) => {
          const key = `mode${index}`;
          params[key] = mode;
          return `@${key}`;
        });
        clauses.push(`json_extract(expert_context, '$.mode') IN (${modeParams.join(', ')})`);
      }
    }
    if (options.createdAtFrom) {
      clauses.push('created_at >= @createdAtFrom');
      params.createdAtFrom = options.createdAtFrom;
    }
    if (options.createdAtTo) {
      clauses.push('created_at < @createdAtTo');
      params.createdAtTo = options.createdAtTo;
    }
    if (options.aspectRatio) {
      clauses.push('aspect_ratio = @aspectRatio');
      params.aspectRatio = options.aspectRatio;
    }
    const searchTokens = Array.from(new Set(
      String(options.search || '')
        .split(/\s+/)
        .map(normalizeSearchToken)
        .filter(Boolean)
        .slice(0, 6),
    ));
    const idTerms = searchTokens.filter(isVideoTaskIdSearchToken);
    idTerms.forEach((term, index) => {
      const key = `taskId${index}`;
      params[key] = term;
      clauses.push(`lower(id) = @${key}`);
    });
    const ratioTerms = searchTokens.filter(isAspectRatioSearchToken);
    ratioTerms.forEach((term, index) => {
      const key = `ratio${index}`;
      params[key] = term;
      clauses.push(`lower(coalesce(
        nullif(json_extract(editable_parse_result, '$.videoGenerationResult.ratio'), ''),
        nullif(json_extract(expert_context, '$.videoGenerationResult.ratio'), ''),
        nullif(json_extract(expert_context, '$.viralUnderstanding.videoGenerationResult.ratio'), ''),
        nullif(json_extract(expert_context, '$.ratio'), ''),
        ''
      )) = @${key}`);
    });
    const searchTerms = searchTokens.filter((term) => !isVideoTaskIdSearchToken(term) && !isAspectRatioSearchToken(term));
    searchTerms.forEach((term, index) => {
      const key = `search${index}`;
      params[key] = `%${term}%`;
      clauses.push(`(
        lower(id) LIKE @${key}
        OR lower(title) LIKE @${key}
        OR lower(prompt) LIKE @${key}
        OR lower(generated_video_url) LIKE @${key}
        OR lower(coalesce(failure_reason, '')) LIKE @${key}
        OR lower(raw_parse_result) LIKE @${key}
        OR lower(editable_parse_result) LIKE @${key}
        OR lower(expert_context) LIKE @${key}
        OR lower(created_at) LIKE @${key}
        OR lower(updated_at) LIKE @${key}
      )`);
    });
    const rows = db.prepare(`
      SELECT ${videoTaskSelectSql}
      FROM video_generation_tasks v
      WHERE ${clauses.join(' AND ')}
      ORDER BY created_at DESC
      LIMIT @limit
    `).all(params) as VideoTaskRow[];
    return rows.map(serializeVideoTask);
  },

  listGeneratingVideoTasks() {
    const rows = db.prepare(`
      SELECT ${videoTaskSelectSql}
      FROM video_generation_tasks v
      WHERE status = 'generating'
      ORDER BY updated_at ASC
      LIMIT 80
    `).all() as VideoTaskRow[];
    return rows.map(serializeVideoTask);
  },

  findVideoTask(id: string) {
    const row = db.prepare(`
      SELECT ${videoTaskSelectSql}
      FROM video_generation_tasks v
      WHERE v.id = ?
    `).get(id) as VideoTaskRow | undefined;
    return row ? serializeVideoTask(row) : null;
  },

  findReusableParsedVideoTask(userId: string, sourceUrl: string) {
    const rows = db.prepare(`
      SELECT ${videoTaskSelectSql}
      FROM video_generation_tasks v
      WHERE v.user_id = @userId
        AND v.source_url = @sourceUrl
        AND v.status IN ('waiting_edit', 'generating', 'success')
      ORDER BY updated_at DESC
      LIMIT 10
    `).all({ userId, sourceUrl }) as VideoTaskRow[];
    return rows
      .map(serializeVideoTask)
      .find((task) => Boolean(task.rawParseResult.analysisProcess?.length || task.editableParseResult.analysisProcess?.length))
      || null;
  },

  deleteVideoTask(id: string) {
    const current = this.findVideoTask(id);
    if (!current) {
      return null;
    }
    db.prepare('DELETE FROM video_generation_tasks WHERE id = ?').run(id);
    return current;
  },

  createParsedVideoTask(input: {
    userId: string;
    sourceUrl: string;
    title: string;
    parseResult: VideoParseResult;
    prompt?: string;
    selectedSkillIds?: string[];
    expertContext?: Record<string, unknown>;
    aspectRatio: string;
  }) {
    const now = new Date().toISOString();
    const id = randomUUID();
    const parseResult = JSON.stringify(input.parseResult);
    db.prepare(`
      INSERT INTO video_generation_tasks (
        id, user_id, source_url, prompt, title, status, raw_parse_result, editable_parse_result,
        selected_skill_ids, expert_context, selected_digital_human_id, selected_voice_id, selected_scene_id,
        generated_video_url, aspect_ratio, failure_reason, created_at, updated_at
      )
      VALUES (
        @id, @userId, @sourceUrl, @prompt, @title, 'waiting_edit', @parseResult, @parseResult,
        @selectedSkillIds, @expertContext, NULL, NULL, NULL, NULL, @aspectRatio, NULL, @now, @now
      )
    `).run({
      id,
      userId: input.userId,
      sourceUrl: input.sourceUrl,
      prompt: input.prompt || '',
      title: input.title,
      parseResult,
      selectedSkillIds: JSON.stringify(input.selectedSkillIds || []),
      expertContext: JSON.stringify(input.expertContext || {}),
      aspectRatio: input.aspectRatio,
      now,
    });
    return this.findVideoTask(id);
  },

  createVideoTaskFromPrompt(input: CreateVideoTaskFromPromptPayload & {
    expertContext: Record<string, unknown>;
    parseResult: VideoParseResult;
    title: string;
    aspectRatio: string;
  }) {
    const now = new Date().toISOString();
    const id = randomUUID();
    db.prepare(`
      INSERT INTO video_generation_tasks (
        id, user_id, source_url, prompt, title, status, raw_parse_result, editable_parse_result,
        selected_skill_ids, expert_context, selected_digital_human_id, selected_voice_id, selected_scene_id,
        generated_video_url, aspect_ratio, failure_reason, created_at, updated_at
      )
      VALUES (
        @id, @userId, '', @prompt, @title, 'waiting_edit', @parseResult, @parseResult,
        @selectedSkillIds, @expertContext, NULL, NULL, NULL, NULL, @aspectRatio, NULL, @now, @now
      )
    `).run({
      id,
      userId: input.userId,
      prompt: input.prompt,
      title: input.title,
      parseResult: JSON.stringify(input.parseResult),
      selectedSkillIds: JSON.stringify(input.selectedSkillIds || []),
      expertContext: JSON.stringify(input.expertContext),
      aspectRatio: input.aspectRatio,
      now,
    });
    return this.findVideoTask(id);
  },

  resetVideoTaskFromPrompt(id: string, input: CreateVideoTaskFromPromptPayload & {
    expertContext: Record<string, unknown>;
    parseResult: VideoParseResult;
    title: string;
    selectedSkillIds?: string[];
    aspectRatio: string;
  }) {
    const current = this.findVideoTask(id);
    if (!current) {
      return null;
    }
    const updatedAt = new Date().toISOString();
    const parseResult = JSON.stringify(input.parseResult);
    db.prepare(`
      UPDATE video_generation_tasks
      SET prompt = @prompt,
          title = @title,
          status = 'waiting_edit',
          raw_parse_result = @parseResult,
          editable_parse_result = @parseResult,
          selected_skill_ids = @selectedSkillIds,
          expert_context = @expertContext,
          selected_digital_human_id = NULL,
          selected_voice_id = NULL,
          selected_scene_id = NULL,
          generated_video_url = NULL,
          aspect_ratio = @aspectRatio,
          failure_reason = NULL,
          updated_at = @updatedAt
      WHERE id = @id
    `).run({
      id,
      prompt: input.prompt,
      title: input.title,
      parseResult,
      selectedSkillIds: JSON.stringify(input.selectedSkillIds || []),
      expertContext: JSON.stringify(input.expertContext),
      aspectRatio: input.aspectRatio,
      updatedAt,
    });
    return this.findVideoTask(id);
  },

  updateVideoTaskParseResult(id: string, payload: UpdateVideoParsePayload & { updatedAt?: string }) {
    const updatedAt = payload.updatedAt || new Date().toISOString();
    db.prepare(`
      UPDATE video_generation_tasks
      SET editable_parse_result = @editableParseResult,
          selected_digital_human_id = @selectedDigitalHumanId,
          selected_voice_id = @selectedVoiceId,
          selected_scene_id = @selectedSceneId,
          updated_at = @updatedAt
      WHERE id = @id
    `).run({
      id,
      editableParseResult: JSON.stringify(payload.editableParseResult),
      selectedDigitalHumanId: payload.selectedDigitalHumanId || null,
      selectedVoiceId: payload.selectedVoiceId || null,
      selectedSceneId: payload.selectedSceneId || null,
      updatedAt,
    });
    return this.findVideoTask(id);
  },

  markVideoTaskGenerated(id: string, generatedVideoUrl: string, options: { updatedAt?: string } = {}) {
    const current = this.findVideoTask(id);
    if (!current) {
      return null;
    }
    const nextGeneratedVideoUrl = generatedVideoUrl.trim();
    if (!nextGeneratedVideoUrl) {
      return current;
    }
    const updatedAt = options.updatedAt || new Date().toISOString();
    db.prepare(`
      UPDATE video_generation_tasks
      SET status = 'success',
          generated_video_url = @generatedVideoUrl,
          failure_reason = NULL,
          updated_at = @updatedAt
      WHERE id = @id
    `).run({ id, generatedVideoUrl: nextGeneratedVideoUrl, updatedAt });
    return this.findVideoTask(id);
  },

  clearVideoTaskGeneratedResult(id: string) {
    const current = this.findVideoTask(id);
    if (!current) {
      return null;
    }
    const updatedAt = new Date().toISOString();
    db.prepare(`
      UPDATE video_generation_tasks
      SET status = 'waiting_edit',
          generated_video_url = NULL,
          failure_reason = NULL,
          updated_at = @updatedAt
      WHERE id = @id
    `).run({ id, updatedAt });
    return this.findVideoTask(id);
  },

  markVideoTaskGenerating(id: string) {
    const updatedAt = new Date().toISOString();
    db.prepare(`
      UPDATE video_generation_tasks
      SET status = 'generating',
          failure_reason = NULL,
          updated_at = @updatedAt
      WHERE id = @id
    `).run({ id, updatedAt });
    return this.findVideoTask(id);
  },

  markVideoTaskFailed(id: string, failureReason: string) {
    const updatedAt = new Date().toISOString();
    db.prepare(`
      UPDATE video_generation_tasks
      SET status = 'failed',
          failure_reason = @failureReason,
          updated_at = @updatedAt
      WHERE id = @id
    `).run({ id, failureReason, updatedAt });
    return this.findVideoTask(id);
  },

  renameVideoTask(id: string, title: string) {
    const updatedAt = new Date().toISOString();
    db.prepare(`
      UPDATE video_generation_tasks
      SET title = @title,
          updated_at = @updatedAt
      WHERE id = @id
    `).run({ id, title, updatedAt });
    return this.findVideoTask(id);
  },

  updateVideoTaskContext(id: string, payload: Required<Pick<UpdateVideoTaskContextPayload, 'selectedSkillIds'>> & {
    expertContext: Record<string, unknown>;
    updatedAt?: string;
  }) {
    const updatedAt = payload.updatedAt || new Date().toISOString();
    db.prepare(`
      UPDATE video_generation_tasks
      SET selected_skill_ids = @selectedSkillIds,
          expert_context = @expertContext,
          updated_at = @updatedAt
      WHERE id = @id
    `).run({
      id,
      selectedSkillIds: JSON.stringify(payload.selectedSkillIds),
      expertContext: JSON.stringify(payload.expertContext),
      updatedAt,
    });
    return this.findVideoTask(id);
  },
};
