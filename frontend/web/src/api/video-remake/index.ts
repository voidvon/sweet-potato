import type { VideoGenerationTask } from '../../types';
import { request } from '../request';

export type VideoRemakeCardType =
  | 'uploading'
  | 'video_basic_info'
  | 'basic_info'
  | 'expert_analysis'
  | 'character_setting'
  | 'scene_setting'
  | 'product_setting'
  | 'pip_setting'
  | 'voice_audio_setting'
  | 'script_content'
  | 'storyboard_script'
  | 'seedance_prompt'
  | 'generation_progress'
  | 'director_normalize'
  | 'llm_thinking'
  | 'final_video';

export type VideoRemakeCardStatus = 'pending' | 'editing' | 'confirmed' | 'expired' | 'failed';
export type VideoRemakeSessionStatus = 'created' | 'running' | 'waiting_credit' | 'waiting_edit' | 'generating' | 'completed' | 'failed' | 'cancelled';

export type VideoRemakeTextMessage = {
  id: string;
  type: 'text';
  role: 'user' | 'assistant' | 'system';
  content: string;
  attachment?: {
    type: 'video';
    url: string;
    title?: string;
    mimeType?: string;
    fileSize?: number;
  };
  createdAt: string;
};

export type VideoRemakeCardMessage<T = unknown> = {
  id: string;
  type: 'card';
  role: 'assistant';
  cardId: string;
  cardType: VideoRemakeCardType;
  title: string;
  status: VideoRemakeCardStatus;
  data: T;
  createdAt: string;
};

export type VideoRemakeChatMessage = VideoRemakeTextMessage | VideoRemakeCardMessage;

export type VideoRemakeSession = {
  id: string;
  userId: string;
  status: VideoRemakeSessionStatus;
  filename?: string;
  taskId?: string;
  currentStep: string;
  invalidArtifacts: VideoRemakeCardType[];
  artifacts: Partial<Record<VideoRemakeCardType, unknown>>;
  messages: VideoRemakeChatMessage[];
  events: VideoRemakeWorkflowEvent[];
  workflow?: Record<string, unknown>;
  task?: VideoGenerationTask;
  createdAt: string;
  updatedAt: string;
  cancelledAt?: string;
};

export type VideoRemakeSessionSummary = Pick<
  VideoRemakeSession,
  'id' | 'userId' | 'status' | 'filename' | 'taskId' | 'currentStep' | 'createdAt' | 'updatedAt' | 'cancelledAt'
>;

export type VideoRemakeWorkflowEvent =
  | { type: 'message'; message: VideoRemakeTextMessage }
  | { type: 'card.create'; card: VideoRemakeCardMessage }
  | { type: 'card.update'; cardId: string; status?: VideoRemakeCardStatus; data?: unknown }
  | { type: 'workflow.progress'; step: string; label: string; percent?: number }
  | { type: 'workflow.interrupt'; interruptType: string; cardId: string; cardType: VideoRemakeCardType; data: unknown }
  | { type: 'workflow.done'; finalVideoUrl: string }
  | { type: 'session.status'; status: VideoRemakeSessionStatus; currentStep: string; invalidArtifacts: VideoRemakeCardType[] }
  | { type: 'error'; step?: string; message: string; retryable: boolean };

export type VideoRemakeEventsResponse = {
  events: Array<VideoRemakeWorkflowEvent & { index: number }>;
  nextIndex: number;
};

export type VideoRemakeChatResponse = {
  session: VideoRemakeSession;
  intent: {
    intent: string;
    target?: VideoRemakeCardType;
    instruction: string;
  };
};

export type VideoRemakeCardConfirmPayload = {
  userId: string;
  cardType: VideoRemakeCardType;
  data: unknown;
  mode?: 'confirm' | 'save_only';
};

export type VideoRemakeCardRegeneratePayload = {
  userId: string;
  cardType: VideoRemakeCardType;
  instruction?: string;
};

export type VideoRemakeExpertRetryPayload = {
  userId: string;
};

enum Api {
  sessions = '/api/video-remake/sessions',
  tasks = '/api/video-remake/tasks',
  parseUrl = '/api/video-remake/parse-url',
}

export function listVideoRemakeTasks(userId: string) {
  void userId;
  return request<VideoGenerationTask[]>(Api.tasks);
}

export function getVideoRemakeTask(id: string) {
  return request<VideoGenerationTask>(`${Api.tasks}/${id}`);
}

export function parseVideoRemakeUrl(payload: { userId: string; url: string }) {
  const { userId: _userId, ...requestPayload } = payload;
  return request<VideoGenerationTask>(Api.parseUrl, {
    method: 'POST',
    body: JSON.stringify(requestPayload),
  });
}

export function parseVideoRemakeSessionUrl(sessionId: string, payload: { userId: string; url: string }) {
  const { userId: _userId, ...requestPayload } = payload;
  return request<VideoRemakeSession>(`${Api.sessions}/${sessionId}/parse-url`, {
    method: 'POST',
    body: JSON.stringify(requestPayload),
  });
}

export function createVideoRemakeSession(payload: { userId: string; filename?: string }) {
  const { userId: _userId, ...requestPayload } = payload;
  return request<VideoRemakeSession>(Api.sessions, {
    method: 'POST',
    body: JSON.stringify(requestPayload),
  });
}

