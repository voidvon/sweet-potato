import { logger } from '../../shared/logger.js';
import {
  runTalkingVideoPromptAgent,
  totalTalkingVideoModelCalls,
  type TalkingVideoAgentPhase,
} from './talking-video-agent-runtime.js';
import {
  pruneTalkingVideoArkReuseCache,
  type TalkingVideoRunMetrics,
} from './talking-video-understanding-runtime.js';
import type { TalkingVideoPromptImage, TalkingVideoPromptMedia } from './talking-video.prompt.js';

export type TalkingVideoTaskStatus = 'thinking' | 'completed' | 'failed' | 'stopped';
export type TalkingVideoTaskPhase = TalkingVideoAgentPhase;

export type TalkingVideoTaskTimings = {
  t_analysis_done_ms?: number;
  t_first_phase_ms?: number;
  t_first_reasoning_ms?: number;
  t_result_ms?: number;
};

export type TalkingVideoTaskEvent =
  | {
    type: 'snapshot';
    taskId: string;
    status: TalkingVideoTaskStatus;
    phase: TalkingVideoTaskPhase;
    reasoning: string;
    prompt: string;
    errorMessage: string;
    metrics: TalkingVideoRunMetrics;
    timings: TalkingVideoTaskTimings;
  }
  | { type: 'phase'; taskId: string; phase: TalkingVideoTaskPhase; metrics: TalkingVideoRunMetrics; timings: TalkingVideoTaskTimings }
  | { type: 'reasoning_delta'; taskId: string; delta: string }
  | { type: 'delta'; taskId: string; delta: string }
  | { type: 'result'; taskId: string; prompt: string; metrics: TalkingVideoRunMetrics; timings: TalkingVideoTaskTimings }
  | { type: 'status'; taskId: string; status: TalkingVideoTaskStatus; phase: TalkingVideoTaskPhase; errorMessage?: string; metrics: TalkingVideoRunMetrics; timings: TalkingVideoTaskTimings }
  | { type: 'done'; taskId: string };

type TalkingVideoTask = {
  id: string;
  userId: string;
  status: TalkingVideoTaskStatus;
  phase: TalkingVideoTaskPhase;
  reasoning: string;
  prompt: string;
  errorMessage: string;
  metrics: TalkingVideoRunMetrics;
  timings: TalkingVideoTaskTimings;
  controller: AbortController;
  listeners: Set<(event: TalkingVideoTaskEvent) => void>;
  createdAt: number;
  runVersion: number;
  startedAt: number;
  persistSnapshot?: (event: Extract<TalkingVideoTaskEvent, { type: 'snapshot' }>) => void;
};

type StartTalkingVideoTaskInput = {
  taskId: string;
  userId: string;
  images: TalkingVideoPromptImage[];
  video: TalkingVideoPromptMedia;
  deepThink: boolean;
  runAgent?: typeof runTalkingVideoPromptAgent;
  persistSnapshot?: (event: Extract<TalkingVideoTaskEvent, { type: 'snapshot' }>) => void;
};

const taskRegistry = new Map<string, TalkingVideoTask>();
const maxRetainedTasks = 100;

function ownedTask(taskId: string, userId: string) {
  const task = taskRegistry.get(taskId);
  if (!task || task.userId !== userId) throw new Error('口播任务不存在或已失效');
  return task;
}

function snapshot(task: TalkingVideoTask): TalkingVideoTaskEvent {
  return {
    type: 'snapshot',
    taskId: task.id,
    status: task.status,
    phase: task.phase,
    reasoning: task.reasoning,
    prompt: task.prompt,
    errorMessage: task.errorMessage,
    metrics: { ...task.metrics },
    timings: { ...task.timings },
  };
}

function publish(task: TalkingVideoTask, event: TalkingVideoTaskEvent) {
  task.listeners.forEach((listener) => listener(event));
}

