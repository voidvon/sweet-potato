import { db } from '../../db/database.js';
import type {
  BillableUsageRecord,
  BillingSettings,
  CreditLedgerEntry,
  CreditReservation,
  CreditReservationStatus,
  CreditSummary,
  LlmUsageRecord,
} from './billing.types.js';

function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function queryCreditSummaries(userId?: string): CreditSummary[] {
  const rows = db.prepare(`
    SELECT
      users.id as userId,
      (
        SELECT COALESCE(SUM(credit_delta), 0)
        FROM credit_ledger
        WHERE user_id = users.id
          AND type = 'admin_adjust'
          AND credit_delta > 0
      ) as totalRechargeCredits,
      (
        SELECT COALESCE(SUM(credit_cost), 0)
        FROM llm_usage_records
        WHERE user_id = users.id
          AND status = 'completed'
      ) + (
        SELECT COALESCE(SUM(credit_cost), 0)
        FROM billable_usage_records
        WHERE user_id = users.id
          AND status = 'completed'
      ) as totalUsageCredits
    FROM users
    WHERE @userId IS NULL OR users.id = @userId
  `).all({ userId: userId || null }) as Array<{
    userId: string;
    totalRechargeCredits: number;
    totalUsageCredits: number;
  }>;
  return rows.map((row) => ({
    userId: row.userId,
    totalRechargeCredits: Number(row.totalRechargeCredits || 0),
    totalUsageCredits: Number(row.totalUsageCredits || 0),
  }));
}

type BillingSettingsRow = {
  id: number;
  seedance_2_credits_per_second_720p: number;
  seedance_2_credits_per_second_480p: number;
  seedance_2_fast_credits_per_second_720p: number;
  seedance_2_fast_credits_per_second_480p: number;
  seedance_2_mini_credits_per_second_720p: number;
  seedance_2_mini_credits_per_second_480p: number;
  video_upload_credits_per_mb: number;
  video_upload_credits_per_second?: number;
  video_understanding_credits_per_1m_tokens?: number;
  video_understanding_usd_per_1m_tokens?: number;
  usd_to_credit_rate?: number;
  content_planning_analysis_credits_per_request: number;
  content_planning_generation_credits_per_request: number;
  talking_video_prompt_credits_per_request: number;
  marketing_video_credits_per_request: number;
  marketing_video_storyboard_model_config_id: string;
  video_upscale_credits_per_request: number;
  subtitle_removal_credits_per_second: number;
  video_translation_subtitle_credits_per_second: number;
  video_translation_voice_credits_per_second: number;
  video_translation_face_credits_per_second: number;
  video_translation_erase_source_credits_per_second: number;
  created_at: string;
  updated_at: string;
};

type CreditReservationRow = {
  id: string;
  user_id: string;
  source_type: string;
  source_id: string;
  reserved_credits: number;
  status: CreditReservationStatus;
  snapshot: string;
  created_at: string;
  settled_at: string | null;
};

type LlmUsageRecordRow = {
  id: string;
  user_id: string;
  model_config_id: string;
  source_type: string;
  source_id: string;
  prompt_tokens: number;
  completion_tokens: number;
  cached_prompt_tokens: number;
  usage_raw: string;
  billing_snapshot: string;
  credit_base_cost?: number;
  credit_billed_cost?: number;
  usd_base_cost?: number;
  usd_billed_cost?: number;
  credit_cost: number;
  status: 'completed' | 'failed';
  created_at: string;
};

type CreditLedgerRow = {
  id: string;
  user_id: string;
  type: CreditLedgerEntry['type'];
  credit_delta: number;
  credit_balance_after: number;
  credit_base_cost?: number | null;
  credit_billed_cost?: number | null;
  usd_base_cost?: number | null;
  usd_billed_cost?: number | null;
  source_type: string | null;
  source_id: string | null;
  snapshot: string;
  created_at: string;
};

