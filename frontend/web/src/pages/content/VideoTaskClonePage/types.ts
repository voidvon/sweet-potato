export type MaterialKey = 'image' | 'video' | 'audio';

export type MaterialKind = {
  hint: string;
  key: MaterialKey;
  label: string;
  meta: string;
};

export type ToolOption = {
  description: string;
  label: string;
  materialHint: string;
  materials: MaterialKind[];
  submitText: string;
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
