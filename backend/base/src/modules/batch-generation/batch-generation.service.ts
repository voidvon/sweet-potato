import { randomUUID } from 'node:crypto';
import {
  normalizeCreativeGlobalParams,
  normalizeCreativeRowParams,
  requireCreativeCapability,
} from '../creative-capabilities/creative-capability.registry.js';
import { batchGenerationRepository } from './batch-generation.repository.js';
import { batchGenerationRunRepository } from './batch-generation-run.repository.js';
import type {
  BatchGenerationRow,
  BatchGenerationSheet,
  BatchGenerationSheetDetail,
} from './batch-generation.types.js';

const MAX_ROWS = 200;
const MAX_SHEET_NAME_LENGTH = 100;

export class BatchGenerationNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BatchGenerationNotFoundError';
  }
}

export class BatchGenerationConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BatchGenerationConflictError';
  }
}

function normalizeName(value: unknown) {
  const name = String(value || '').trim();
  if (!name) throw new Error('表名不能为空');
  if (name.length > MAX_SHEET_NAME_LENGTH) {
    throw new Error(`表名不能超过 ${MAX_SHEET_NAME_LENGTH} 个字符`);
  }
  return name;
}

function requireOwnedSheet(userId: string, sheetId: string) {
  const sheet = batchGenerationRepository.findSheet(sheetId);
  if (!sheet || sheet.userId !== userId) {
    throw new BatchGenerationNotFoundError('表格不存在');
  }
  return sheet;
}

function requireOwnedRow(userId: string, sheetId: string, rowId: string) {
  const sheet = requireOwnedSheet(userId, sheetId);
  const row = batchGenerationRepository.findRow(rowId);
  if (!row || row.sheetId !== sheet.id) {
    throw new BatchGenerationNotFoundError('表格行不存在');
  }
  return { row, sheet };
}

function detailStats(rows: BatchGenerationRow[]): BatchGenerationSheetDetail['stats'] {
  return {
    total: rows.length,
    completed: rows.filter((row) => row.executionStatus === 'completed').length,
    failed: rows.filter((row) => ['failed', 'partial_failed'].includes(row.executionStatus)).length,
    queued: rows.filter((row) => row.executionStatus === 'queued').length,
    running: rows.filter((row) => row.executionStatus === 'running').length,
    idle: rows.filter((row) => row.executionStatus === 'idle').length,
    actualCredits: rows.reduce((total, row) => total + row.actualCredits, 0),
  };
}

