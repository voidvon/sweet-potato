import { desktopAutomationBridge } from '../../config/env.js';

export type DesktopAutomationTaskStatus = 'created' | 'running' | 'waiting_user' | 'done' | 'failed' | 'canceled';

export type DesktopAutomationTask = {
  id: string;
  adapter: string;
  profileId: string;
  status: DesktopAutomationTaskStatus;
  input: Record<string, unknown>;
  result: unknown;
  error: string | null;
  logs: Array<{ time: string; level: 'info' | 'warn' | 'error'; message: string }>;
  createdAt: string;
  updatedAt: string;
};

type DesktopAutomationTaskResponse = {
  ok: boolean;
  task?: DesktopAutomationTask;
  taskId?: string;
  message?: string;
};

function joinUrl(pathname: string) {
  return `${desktopAutomationBridge.baseUrl}${pathname}`;
}

async function parseJson(response: Response) {
  const text = await response.text();
  return text ? JSON.parse(text) as Record<string, unknown> : {};
}

async function request<T>(pathname: string, init?: RequestInit): Promise<T> {
  const response = await fetch(joinUrl(pathname), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
    signal: AbortSignal.timeout(Math.max(1000, desktopAutomationBridge.taskTimeoutMs)),
  });
  const data = await parseJson(response);
  if (!response.ok) {
    throw new Error(String(data.message || `桌面自动化 bridge 请求失败：${response.status}`));
  }
  return data as T;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const desktopAutomationClient = {
  async health() {
    return request<{ ok: boolean; desktopReady?: boolean }>('/internal/desktop-automation/health', {
      method: 'GET',
    });
  },

  async startTask(payload: { adapter: string; profileId?: string; input: Record<string, unknown> }) {
    return request<DesktopAutomationTaskResponse>('/internal/desktop-automation/tasks', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async getTask(taskId: string) {
    return request<DesktopAutomationTaskResponse>(`/internal/desktop-automation/tasks/${encodeURIComponent(taskId)}`, {
      method: 'GET',
    });
  },

  async waitForTaskDone(taskId: string) {
    const deadline = Date.now() + Math.max(5000, desktopAutomationBridge.taskTimeoutMs);
    while (Date.now() < deadline) {
      const result = await this.getTask(taskId);
      if (!result.ok || !result.task) {
        throw new Error(result.message || '桌面自动化任务不存在');
      }
      if (['done', 'failed', 'canceled'].includes(result.task.status)) {
        return result.task;
      }
      await sleep(Math.max(200, desktopAutomationBridge.pollIntervalMs));
    }
    throw new Error('等待桌面自动化任务完成超时');
  },
};

