export type ContentPlanningSourceSurface = 'create_video';

export type ContentPlanningStatus =
  | 'draft'
  | 'analyzing'
  | 'confirming'
  | 'configuring'
  | 'generating'
  | 'ready_to_apply'
  | 'applied'
  | 'failed';

export type ContentPlanningUiStep = 'step1' | 'step2' | 'step3' | 'step4';

export type ContentPlanningJobStage =
  | 'idle'
  | 'uploading_assets'
  | 'analyzing_materials'
  | 'analyzing_reference_video'
  | 'planner_running'
  | 'strategy_running'
  | 'timeline_running'
  | 'copywriter_running'
  | 'visual_director_running'
  | 'validator_running'
  | 'completed'
  | 'failed';

export type ContentPlanningAgentRole =
  | 'Planner'
  | 'Strategy'
  | 'Timeline'
  | 'Copywriter'
  | 'Visual Director'
  | 'Validator'
  | 'System';

export type ContentPlanningAssetRef = {
  assetId: string;
  kind: 'image' | 'video' | 'audio';
  name: string;
  fileUrl: string;
  mimeType: string;
  originalFileName?: string;
  storedFileName?: string;
  durationSeconds?: number;
};

export type ContentPlanningMaterialBundle = {
  prompt: string;
  productName: string;
  imageMaterials: ContentPlanningAssetRef[];
  referenceVideo?: ContentPlanningAssetRef | null;
  referenceAudio?: ContentPlanningAssetRef | null;
};

export type ContentPlanningViralBreakdownSegment = {
  timeRange: string;
  title: string;
  summary: string;
};

export type ContentPlanningViralBreakdown = {
  tags: string[];
  structureFramework: string;
  emotionCurve: string;
  summary: string;
  segments: ContentPlanningViralBreakdownSegment[];
  replaceableElements: string[];
  keepElements: string[];
  applicableCategories: string[];
  note?: string;
  failed?: boolean;
};

export type ContentPlanningMaterialCaption = {
  id: string;
  assetId: string;
  label: string;
  previewUrl: string;
  description: string;
};

export type ContentPlanningProductInsights = {
  productName: string;
  productCategory: string;
  productFeatures: string[];
  coreSellingPoints: string[];
  targetAudience: string[];
  useScenarios: string[];
};

export type ContentPlanningAnalysis = {
  viralBreakdown?: ContentPlanningViralBreakdown | null;
  materialCaptions: ContentPlanningMaterialCaption[];
  productInsights: ContentPlanningProductInsights;
  confirmed: boolean;
  notes: string[];
};

export type ContentPlanningBusinessScene =
  | 'ecommerce'
  | 'local_service'
  | 'door_to_door'
  | 'education'
  | 'unrestricted';

export type ContentPlanningSpokenLanguage = 'zh' | 'en' | 'ja' | 'de' | 'fr';

export type ContentPlanningDurationSeconds = 5 | 10 | 15;

export type ContentPlanningSettings = {
  businessScene: ContentPlanningBusinessScene;
  contentType: string;
  shootingMethod: string;
  spokenLanguage: ContentPlanningSpokenLanguage;
  displayOnly: boolean;
  extraInstruction: string;
  durationSeconds: ContentPlanningDurationSeconds;
  styleKeywords: string[];
  deepThink: boolean;
  webSearch: boolean;
  candidateCount: number;
  referencePolicy: {
    useBreakdown: boolean;
    lockedContentPreset?: {
      contentType: string;
      shootingMethod: string;
    } | null;
  };
};

export type ContentPlanningReasoningLog = {
  id: string;
  stage: ContentPlanningJobStage;
  role: ContentPlanningAgentRole;
  content: string;
  createdAt: string;
};

export type ContentPlanningReasoningStream = {
  stage: ContentPlanningJobStage;
  role: Exclude<ContentPlanningAgentRole, 'System'>;
  content: string;
  updatedAt: string;
};

export type ContentPlanningAgentStageStatus = 'pending' | 'running' | 'completed' | 'failed';

export type ContentPlanningAgentStage = {
  id: string;
  role: Exclude<ContentPlanningAgentRole, 'System'>;
  status: ContentPlanningAgentStageStatus;
  inputSummary: string;
  outputSummary: string;
  startedAt?: string;
  completedAt?: string;
  errorMessage?: string;
};

export type ContentPlanningStrategyDirection = {
  id: string;
  title: string;
  hook: string;
  audienceAngle: string;
  emotionalArc: string;
  summary: string;
  followReferenceStructure: boolean;
  tags: string[];
};

export type ContentPlanningTimelineSegment = {
  id: string;
  startSecond: number;
  endSecond: number;
  beat: string;
  goal: string;
};

