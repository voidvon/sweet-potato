export type VideoReferenceType = 'image' | 'video' | 'audio';

export type VideoImageMode = 'none' | 'first_frame_required' | 'first_last_optional' | 'reference_images';

export type VideoModelReferencePolicy = {
  imageMode: VideoImageMode;
  maxImages: number;
  allowVideo: boolean;
  maxVideos: number;
  allowAudio: boolean;
  maxAudios: number;
  audioRequiresVisualReference?: boolean;
};

export type VideoModelOption = {
  id: string;
  name: string;
  description: string;
  disabled?: boolean;
  supportedReferenceTypes: VideoReferenceType[];
  referencePolicy: VideoModelReferencePolicy;
  durationPolicy: {
    minSeconds: number;
    maxSeconds: number;
    defaultSeconds: number;
    supportsAuto: boolean;
  };
};

export type VideoModelProvider = {
  id: string;
  name: string;
  description: string;
  keyLabel: string;
  keyPlaceholder: string;
  keyHelp?: string;
  defaultBaseUrl: string;
  defaultModel: string;
  models: VideoModelOption[];
};
