import { randomUUID } from 'node:crypto';
import { db } from '../../db/database.js';
import type {
  ContentAsset,
  ContentAssetGroup,
  ContentResourceType,
  CreateAssetGroupPayload,
  CreateAssetPayload,
  CreateVideoTaskFromPromptPayload,
  UpdateAssetGroupPayload,
  UpdateAssetPayload,
  UpdateVideoTaskContextPayload,
  UpdateVideoParsePayload,
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
    metadata: parseJsonObject(row.metadata),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function serializeVideoTask(row: VideoTaskRow): VideoGenerationTask {
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
    expertContext: parseJsonObject(row.expert_context),
    selectedDigitalHumanId: row.selected_digital_human_id,
    selectedVoiceId: row.selected_voice_id,
    selectedSceneId: row.selected_scene_id,
    generatedVideoUrl: row.generated_video_url,
    failureReason: row.failure_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

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
    db.prepare('DELETE FROM content_assets WHERE group_id = ?').run(id);
    const result = db.prepare('DELETE FROM content_asset_groups WHERE id = ?').run(id);
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
        stored_file_name, mime_type, file_size, size, file_path, file_url, metadata, created_at, updated_at
      )
      VALUES (
        @id, @groupId, @userId, @resourceType, 'file', @name, @description, NULL, @originalFileName,
        @storedFileName, @mimeType, @fileSize, @fileSize, @filePath, @fileUrl, @metadata, @now, @now
      )
    `).run({
      id,
      ...payload,
      description: payload.description?.trim() || '',
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
  }) {
    const current = this.findAsset(id);
    if (!current) {
      return null;
    }
    const updatedAt = new Date().toISOString();
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
    db.prepare('DELETE FROM content_assets WHERE id = ?').run(id);
    return current;
  },

  listVideoTasks(userId: string, options: {
    mode?: string;
    search?: string;
    updatedAtFrom?: string;
    updatedAtTo?: string;
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
    if (options.updatedAtFrom) {
      clauses.push('updated_at >= @updatedAtFrom');
      params.updatedAtFrom = options.updatedAtFrom;
    }
    if (options.updatedAtTo) {
      clauses.push('updated_at < @updatedAtTo');
      params.updatedAtTo = options.updatedAtTo;
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
      SELECT * FROM video_generation_tasks
      WHERE ${clauses.join(' AND ')}
      ORDER BY created_at DESC
      LIMIT @limit
    `).all(params) as VideoTaskRow[];
    return rows.map(serializeVideoTask);
  },

  listGeneratingVideoTasks() {
    const rows = db.prepare(`
      SELECT * FROM video_generation_tasks
      WHERE status = 'generating'
      ORDER BY updated_at ASC
      LIMIT 80
    `).all() as VideoTaskRow[];
    return rows.map(serializeVideoTask);
  },

  findVideoTask(id: string) {
    const row = db.prepare('SELECT * FROM video_generation_tasks WHERE id = ?').get(id) as VideoTaskRow | undefined;
    return row ? serializeVideoTask(row) : null;
  },

  findReusableParsedVideoTask(userId: string, sourceUrl: string) {
    const rows = db.prepare(`
      SELECT * FROM video_generation_tasks
      WHERE user_id = @userId
        AND source_url = @sourceUrl
        AND status IN ('waiting_edit', 'generating', 'success')
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
  }) {
    const now = new Date().toISOString();
    const id = randomUUID();
    const parseResult = JSON.stringify(input.parseResult);
    db.prepare(`
      INSERT INTO video_generation_tasks (
        id, user_id, source_url, prompt, title, status, raw_parse_result, editable_parse_result,
        selected_skill_ids, expert_context, selected_digital_human_id, selected_voice_id, selected_scene_id,
        generated_video_url, failure_reason, created_at, updated_at
      )
      VALUES (
        @id, @userId, @sourceUrl, @prompt, @title, 'waiting_edit', @parseResult, @parseResult,
        @selectedSkillIds, @expertContext, NULL, NULL, NULL, NULL, NULL, @now, @now
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
      now,
    });
    return this.findVideoTask(id);
  },

  createVideoTaskFromPrompt(input: CreateVideoTaskFromPromptPayload & {
    expertContext: Record<string, unknown>;
    parseResult: VideoParseResult;
    title: string;
  }) {
    const now = new Date().toISOString();
    const id = randomUUID();
    db.prepare(`
      INSERT INTO video_generation_tasks (
        id, user_id, source_url, prompt, title, status, raw_parse_result, editable_parse_result,
        selected_skill_ids, expert_context, selected_digital_human_id, selected_voice_id, selected_scene_id,
        generated_video_url, failure_reason, created_at, updated_at
      )
      VALUES (
        @id, @userId, '', @prompt, @title, 'waiting_edit', @parseResult, @parseResult,
        @selectedSkillIds, @expertContext, NULL, NULL, NULL, NULL, NULL, @now, @now
      )
    `).run({
      id,
      userId: input.userId,
      prompt: input.prompt,
      title: input.title,
      parseResult: JSON.stringify(input.parseResult),
      selectedSkillIds: JSON.stringify(input.selectedSkillIds || []),
      expertContext: JSON.stringify(input.expertContext),
      now,
    });
    return this.findVideoTask(id);
  },

  resetVideoTaskFromPrompt(id: string, input: CreateVideoTaskFromPromptPayload & {
    expertContext: Record<string, unknown>;
    parseResult: VideoParseResult;
    title: string;
    selectedSkillIds?: string[];
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
