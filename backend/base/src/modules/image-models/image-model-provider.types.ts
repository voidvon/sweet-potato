export type ImageModelOption = {
  id: string;
  name: string;
  description: string;
  disabled?: boolean;
};

export type ImageModelProvider = {
  id: string;
  name: string;
  description: string;
  keyLabel: string;
  keyPlaceholder: string;
  keyHelp?: string;
  defaultBaseUrl: string;
  defaultModel: string;
  models: ImageModelOption[];
};
