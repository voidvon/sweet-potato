import type { TalkingVideoPromptTask } from './types';

export type TalkingVideoDeltaKind = 'prompt' | 'reasoning';

export type TalkingVideoDeltaBuffer = {
  prompt: string;
  reasoning: string;
};

export function emptyTalkingVideoMetrics(): TalkingVideoPromptTask['metrics'] {
  return {
    arkUploadCount: 0,
    arkUploadPollMs: 0,
    understandingModelCalls: 0,
    understandingReplayCalls: 0,
    formatRepairCalls: 0,
    promptRepairCalls: 0,
    reuseCacheHitCount: 0,
  };
}

export function normalizeTalkingVideoTaskRuntimeFields(task: TalkingVideoPromptTask): TalkingVideoPromptTask {
  return {
    ...task,
    phase: task.phase || (task.status === 'completed'
      ? 'completed'
      : task.status === 'failed'
        ? 'failed'
        : task.status === 'stopped'
          ? 'stopped'
          : 'uploading_assets'),
    metrics: task.metrics || emptyTalkingVideoMetrics(),
    serverTimings: task.serverTimings || {},
    clientTimings: task.clientTimings || {},
  };
}

export function applyTalkingVideoResumeFailure(
  task: TalkingVideoPromptTask,
  errorMessage: string,
): TalkingVideoPromptTask {
  const normalizedMessage = errorMessage.trim() || '口播任务恢复失败，请重新生成';
  const missingTask = /口播任务(?:已失效，请点击继续重新生成|不存在或已失效)/u.test(normalizedMessage);
  return {
    ...task,
    phase: missingTask ? 'stopped' : 'failed',
    status: missingTask ? 'stopped' : 'failed',
    errorMessage: normalizedMessage,
  };
}

export function applyTalkingVideoClientPhase(
  task: TalkingVideoPromptTask,
  phase: TalkingVideoPromptTask['phase'],
  nowMs?: number,
) {
  if (task.clientTimings.firstVisiblePhaseMs !== undefined || nowMs === undefined) {
    return { ...task, phase };
  }
  const startedAtMs = task.clientTimings.streamStartedAtMs;
  return {
    ...task,
    phase,
    clientTimings: startedAtMs === undefined
      ? task.clientTimings
      : {
        ...task.clientTimings,
        firstVisiblePhaseMs: Math.max(0, Math.round(nowMs - startedAtMs)),
      },
  };
}

export function applyTalkingVideoClientReasoning(
  task: TalkingVideoPromptTask,
  nowMs?: number,
) {
  if (task.clientTimings.firstReasoningMs !== undefined || nowMs === undefined) return task;
  const startedAtMs = task.clientTimings.streamStartedAtMs;
  return {
    ...task,
    clientTimings: startedAtMs === undefined
      ? task.clientTimings
      : {
        ...task.clientTimings,
        firstReasoningMs: Math.max(0, Math.round(nowMs - startedAtMs)),
      },
  };
}

export function appendTalkingVideoDeltaBuffer(
  buffer: TalkingVideoDeltaBuffer,
  kind: TalkingVideoDeltaKind,
  delta: string,
): TalkingVideoDeltaBuffer {
  return kind === 'reasoning'
    ? { ...buffer, reasoning: `${buffer.reasoning}${delta}` }
    : { ...buffer, prompt: `${buffer.prompt}${delta}` };
}

export function flushTalkingVideoDeltaBufferIntoTask(
  task: TalkingVideoPromptTask,
  buffer: TalkingVideoDeltaBuffer,
) {
  let next = task;
  if (buffer.reasoning) {
    next = {
      ...next,
      reasoning: `${next.reasoning}${buffer.reasoning}`,
    };
  }
  if (buffer.prompt) {
    next = {
      ...next,
      prompt: `${next.prompt}${buffer.prompt}`,
    };
  }
  return next;
}
