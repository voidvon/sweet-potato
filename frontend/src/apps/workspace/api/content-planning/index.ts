import { request } from '../request';

export type PlanningUiStep = 'step1' | 'step2' | 'step3' | 'step4';
export type PlanningStatus =
  | 'draft'
  | 'analyzing'
  | 'confirming'
  | 'configuring'
  | 'generating'
  | 'ready_to_apply'
  | 'applied'
  | 'failed';
export type PlanningJobStage =
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

export type PlanningAssetRef = {
  assetId: string;
  kind: 'image' | 'video' | 'audio';
  name: string;
  fileUrl: string;
  mimeType: string;
  originalFileName?: string;
  storedFileName?: string;
  durationSeconds?: number;
};

export type PlanningMaterialCaption = {
  id: string;
  assetId: string;
  label: string;
  previewUrl: string;
  description: string;
};

export type PlanningProductInsights = {
  productName: string;
  productCategory: string;
  productFeatures: string[];
  coreSellingPoints: string[];
  targetAudience: string[];
  useScenarios: string[];
};

export type PlanningReferenceBreakdown = {
  tags: string[];
  structureFramework: string;
  emotionCurve: string;
  summary: string;
  segments: Array<{ timeRange: string; title: string; summary: string }>;
  replaceableElements: string[];
  keepElements: string[];
  applicableCategories: string[];
  note?: string;
  failed?: boolean;
};

export type PlanningAnalysis = {
  referenceBreakdown?: PlanningReferenceBreakdown | null;
  materialCaptions: PlanningMaterialCaption[];
  productInsights: PlanningProductInsights;
  confirmed: boolean;
  notes: string[];
};

export type PlanningSettings = {
  businessScene: 'ecommerce' | 'local_service' | 'door_to_door' | 'education' | 'unrestricted';
  contentType: string;
  shootingMethod: string;
  spokenLanguage: 'zh' | 'en' | 'ja' | 'de' | 'fr';
  displayOnly: boolean;
  extraInstruction: string;
  durationSeconds: 5 | 10 | 15;
  styleKeywords: string[];
  deepThink: boolean;
  webSearch: boolean;
  candidateCount: number;
  referencePolicy: {
    useBreakdown: boolean;
    lockedContentPreset?: { contentType: string; shootingMethod: string } | null;
  };
};

export type PlanningReasoningLog = {
  id: string;
  stage: PlanningJobStage;
  role: string;
  content: string;
  createdAt: string;
};

export type PlanningReasoningStream = {
  stage: PlanningJobStage;
  role: string;
  content: string;
  updatedAt: string;
};

