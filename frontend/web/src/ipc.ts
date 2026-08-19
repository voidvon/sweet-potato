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
