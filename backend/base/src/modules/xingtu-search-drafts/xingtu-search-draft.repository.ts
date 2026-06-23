import { db } from '../../db/database.js';
import type { XingtuSearchDraft, XingtuSearchDraftRecord, XingtuSearchDraftRunSummary } from './xingtu-search-draft.types.js';

function parseDraft(record: XingtuSearchDraftRecord): XingtuSearchDraft {
  return {
    ...record,
    criteria: JSON.parse(record.criteria || '[]'),
    automationFilters: record.automationFilters ? JSON.parse(record.automationFilters) : null,
    sourceText: record.sourceText || undefined,
    lastRunTaskId: record.lastRunTaskId || null,
    lastResultSummary: record.lastResultSummary ? JSON.parse(record.lastResultSummary) as XingtuSearchDraftRunSummary : null,
  };
}

function serializeDraft(draft: XingtuSearchDraft) {
  return {
    ...draft,
    criteria: JSON.stringify(draft.criteria || []),
    automationFilters: draft.automationFilters ? JSON.stringify(draft.automationFilters) : null,
    sourceText: draft.sourceText || null,
    lastRunTaskId: draft.lastRunTaskId || null,
    lastResultSummary: draft.lastResultSummary ? JSON.stringify(draft.lastResultSummary) : null,
  };
}

const draftSelect = `
  SELECT
    id,
    user_id as userId,
    profile_id as profileId,
    keyword,
    search_mode as searchMode,
    criteria,
    automation_filters as automationFilters,
    source_text as sourceText,
    status,
    last_run_task_id as lastRunTaskId,
    last_result_summary as lastResultSummary,
    created_at as createdAt,
    updated_at as updatedAt
  FROM xingtu_search_drafts
`;

export const xingtuSearchDraftRepository = {
  create(draft: XingtuSearchDraft) {
    db.prepare(`
      INSERT INTO xingtu_search_drafts (
        id, user_id, profile_id, keyword, search_mode, criteria, automation_filters, source_text,
        status, last_run_task_id, last_result_summary, created_at, updated_at
      )
      VALUES (
        @id, @userId, @profileId, @keyword, @searchMode, @criteria, @automationFilters, @sourceText,
        @status, @lastRunTaskId, @lastResultSummary, @createdAt, @updatedAt
      )
    `).run(serializeDraft(draft));
    return draft;
  },

  find(id: string) {
    const record = db.prepare(`${draftSelect} WHERE id = ?`).get(id) as XingtuSearchDraftRecord | undefined;
    return record ? parseDraft(record) : undefined;
  },

  listByUser(userId: string) {
    const records = db.prepare(`
      ${draftSelect}
      WHERE user_id = ?
      ORDER BY updated_at DESC
    `).all(userId) as XingtuSearchDraftRecord[];
    return records.map(parseDraft);
  },

  update(draft: XingtuSearchDraft) {
    db.prepare(`
      UPDATE xingtu_search_drafts
      SET
        profile_id = @profileId,
        keyword = @keyword,
        search_mode = @searchMode,
        criteria = @criteria,
        automation_filters = @automationFilters,
        source_text = @sourceText,
        status = @status,
        last_run_task_id = @lastRunTaskId,
        last_result_summary = @lastResultSummary,
        updated_at = @updatedAt
      WHERE id = @id
    `).run(serializeDraft(draft));
    return draft;
  },
};