export function listVideoRemakeSessions(userId: string) {
  void userId;
  return request<VideoRemakeSessionSummary[]>(Api.sessions);
}

export function getVideoRemakeSession(sessionId: string) {
  return request<VideoRemakeSession>(`${Api.sessions}/${sessionId}`);
}

export function renameVideoRemakeSession(sessionId: string, payload: { userId: string; filename: string }) {
  const { userId: _userId, ...requestPayload } = payload;
  return request<VideoRemakeSession>(`${Api.sessions}/${sessionId}`, {
    method: 'PATCH',
    body: JSON.stringify(requestPayload),
  });
}

export function deleteVideoRemakeSession(sessionId: string, payload: { userId: string }) {
  const { userId: _userId } = payload;
  return request<{ ok: boolean }>(`${Api.sessions}/${sessionId}`, {
    method: 'DELETE',
    body: JSON.stringify({}),
  });
}

export function uploadVideoRemakeSessionVideo(sessionId: string, payload: { userId: string; file: File }) {
  const { userId: _userId, ...requestPayload } = payload;
  const formData = new FormData();
  formData.set('file', requestPayload.file);
  return request<VideoRemakeSession>(`${Api.sessions}/${sessionId}/upload`, {
    method: 'POST',
    body: formData,
  });
}

export type VideoRemakePipUploadResult = {
  originalFileName: string;
  storedFileName: string;
  mimeType: string;
  fileSize: number;
  fileUrl: string;
};

export function uploadVideoRemakePipAsset(sessionId: string, payload: { userId: string; file: File }) {
  const { userId: _userId, ...requestPayload } = payload;
  const formData = new FormData();
  formData.set('file', requestPayload.file);
  return request<VideoRemakePipUploadResult>(`${Api.sessions}/${sessionId}/pip-assets/upload`, {
    method: 'POST',
    body: formData,
  });
}

export function runVideoRemakeSession(sessionId: string) {
  return request<VideoRemakeSession>(`${Api.sessions}/${sessionId}/run`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export function resumeVideoRemakeSession(sessionId: string) {
  return request<VideoRemakeSession>(`${Api.sessions}/${sessionId}/resume`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export function syncVideoRemakeSession(sessionId: string) {
  return request<VideoRemakeSession>(`${Api.sessions}/${sessionId}/sync`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export function listVideoRemakeEvents(sessionId: string, payload: { userId: string; afterIndex?: number }) {
  const params = new URLSearchParams();
  if (payload.afterIndex !== undefined) {
    params.set('afterIndex', String(payload.afterIndex));
  }
  return request<VideoRemakeEventsResponse>(`${Api.sessions}/${sessionId}/events?${params.toString()}`);
}

export function sendVideoRemakeChat(sessionId: string, payload: { userId: string; message: string }) {
  const { userId: _userId, ...requestPayload } = payload;
  return request<VideoRemakeChatResponse>(`${Api.sessions}/${sessionId}/chat`, {
    method: 'POST',
    body: JSON.stringify(requestPayload),
  });
}

export function confirmVideoRemakeCard(sessionId: string, cardId: string, payload: VideoRemakeCardConfirmPayload) {
  const { userId: _userId, ...requestPayload } = payload;
  return request<VideoRemakeSession>(`${Api.sessions}/${sessionId}/cards/${cardId}/confirm`, {
    method: 'POST',
    body: JSON.stringify(requestPayload),
  });
}

export function cancelVideoRemakeCard(sessionId: string, cardId: string, payload: { userId: string }) {
  const { userId: _userId } = payload;
  return request<VideoRemakeSession>(`${Api.sessions}/${sessionId}/cards/${cardId}/cancel`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export function editVideoRemakeCard(sessionId: string, cardId: string, payload: { userId: string }) {
  const { userId: _userId } = payload;
  return request<VideoRemakeSession>(`${Api.sessions}/${sessionId}/cards/${cardId}/edit`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export function regenerateVideoRemakeCard(sessionId: string, cardId: string, payload: VideoRemakeCardRegeneratePayload) {
  const { userId: _userId, ...requestPayload } = payload;
  return request<VideoRemakeSession>(`${Api.sessions}/${sessionId}/cards/${cardId}/regenerate`, {
    method: 'POST',
    body: JSON.stringify(requestPayload),
  });
}

export function regenerateVideoRemakeFinalSegment(
  sessionId: string,
  cardId: string,
  segmentIndex: number,
  payload: { userId: string; prompt?: string },
) {
  const { userId: _userId, ...requestPayload } = payload;
  return request<VideoRemakeSession>(`${Api.sessions}/${sessionId}/cards/${cardId}/final-video/segments/${segmentIndex}/regenerate`, {
    method: 'POST',
    body: JSON.stringify(requestPayload),
  });
}

export function retryVideoRemakeExpert(sessionId: string, cardId: string, payload: VideoRemakeExpertRetryPayload) {
  const { userId: _userId } = payload;
  return request<VideoRemakeSession>(`${Api.sessions}/${sessionId}/cards/${cardId}/retry-expert`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export function cancelVideoRemakeSession(sessionId: string, payload: { userId: string }) {
  const { userId: _userId } = payload;
  return request<VideoRemakeSession>(`${Api.sessions}/${sessionId}/cancel`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}
