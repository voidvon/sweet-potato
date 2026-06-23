type ElectronRenderer = {
  ipcRenderer?: {
    invoke?: (channel: string, params?: unknown) => Promise<unknown>;
  };
};

declare global {
  interface Window {
    electron?: ElectronRenderer;
    require?: (moduleName: string) => ElectronRenderer;
    showSaveFilePicker?: (options?: {
      suggestedName?: string;
      types?: Array<{
        description?: string;
        accept: Record<string, string[]>;
      }>;
    }) => Promise<{
      createWritable: () => Promise<{
        write: (data: Blob) => Promise<void>;
        close: () => Promise<void>;
      }>;
    }>;
  }
}

const Renderer = (window.require?.('electron') || window.electron || {}) as ElectronRenderer;

const ipc = Renderer.ipcRenderer;
export const isElectronEgg = Boolean(ipc);

export type SaveAssetFilePayload = {
  fileName: string;
  sourcePath?: string;
  url?: string;
};

export type SaveAssetFileResult = {
  ok: boolean;
  canceled?: boolean;
  filePath?: string;
  message?: string;
};

export type AutomationTaskStatus = 'created' | 'running' | 'waiting_user' | 'done' | 'failed' | 'canceled';

export type AutomationTaskLog = {
  time: string;
  level: 'info' | 'warn' | 'error';
  message: string;
};

export type AutomationTask = {
  id: string;
  adapter: string;
  profileId: string;
  status: AutomationTaskStatus;
  input: Record<string, unknown>;
  result: unknown;
  error: string | null;
  logs: AutomationTaskLog[];
  createdAt: string;
  updatedAt: string;
};

export type StartAutomationTaskPayload = {
  adapter: string;
  profileId?: string;
  input: Record<string, unknown>;
};

export type AutomationTaskResult = {
  ok: boolean;
  taskId?: string;
  task?: AutomationTask;
  message?: string;
};

export type AutomationWindowsResult = {
  ok: boolean;
  closedCount?: number;
  message?: string;
};

export type AutomationProfileStopResult = {
  ok: boolean;
  canceledTaskIds?: string[];
  closedCount?: number;
  message?: string;
};

export async function saveAssetFile(payload: SaveAssetFilePayload): Promise<SaveAssetFileResult> {
  if (!ipc?.invoke) {
    return { ok: false, message: '当前环境不支持 Electron 保存文件' };
  }
  try {
    const result = await ipc.invoke('controller/file/saveAsset', payload);
    return result as SaveAssetFileResult;
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : '保存失败',
    };
  }
}

async function invokeAutomation<T>(method: string, payload?: unknown): Promise<T> {
  if (!ipc?.invoke) {
    return { ok: false, message: '当前环境不支持 Electron 自动化' } as T;
  }
  try {
    return await ipc.invoke(`controller/browserAutomation/${method}`, payload) as T;
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : '自动化调用失败',
    } as T;
  }
}

export function startAutomationTask(payload: StartAutomationTaskPayload): Promise<AutomationTaskResult> {
  return invokeAutomation<AutomationTaskResult>('startTask', payload);
}

export function cancelAutomationTask(taskId: string): Promise<AutomationTaskResult> {
  return invokeAutomation<AutomationTaskResult>('cancelTask', { taskId });
}

export function resumeAutomationTask(taskId: string): Promise<AutomationTaskResult> {
  return invokeAutomation<AutomationTaskResult>('resumeTask', { taskId });
}

export function getAutomationTask(taskId: string): Promise<AutomationTaskResult> {
  return invokeAutomation<AutomationTaskResult>('getTask', { taskId });
}

export function closeAutomationWindows(profileId: string): Promise<AutomationWindowsResult> {
  return invokeAutomation<AutomationWindowsResult>('closeWindows', { profileId });
}

export function stopAutomationProfile(profileId: string, site?: string): Promise<AutomationProfileStopResult> {
  return invokeAutomation<AutomationProfileStopResult>('stopProfile', { profileId, site });
}
