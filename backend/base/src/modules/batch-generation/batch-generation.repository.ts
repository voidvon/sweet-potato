import { db } from '../../db/database.js';
import type {
  BatchGenerationRow,
  BatchGenerationSheet,
  BatchGenerationSheetSummary,
} from './batch-generation.types.js';

type SheetRow = Omit<BatchGenerationSheet, 'globalParams'> & {
  globalParams: string;
};

type SheetSummaryRow = SheetRow & {
  rowCount: number;
  completedCount: number;
  failedCount: number;
  runningCount: number;
};

type GenerationRowRecord = Omit<BatchGenerationRow, 'params' | 'validationErrors'> & {
  params: string;
  validationErrors: string;
};

function parseJsonObject(value: string | null | undefined) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function parseStringArray(value: string | null | undefined) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function parseSheet(row: SheetRow): BatchGenerationSheet {
  return {
    ...row,
    globalParams: parseJsonObject(row.globalParams),
  };
}

function parseSheetSummary(row: SheetSummaryRow): BatchGenerationSheetSummary {
  return {
    ...parseSheet(row),
    rowCount: Number(row.rowCount || 0),
    completedCount: Number(row.completedCount || 0),
    failedCount: Number(row.failedCount || 0),
    runningCount: Number(row.runningCount || 0),
  };
}

function parseGenerationRow(row: GenerationRowRecord): BatchGenerationRow {
  return {
    ...row,
    params: parseJsonObject(row.params),
    validationErrors: parseStringArray(row.validationErrors),
    actualCredits: Number(row.actualCredits || 0),
  };
}

const sheetSelect = `
  SELECT
    id,
    user_id as userId,
    name,
    capability_key as capabilityKey,
    media_kind as mediaKind,
    global_params as globalParams,
    schema_version as schemaVersion,
    sort_order as sortOrder,
    revision,
    created_at as createdAt,
    updated_at as updatedAt
  FROM batch_generation_sheets
`;

const rowSelect = `
  SELECT
    id,
    sheet_id as sheetId,
    position,
    params,
    validation_status as validationStatus,
    validation_errors as validationErrors,
    execution_status as executionStatus,
    latest_attempt_id as latestAttemptId,
    actual_credits as actualCredits,
    revision,
    created_at as createdAt,
    updated_at as updatedAt
  FROM batch_generation_rows
`;

