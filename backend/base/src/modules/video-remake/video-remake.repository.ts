import { randomUUID } from 'node:crypto';
import { db } from '../../db/database.js';
import type {
  VideoRemakeCardMessage,
  VideoRemakeCardStatus,
  VideoRemakeCardType,
  VideoRemakeChatMessage,
  VideoRemakeSession,
  VideoRemakeSessionSummary,
  VideoRemakeTask,
  VideoRemakeTaskStatus,
  VideoRemakeWorkflowEvent,
  VideoRemakeWorkflowNode,
  VideoRemakeWorkflowState,
} from './video-remake.types.js';

type VideoRemakeTaskRow = {
  id: string;
  user_id: string;
  source_url: string;
  prompt: string;
  title: string;
  status: VideoRemakeTaskStatus;
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

type VideoRemakeSessionRow = {
  id: string;
  task_id: string | null;
  user_id: string;
  filename: string | null;
  status: VideoRemakeSession['status'];
  current_step: string;
  invalid_artifacts: string;
  artifacts: string;
  workflow_state: string;
  created_at: string;
  updated_at: string;
  cancelled_at: string | null;
};

type VideoRemakeCardRow = {
  id: string;
  session_id: string;
  card_id: string;
  card_type: VideoRemakeCardType;
  title: string;
  status: VideoRemakeCardStatus;
  data: string;
  created_at: string;
  updated_at: string;
};

type VideoRemakeEventRow = {
  id: string;
  session_id: string;
  event_type: string;
  payload: string;
  created_at: string;
};

type VideoRemakeFinalSegmentRow = {
  id: string;
  session_id: string;
  card_id: string;
  version_label: string;
  version_number: number;
  segment_index: number;
  video_url: string | null;
  file_path: string | null;
  status: string;
  prompt: string;
  data: string;
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

function parseRecord(value: string): Record<string, unknown> {
  const parsed = parseJson<unknown>(value, {});
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
}

function parseStringArray(value: string): string[] {
  const parsed = parseJson<unknown>(value, []);
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
}

function parseWorkflowState(value: string): VideoRemakeWorkflowState {
  const parsed = parseJson<unknown>(value, {});
  const record = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  return {
    mode: typeof record.mode === 'string' ? record.mode : 'video_remake',
    currentNode: (typeof record.currentNode === 'string' ? record.currentNode : 'upload_to_vod') as VideoRemakeWorkflowNode,
    artifacts: typeof record.artifacts === 'object' && record.artifacts && !Array.isArray(record.artifacts)
      ? record.artifacts as Partial<Record<string, unknown>>
      : {},
    invalidArtifacts: Array.isArray(record.invalidArtifacts)
      ? record.invalidArtifacts.filter((item): item is VideoRemakeCardType => typeof item === 'string')
      : [],
    pendingInterrupt: typeof record.pendingInterrupt === 'object' && record.pendingInterrupt && !Array.isArray(record.pendingInterrupt)
      ? record.pendingInterrupt as VideoRemakeWorkflowState['pendingInterrupt']
      : undefined,
    source: typeof record.source === 'object' && record.source && !Array.isArray(record.source)
      ? record.source as VideoRemakeWorkflowState['source']
      : { kind: 'url', title: '', sourceUrl: '' },
    runtime: typeof record.runtime === 'object' && record.runtime && !Array.isArray(record.runtime)
      ? record.runtime as VideoRemakeWorkflowState['runtime']
      : {},
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : nowIso(),
  };
}

function serializeTask(row: VideoRemakeTaskRow): VideoRemakeTask {
  return {
    id: row.id,
    userId: row.user_id,
    sourceUrl: row.source_url,
    prompt: row.prompt,
    title: row.title,
    status: row.status,
    rawParseResult: parseRecord(row.raw_parse_result),
    editableParseResult: parseRecord(row.editable_parse_result),
    selectedSkillIds: parseStringArray(row.selected_skill_ids),
    expertContext: parseRecord(row.expert_context),
    generatedVideoUrl: row.generated_video_url,
    failureReason: row.failure_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function serializeCard(row: VideoRemakeCardRow): VideoRemakeCardMessage {
  return {
    id: row.id,
    type: 'card',
    role: 'assistant',
    cardId: row.card_id,
    cardType: row.card_type,
    title: row.title,
    status: row.status,
    data: parseJson<unknown>(row.data, {}),
    createdAt: row.created_at,
  };
}

function serializeEvent(row: VideoRemakeEventRow): VideoRemakeWorkflowEvent {
  return parseJson<VideoRemakeWorkflowEvent>(row.payload, {
    type: 'error',
    message: 'invalid event payload',
    retryable: false,
  });
}

function serializeFinalSegment(row: VideoRemakeFinalSegmentRow): Record<string, unknown> {
  return {
    ...parseRecord(row.data),
    segmentIndex: row.segment_index,
    videoUrl: row.video_url || undefined,
    filePath: row.file_path || undefined,
    status: row.status,
    prompt: parseJson<unknown>(row.prompt, {}),
    versionLabel: row.version_label,
    versionNumber: row.version_number,
  };
}

const emptyParseResult = {
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

function buildSession(row: VideoRemakeSessionRow, cards: VideoRemakeCardRow[], events: VideoRemakeEventRow[]): VideoRemakeSession {
  const workflow = parseWorkflowState(row.workflow_state);
  const messages: VideoRemakeChatMessage[] = [];
  const cardMessages = cards.map(serializeCard);
  const workflowEvents = events.map(serializeEvent);
  for (const event of workflowEvents) {
    if (event.type === 'message') {
      messages.push(event.message);
      continue;
    }
    if (event.type === 'card.create') {
      messages.push(event.card);
      continue;
    }
    if (event.type === 'card.update') {
      const index = messages.findIndex((message) => message.type === 'card' && message.cardId === event.cardId);
      if (index >= 0) {
        const message = messages[index];
        if (message.type === 'card') {
          messages[index] = {
            ...message,
            status: event.status || message.status,
            data: event.data === undefined ? message.data : event.data,
          };
        }
      }
    }
  }
  for (const card of cardMessages) {
    const index = messages.findIndex((message) => message.type === 'card' && message.cardId === card.cardId);
    if (index >= 0) {
      messages[index] = card;
    } else {
      messages.push(card);
    }
  }
  messages.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return {
    id: row.id,
    userId: row.user_id,
    filename: row.filename || undefined,
    taskId: row.task_id || undefined,
    status: row.status,
    currentStep: row.current_step as VideoRemakeWorkflowNode,
    invalidArtifacts: parseStringArray(row.invalid_artifacts) as VideoRemakeCardType[],
    artifacts: parseJson<Partial<Record<VideoRemakeCardType, unknown>>>(row.artifacts, {}),
    messages,
    events: workflowEvents,
    workflow,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    cancelledAt: row.cancelled_at || undefined,
  };
}

function buildSessionSummary(row: VideoRemakeSessionRow): VideoRemakeSessionSummary {
  return {
    id: row.id,
    userId: row.user_id,
    filename: row.filename || undefined,
    taskId: row.task_id || undefined,
    status: row.status,
    currentStep: row.current_step as VideoRemakeWorkflowNode,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    cancelledAt: row.cancelled_at || undefined,
  };
}

function readSessionRows(sessionId: string) {
  const session = db.prepare('SELECT * FROM video_remake_sessions WHERE id = ?').get(sessionId) as VideoRemakeSessionRow | undefined;
  if (!session) {
    return null;
  }
  const cards = db.prepare(`
    SELECT * FROM video_remake_cards
    WHERE session_id = @sessionId
    ORDER BY created_at ASC
  `).all({ sessionId }) as VideoRemakeCardRow[];
  const events = db.prepare(`
    SELECT * FROM video_remake_events
    WHERE session_id = @sessionId
    ORDER BY created_at ASC
  `).all({ sessionId }) as VideoRemakeEventRow[];
  return buildSession(session, cards, events);
}

export const videoRemakeRepository = {
  listTasks(userId: string) {
    const rows = db.prepare(`
      SELECT * FROM video_generation_tasks
      WHERE user_id = @userId
      ORDER BY created_at DESC
      LIMIT 80
    `).all({ userId }) as VideoRemakeTaskRow[];
    return rows
      .map(serializeTask)
      .filter((task) => String(task.expertContext.mode || '').startsWith('video_remake_'));
  },

  findTask(id: string) {
    const row = db.prepare('SELECT * FROM video_generation_tasks WHERE id = ?').get(id) as VideoRemakeTaskRow | undefined;
    return row ? serializeTask(row) : null;
  },

  createTask(input: {
    userId: string;
    sourceUrl: string;
    title: string;
    prompt?: string;
    parseResult?: Record<string, unknown>;
    expertContext: Record<string, unknown>;
  }) {
    const now = nowIso();
    const id = randomUUID();
    const parseResult = JSON.stringify(input.parseResult || emptyParseResult);
    db.prepare(`
      INSERT INTO video_generation_tasks (
        id, user_id, source_url, prompt, title, status, raw_parse_result, editable_parse_result,
        selected_skill_ids, expert_context, selected_digital_human_id, selected_voice_id, selected_scene_id,
        generated_video_url, failure_reason, created_at, updated_at
      )
      VALUES (
        @id, @userId, @sourceUrl, @prompt, @title, 'pending', @parseResult, @parseResult,
        '[]', @expertContext, NULL, NULL, NULL, NULL, NULL, @now, @now
      )
    `).run({
      id,
      userId: input.userId,
      sourceUrl: input.sourceUrl,
      prompt: input.prompt || '',
      title: input.title,
      parseResult,
      expertContext: JSON.stringify(input.expertContext),
      now,
    });
    return this.findTask(id);
  },

  updateTask(id: string, patch: {
    status?: VideoRemakeTaskStatus;
    rawParseResult?: Record<string, unknown>;
    editableParseResult?: Record<string, unknown>;
    expertContext?: Record<string, unknown>;
    generatedVideoUrl?: string | null;
    failureReason?: string | null;
  }) {
    const current = this.findTask(id);
    if (!current) {
      return null;
    }
    const updatedAt = nowIso();
    db.prepare(`
      UPDATE video_generation_tasks
      SET status = @status,
          raw_parse_result = @rawParseResult,
          editable_parse_result = @editableParseResult,
          expert_context = @expertContext,
          generated_video_url = @generatedVideoUrl,
          failure_reason = @failureReason,
          updated_at = @updatedAt
      WHERE id = @id
    `).run({
      id,
      status: patch.status || current.status,
      rawParseResult: JSON.stringify(patch.rawParseResult || current.rawParseResult),
      editableParseResult: JSON.stringify(patch.editableParseResult || current.editableParseResult),
      expertContext: JSON.stringify(patch.expertContext || current.expertContext),
      generatedVideoUrl: patch.generatedVideoUrl === undefined ? current.generatedVideoUrl : patch.generatedVideoUrl,
      failureReason: patch.failureReason === undefined ? current.failureReason : patch.failureReason,
      updatedAt,
    });
    return this.findTask(id);
  },

  createSession(input: {
    id?: string;
    taskId?: string;
    userId: string;
    filename?: string;
    status: VideoRemakeSession['status'];
    currentStep: VideoRemakeWorkflowNode;
    invalidArtifacts?: VideoRemakeCardType[];
    artifacts?: Partial<Record<VideoRemakeCardType, unknown>>;
    workflow: VideoRemakeWorkflowState;
  }) {
    const id = input.id || randomUUID();
    const now = nowIso();
    db.prepare(`
      INSERT INTO video_remake_sessions (
        id, task_id, user_id, filename, status, current_step, invalid_artifacts, artifacts, workflow_state,
        created_at, updated_at, cancelled_at
      )
      VALUES (
        @id, @taskId, @userId, @filename, @status, @currentStep, @invalidArtifacts, @artifacts, @workflowState,
        @createdAt, @updatedAt, NULL
      )
    `).run({
      id,
      taskId: input.taskId || null,
      userId: input.userId,
      filename: input.filename || null,
      status: input.status,
      currentStep: input.currentStep,
      invalidArtifacts: JSON.stringify(input.invalidArtifacts || []),
      artifacts: JSON.stringify(input.artifacts || {}),
      workflowState: JSON.stringify(input.workflow),
      createdAt: now,
      updatedAt: now,
    });
    return this.findSession(id);
  },

  updateSession(sessionId: string, patch: {
    taskId?: string | null;
    filename?: string | null;
    status?: VideoRemakeSession['status'];
    currentStep?: VideoRemakeWorkflowNode;
    invalidArtifacts?: VideoRemakeCardType[];
    artifacts?: Partial<Record<VideoRemakeCardType, unknown>>;
    workflow?: VideoRemakeWorkflowState;
    cancelledAt?: string | null;
  }) {
    const current = this.findSession(sessionId);
    if (!current) {
      return null;
    }
    const nextWorkflow = patch.workflow || current.workflow;
    const updatedAt = nowIso();
    db.prepare(`
      UPDATE video_remake_sessions
      SET task_id = @taskId,
          filename = @filename,
          status = @status,
          current_step = @currentStep,
          invalid_artifacts = @invalidArtifacts,
          artifacts = @artifacts,
          workflow_state = @workflowState,
          updated_at = @updatedAt,
          cancelled_at = @cancelledAt
      WHERE id = @id
    `).run({
      id: sessionId,
      taskId: patch.taskId === undefined ? current.taskId || null : patch.taskId,
      filename: patch.filename === undefined ? current.filename || null : patch.filename,
      status: patch.status || current.status,
      currentStep: patch.currentStep || current.currentStep,
      invalidArtifacts: JSON.stringify(patch.invalidArtifacts || current.invalidArtifacts),
      artifacts: JSON.stringify(patch.artifacts || current.artifacts),
      workflowState: JSON.stringify({ ...nextWorkflow, updatedAt }),
      updatedAt,
      cancelledAt: patch.cancelledAt === undefined ? current.cancelledAt || null : patch.cancelledAt,
    });
    return this.findSession(sessionId);
  },

  deleteSession(sessionId: string) {
    const existing = this.findSession(sessionId);
    if (!existing) {
      return false;
    }
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM video_remake_events WHERE session_id = ?').run(sessionId);
      db.prepare('DELETE FROM video_remake_cards WHERE session_id = ?').run(sessionId);
      db.prepare('DELETE FROM video_remake_final_segments WHERE session_id = ?').run(sessionId);
      db.prepare('DELETE FROM video_remake_sessions WHERE id = ?').run(sessionId);
    });
    tx();
    return true;
  },

  findSession(sessionId: string) {
    return readSessionRows(sessionId);
  },

  findSessionByTaskId(taskId: string) {
    const row = db.prepare(`
      SELECT * FROM video_remake_sessions
      WHERE task_id = @taskId
      ORDER BY updated_at DESC
      LIMIT 1
    `).get({ taskId }) as VideoRemakeSessionRow | undefined;
    if (!row) {
      return null;
    }
    const cards = db.prepare(`
      SELECT * FROM video_remake_cards
      WHERE session_id = @sessionId
      ORDER BY created_at ASC
    `).all({ sessionId: row.id }) as VideoRemakeCardRow[];
    const events = db.prepare(`
      SELECT * FROM video_remake_events
      WHERE session_id = @sessionId
      ORDER BY created_at ASC
    `).all({ sessionId: row.id }) as VideoRemakeEventRow[];
    return buildSession(row, cards, events);
  },

  listSessionSummaries(userId: string) {
    const rows = db.prepare(`
      SELECT * FROM video_remake_sessions
      WHERE user_id = @userId
      ORDER BY updated_at DESC
    `).all({ userId }) as VideoRemakeSessionRow[];
    return rows.map(buildSessionSummary);
  },

  listSessions(userId: string) {
    const rows = db.prepare(`
      SELECT * FROM video_remake_sessions
      WHERE user_id = @userId
      ORDER BY updated_at DESC
    `).all({ userId }) as VideoRemakeSessionRow[];
    return rows.map((row) => {
      const cards = db.prepare(`
        SELECT * FROM video_remake_cards
        WHERE session_id = @sessionId
        ORDER BY created_at ASC
      `).all({ sessionId: row.id }) as VideoRemakeCardRow[];
      const events = db.prepare(`
        SELECT * FROM video_remake_events
        WHERE session_id = @sessionId
        ORDER BY created_at ASC
      `).all({ sessionId: row.id }) as VideoRemakeEventRow[];
      return buildSession(row, cards, events);
    });
  },

  listResumableSessions() {
    const rows = db.prepare(`
      SELECT * FROM video_remake_sessions
      WHERE status IN ('running', 'generating')
      ORDER BY updated_at ASC
      LIMIT 80
    `).all() as VideoRemakeSessionRow[];
    return rows.map((row) => {
      const cards = db.prepare(`
        SELECT * FROM video_remake_cards
        WHERE session_id = @sessionId
        ORDER BY created_at ASC
      `).all({ sessionId: row.id }) as VideoRemakeCardRow[];
      const events = db.prepare(`
        SELECT * FROM video_remake_events
        WHERE session_id = @sessionId
        ORDER BY created_at ASC
      `).all({ sessionId: row.id }) as VideoRemakeEventRow[];
      return buildSession(row, cards, events);
    });
  },

  upsertCard(sessionId: string, card: VideoRemakeCardMessage) {
    const existing = db.prepare(`
      SELECT * FROM video_remake_cards
      WHERE session_id = @sessionId AND card_id = @cardId
      LIMIT 1
    `).get({ sessionId, cardId: card.cardId }) as VideoRemakeCardRow | undefined;
    const updatedAt = nowIso();
    if (existing) {
      db.prepare(`
        UPDATE video_remake_cards
        SET status = @status,
            data = @data,
            title = @title,
            updated_at = @updatedAt
        WHERE id = @id
      `).run({
        id: existing.id,
        status: card.status,
        data: JSON.stringify(card.data),
        title: card.title,
        updatedAt,
      });
    } else {
      db.prepare(`
        INSERT INTO video_remake_cards (
          id, session_id, card_id, card_type, title, status, data, created_at, updated_at
        )
        VALUES (
          @id, @sessionId, @cardId, @cardType, @title, @status, @data, @createdAt, @updatedAt
        )
      `).run({
        id: card.id,
        sessionId,
        cardId: card.cardId,
        cardType: card.cardType,
        title: card.title,
        status: card.status,
        data: JSON.stringify(card.data),
        createdAt: card.createdAt,
        updatedAt: card.createdAt,
      });
    }
    return this.findSession(sessionId);
  },

  appendEvent(sessionId: string, event: VideoRemakeWorkflowEvent) {
    db.prepare(`
      INSERT INTO video_remake_events (
        id, session_id, event_type, payload, created_at
      )
      VALUES (
        @id, @sessionId, @eventType, @payload, @createdAt
      )
    `).run({
      id: randomUUID(),
      sessionId,
      eventType: event.type,
      payload: JSON.stringify(event),
      createdAt: nowIso(),
    });
  },

  listFinalVideoSegments(input: { sessionId: string; cardId: string; versionLabel?: string; versionNumber?: number }) {
    const versionLabel = input.versionLabel || (input.versionNumber ? `v${input.versionNumber}` : '');
    const rows = db.prepare(`
      SELECT * FROM video_remake_final_segments
      WHERE session_id = @sessionId
        AND card_id = @cardId
        AND version_label = @versionLabel
      ORDER BY segment_index ASC
    `).all({
      sessionId: input.sessionId,
      cardId: input.cardId,
      versionLabel,
    }) as VideoRemakeFinalSegmentRow[];
    return rows.map(serializeFinalSegment);
  },

  upsertFinalVideoSegments(input: {
    sessionId: string;
    cardId: string;
    versionLabel?: string;
    versionNumber?: number;
    segments: Array<Record<string, unknown>>;
  }) {
    const now = nowIso();
    const versionNumber = Number(input.versionNumber || 0);
    const versionLabel = input.versionLabel || (versionNumber ? `v${versionNumber}` : '');
    if (!versionLabel || !input.segments.length) {
      return;
    }
    const statement = db.prepare(`
      INSERT INTO video_remake_final_segments (
        id, session_id, card_id, version_label, version_number, segment_index,
        video_url, file_path, status, prompt, data, created_at, updated_at
      )
      VALUES (
        @id, @sessionId, @cardId, @versionLabel, @versionNumber, @segmentIndex,
        @videoUrl, @filePath, @status, @prompt, @data, @createdAt, @updatedAt
      )
      ON CONFLICT(session_id, card_id, version_label, segment_index)
      DO UPDATE SET
        version_number = excluded.version_number,
        video_url = excluded.video_url,
        file_path = excluded.file_path,
        status = excluded.status,
        prompt = excluded.prompt,
        data = excluded.data,
        updated_at = excluded.updated_at
    `);
    const tx = db.transaction(() => {
      input.segments.forEach((segment, index) => {
        const segmentIndex = Number(segment.segmentIndex || segment.index || index + 1);
        const prompt = parseJson<unknown>(JSON.stringify(segment.prompt || {}), {});
        statement.run({
          id: randomUUID(),
          sessionId: input.sessionId,
          cardId: input.cardId,
          versionLabel,
          versionNumber,
          segmentIndex,
          videoUrl: typeof segment.videoUrl === 'string'
            ? segment.videoUrl
            : typeof segment.fileUrl === 'string'
              ? segment.fileUrl
              : typeof segment.url === 'string'
                ? segment.url
                : null,
          filePath: typeof segment.filePath === 'string' || typeof segment.segmentPath === 'string'
            ? String(segment.filePath || segment.segmentPath)
            : null,
          status: typeof segment.status === 'string' ? segment.status : 'completed',
          prompt: JSON.stringify(prompt),
          data: JSON.stringify(segment),
          createdAt: now,
          updatedAt: now,
        });
      });
    });
    tx();
  },
};
