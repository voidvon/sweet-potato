import { API_BASE_URL, request } from '../request';
import { getStoredToken } from '../../utils/session';
import { createUtf8SseEventParser } from '../talkingVideoSse';

export type TalkingVideoPromptEvent =
  | {
    type: 'snapshot';
    taskId: string;
    status: 'thinking' | 'completed' | 'failed' | 'stopped';
    phase: 'uploading_assets' | 'understanding_video' | 'validating_analysis' | 'generating_prompt' | 'validating_prompt' | 'repairing_prompt' | 'completed' | 'failed' | 'stopped';
    reasoning: string;
    prompt: string;
    errorMessage: string;
    metrics: TalkingVideoPromptMetrics;
    timings: TalkingVideoPromptTimings;
  }
  | {
    type: 'phase';
    taskId: string;
    phase: 'uploading_assets' | 'understanding_video' | 'validating_analysis' | 'generating_prompt' | 'validating_prompt' | 'repairing_prompt' | 'completed' | 'failed' | 'stopped';
    metrics: TalkingVideoPromptMetrics;
    timings: TalkingVideoPromptTimings;
  }
  | { type: 'reasoning_delta'; taskId: string; delta: string }
  | { type: 'delta'; taskId: string; delta: string }
  | { type: 'result'; taskId: string; prompt: string; metrics: TalkingVideoPromptMetrics; timings: TalkingVideoPromptTimings }
  | {
    type: 'status';
    taskId: string;
    status: 'thinking' | 'completed' | 'failed' | 'stopped';
    phase: 'uploading_assets' | 'understanding_video' | 'validating_analysis' | 'generating_prompt' | 'validating_prompt' | 'repairing_prompt' | 'completed' | 'failed' | 'stopped';
    errorMessage?: string;
    metrics: TalkingVideoPromptMetrics;
    timings: TalkingVideoPromptTimings;
  }
  | { type: 'done'; taskId: string };

export type TalkingVideoPromptMetrics = {
  arkUploadCount: number;
  arkUploadPollMs: number;
  understandingModelCalls: number;
  understandingReplayCalls: number;
  formatRepairCalls: number;
  promptRepairCalls: number;
  reuseCacheHitCount: number;
};

export type TalkingVideoPromptTimings = {
  t_analysis_done_ms?: number;
  t_first_phase_ms?: number;
  t_first_reasoning_ms?: number;
  t_result_ms?: number;
};

export async function streamTalkingVideoPrompt(taskId: string, payload: {
  videoAssetId?: string;
  remoteVideo?: {
    input: string;
    trimEnd?: number;
    trimStart?: number;
  };
  images: Array<{
    assetId: string;
    role: 'model' | 'product' | 'background' | 'detail';
  }>;
  deepThink: boolean;
}, onEvent: (event: TalkingVideoPromptEvent) => void, options?: { signal?: AbortSignal }) {
  const token = getStoredToken();
  const response = await fetch(`${API_BASE_URL}/api/talking-video/prompt/tasks/${encodeURIComponent(taskId)}/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
    signal: options?.signal,
  });
  await consumeTalkingVideoPromptStream(response, onEvent);
}

export async function resumeTalkingVideoPrompt(taskId: string, onEvent: (event: TalkingVideoPromptEvent) => void, options?: { signal?: AbortSignal }) {
  const token = getStoredToken();
  const response = await fetch(`${API_BASE_URL}/api/talking-video/prompt/tasks/${encodeURIComponent(taskId)}/stream`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    signal: options?.signal,
  });
  await consumeTalkingVideoPromptStream(response, onEvent);
}

export function stopTalkingVideoPrompt(taskId: string) {
  return request<TalkingVideoPromptEvent>(`/api/talking-video/prompt/tasks/${encodeURIComponent(taskId)}/stop`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export async function listTalkingVideoPromptHistory() {
  const response = await request<{ tasks: unknown[] }>('/api/talking-video/prompt/history');
  return Array.isArray(response.tasks) ? response.tasks : [];
}

export async function importTalkingVideoPromptHistory(tasks: unknown[]) {
  const response = await request<{ tasks: unknown[] }>('/api/talking-video/prompt/history/import', {
    method: 'POST',
    body: JSON.stringify({ tasks: tasks.slice(0, 10) }),
  });
  return Array.isArray(response.tasks) ? response.tasks : [];
}

async function consumeTalkingVideoPromptStream(response: Response, onEvent: (event: TalkingVideoPromptEvent) => void) {
  if (!response.ok) {
    const text = await response.text();
    let message = '口播提示词生成失败';
    try {
      message = JSON.parse(text)?.message || message;
    } catch {
      message = text || message;
    }
    throw new Error(message);
  }
  if (!response.body) throw new Error('口播提示词生成服务未返回内容');

  const reader = response.body.getReader();
  const parser = createUtf8SseEventParser<TalkingVideoPromptEvent>((data) => JSON.parse(data) as TalkingVideoPromptEvent);
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    parser.push(value).forEach(onEvent);
  }
  parser.finish().forEach(onEvent);
}