export type ContentPlanningStoryboardSegment = {
  id: string;
  startSecond: number;
  endSecond: number;
  title: string;
  visual: string;
  action: string;
  dialogue: string;
  soundEffect: string;
  camera: string;
  lighting: string;
  spaceRelation: string;
  materialRefs: string[];
};

export type ContentPlanningScript = {
  id: string;
  title: string;
  summary: string;
  fullScript: string;
  prompt: string;
  durationSeconds: ContentPlanningDurationSeconds;
  storyboard: ContentPlanningStoryboardSegment[];
};

export type ContentPlanningCandidate = {
  id: string;
  title: string;
  summary: string;
  hook: string;
  audienceAngle: string;
  tags: string[];
  fullScript: string;
  prompt: string;
  storyboard: ContentPlanningStoryboardSegment[];
  score: number;
  issues: string[];
  repairAdvice: string;
  sourceStrategyId: string;
  script: ContentPlanningScript;
};

export type ContentPlanningAgentStageOutputs = Partial<{
  planner: {
    brief: string;
    hardConstraints: string[];
    candidateDirections: string[];
  };
  strategy: {
    strategies: ContentPlanningStrategyDirection[];
  };
  timeline: {
    timelines: Array<{ strategyId: string; segments: ContentPlanningTimelineSegment[] }>;
  };
  copywriter: {
    scripts: Array<{ strategyId: string; lines: Array<{ segmentId: string; text: string }> }>;
  };
  visualDirector: {
    storyboardCandidates: ContentPlanningCandidate[];
  };
  validator: {
    selectedCandidateId: string;
    summary: string;
  };
}>;

export type ContentPlanningGeneration = {
  reasoningLogs: ContentPlanningReasoningLog[];
  reasoningStream: ContentPlanningReasoningStream | null;
  stages: ContentPlanningAgentStage[];
  candidates: ContentPlanningCandidate[];
  selectedCandidateId: string;
  validatorSummary: string;
  stageOutputs: ContentPlanningAgentStageOutputs;
};

export type ContentPlanningApplySnapshot = {
  prompt: string;
  duration: `${ContentPlanningDurationSeconds}s`;
  imageMaterials: ContentPlanningAssetRef[];
  referenceAudio?: ContentPlanningAssetRef;
  appliedAt: string;
};

export type ContentPlanningSession = {
  id: string;
  userId: string;
  sourceSurface: ContentPlanningSourceSurface;
  status: ContentPlanningStatus;
  uiStep: ContentPlanningUiStep;
  jobStage: ContentPlanningJobStage;
  materialBundle: ContentPlanningMaterialBundle;
  analysis: ContentPlanningAnalysis;
  settings: ContentPlanningSettings;
  generation: ContentPlanningGeneration;
  applySnapshot?: ContentPlanningApplySnapshot | null;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
};

// Stable public protocol names for consumers that do not need the module prefix.
export type PlanningSession = ContentPlanningSession;
export type PlanningCandidate = ContentPlanningCandidate;
export type PlanningScript = ContentPlanningScript;
export type AgentStage = ContentPlanningAgentStage;

export type ContentPlanningApplyPayload = {
  allowlist: {
    prompt: string;
    duration: `${ContentPlanningDurationSeconds}s`;
    imageMaterials: ContentPlanningAssetRef[];
    referenceAudio?: ContentPlanningAssetRef;
  };
  session: ContentPlanningSession;
};

export type CreateContentPlanningSessionPayload = {
  userId: string;
  sessionId?: string;
  restoreLatest?: boolean;
  sourceSurface?: ContentPlanningSourceSurface;
  prompt?: string;
  productName?: string;
  media?: ContentPlanningMediaInput[];
};

export type ContentPlanningMediaInput = {
  assetId: string;
  kind: 'image' | 'video' | 'audio';
};

export type AnalyzeContentPlanningSessionPayload = {
  userId: string;
  sessionId: string;
  productName: string;
  prompt?: string;
  imageAssetIds: string[];
  referenceVideoAssetId?: string;
  referenceAudioAssetId?: string;
  media?: ContentPlanningMediaInput[];
};

export type UpdateContentPlanningConfirmationPayload = {
  userId: string;
  sessionId: string;
  viralBreakdown?: ContentPlanningViralBreakdown | null;
  materialCaptions: ContentPlanningMaterialCaption[];
  productInsights: ContentPlanningProductInsights;
  referencePolicy: ContentPlanningSettings['referencePolicy'];
};

export type UpdateContentPlanningSettingsPayload = {
  userId: string;
  sessionId: string;
  settings: ContentPlanningSettings;
};

export type GenerateContentPlanningSessionPayload = {
  userId: string;
  sessionId: string;
  regenerate?: boolean;
};

export type SelectContentPlanningCandidatePayload = {
  userId: string;
  sessionId: string;
  candidateId: string;
};

export type ApplyContentPlanningSessionPayload = {
  userId: string;
  sessionId: string;
  candidateId?: string;
};
