export type MaterialKey = 'image' | 'video' | 'audio';

export type ToolKey =
  | 'video'
  | 'video-upscale'
  | 'talking-video'
  | 'subject-replace'
  | 'dance-remake'
  | 'marketing-video'
  | 'subtitle-removal'
  | 'video-translation';

export type SubtitleRemovalMode = 'auto' | 'auto_region' | 'manual';

export type SubtitleRemovalContentType = 'subtitle' | 'text';

export type SubtitleRemovalLocation = {
  topLeftX: number;
  topLeftY: number;
  bottomRightX: number;
  bottomRightY: number;
};

export type SubtitleRemovalClipFilter = {
  mode: 'all' | 'selected' | 'skip';
  clips: Array<{
    start: number;
    end: number;
  }>;
};

export type SubtitleRemovalConfig = {
  mode: SubtitleRemovalMode;
  contentType: SubtitleRemovalContentType;
  locations: SubtitleRemovalLocation[];
  clipFilter: SubtitleRemovalClipFilter;
};

export type MaterialKind = {
  hint: string;
  key: MaterialKey;
  label: string;
  maxCount?: number;
  meta: string;
  minCount?: number;
};

export type WorkspaceBlock =
  | { id: string; type: 'material'; showVoiceToggle?: boolean }
  | { id: string; type: 'parameters' }
  | { id: string; type: 'prompt'; title?: string }
  | { id: string; type: 'subtitle-removal' };

export type WorkspaceBlockType = WorkspaceBlock['type'];

export type ToolOption = {
  description: string;
  key: ToolKey;
  label: string;
  materialHint: string;
  materials: MaterialKind[];
  submitText: string;
  workspace: {
    blocks: WorkspaceBlock[];
    generate: {
      handler: 'video-generation' | 'video-upscale' | 'subtitle-removal' | 'pending';
    };
  };
};

export type FilterGroup = {
  label: string;
  options: string[];
};

export type MaterialMode = 'works' | 'audio' | null;

export type WorksTab = 'all' | 'image' | 'video';

export type PromptPanel = 'marketing' | 'reverse' | 'write';

export type ParamKind = 'model' | 'canvas' | 'duration';

export type FilterValues = Record<string, string>;

export type UploadAnchor = {
  left: number;
  top: number;
};

export type LocalMaterialFile = {
  assetId?: string;
  audioDuration?: number;
  file?: File;
  id: string;
  name: string;
  serverFileUrl?: string;
  storedFileName?: string;
  trimDuration?: number;
  trimEnd?: number;
  trimStart?: number;
  type: MaterialKey;
  url: string;
};

export type SelectedMaterials = Partial<Record<MaterialKey, string | LocalMaterialFile[]>>;

export type SelectedMaterialValue = string | LocalMaterialFile[] | undefined;
