export type ContentModuleCode = 'digital_human' | 'virtual_portrait_assets' | 'ai_voice' | 'scene_library' | 'product_assets' | 'finished_assets' | 'real_person_assets' | 'create_video';

export type ContentModule = {
  code: ContentModuleCode;
  name: string;
  kind: 'asset_library' | 'video_generation';
  description: string;
};

export type ContentResourceType = 'digital_human' | 'virtual_portrait' | 'voice' | 'scene' | 'product' | 'finished_video' | 'real_person' | 'other';
export type ContentAssetLifecycleStatus = 'temporary' | 'retained' | 'permanent';

export type ContentAssetGroup = {
  id: string;
  userId: string;
  username?: string;
  resourceType: ContentResourceType;
  name: string;
  description: string;
  metadata: Record<string, unknown>;
  assetCount?: number;
  coverAssets?: ContentAsset[];
  createdAt: string;
  updatedAt: string;
};

export type ContentAsset = {
  id: string;
  groupId: string;
  userId: string;
  resourceType: ContentResourceType;
  name: string;
  description: string;
  originalFileName: string;
  storedFileName: string;
  mimeType: string;
  fileSize: number;
  filePath: string;
  fileUrl: string;
  assetKind: string;
  lifecycleStatus: ContentAssetLifecycleStatus;
  parentAssetId: string | null;
  expiresAt: string | null;
  retainedAt: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type TemporaryAssetCleanupCandidate = {
  id: string;
  userId: string;
  username: string;
  assetKind: string;
  name: string;
  mimeType: string;
  fileSize: number;
  fileUrl: string;
  parentAssetId: string | null;
  expiresAt: string;
  createdAt: string;
};

export type TemporaryAssetCleanupLog = {
  id: number;
  assetId: string;
  userId: string;
  username: string;
  assetKind: string;
  name: string;
  fileUrl: string;
  fileSize: number;
  expiresAt: string | null;
  triggerType: 'scheduled' | 'manual';
  cleanedAt: string;
};

export type VideoTaskStatus = 'pending' | 'parsing' | 'waiting_edit' | 'generating' | 'success' | 'failed';

export type VideoAnalysisProcessSection = {
  key: string;
  label: string;
  items: Array<{ label: string; value: string }>;
  conclusion: string;
};

export type PictureInPictureDetectionItem = {
  id: string;
  type: 'pip_video' | 'pip_image' | 'screenshot_overlay' | 'screen_recording' | 'split_screen' | 'unknown' | string;
  startSecond: number;
  endSecond: number;
  position: string;
  content: string;
  confidence: number;
};

export type PictureInPictureDetection = {
  appeared: boolean;
  summary: string;
  items: PictureInPictureDetectionItem[];
  extraction?: {
    ok: boolean;
    message?: string;
    video?: Record<string, unknown>;
  };
};

export type VideoParseResult = {
  person: string;
  scene: string;
  voice: string;
  shotLanguage: string;
  product: string;
  pip: string;
  pictureInPicture?: PictureInPictureDetection;
  spokenContent: string;
  extraDetails: string;
  analysisProcess?: VideoAnalysisProcessSection[];
  viralAnalysis?: ViralVideoAnalysis;
  replicationPlan?: ViralReplicationPlan;
  videoGenerationResult?: VideoGenerationResult;
};

export type ViralRoleType = 'human' | 'animal' | 'virtual_avatar' | 'anthropomorphic_object' | 'none';

export type ViralAnalysisDimension<T = Record<string, unknown>> = {
  key: ViralAnalysisDimensionKey;
  label: string;
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  appeared: boolean;
  summary: string;
  skipReason?: string;
  evidence: string[];
  details: T;
};

export type ViralAnalysisDimensionKey =
  | 'basicInfo'
  | 'formatQuality'
  | 'role'
  | 'scene'
  | 'product'
  | 'pip'
  | 'narrative'
  | 'camera'
  | 'colorLighting'
  | 'audioMood'
  | 'captionCopy'
  | 'interaction'
  | 'cover'
  | 'sellingPoint'
  | 'negativePrompts';

export type ViralVideoAnalysis = {
  version: 1;
  sourceType: 'url' | 'prompt';
  sourceValue: string;
  deterministicSeed: string;
  dimensions: Record<ViralAnalysisDimensionKey, ViralAnalysisDimension>;
  role: ViralAnalysisDimension<{
    roleType: ViralRoleType;
    human?: { ageRange: string; genderExpression: string; outfit: string; expression: string; action: string };
    animal?: { species: string; behavior: string; anthropomorphicLevel: string };
    virtualAvatar?: { style: string; realism: string; brandPersona: string };
    anthropomorphicObject?: { objectName: string; humanizedTraits: string; movement: string };
    noRole?: { reason: string; visualFocus: string };
  }>;
  narrative: ViralAnalysisDimension<{
    hookFirst3Seconds: string;
    timeline: Array<{ timeRange: string; beat: string; purpose: string }>;
    climaxTurn: string;
    ending: string;
  }>;
  sellingPoint: ViralAnalysisDimension<{
    coreValue: string;
    proofPoints: string[];
    retentionLevers: string[];
  }>;
  negativePrompts: ViralAnalysisDimension<{
    people: string[];
    scene: string[];
    props: string[];
    quality: string[];
    copyCompliance: string[];
  }>;
  createdAt: string;
};

export type ViralReplacementItem = {
  dimension: ViralAnalysisDimensionKey;
  label: string;
  sourceSummary: string;
  replacementSuggestion: string;
  mustKeep: string;
};

export type ViralReplicationPlan = {
  version: 1;
  taskId: string;
  targetPlatform: string;
  userBrandOrProduct: string;
  replacementBrief: string;
  replacementItems: ViralReplacementItem[];
  voiceoverScript: Array<{ timeRange: string; text: string; rhythm: string }>;
  visualPrompt: string;
  negativePrompts: string[];
  keepRules: string[];
  generatedAt: string;
};

export type VideoGenerationResult = {
  version: 1;
  taskId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  sourceType?: string;
  provider?: string;
  model?: string;
  jobId?: string;
  videoUrl?: string | null;
  coverUrl?: string;
  errorMessage?: string;
  duration: string;
  ratio: string;
  usedReplicationPlan?: ViralReplicationPlan;
  renderMode?: 'local_preview' | 'provider_generation' | 'segmented_ffmpeg';
  renderStatus?: 'queued' | 'rendering' | 'rendered' | 'failed';
  audioSource?: 'confirmed_audio' | 'provider_audio' | 'silent_fallback';
  assetId?: string;
  generatedAt: string;
};

export type VideoGenerationTask = {
  id: string;
  userId: string;
  sourceUrl: string;
  prompt: string;
  title: string;
  status: VideoTaskStatus;
  rawParseResult: VideoParseResult;
  editableParseResult: VideoParseResult;
  selectedSkillIds: string[];
  expertContext: Record<string, unknown>;
  selectedDigitalHumanId?: string | null;
  selectedVoiceId?: string | null;
  selectedSceneId?: string | null;
  generatedVideoUrl?: string | null;
  generatedCoverUrl?: string | null;
  aspectRatio: string;
  creditCost?: number | null;
  failureReason?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateAssetGroupPayload = {
  id?: string;
  userId: string;
  resourceType: ContentResourceType;
  name: string;
  description?: string;
  metadata?: Record<string, unknown>;
};

export type UpdateAssetGroupPayload = {
  resourceType?: ContentResourceType;
  name?: string;
  description?: string;
  metadata?: Record<string, unknown>;
};

export type CreateAssetPayload = {
  userId: string;
  groupId?: string;
  resourceType: ContentResourceType;
  name: string;
  description?: string;
  originalFileName: string;
  storedFileName: string;
  mimeType: string;
  fileSize: number;
  filePath: string;
  fileUrl: string;
  assetKind?: string;
  lifecycleStatus?: ContentAssetLifecycleStatus;
  parentAssetId?: string | null;
  expiresAt?: string | null;
  retainedAt?: string | null;
  metadata?: Record<string, unknown>;
};

export type UpdateAssetPayload = {
  groupId?: string;
  resourceType?: ContentResourceType;
  name?: string;
  description?: string;
  fileUrl?: string;
  url?: string;
  metadata?: Record<string, unknown>;
};

export type CreateRealPersonValidationSessionPayload = {
  userId: string;
  name?: string;
  description?: string;
  metadata?: Record<string, unknown>;
};

export type GetRealPersonValidationResultPayload = {
  userId: string;
  groupId: string;
  bytedToken?: string;
};

export type CreateRealPersonAssetPayload = {
  userId: string;
  name?: string;
  description?: string;
  url?: string;
  metadata?: Record<string, unknown>;
};

export type SyncRealPersonAssetPayload = {
  userId: string;
};

export type CreateVideoTaskFromPromptPayload = {
  userId: string;
  prompt: string;
  selectedSkillIds?: string[];
};

export type CreateVideoProductionPayload = {
  userId: string;
  taskMode?: 'video_create' | 'talking_video' | 'dance_remake' | 'subject_replace';
  precreatedTaskId?: string;
  retryTaskId?: string;
  prompt?: string;
  quality?: string;
  ratio?: string;
  duration?: string;
  videoModelProviderId?: string;
  videoModelConfigId?: string;
  videoModelId?: string;
  referenceImageGroupId?: string;
  referenceVideoGroupId?: string;
  referenceAudioGroupId?: string;
  referenceImageIds?: string[];
  referenceVideoIds?: string[];
  referenceAudioIds?: string[];
  characterReferenceImageIds?: string[];
  subjectReplaceType?: string;
  subjectReplaceRemoteVideo?: {
    input: string;
    trimEnd?: number;
    trimStart?: number;
  };
  generateAudio?: boolean;
  skipVideoBilling?: boolean;
  videoBillingReservationId?: string;
  billingSourceType?: string;
  billingSourceId?: string;
};

export type CreateVideoEnhancementPayload = {
  userId: string;
  sourceAssetId: string;
  resolution?: '1080p' | '2k' | '4k';
};

export type SubtitleRemovalMode = 'auto' | 'auto_region' | 'manual';

export type SubtitleRemovalLocation = {
  topLeftX: number;
  topLeftY: number;
  bottomRightX: number;
  bottomRightY: number;
};

export type CreateSubtitleRemovalPayload = {
  userId: string;
  sourceAssetId: string;
  mode: SubtitleRemovalMode;
  contentType: 'subtitle' | 'text';
  locations?: SubtitleRemovalLocation[];
  clipFilter?: {
    mode: 'all' | 'selected' | 'skip';
    clips?: Array<{
      start: number;
      end: number;
    }>;
    start?: number;
    end?: number;
  };
};

export type VideoTranslationType = 'subtitle' | 'voice' | 'face';

export type CreateVideoTranslationPayload = {
  userId: string;
  sourceAssetId: string;
  sourceLanguage: string;
  targetLanguage: string;
  translationTypes: VideoTranslationType[];
  subtitleSource: 'ocr' | 'asr';
  subtitleConfig: {
    isHardSubtitle: boolean;
    isEraseSource: boolean;
    fontSize?: number;
    marginL?: number;
    marginR?: number;
    marginV?: number;
    showLines?: number;
  };
};

export type GenerateDigitalHumanThreeViewPayload = {
  userId: string;
};

export type UpdateVideoParsePayload = {
  userId?: string;
  editableParseResult: VideoParseResult;
  selectedDigitalHumanId?: string | null;
  selectedVoiceId?: string | null;
  selectedSceneId?: string | null;
};

export type UpdateVideoTaskContextPayload = {
  userId?: string;
  expertContext?: Record<string, unknown>;
  context?: Record<string, unknown>;
  editableParseResult?: VideoParseResult;
  selectedSkillIds?: string[];
};

export type GenerateVideoPayload = {
  userId?: string;
  replicationPlan?: ViralReplicationPlan;
  confirmedVoice?: Record<string, unknown> | null;
  confirmedScene?: Record<string, unknown> | null;
  confirmedDigitalHuman?: Record<string, unknown> | null;
};