export const batchGenerationService = {
  listSheets(userId: string) {
    return batchGenerationRepository.listSheets(userId);
  },

  getSheet(userId: string, sheetId: string): BatchGenerationSheetDetail {
    const sheet = requireOwnedSheet(userId, sheetId);
    const rows = batchGenerationRepository.listRows(sheet.id);
    const latestAttempts = rows.flatMap((row) => {
      if (!row.latestAttemptId) return [];
      const attempt = batchGenerationRunRepository.findAttempt(row.latestAttemptId);
      return attempt ? [{ ...attempt, outputs: batchGenerationRunRepository.listOutputs(attempt.id) }] : [];
    });
    return { sheet, rows, latestAttempts, stats: detailStats(rows) };
  },

  createSheet(input: {
    userId: string;
    name: unknown;
    capabilityKey: unknown;
    globalParams?: unknown;
  }) {
    const capability = requireCreativeCapability(String(input.capabilityKey || '').trim());
    const now = new Date().toISOString();
    const sheet: BatchGenerationSheet = {
      id: randomUUID(),
      userId: input.userId,
      name: normalizeName(input.name),
      capabilityKey: capability.key,
      mediaKind: capability.mediaKind,
      globalParams: normalizeCreativeGlobalParams(capability.key, input.globalParams),
      schemaVersion: capability.schemaVersion,
      sortOrder: batchGenerationRepository.nextSheetSortOrder(input.userId),
      revision: 1,
      createdAt: now,
      updatedAt: now,
    };
    return batchGenerationRepository.createSheet(sheet);
  },

  updateSheet(input: {
    userId: string;
    sheetId: string;
    name?: unknown;
    globalParams?: unknown;
    sortOrder?: unknown;
    revision?: unknown;
  }) {
    const current = requireOwnedSheet(input.userId, input.sheetId);
    const expectedRevision = input.revision === undefined ? current.revision : Number(input.revision);
    if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
      throw new Error('revision 参数无效');
    }
    const sortOrder = input.sortOrder === undefined ? current.sortOrder : Number(input.sortOrder);
    if (!Number.isInteger(sortOrder) || sortOrder < 0) {
      throw new Error('排序值必须是非负整数');
    }
    const updated = batchGenerationRepository.updateSheet({
      id: current.id,
      expectedRevision,
      name: input.name === undefined ? current.name : normalizeName(input.name),
      globalParams: input.globalParams === undefined
        ? current.globalParams
        : normalizeCreativeGlobalParams(current.capabilityKey, input.globalParams),
      sortOrder,
      updatedAt: new Date().toISOString(),
    });
    if (!updated) {
      throw new BatchGenerationConflictError('表格已被其他操作更新，请刷新后重试');
    }
    return batchGenerationRepository.findSheet(current.id);
  },

  deleteSheet(userId: string, sheetId: string) {
    const sheet = requireOwnedSheet(userId, sheetId);
    batchGenerationRepository.deleteSheet(sheet.id);
    return { ok: true };
  },

  addRows(input: { userId: string; sheetId: string; rows: unknown[]; insertAt?: unknown }) {
    const sheet = requireOwnedSheet(input.userId, input.sheetId);
    if (!input.rows.length) throw new Error('至少需要新增一行');
    const currentCount = batchGenerationRepository.countRows(sheet.id);
    if (currentCount + input.rows.length > MAX_ROWS) {
      throw new Error(`每个表格最多允许 ${MAX_ROWS} 行`);
    }
    const insertAt = input.insertAt === undefined
      ? currentCount
      : Number(input.insertAt);
    if (!Number.isInteger(insertAt) || insertAt < 0 || insertAt > currentCount) {
      throw new Error('插入位置无效');
    }
    const now = new Date().toISOString();
    const rows = input.rows.map((params, index): BatchGenerationRow => ({
      id: randomUUID(),
      sheetId: sheet.id,
      position: insertAt + index,
      params: normalizeCreativeRowParams(sheet.capabilityKey, params),
      validationStatus: 'draft',
      validationErrors: [],
      executionStatus: 'idle',
      latestAttemptId: null,
      actualCredits: 0,
      revision: 1,
      createdAt: now,
      updatedAt: now,
    }));
    return batchGenerationRepository.insertRows(rows, insertAt);
  },

  updateRow(input: {
    userId: string;
    sheetId: string;
    rowId: string;
    params?: unknown;
    revision?: unknown;
  }) {
    const { row, sheet } = requireOwnedRow(input.userId, input.sheetId, input.rowId);
    const expectedRevision = input.revision === undefined ? row.revision : Number(input.revision);
    if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
      throw new Error('revision 参数无效');
    }
    const updated = batchGenerationRepository.updateRow({
      id: row.id,
      expectedRevision,
      params: input.params === undefined
        ? row.params
        : normalizeCreativeRowParams(sheet.capabilityKey, input.params),
      validationStatus: 'draft',
      validationErrors: [],
      updatedAt: new Date().toISOString(),
    });
    if (!updated) {
      throw new BatchGenerationConflictError('表格行已被其他操作更新，请刷新后重试');
    }
    return batchGenerationRepository.findRow(row.id);
  },

  deleteRow(userId: string, sheetId: string, rowId: string) {
    requireOwnedRow(userId, sheetId, rowId);
    batchGenerationRepository.deleteRow(sheetId, rowId);
    return { ok: true };
  },
};
