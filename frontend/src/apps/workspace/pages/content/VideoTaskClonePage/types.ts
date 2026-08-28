export type MaterialKey = 'image' | 'video' | 'audio';

export type ToolKey =
  | 'lightweight-marketing-video'
  | 'video'
  | 'video-upscale'
  | 'talking-video'
  | 'subject-replace'
  | 'dance-remake'
  | 'marketing-video'
  | 'subtitle-removal'
  | 'video-translation';

export type DanceRemakeMode = 'standard' | 'enhanced';

export type TalkingVideoImageRole = 'model' | 'product' | 'background' | 'detail';

export type TalkingVideoPromptPhase =
  | 'uploading_assets'
  | 'understanding_video'
  | 'validating_analysis'
  | 'generating_prompt'
  | 'validating_prompt'
  | 'repairing_prompt'
  | 'completed'
  | 'failed'
  | 'stopped';

export type TalkingVideoPromptMetrics = {
  arkUploadCount: number;
  arkUploadPollMs: number;
  understandingModelCalls: number;
  understandingReplayCalls: number;
  formatRepairCalls: number;
  promptRepairCalls: number;
  reuseCacheHitCount: number;
};

export type TalkingVideoPromptServerTimings = {
  t_analysis_done_ms?: number;
  t_first_phase_ms?: number;
  t_first_reasoning_ms?: number;
  t_result_ms?: number;
};

export type TalkingVideoPromptClientTimings = {
  firstReasoningMs?: number;
  firstVisiblePhaseMs?: number;
  streamStartedAtMs?: number;
};

export type TalkingVideoPromptTask = {
  deepThink: boolean;
  id: string;
  phase: TalkingVideoPromptPhase;
  status: 'preparing' | 'thinking' | 'completed' | 'failed' | 'stopped';
  reasoning: string;
  prompt: string;
  errorMessage: string;
  metrics: TalkingVideoPromptMetrics;
  serverTimings: TalkingVideoPromptServerTimings;
  clientTimings: TalkingVideoPromptClientTimings;
  sourceVideo: LocalMaterialFile;
  referenceImages: LocalMaterialFile[];
  createdAt: string;
};
export type SubjectReplaceType = 'model' | 'clothing' | 'face' | 'background' | 'product';

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

export type VideoTranslationMode = 'subtitle' | 'voice' | 'face';

export type VideoTranslationSubtitleSource = 'ocr' | 'asr';

export type VideoTranslationConfig = {
  sourceLanguage: string;
  targetLanguage: string;
  modes: Record<VideoTranslationMode, boolean>;
  subtitleSource: VideoTranslationSubtitleSource;
  hardSubtitles: boolean;
  eraseOriginalSubtitles: boolean;
  subtitlePlacementConfig: SubtitleRemovalConfig;
  fontSize: number;
  showLines: number;
};

export type MarketingVideoConfig = {
  productCategory: string;
  productName: string;
  sellingPoints: string;
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
  | { id: string; type: 'lightweight-marketing-video-form' }
  | { id: string; type: 'material'; showVoiceToggle?: boolean }
  | { id: string; type: 'talking-video-form' }
  | { id: string; type: 'dance-remake-form' }
  | { id: string; type: 'subject-replace-form' }
  | { id: string; type: 'parameters'; showDuration?: boolean; showHeader?: boolean; showRatio?: boolean }
  | { id: string; type: 'prompt'; title?: string }
  | { id: string; type: 'marketing-video-form' }
  | { id: string; type: 'subtitle-removal' }
  | { id: string; type: 'video-translation' };

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
      handler: 'video-generation' | 'video-upscale' | 'subtitle-removal' | 'video-translation' | 'dance-remake' | 'subject-replace' | 'pending';
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
  mediaDuration?: number;
  name: string;
  remoteMetadata?: Record<string, unknown>;
  remoteSourceUrl?: string;
  serverFileUrl?: string;
  storedFileName?: string;
  talkingVideoRole?: TalkingVideoImageRole;
  trimDuration?: number;
  trimEnd?: number;
  trimStart?: number;
  type: MaterialKey;
  url: string;
};

export type SelectedMaterials = Partial<Record<MaterialKey, string | LocalMaterialFile[]>>;

export type SelectedMaterialValue = string | LocalMaterialFile[] | undefined;