export const batchGenerationRepository = {
  listSheets(userId: string) {
    const rows = db.prepare(`
      SELECT
        sheet.*,
        COUNT(row.id) as rowCount,
        SUM(CASE WHEN row.execution_status = 'completed' THEN 1 ELSE 0 END) as completedCount,
        SUM(CASE WHEN row.execution_status IN ('failed', 'partial_failed') THEN 1 ELSE 0 END) as failedCount,
        SUM(CASE WHEN row.execution_status IN ('queued', 'running') THEN 1 ELSE 0 END) as runningCount
      FROM (${sheetSelect}) AS sheet
      LEFT JOIN batch_generation_rows AS row ON row.sheet_id = sheet.id
      WHERE sheet.userId = ?
      GROUP BY sheet.id
      ORDER BY sheet.sortOrder ASC, sheet.createdAt ASC
    `).all(userId) as SheetSummaryRow[];
    return rows.map(parseSheetSummary);
  },

  findSheet(id: string) {
    const row = db.prepare(`${sheetSelect} WHERE id = ?`).get(id) as SheetRow | undefined;
    return row ? parseSheet(row) : undefined;
  },

  nextSheetSortOrder(userId: string) {
    const row = db.prepare(`
      SELECT COALESCE(MAX(sort_order), -1) + 1 as nextSortOrder
      FROM batch_generation_sheets
      WHERE user_id = ?
    `).get(userId) as { nextSortOrder: number };
    return Number(row.nextSortOrder || 0);
  },

  createSheet(sheet: BatchGenerationSheet) {
    db.prepare(`
      INSERT INTO batch_generation_sheets (
        id, user_id, name, capability_key, media_kind, global_params,
        schema_version, sort_order, revision, created_at, updated_at
      ) VALUES (
        @id, @userId, @name, @capabilityKey, @mediaKind, @globalParams,
        @schemaVersion, @sortOrder, @revision, @createdAt, @updatedAt
      )
    `).run({ ...sheet, globalParams: JSON.stringify(sheet.globalParams) });
    return sheet;
  },

  updateSheet(input: {
    id: string;
    expectedRevision: number;
    name: string;
    globalParams: Record<string, unknown>;
    sortOrder: number;
    updatedAt: string;
  }) {
    const result = db.prepare(`
      UPDATE batch_generation_sheets
      SET name = @name,
          global_params = @globalParams,
          sort_order = @sortOrder,
          revision = revision + 1,
          updated_at = @updatedAt
      WHERE id = @id AND revision = @expectedRevision
    `).run({ ...input, globalParams: JSON.stringify(input.globalParams) });
    return result.changes > 0;
  },

  deleteSheet(id: string) {
    const remove = db.transaction(() => {
      db.prepare(`
        DELETE FROM batch_generation_outputs
        WHERE attempt_id IN (
          SELECT attempt.id
          FROM batch_generation_attempts AS attempt
          INNER JOIN batch_generation_runs AS run ON run.id = attempt.run_id
          WHERE run.sheet_id = ?
        )
      `).run(id);
      db.prepare(`
        DELETE FROM batch_generation_attempts
        WHERE run_id IN (SELECT id FROM batch_generation_runs WHERE sheet_id = ?)
      `).run(id);
      db.prepare('DELETE FROM batch_generation_runs WHERE sheet_id = ?').run(id);
      db.prepare('DELETE FROM batch_generation_rows WHERE sheet_id = ?').run(id);
      return db.prepare('DELETE FROM batch_generation_sheets WHERE id = ?').run(id).changes > 0;
    });
    return remove();
  },

  listRows(sheetId: string) {
    const rows = db.prepare(`
      ${rowSelect}
      WHERE sheet_id = ?
      ORDER BY position ASC
    `).all(sheetId) as GenerationRowRecord[];
    return rows.map(parseGenerationRow);
  },

  findRow(id: string) {
    const row = db.prepare(`${rowSelect} WHERE id = ?`).get(id) as GenerationRowRecord | undefined;
    return row ? parseGenerationRow(row) : undefined;
  },

  countRows(sheetId: string) {
    const row = db.prepare('SELECT COUNT(*) as count FROM batch_generation_rows WHERE sheet_id = ?')
      .get(sheetId) as { count: number };
    return Number(row.count || 0);
  },

  createRows(rows: BatchGenerationRow[]) {
    const insert = db.prepare(`
      INSERT INTO batch_generation_rows (
        id, sheet_id, position, params, validation_status, validation_errors,
        execution_status, latest_attempt_id, actual_credits, revision, created_at, updated_at
      ) VALUES (
        @id, @sheetId, @position, @params, @validationStatus, @validationErrors,
        @executionStatus, @latestAttemptId, @actualCredits, @revision, @createdAt, @updatedAt
      )
    `);
    const transaction = db.transaction(() => {
      rows.forEach((row) => insert.run({
        ...row,
        params: JSON.stringify(row.params),
        validationErrors: JSON.stringify(row.validationErrors),
        latestAttemptId: row.latestAttemptId || null,
      }));
    });
    transaction();
    return rows;
  },

  updateRow(input: {
    id: string;
    expectedRevision: number;
    params: Record<string, unknown>;
    validationStatus: BatchGenerationRow['validationStatus'];
    validationErrors: string[];
    updatedAt: string;
  }) {
    const result = db.prepare(`
      UPDATE batch_generation_rows
      SET params = @params,
          validation_status = @validationStatus,
          validation_errors = @validationErrors,
          revision = revision + 1,
          updated_at = @updatedAt
      WHERE id = @id AND revision = @expectedRevision
    `).run({
      ...input,
      params: JSON.stringify(input.params),
      validationErrors: JSON.stringify(input.validationErrors),
    });
    return result.changes > 0;
  },

  setRowValidation(input: {
    id: string;
    validationStatus: BatchGenerationRow['validationStatus'];
    validationErrors: string[];
  }) {
    const updatedAt = new Date().toISOString();
    db.prepare(`
      UPDATE batch_generation_rows
      SET validation_status = @validationStatus,
          validation_errors = @validationErrors,
          updated_at = @updatedAt
      WHERE id = @id
    `).run({
      ...input,
      validationErrors: JSON.stringify(input.validationErrors),
      updatedAt,
    });
    return this.findRow(input.id);
  },

  deleteRow(sheetId: string, rowId: string) {
    const remove = db.transaction(() => {
      const row = db.prepare('SELECT position FROM batch_generation_rows WHERE id = ? AND sheet_id = ?')
        .get(rowId, sheetId) as { position: number } | undefined;
      if (!row) return false;
      db.prepare('DELETE FROM batch_generation_rows WHERE id = ?').run(rowId);
      db.prepare(`
        UPDATE batch_generation_rows
        SET position = position - 1
        WHERE sheet_id = ? AND position > ?
      `).run(sheetId, row.position);
      return true;
    });
    return remove();
  },
};
