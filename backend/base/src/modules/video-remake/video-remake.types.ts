export type VideoRemakeCardType =
  | 'uploading'
  | 'video_basic_info'
  | 'basic_info'
  | 'expert_analysis'
  | 'character_setting'
  | 'scene_setting'
  | 'product_setting'
  | 'pip_setting'
  | 'voice_audio_setting'
  | 'script_content'
  | 'storyboard_script'
  | 'seedance_prompt'
  | 'generation_progress'
  | 'director_normalize'
  | 'llm_thinking'
  | 'final_video';

export type VideoRemakeCardStatus = 'pending' | 'editing' | 'confirmed' | 'expired' | 'failed';

export type VideoRemakeWorkflowNode =
  | 'upload_to_vod'
  | 'analyze_audio'
  | 'analyze_visual'
  | 'analyze_pip'
  | 'director_normalize'
  | 'confirm_basic_info'
  | 'confirm_character'
  | 'confirm_scene'
  | 'confirm_product'
  | 'confirm_pip'
  | 'confirm_voice_audio'
  | 'confirm_script_content'
  | 'generate_storyboard'
  | 'confirm_storyboard'
  | 'generate_seedance_prompts'
  | 'confirm_seedance_prompts'
  | 'generate_video_segments'
  | 'merge_video'
  | 'completed'
  | 'cancelled'
  | 'failed';

export type VideoRemakeTextMessage = {
  id: string;
  type: 'text';
  role: 'user' | 'assistant' | 'system';
  content: string;
  attachment?: {
    type: 'video';
    url: string;
    title?: string;
    mimeType?: string;
    fileSize?: number;
  };
  createdAt: string;
};

export type VideoRemakeCardMessage<T = unknown> = {
  id: string;
  type: 'card';
  role: 'assistant';
  cardId: string;
  cardType: VideoRemakeCardType;
  title: string;
  status: VideoRemakeCardStatus;
  data: T;
  createdAt: string;
};

export type VideoRemakeChatMessage = VideoRemakeTextMessage | VideoRemakeCardMessage;

export type VideoRemakeWorkflowEvent =
  | { type: 'message'; message: VideoRemakeTextMessage }
  | { type: 'card.create'; card: VideoRemakeCardMessage }
  | { type: 'card.update'; cardId: string; status?: VideoRemakeCardStatus; data?: unknown }
  | { type: 'workflow.progress'; step: string; label: string; percent?: number }
  | { type: 'workflow.interrupt'; interruptType: string; cardId: string; cardType: VideoRemakeCardType; data: unknown }
  | { type: 'workflow.done'; finalVideoUrl: string }
  | { type: 'session.status'; status: VideoRemakeSessionStatus; currentStep: VideoRemakeWorkflowNode; invalidArtifacts: VideoRemakeCardType[] }
  | { type: 'error'; step?: string; message: string; retryable: boolean };

export type VideoRemakeChatIntent =
  | { intent: 'open_edit_card'; target: VideoRemakeCardType; instruction: string }
  | { intent: 'add_artifact_item'; target: VideoRemakeCardType; instruction: string }
  | { intent: 'modify_artifact_with_llm'; target: VideoRemakeCardType; instruction: string }
  | { intent: 'continue_workflow'; instruction: string }
  | { intent: 'regenerate_artifact'; target: VideoRemakeCardType; instruction: string }
  | { intent: 'unknown'; instruction: string };

export type VideoRemakeSessionStatus =
  | 'created'
  | 'running'
  | 'waiting_credit'
  | 'waiting_edit'
  | 'generating'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type VideoRemakePendingInterrupt = {
  type: 'confirm_card';
  cardId: string;
  cardType: VideoRemakeCardType;
  reason: 'initial_review' | 'manual_edit' | 'regenerate';
};

export type VideoRemakeWorkflowState = {
  mode: string;
  currentNode: VideoRemakeWorkflowNode;
  artifacts: Partial<Record<string, unknown>>;
  invalidArtifacts: VideoRemakeCardType[];
  pendingInterrupt?: VideoRemakePendingInterrupt;
  source: {
    kind: 'upload' | 'url';
    title: string;
    sourceUrl: string;
    file?: {
      originalFileName: string;
      storedFileName: string;
      mimeType: string;
      fileSize: number;
      filePath: string;
      fileUrl: string;
    };
  };
  runtime: {
    vod?: Record<string, unknown>;
    analyses?: {
      audio?: Record<string, unknown>;
      visual?: Record<string, unknown>;
      pip?: Record<string, unknown>;
    };
    viralUnderstanding?: {
      vid?: string;
      spaceName?: string;
      executions?: Array<Record<string, unknown>>;
      outputs?: Record<string, unknown>;
      estimatedAnalysisTime?: string;
      billedRunIds?: string[];
    };
    creditBlock?: {
      step: string;
      stepLabel: string;
      message: string;
      currentCredits: number;
      requiredCredits: number;
      shortfallCredits: number;
      createdAt: string;
    };
    videoSegments?: Array<Record<string, unknown>>;
    mergedVideo?: Record<string, unknown>;
    referencePrimer?: Record<string, unknown>;
    langGraph?: Record<string, unknown>;
    deferredInvalidationCardTypes?: VideoRemakeCardType[];
  };
  updatedAt: string;
};

export type VideoRemakeSession = {
  id: string;
  userId: string;
  status: VideoRemakeSessionStatus;
  filename?: string;
  taskId?: string;
  currentStep: VideoRemakeWorkflowNode;
  invalidArtifacts: VideoRemakeCardType[];
  artifacts: Partial<Record<VideoRemakeCardType, unknown>>;
  messages: VideoRemakeChatMessage[];
  events: VideoRemakeWorkflowEvent[];
  workflow: VideoRemakeWorkflowState;
  createdAt: string;
  updatedAt: string;
  cancelledAt?: string;
};

export type VideoRemakeSessionSummary = Pick<
  VideoRemakeSession,
  'id' | 'userId' | 'status' | 'filename' | 'taskId' | 'currentStep' | 'createdAt' | 'updatedAt' | 'cancelledAt'
>;

export type VideoRemakeSessionSnapshot = VideoRemakeSession & {
  task?: VideoRemakeTask;
};

export type UploadVideoRemakePayload = {
  userId: string;
  originalFileName: string;
  storedFileName: string;
  mimeType: string;
  fileSize: number;
  filePath: string;
  fileUrl: string;
};

export type UploadVideoRemakePipAssetPayload = UploadVideoRemakePayload;

export type VideoRemakeTaskStatus =
  | 'pending'
  | 'parsing'
  | 'waiting_credit'
  | 'waiting_edit'
  | 'generating'
  | 'success'
  | 'failed'
  | 'cancelled';

export type VideoRemakeTask = {
  id: string;
  userId: string;
  sourceUrl: string;
  prompt: string;
  title: string;
  status: VideoRemakeTaskStatus;
  rawParseResult: Record<string, unknown>;
  editableParseResult: Record<string, unknown>;
  selectedSkillIds: string[];
  expertContext: Record<string, unknown>;
  generatedVideoUrl?: string | null;
  failureReason?: string | null;
  createdAt: string;
  updatedAt: string;
};
