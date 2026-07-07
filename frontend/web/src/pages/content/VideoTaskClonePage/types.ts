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

export type MaterialMode = 'works' | 'audio' | 'model' | null;

export type PromptPanel = 'marketing' | 'reverse' | 'write';

export type ParamKind = 'model' | 'canvas' | 'duration';

export type FilterValues = Record<string, string>;

export type UploadAnchor = {
  left: number;
  top: number;
};

export type SelectedMaterials = Partial<Record<MaterialKey, string>>;

export type SelectedMaterialValue = string | undefined;
