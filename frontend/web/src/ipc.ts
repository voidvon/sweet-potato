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

export type WechatProbeNode = {
  name: string;
  automationId: string;
  className: string;
  controlType: string;
};

export type WechatProbeData = {
  windowName: string;
  childCount: number;
  children: WechatProbeNode[];
};

export type WechatMenuProbeNode = {
  name: string;
  automationId: string;
  className: string;
  controlType: string;
  depth: number;
  source: 'window' | 'root';
  rect?: [number, number, number, number] | null;
};

export type WechatAddFriendMenuProbeData = {
  windowName: string;
  plusButton: WechatMenuProbeNode | null;
  relatedControls: WechatMenuProbeNode[];
};

export type WechatQuickActionProbeData = {
  windowName: string;
  activated: boolean;
  clicked: boolean;
  menuOpened: boolean;
  menuRegion?: [number, number, number, number] | null;
  plusButton?: WechatMenuProbeNode | null;
  quickActionButton: (WechatMenuProbeNode & { score?: number }) | null;
  candidates: Array<WechatMenuProbeNode & { score?: number }>;
  relatedControls?: WechatMenuProbeNode[];
};

export type WechatAutomationLog = {
  level: 'info' | 'warn' | 'error';
  message: string;
  code?: string;
  details?: Record<string, unknown>;
};

export type WechatProbeResult = {
  ok: boolean;
  data?: WechatProbeData;
  message?: string;
  logs?: WechatAutomationLog[];
  command?: string[];
};

export type WechatAutomationActionResult = {
  ok: boolean;
  message?: string;
  logs?: WechatAutomationLog[];
  command?: string[];
  data?: unknown;
};

export type WechatSendMessageResult = WechatAutomationActionResult;

export type WechatAddFriendMenuProbeResult = WechatAutomationActionResult & {
  data?: WechatAddFriendMenuProbeData;
};

export type WechatQuickActionProbeResult = WechatAutomationActionResult & {
  data?: WechatQuickActionProbeData;
};

export type WechatPanelIdentifyData = {
  windowName: string;
  activated: boolean;
  panel: string | null;
  confidence: number;
  method: string;
  matchedRule?: string | null;
  matchedKeyword?: string;
  matchedControl?: WechatMenuProbeNode & { panel?: string; keyword?: string; rule?: string };
  ruleMatches?: Array<WechatMenuProbeNode & { panel?: string; keyword?: string; rule?: string }>;
  contactFeatureMatchCount?: number;
  contactFeatureMatches?: Array<WechatMenuProbeNode & { feature?: string; keyword?: string; matchType?: string }>;
  signals?: string[];
  mainControlNames?: string[];
};

export type WechatPanelIdentifyResult = WechatAutomationActionResult & {
  data?: WechatPanelIdentifyData;
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

async function invokeWechatAutomation<T>(method: string, payload?: unknown): Promise<T> {
  if (!ipc?.invoke) {
    return { ok: false, message: '当前环境不支持 Electron 微信自动化' } as T;
  }
  try {
    return await ipc.invoke(`controller/wechatAutomation/${method}`, payload) as T;
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : '微信自动化调用失败',
    } as T;
  }
}

export function runWechatProbe(windowName?: string): Promise<WechatProbeResult> {
  return invokeWechatAutomation<WechatProbeResult>('runProbe', { windowName });
}

export function identifyWechatCurrentPanel(payload?: {
  windowName?: string;
}): Promise<WechatPanelIdentifyResult> {
  return invokeWechatAutomation<WechatPanelIdentifyResult>('identifyCurrentPanel', payload);
}

export function switchWechatPanel(payload: {
  windowName?: string;
  panel: '微信' | '通讯录';
}): Promise<WechatAutomationActionResult> {
  return invokeWechatAutomation<WechatAutomationActionResult>('switchPanel', payload);
}

export function sendWechatMessage(payload: {
  windowName?: string;
  contactName: string;
  message: string;
}): Promise<WechatSendMessageResult> {
  return invokeWechatAutomation<WechatSendMessageResult>('sendMessage', payload);
}

export function openWechatAddFriend(payload?: {
  windowName?: string;
  account?: string;
  greeting?: string;
}): Promise<WechatAutomationActionResult> {
  return invokeWechatAutomation<WechatAutomationActionResult>('openAddFriend', payload);
}

export function probeWechatAddFriendMenu(payload?: {
  windowName?: string;
}): Promise<WechatAddFriendMenuProbeResult> {
  return invokeWechatAutomation<WechatAddFriendMenuProbeResult>('probeAddFriendMenu', payload);
}

export function probeWechatQuickAction(payload?: {
  windowName?: string;
}): Promise<WechatQuickActionProbeResult> {
  return invokeWechatAutomation<WechatQuickActionProbeResult>('probeQuickAction', payload);
}

export function clickWechatAddFriendEntry(payload?: {
  windowName?: string;
}): Promise<WechatAutomationActionResult> {
  return invokeWechatAutomation<WechatAutomationActionResult>('clickAddFriendEntry', payload);
}

export function focusWechatAddFriendSearch(payload?: {
  windowName?: string;
}): Promise<WechatAutomationActionResult> {
  return invokeWechatAutomation<WechatAutomationActionResult>('focusAddFriendSearch', payload);
}

export function searchWechatAddFriendAccount(payload: {
  account: string;
}): Promise<WechatAutomationActionResult> {
  return invokeWechatAutomation<WechatAutomationActionResult>('searchAddFriendAccount', payload);
}

export function handleWechatAddFriendResult(payload: {
  windowName?: string;
  greeting: string;
}): Promise<WechatAutomationActionResult> {
  return invokeWechatAutomation<WechatAutomationActionResult>('handleAddFriendResult', payload);
}

export function closeWechatAddFriendWindows(payload?: {
  windowName?: string;
}): Promise<WechatAutomationActionResult> {
  return invokeWechatAutomation<WechatAutomationActionResult>('closeAddFriendWindows', payload);
}

export function focusFillWechatChatMessage(payload: {
  windowName?: string;
  message: string;
}): Promise<WechatAutomationActionResult> {
  return invokeWechatAutomation<WechatAutomationActionResult>('focusFillChatMessage', payload);
}

export function sendWechatCurrentChatMessage(payload: {
  windowName?: string;
  message: string;
}): Promise<WechatAutomationActionResult> {
  return invokeWechatAutomation<WechatAutomationActionResult>('focusFillChatMessage', payload);
}
