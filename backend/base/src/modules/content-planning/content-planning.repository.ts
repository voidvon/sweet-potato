import { randomUUID } from 'node:crypto';
import { db } from '../../db/database.js';
import type {
  ContentPlanningAnalysis,
  ContentPlanningApplySnapshot,
  ContentPlanningGeneration,
  ContentPlanningMaterialBundle,
  ContentPlanningSession,
  ContentPlanningSettings,
  ContentPlanningSourceSurface,
  ContentPlanningStatus,
  ContentPlanningUiStep,
  ContentPlanningJobStage,
} from './content-planning.types.js';

function ensureContentPlanningSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS content_planning_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      source_surface TEXT NOT NULL,
      status TEXT NOT NULL,
      ui_step TEXT NOT NULL,
      job_stage TEXT NOT NULL,
      material_bundle TEXT NOT NULL DEFAULT '{}',
      analysis TEXT NOT NULL DEFAULT '{}',
      settings TEXT NOT NULL DEFAULT '{}',
      generation TEXT NOT NULL DEFAULT '{}',
      apply_snapshot TEXT NOT NULL DEFAULT 'null',
      error_message TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_content_planning_sessions_user_updated
      ON content_planning_sessions(user_id, updated_at DESC);
  `);
}

ensureContentPlanningSchema();

type ContentPlanningSessionRow = {
  id: string;
  user_id: string;
  source_surface: ContentPlanningSourceSurface;
  status: ContentPlanningStatus;
  ui_step: ContentPlanningUiStep;
  job_stage: ContentPlanningJobStage;
  material_bundle: string;
  analysis: string;
  settings: string;
  generation: string;
  apply_snapshot: string;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

function nowIso() {
  return new Date().toISOString();
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function createEmptyPlanningMaterialBundle(): ContentPlanningMaterialBundle {
  return {
    prompt: '',
    productName: '',
    imageMaterials: [],
    referenceVideo: null,
    referenceAudio: null,
  };
}

export function createEmptyPlanningAnalysis(): ContentPlanningAnalysis {
  return {
    viralBreakdown: null,
    materialCaptions: [],
    productInsights: {
      productName: '',
      productCategory: '',
      productFeatures: [],
      coreSellingPoints: [],
      targetAudience: [],
      useScenarios: [],
    },
    confirmed: false,
    notes: [],
  };
}

export function createDefaultPlanningSettings(): ContentPlanningSettings {
  return {
    businessScene: 'unrestricted',
    contentType: '',
    shootingMethod: '',
    spokenLanguage: 'zh',
    displayOnly: false,
    extraInstruction: '',
    durationSeconds: 5,
    styleKeywords: ['干净明亮'],
    deepThink: true,
    webSearch: false,
    candidateCount: 1,
    referencePolicy: {
      useBreakdown: true,
      lockedContentPreset: null,
    },
  };
}

export function createEmptyPlanningGeneration(): ContentPlanningGeneration {
  return {
    reasoningLogs: [],
    reasoningStream: null,
    stages: [],
    candidates: [],
    selectedCandidateId: '',
    validatorSummary: '',
    stageOutputs: {},
  };
}

function serializeSession(row: ContentPlanningSessionRow): ContentPlanningSession {
  const materialBundle = parseJson(row.material_bundle, createEmptyPlanningMaterialBundle());
  const generation = parseJson(row.generation, createEmptyPlanningGeneration());
  return {
    id: row.id,
    userId: row.user_id,
    sourceSurface: row.source_surface,
    status: row.status,
    uiStep: row.ui_step,
    jobStage: row.job_stage,
    materialBundle: {
      ...createEmptyPlanningMaterialBundle(),
      ...materialBundle,
      imageMaterials: materialBundle.imageMaterials || [],
    },
    analysis: parseJson(row.analysis, createEmptyPlanningAnalysis()),
    settings: parseJson(row.settings, createDefaultPlanningSettings()),
    generation: {
      ...createEmptyPlanningGeneration(),
      ...generation,
      stages: generation.stages || [],
      reasoningLogs: generation.reasoningLogs || [],
      reasoningStream: generation.reasoningStream || null,
      candidates: generation.candidates || [],
    },
    applySnapshot: parseJson<ContentPlanningApplySnapshot | null>(row.apply_snapshot, null),
    errorMessage: row.error_message || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const contentPlanningRepository = {
  findSession(id: string) {
    const row = db.prepare('SELECT * FROM content_planning_sessions WHERE id = ?').get(id) as ContentPlanningSessionRow | undefined;
    return row ? serializeSession(row) : null;
  },

  findLatestRestorableSession(userId: string, sourceSurface: ContentPlanningSourceSurface) {
    const row = db.prepare(`
      SELECT * FROM content_planning_sessions
      WHERE user_id = @userId
        AND source_surface = @sourceSurface
        AND status IN ('draft', 'analyzing', 'confirming', 'configuring', 'generating', 'ready_to_apply', 'failed')
      ORDER BY updated_at DESC
      LIMIT 1
    `).get({ userId, sourceSurface }) as ContentPlanningSessionRow | undefined;
    return row ? serializeSession(row) : null;
  },

  listSessionsByStatuses(statuses: ContentPlanningStatus[]) {
    if (!statuses.length) {
      return [];
    }
    const params = Object.fromEntries(statuses.map((status, index) => [`status${index}`, status]));
    const placeholders = statuses.map((_, index) => `@status${index}`).join(', ');
    const rows = db.prepare(`
      SELECT * FROM content_planning_sessions
      WHERE status IN (${placeholders})
      ORDER BY updated_at DESC
    `).all(params) as ContentPlanningSessionRow[];
    return rows.map(serializeSession);
  },

  createSession(input: {
    userId: string;
    sourceSurface: ContentPlanningSourceSurface;
  }) {
    const now = nowIso();
    const id = randomUUID();
    db.prepare(`
      INSERT INTO content_planning_sessions (
        id, user_id, source_surface, status, ui_step, job_stage,
        material_bundle, analysis, settings, generation, apply_snapshot, error_message,
        created_at, updated_at
      )
      VALUES (
        @id, @userId, @sourceSurface, 'draft', 'step1', 'idle',
        @materialBundle, @analysis, @settings, @generation, 'null', '',
        @now, @now
      )
    `).run({
      id,
      userId: input.userId,
      sourceSurface: input.sourceSurface,
      materialBundle: JSON.stringify(createEmptyPlanningMaterialBundle()),
      analysis: JSON.stringify(createEmptyPlanningAnalysis()),
      settings: JSON.stringify(createDefaultPlanningSettings()),
      generation: JSON.stringify(createEmptyPlanningGeneration()),
      now,
    });
    return this.findSession(id);
  },

  updateSession(id: string, patch: Partial<{
    status: ContentPlanningStatus;
    uiStep: ContentPlanningUiStep;
    jobStage: ContentPlanningJobStage;
    materialBundle: ContentPlanningMaterialBundle;
    analysis: ContentPlanningAnalysis;
    settings: ContentPlanningSettings;
    generation: ContentPlanningGeneration;
    applySnapshot: ContentPlanningApplySnapshot | null;
    errorMessage: string;
  }>) {
    const current = this.findSession(id);
    if (!current) {
      return null;
    }
    const next: ContentPlanningSession = {
      ...current,
      status: patch.status ?? current.status,
      uiStep: patch.uiStep ?? current.uiStep,
      jobStage: patch.jobStage ?? current.jobStage,
      materialBundle: patch.materialBundle ?? current.materialBundle,
      analysis: patch.analysis ?? current.analysis,
      settings: patch.settings ?? current.settings,
      generation: patch.generation ?? current.generation,
      applySnapshot: patch.applySnapshot === undefined ? current.applySnapshot : patch.applySnapshot,
      errorMessage: patch.errorMessage ?? current.errorMessage,
      updatedAt: nowIso(),
    };
    db.prepare(`
      UPDATE content_planning_sessions
      SET status = @status,
          ui_step = @uiStep,
          job_stage = @jobStage,
          material_bundle = @materialBundle,
          analysis = @analysis,
          settings = @settings,
          generation = @generation,
          apply_snapshot = @applySnapshot,
          error_message = @errorMessage,
          updated_at = @updatedAt
      WHERE id = @id
    `).run({
      id,
      status: next.status,
      uiStep: next.uiStep,
      jobStage: next.jobStage,
      materialBundle: JSON.stringify(next.materialBundle),
      analysis: JSON.stringify(next.analysis),
      settings: JSON.stringify(next.settings),
      generation: JSON.stringify(next.generation),
      applySnapshot: JSON.stringify(next.applySnapshot ?? null),
      errorMessage: next.errorMessage || '',
      updatedAt: next.updatedAt,
    });
    return this.findSession(id);
  },

  deleteSession(id: string) {
    db.prepare('DELETE FROM content_planning_sessions WHERE id = ?').run(id);
  },
};