export type PlanningStoryboardSegment = {
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

export type PlanningCandidate = {
  id: string;
  title: string;
  summary: string;
  hook: string;
  audienceAngle: string;
  tags: string[];
  fullScript: string;
  prompt: string;
  storyboard: PlanningStoryboardSegment[];
  score: number;
  issues: string[];
  repairAdvice: string;
  sourceStrategyId: string;
  script?: {
    id: string;
    title: string;
    summary: string;
    fullScript: string;
    prompt: string;
    durationSeconds: 5 | 10 | 15;
    storyboard: PlanningStoryboardSegment[];
  };
};

export type PlanningGeneration = {
  reasoningLogs: PlanningReasoningLog[];
  reasoningStream?: PlanningReasoningStream | null;
  stages: Array<{
    id: string;
    role: string;
    status: 'pending' | 'running' | 'completed' | 'failed';
    inputSummary: string;
    outputSummary: string;
    errorMessage?: string;
  }>;
  candidates: PlanningCandidate[];
  selectedCandidateId: string;
  validatorSummary: string;
  stageOutputs?: Record<string, unknown>;
};

export type PlanningSessionUpdates = {
  sessionId: string;
  status: PlanningStatus;
  jobStage: PlanningJobStage;
  updatedAt: string;
  reasoningLogs: PlanningReasoningLog[];
  reasoningStream: PlanningReasoningStream | null;
  stages: PlanningGeneration['stages'];
  candidates: PlanningCandidate[];
  selectedCandidateId: string;
};

export type PlanningRealtimeEvent = {
  type: 'reasoning_stream' | 'stage_completed' | 'generation_failed';
  sessionId: string;
  reasoningStream: PlanningReasoningStream | null;
  reasoningLog?: PlanningReasoningLog;
};

export type PlanningSession = {
  id: string;
  userId: string;
  sourceSurface: 'create_video';
  status: PlanningStatus;
  uiStep: PlanningUiStep;
  jobStage: PlanningJobStage;
  materialBundle: {
    prompt: string;
    productName: string;
    imageMaterials: PlanningAssetRef[];
    referenceVideo?: PlanningAssetRef | null;
    referenceAudio?: PlanningAssetRef | null;
  };
  analysis: PlanningAnalysis;
  settings: PlanningSettings;
  generation: PlanningGeneration;
  applySnapshot?: {
    prompt: string;
    duration: `${5 | 10 | 15}s`;
    imageMaterials: PlanningAssetRef[];
    referenceVideo?: PlanningAssetRef;
    referenceAudio?: PlanningAssetRef;
    appliedAt: string;
  } | null;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
};

export type PlanningApplyPayload = {
  allowlist: {
    prompt: string;
    duration: `${5 | 10 | 15}s`;
    imageMaterials: PlanningAssetRef[];
    referenceVideo?: PlanningAssetRef;
    referenceAudio?: PlanningAssetRef;
  };
  session?: PlanningSession;
};

export type ContentPlanningClientConfig = {
  analysisCredits: number;
  generationCredits: number;
};

type MediaInput = { assetId: string; kind: PlanningAssetRef['kind'] };

const basePath = '/api/content-planning/sessions';

export function getContentPlanningConfig() {
  return request<ContentPlanningClientConfig>('/api/content-planning/config');
}

export function createPlanningSession(payload: {
  userId: string;
  sessionId?: string;
  restoreLatest?: boolean;
  prompt?: string;
  productName?: string;
  media?: MediaInput[];
}) {
  return request<PlanningSession | { session: PlanningSession }>(basePath, {
    method: 'POST',
    body: JSON.stringify({ sourceSurface: 'create_video', ...payload }),
  }).then(extractPlanningSession);
}

export function getPlanningSession(sessionId: string, userId: string) {
  return request<PlanningSession | { session: PlanningSession }>(`${basePath}/${sessionId}?userId=${encodeURIComponent(userId)}`)
    .then(extractPlanningSession);
}

export function getPlanningSessionUpdates(payload: { sessionId: string; userId: string; since?: string }) {
  const params = new URLSearchParams();
  params.set('userId', payload.userId);
  if (payload.since) {
    params.set('since', payload.since);
  }
  return request<PlanningSessionUpdates>(`${basePath}/${payload.sessionId}/updates?${params.toString()}`);
}

export function analyzePlanningSession(payload: {
  userId: string;
  sessionId: string;
  productName: string;
  prompt?: string;
  imageAssetIds: string[];
  referenceVideoAssetId?: string;
  referenceAudioAssetId?: string;
  media?: MediaInput[];
}) {
  return request<PlanningSession | { session: PlanningSession }>(`${basePath}/${payload.sessionId}/analyze`, {
    method: 'POST',
    body: JSON.stringify(payload),
  }).then(extractPlanningSession);
}

export function updatePlanningConfirmation(payload: {
  userId: string;
  sessionId: string;
  referenceBreakdown?: PlanningReferenceBreakdown | null;
  materialCaptions: PlanningMaterialCaption[];
  productInsights: PlanningProductInsights;
  referencePolicy: PlanningSettings['referencePolicy'];
}) {
  return request<PlanningSession | { session: PlanningSession }>(`${basePath}/${payload.sessionId}/confirmation`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  }).then(extractPlanningSession);
}

export function updatePlanningSettings(payload: { userId: string; sessionId: string; settings: PlanningSettings }) {
  return request<PlanningSession | { session: PlanningSession }>(`${basePath}/${payload.sessionId}/settings`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  }).then(extractPlanningSession);
}

export function generatePlanningCandidates(payload: { userId: string; sessionId: string; regenerate?: boolean }) {
  return request<PlanningSession | { session: PlanningSession }>(`${basePath}/${payload.sessionId}/generate`, {
    method: 'POST',
    body: JSON.stringify(payload),
  }).then(extractPlanningSession);
}

export async function selectPlanningCandidate(payload: { userId: string; sessionId: string; candidateId: string }) {
  try {
    return await request<PlanningSession | { session: PlanningSession }>(
      `${basePath}/${payload.sessionId}/candidates/${payload.candidateId}/select`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
    ).then(extractPlanningSession);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (!message.toLowerCase().includes('not found')) {
      throw error;
    }
    return request<PlanningSession | { session: PlanningSession }>(`${basePath}/${payload.sessionId}/candidate`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }).then(extractPlanningSession);
  }
}

export function applyPlanningSession(payload: { userId: string; sessionId: string; candidateId?: string }) {
  return request<PlanningApplyPayload | { apply: PlanningApplyPayload }>(`${basePath}/${payload.sessionId}/apply`, {
    method: 'POST',
    body: JSON.stringify(payload),
  }).then(extractPlanningApplyPayload);
}

export function extractPlanningSession(value: PlanningSession | { session: PlanningSession }): PlanningSession {
  return 'session' in value ? value.session : value;
}

export function extractPlanningApplyPayload(value: PlanningApplyPayload | { apply: PlanningApplyPayload }): PlanningApplyPayload {
  return 'apply' in value ? value.apply : value;
}