function persist(task: TalkingVideoTask) {
  try {
    task.persistSnapshot?.(snapshot(task) as Extract<TalkingVideoTaskEvent, { type: 'snapshot' }>);
  } catch (error) {
    logger.warn('failed to persist talking video task snapshot', {
      taskId: task.id,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

function publicError(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  if (/cancel(?:ed|led)|abort|已停止/iu.test(message)) {
    return { status: 'stopped' as const, message: '口播提示词生成已停止' };
  }
  return { status: 'failed' as const, message: message || '口播提示词生成失败，请重新尝试' };
}

function pruneTasks() {
  pruneTalkingVideoArkReuseCache();
  if (taskRegistry.size <= maxRetainedTasks) return;
  const removable = [...taskRegistry.values()]
    .filter((task) => task.status !== 'thinking')
    .sort((left, right) => left.createdAt - right.createdAt);
  while (taskRegistry.size > maxRetainedTasks && removable.length) {
    const task = removable.shift();
    if (task) taskRegistry.delete(task.id);
  }
}

function createEmptyMetrics(): TalkingVideoRunMetrics {
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

function recordPhase(task: TalkingVideoTask, phase: TalkingVideoTaskPhase, metrics: TalkingVideoRunMetrics) {
  task.phase = phase;
  task.metrics = { ...metrics };
  const elapsedMs = Date.now() - task.startedAt;
  if (task.timings.t_first_phase_ms === undefined) {
    task.timings.t_first_phase_ms = elapsedMs;
  }
  if (phase === 'generating_prompt' && task.timings.t_analysis_done_ms === undefined) {
    task.timings.t_analysis_done_ms = elapsedMs;
  }
  if (phase === 'completed' && task.timings.t_result_ms === undefined) {
    task.timings.t_result_ms = elapsedMs;
  }
}

function runTalkingVideoTask(task: TalkingVideoTask, input: StartTalkingVideoTaskInput) {
  const runVersion = task.runVersion;
  const controller = task.controller;
  const runAgent = input.runAgent || runTalkingVideoPromptAgent;
  queueMicrotask(() => {
    void runAgent({
      userId: input.userId,
      video: input.video,
      images: input.images,
      deepThink: input.deepThink,
      signal: controller.signal,
      onPhaseChange: (phase, metrics) => {
        if (task.runVersion !== runVersion) return;
        recordPhase(task, phase, metrics);
        publish(task, {
          type: 'phase',
          taskId: task.id,
          phase: task.phase,
          metrics: { ...task.metrics },
          timings: { ...task.timings },
        });
        persist(task);
      },
      onReasoningDelta: (delta) => {
        if (task.runVersion !== runVersion) return;
        task.reasoning += delta;
        if (task.timings.t_first_reasoning_ms === undefined) {
          task.timings.t_first_reasoning_ms = Date.now() - task.startedAt;
        }
        publish(task, { type: 'reasoning_delta', taskId: task.id, delta });
      },
      onAnswerDelta: (delta) => {
        if (task.runVersion !== runVersion) return;
        task.prompt += delta;
        publish(task, { type: 'delta', taskId: task.id, delta });
      },
    }).then((result) => {
      if (task.runVersion !== runVersion) return;
      task.prompt = result.prompt;
      task.status = 'completed';
      recordPhase(task, 'completed', result.metrics);
      publish(task, {
        type: 'result',
        taskId: task.id,
        prompt: result.prompt,
        metrics: { ...task.metrics },
        timings: { ...task.timings },
      });
      publish(task, {
        type: 'status',
        taskId: task.id,
        status: 'completed',
        phase: task.phase,
        metrics: { ...task.metrics },
        timings: { ...task.timings },
      });
      persist(task);
      logger.info('talking video task completed', {
        taskId: task.id,
        metrics: task.metrics,
        timings: task.timings,
        totalModelCalls: totalTalkingVideoModelCalls(task.metrics),
      });
      publish(task, { type: 'done', taskId: task.id });
    }).catch((error) => {
      if (task.runVersion !== runVersion) return;
      const resolved = publicError(error);
      task.status = resolved.status;
      task.phase = resolved.status === 'stopped' ? 'stopped' : 'failed';
      task.errorMessage = resolved.message;
      if (resolved.status !== 'stopped' && task.timings.t_result_ms === undefined) {
        task.timings.t_result_ms = Date.now() - task.startedAt;
      }
      publish(task, {
        type: 'status',
        taskId: task.id,
        status: resolved.status,
        phase: task.phase,
        errorMessage: resolved.message,
        metrics: { ...task.metrics },
        timings: { ...task.timings },
      });
      persist(task);
      logger.warn('talking video task ended with error', {
        taskId: task.id,
        status: resolved.status,
        message: resolved.message,
        metrics: task.metrics,
        timings: task.timings,
        totalModelCalls: totalTalkingVideoModelCalls(task.metrics),
      });
      publish(task, { type: 'done', taskId: task.id });
    });
  });
}

export function startTalkingVideoTask(input: StartTalkingVideoTaskInput) {
  const existing = taskRegistry.get(input.taskId);
  if (existing) {
    if (existing.userId !== input.userId) throw new Error('口播任务不存在');
    if (existing.status === 'thinking' || existing.status === 'completed') {
      existing.persistSnapshot = input.persistSnapshot;
      persist(existing);
      return existing;
    }
    existing.status = 'thinking';
    existing.phase = 'uploading_assets';
    existing.reasoning = '';
    existing.prompt = '';
    existing.errorMessage = '';
    existing.metrics = createEmptyMetrics();
    existing.timings = {};
    existing.controller = new AbortController();
    existing.createdAt = Date.now();
    existing.startedAt = existing.createdAt;
    existing.runVersion += 1;
    existing.persistSnapshot = input.persistSnapshot;
    persist(existing);
    runTalkingVideoTask(existing, input);
    return existing;
  }

  const task: TalkingVideoTask = {
    id: input.taskId,
    userId: input.userId,
    status: 'thinking',
    phase: 'uploading_assets',
    reasoning: '',
    prompt: '',
    errorMessage: '',
    metrics: createEmptyMetrics(),
    timings: {},
    controller: new AbortController(),
    listeners: new Set(),
    createdAt: Date.now(),
    runVersion: 1,
    startedAt: Date.now(),
    persistSnapshot: input.persistSnapshot,
  };
  taskRegistry.set(task.id, task);
  pruneTasks();
  persist(task);
  runTalkingVideoTask(task, input);

  return task;
}

export function subscribeTalkingVideoTask(input: {
  taskId: string;
  userId: string;
  listener: (event: TalkingVideoTaskEvent) => void;
}) {
  const task = ownedTask(input.taskId, input.userId);
  task.listeners.add(input.listener);
  input.listener(snapshot(task));
  return () => task.listeners.delete(input.listener);
}

export function getTalkingVideoTaskSnapshot(taskId: string, userId: string) {
  return snapshot(ownedTask(taskId, userId));
}

export function stopTalkingVideoTask(taskId: string, userId: string) {
  const task = ownedTask(taskId, userId);
  if (task.status === 'thinking') {
    const controller = task.controller;
    task.status = 'stopped';
    task.phase = 'stopped';
    task.errorMessage = '口播提示词生成已停止';
    publish(task, {
      type: 'status',
      taskId: task.id,
      status: 'stopped',
      phase: task.phase,
      errorMessage: task.errorMessage,
      metrics: { ...task.metrics },
      timings: { ...task.timings },
    });
    persist(task);
    task.runVersion += 1;
    controller.abort();
  }
  return snapshot(task);
}