type BillableUsageRecordRow = {
  id: string;
  user_id: string;
  category: BillableUsageRecord['category'];
  model_config_id: string | null;
  provider: string | null;
  model: string | null;
  source_type: string;
  source_id: string;
  task_id: string | null;
  session_id: string | null;
  group_id: string | null;
  pricing_mode: BillableUsageRecord['pricingMode'];
  quantity_snapshot: string;
  usage_raw: string;
  request_snapshot: string;
  response_snapshot: string;
  credit_base_cost?: number;
  credit_billed_cost?: number;
  usd_base_cost?: number;
  usd_billed_cost?: number;
  credit_cost: number;
  status: BillableUsageRecord['status'];
  created_at: string;
};

function parseBillingSettings(row: BillingSettingsRow): BillingSettings {
  const understandingCreditsPer1MTokens = typeof row.video_understanding_credits_per_1m_tokens === 'number'
    ? Number(row.video_understanding_credits_per_1m_tokens || 0)
    : typeof row.video_understanding_usd_per_1m_tokens === 'number'
      ? Number(row.video_understanding_usd_per_1m_tokens || 0) * Number(row.usd_to_credit_rate || 0)
      : 0;
  return {
    id: 1,
    seedance2CreditsPerSecond720p: Number(row.seedance_2_credits_per_second_720p ?? 20),
    seedance2CreditsPerSecond480p: Number(row.seedance_2_credits_per_second_480p ?? 12),
    seedance2FastCreditsPerSecond720p: Number(row.seedance_2_fast_credits_per_second_720p ?? 18),
    seedance2FastCreditsPerSecond480p: Number(row.seedance_2_fast_credits_per_second_480p ?? 11),
    seedance2MiniCreditsPerSecond720p: Number(row.seedance_2_mini_credits_per_second_720p ?? 15),
    seedance2MiniCreditsPerSecond480p: Number(row.seedance_2_mini_credits_per_second_480p ?? 7),
    videoUploadCreditsPerMb: typeof row.video_upload_credits_per_mb === 'number'
      ? Number(row.video_upload_credits_per_mb || 0)
      : Number(row.video_upload_credits_per_second || 0),
    videoUnderstandingCreditsPer1MTokens: understandingCreditsPer1MTokens,
    contentPlanningAnalysisCreditsPerRequest: Number(row.content_planning_analysis_credits_per_request ?? 2),
    contentPlanningGenerationCreditsPerRequest: Number(row.content_planning_generation_credits_per_request ?? 3),
    talkingVideoPromptCreditsPerRequest: Number(row.talking_video_prompt_credits_per_request ?? 3),
    marketingVideoCreditsPerRequest: Number(row.marketing_video_credits_per_request ?? 15),
    marketingVideoStoryboardModelConfigId: String(row.marketing_video_storyboard_model_config_id || ''),
    videoUpscaleCreditsPerRequest: Number(row.video_upscale_credits_per_request ?? 20),
    subtitleRemovalCreditsPerSecond: Number(row.subtitle_removal_credits_per_second ?? 2),
    videoTranslationSubtitleCreditsPerSecond: Number(row.video_translation_subtitle_credits_per_second ?? 1),
    videoTranslationVoiceCreditsPerSecond: Number(row.video_translation_voice_credits_per_second ?? 2),
    videoTranslationFaceCreditsPerSecond: Number(row.video_translation_face_credits_per_second ?? 2),
    videoTranslationEraseSourceCreditsPerSecond: Number(
      row.video_translation_erase_source_credits_per_second ?? 2,
    ),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseReservation(row: CreditReservationRow): CreditReservation {
  return {
    id: row.id,
    userId: row.user_id,
    sourceType: row.source_type,
    sourceId: row.source_id,
    reservedCredits: Number(row.reserved_credits || 0),
    status: row.status,
    snapshot: parseJsonObject(row.snapshot),
    createdAt: row.created_at,
    settledAt: row.settled_at,
  };
}

function parseUsageRecord(row: LlmUsageRecordRow): LlmUsageRecord {
  return {
    id: row.id,
    userId: row.user_id,
    modelConfigId: row.model_config_id,
    sourceType: row.source_type,
    sourceId: row.source_id,
    promptTokens: Number(row.prompt_tokens || 0),
    completionTokens: Number(row.completion_tokens || 0),
    cachedPromptTokens: Number(row.cached_prompt_tokens || 0),
    usageRaw: parseJsonObject(row.usage_raw),
    billingSnapshot: parseJsonObject(row.billing_snapshot),
    creditBaseCost: typeof row.credit_base_cost === 'number'
      ? Number(row.credit_base_cost || 0)
      : Number(row.credit_cost || 0),
    creditBilledCost: typeof row.credit_billed_cost === 'number'
      ? Number(row.credit_billed_cost || 0)
      : Number(row.credit_cost || 0),
    creditCost: Number(row.credit_cost || 0),
    status: row.status,
    createdAt: row.created_at,
  };
}

function parseLedgerRow(row: CreditLedgerRow): CreditLedgerEntry {
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    creditDelta: Number(row.credit_delta || 0),
    creditBalanceAfter: Number(row.credit_balance_after || 0),
    creditBaseCost: row.credit_base_cost === null || typeof row.credit_base_cost === 'undefined'
      ? null
      : Number(row.credit_base_cost || 0),
    creditBilledCost: row.credit_billed_cost === null || typeof row.credit_billed_cost === 'undefined'
      ? null
      : Number(row.credit_billed_cost || 0),
    sourceType: row.source_type,
    sourceId: row.source_id,
    snapshot: parseJsonObject(row.snapshot),
    createdAt: row.created_at,
  };
}

function parseBillableUsageRecord(row: BillableUsageRecordRow): BillableUsageRecord {
  return {
    id: row.id,
    userId: row.user_id,
    category: row.category,
    modelConfigId: row.model_config_id,
    provider: row.provider,
    model: row.model,
    sourceType: row.source_type,
    sourceId: row.source_id,
    taskId: row.task_id,
    sessionId: row.session_id,
    groupId: row.group_id,
    pricingMode: row.pricing_mode,
    quantitySnapshot: parseJsonObject(row.quantity_snapshot),
    usageRaw: parseJsonObject(row.usage_raw),
    requestSnapshot: parseJsonObject(row.request_snapshot),
    responseSnapshot: parseJsonObject(row.response_snapshot),
    creditBaseCost: typeof row.credit_base_cost === 'number'
      ? Number(row.credit_base_cost || 0)
      : Number(row.credit_cost || 0),
    creditBilledCost: typeof row.credit_billed_cost === 'number'
      ? Number(row.credit_billed_cost || 0)
      : Number(row.credit_cost || 0),
    creditCost: Number(row.credit_cost || 0),
    status: row.status,
    createdAt: row.created_at,
  };
}

export const billingRepository = {
  listCreditSummaries(): CreditSummary[] {
    return queryCreditSummaries();
  },

  getCreditSummary(userId: string): CreditSummary {
    return queryCreditSummaries(userId)[0] || {
      userId,
      totalRechargeCredits: 0,
      totalUsageCredits: 0,
    };
  },

  getSettings() {
    const row = db.prepare('SELECT * FROM billing_settings WHERE id = 1').get() as BillingSettingsRow | undefined;
    return row ? parseBillingSettings(row) : null;
  },

  saveSettings(settings: BillingSettings) {
    db.prepare(`
      INSERT INTO billing_settings (
        id, seedance_2_credits_per_second_720p, seedance_2_credits_per_second_480p,
        seedance_2_fast_credits_per_second_720p, seedance_2_fast_credits_per_second_480p,
        seedance_2_mini_credits_per_second_720p, seedance_2_mini_credits_per_second_480p,
        video_upload_credits_per_mb, video_understanding_credits_per_1m_tokens,
        content_planning_analysis_credits_per_request, content_planning_generation_credits_per_request,
        talking_video_prompt_credits_per_request,
        marketing_video_credits_per_request, marketing_video_storyboard_model_config_id,
        video_upscale_credits_per_request, subtitle_removal_credits_per_second,
        video_translation_subtitle_credits_per_second, video_translation_voice_credits_per_second,
        video_translation_face_credits_per_second, video_translation_erase_source_credits_per_second,
        created_at, updated_at
      )
      VALUES (
        @id, @seedance2CreditsPerSecond720p, @seedance2CreditsPerSecond480p,
        @seedance2FastCreditsPerSecond720p, @seedance2FastCreditsPerSecond480p,
        @seedance2MiniCreditsPerSecond720p, @seedance2MiniCreditsPerSecond480p,
        @videoUploadCreditsPerMb, @videoUnderstandingCreditsPer1MTokens,
        @contentPlanningAnalysisCreditsPerRequest, @contentPlanningGenerationCreditsPerRequest,
        @talkingVideoPromptCreditsPerRequest,
        @marketingVideoCreditsPerRequest, @marketingVideoStoryboardModelConfigId,
        @videoUpscaleCreditsPerRequest, @subtitleRemovalCreditsPerSecond,
        @videoTranslationSubtitleCreditsPerSecond, @videoTranslationVoiceCreditsPerSecond,
        @videoTranslationFaceCreditsPerSecond, @videoTranslationEraseSourceCreditsPerSecond,
        @createdAt, @updatedAt
      )
      ON CONFLICT(id) DO UPDATE SET
        seedance_2_credits_per_second_720p = excluded.seedance_2_credits_per_second_720p,
        seedance_2_credits_per_second_480p = excluded.seedance_2_credits_per_second_480p,
        seedance_2_fast_credits_per_second_720p = excluded.seedance_2_fast_credits_per_second_720p,
        seedance_2_fast_credits_per_second_480p = excluded.seedance_2_fast_credits_per_second_480p,
        seedance_2_mini_credits_per_second_720p = excluded.seedance_2_mini_credits_per_second_720p,
        seedance_2_mini_credits_per_second_480p = excluded.seedance_2_mini_credits_per_second_480p,
        video_upload_credits_per_mb = excluded.video_upload_credits_per_mb,
        video_understanding_credits_per_1m_tokens = excluded.video_understanding_credits_per_1m_tokens,
        content_planning_analysis_credits_per_request = excluded.content_planning_analysis_credits_per_request,
        content_planning_generation_credits_per_request = excluded.content_planning_generation_credits_per_request,
        talking_video_prompt_credits_per_request = excluded.talking_video_prompt_credits_per_request,
        marketing_video_credits_per_request = excluded.marketing_video_credits_per_request,
        marketing_video_storyboard_model_config_id = excluded.marketing_video_storyboard_model_config_id,
        video_upscale_credits_per_request = excluded.video_upscale_credits_per_request,
        subtitle_removal_credits_per_second = excluded.subtitle_removal_credits_per_second,
        video_translation_subtitle_credits_per_second = excluded.video_translation_subtitle_credits_per_second,
        video_translation_voice_credits_per_second = excluded.video_translation_voice_credits_per_second,
        video_translation_face_credits_per_second = excluded.video_translation_face_credits_per_second,
        video_translation_erase_source_credits_per_second = excluded.video_translation_erase_source_credits_per_second,
        updated_at = excluded.updated_at
    `).run({
      id: 1,
      seedance2CreditsPerSecond720p: settings.seedance2CreditsPerSecond720p,
      seedance2CreditsPerSecond480p: settings.seedance2CreditsPerSecond480p,
      seedance2FastCreditsPerSecond720p: settings.seedance2FastCreditsPerSecond720p,
      seedance2FastCreditsPerSecond480p: settings.seedance2FastCreditsPerSecond480p,
      seedance2MiniCreditsPerSecond720p: settings.seedance2MiniCreditsPerSecond720p,
      seedance2MiniCreditsPerSecond480p: settings.seedance2MiniCreditsPerSecond480p,
      videoUploadCreditsPerMb: settings.videoUploadCreditsPerMb,
      videoUnderstandingCreditsPer1MTokens: settings.videoUnderstandingCreditsPer1MTokens,
      contentPlanningAnalysisCreditsPerRequest: settings.contentPlanningAnalysisCreditsPerRequest,
      contentPlanningGenerationCreditsPerRequest: settings.contentPlanningGenerationCreditsPerRequest,
      talkingVideoPromptCreditsPerRequest: settings.talkingVideoPromptCreditsPerRequest,
      marketingVideoCreditsPerRequest: settings.marketingVideoCreditsPerRequest,
      marketingVideoStoryboardModelConfigId: settings.marketingVideoStoryboardModelConfigId,
      videoUpscaleCreditsPerRequest: settings.videoUpscaleCreditsPerRequest,
      subtitleRemovalCreditsPerSecond: settings.subtitleRemovalCreditsPerSecond,
      videoTranslationSubtitleCreditsPerSecond: settings.videoTranslationSubtitleCreditsPerSecond,
      videoTranslationVoiceCreditsPerSecond: settings.videoTranslationVoiceCreditsPerSecond,
      videoTranslationFaceCreditsPerSecond: settings.videoTranslationFaceCreditsPerSecond,
      videoTranslationEraseSourceCreditsPerSecond: settings.videoTranslationEraseSourceCreditsPerSecond,
      createdAt: settings.createdAt,
      updatedAt: settings.updatedAt,
    });
  },

  createReservation(reservation: CreditReservation) {
    db.prepare(`
      INSERT INTO credit_reservations (
        id, user_id, source_type, source_id, reserved_credits, status, snapshot, created_at, settled_at
      ) VALUES (
        @id, @userId, @sourceType, @sourceId, @reservedCredits, @status, @snapshot, @createdAt, @settledAt
      )
    `).run({
      ...reservation,
      snapshot: JSON.stringify(reservation.snapshot || {}),
    });
  },

  findReservation(id: string) {
    const row = db.prepare('SELECT * FROM credit_reservations WHERE id = ?').get(id) as CreditReservationRow | undefined;
    return row ? parseReservation(row) : null;
  },

  findLatestReservedReservationBySourceTypeAndSessionId(sourceType: string, sessionId: string) {
    const rows = db.prepare(`
      SELECT *
      FROM credit_reservations
      WHERE source_type = ? AND status = 'reserved'
      ORDER BY created_at DESC
    `).all(sourceType) as CreditReservationRow[];
    return rows
      .map(parseReservation)
      .find((reservation) => reservation.snapshot.sessionId === sessionId) || null;
  },

  updateReservationStatus(id: string, status: CreditReservationStatus, settledAt?: string | null) {
    db.prepare(`
      UPDATE credit_reservations
      SET status = @status, settled_at = @settledAt
      WHERE id = @id
    `).run({
      id,
      status,
      settledAt: settledAt || null,
    });
  },

  createUsageRecord(record: LlmUsageRecord) {
    db.prepare(`
      INSERT INTO llm_usage_records (
        id, user_id, model_config_id, source_type, source_id, prompt_tokens, completion_tokens,
        cached_prompt_tokens, usage_raw, billing_snapshot, credit_base_cost, credit_billed_cost,
        credit_cost, status, created_at
      ) VALUES (
        @id, @userId, @modelConfigId, @sourceType, @sourceId, @promptTokens, @completionTokens,
        @cachedPromptTokens, @usageRaw, @billingSnapshot, @creditBaseCost, @creditBilledCost,
        @creditCost, @status, @createdAt
      )
    `).run({
      ...record,
      usageRaw: JSON.stringify(record.usageRaw || {}),
      billingSnapshot: JSON.stringify(record.billingSnapshot || {}),
    });
  },

  listUsageRecords(input: { userId?: string; limit?: number } = {}) {
    const filters: string[] = [];
    const params: Record<string, unknown> = {
      limit: input.limit || 100,
    };
    if (input.userId) {
      filters.push('user_id = @userId');
      params.userId = input.userId;
    }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const rows = db.prepare(`
      SELECT * FROM llm_usage_records
      ${where}
      ORDER BY created_at DESC
      LIMIT @limit
    `).all(params) as LlmUsageRecordRow[];
    return rows.map(parseUsageRecord);
  },

  findUsageRecordBySourceId(sourceId: string) {
    const row = db.prepare(`
      SELECT * FROM llm_usage_records
      WHERE source_id = @sourceId
      ORDER BY created_at DESC
      LIMIT 1
    `).get({ sourceId }) as LlmUsageRecordRow | undefined;
    return row ? parseUsageRecord(row) : null;
  },

  createLedgerEntry(entry: CreditLedgerEntry) {
    db.prepare(`
      INSERT INTO credit_ledger (
        id, user_id, type, credit_delta, credit_balance_after, credit_base_cost, credit_billed_cost,
        source_type, source_id, snapshot, created_at
      ) VALUES (
        @id, @userId, @type, @creditDelta, @creditBalanceAfter, @creditBaseCost, @creditBilledCost,
        @sourceType, @sourceId, @snapshot, @createdAt
      )
    `).run({
      ...entry,
      snapshot: JSON.stringify(entry.snapshot || {}),
    });
  },

  markReservedLedgerAsUsageDebit(input: { userId: string; sourceType: string; sourceId: string }) {
    return db.prepare(`
      UPDATE credit_ledger
      SET type = 'usage_debit'
      WHERE user_id = @userId
        AND source_type = @sourceType
        AND source_id = @sourceId
        AND type = 'reserve_debit'
    `).run(input).changes;
  },

  createBillableUsageRecord(record: BillableUsageRecord) {
    db.prepare(`
      INSERT INTO billable_usage_records (
        id, user_id, category, model_config_id, provider, model, source_type, source_id,
        task_id, session_id, group_id, pricing_mode, quantity_snapshot, usage_raw,
        request_snapshot, response_snapshot, credit_base_cost, credit_billed_cost, credit_cost,
        status, created_at
      ) VALUES (
        @id, @userId, @category, @modelConfigId, @provider, @model, @sourceType, @sourceId,
        @taskId, @sessionId, @groupId, @pricingMode, @quantitySnapshot, @usageRaw,
        @requestSnapshot, @responseSnapshot, @creditBaseCost, @creditBilledCost, @creditCost,
        @status, @createdAt
      )
    `).run({
      ...record,
      quantitySnapshot: JSON.stringify(record.quantitySnapshot || {}),
      usageRaw: JSON.stringify(record.usageRaw || {}),
      requestSnapshot: JSON.stringify(record.requestSnapshot || {}),
      responseSnapshot: JSON.stringify(record.responseSnapshot || {}),
    });
  },

  findBillableUsageRecordByCategoryAndSourceId(category: BillableUsageRecord['category'], sourceId: string) {
    const row = db.prepare(`
      SELECT * FROM billable_usage_records
      WHERE category = ? AND source_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `).get(category, sourceId) as BillableUsageRecordRow | undefined;
    return row ? parseBillableUsageRecord(row) : null;
  },

  listBillableUsageRecords(input: { userId?: string; limit?: number } = {}) {
    const filters: string[] = [];
    const params: Record<string, unknown> = {
      limit: input.limit || 100,
    };
    if (input.userId) {
      filters.push('user_id = @userId');
      params.userId = input.userId;
    }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const rows = db.prepare(`
      SELECT * FROM billable_usage_records
      ${where}
      ORDER BY created_at DESC
      LIMIT @limit
    `).all(params) as BillableUsageRecordRow[];
    return rows.map(parseBillableUsageRecord);
  },

  listLedgerEntries(input: { userId?: string; limit?: number } = {}) {
    const filters: string[] = [];
    const params: Record<string, unknown> = {
      limit: input.limit || 100,
    };
    if (input.userId) {
      filters.push('user_id = @userId');
      params.userId = input.userId;
    }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const rows = db.prepare(`
      SELECT * FROM credit_ledger
      ${where}
      ORDER BY created_at DESC
      LIMIT @limit
    `).all(params) as CreditLedgerRow[];
    return rows.map(parseLedgerRow);
  },
};
