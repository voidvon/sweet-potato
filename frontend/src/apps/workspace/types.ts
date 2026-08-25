import type { ComponentType } from 'react';
import type { LucideProps } from 'lucide-react';

export * from '@shared/types';

export type VideoReferenceType = 'image' | 'video' | 'audio';

export type VideoModelReferencePolicy = {
  imageMode: 'none' | 'first_frame_required' | 'first_last_optional' | 'reference_images';
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

export type ChatAttachment = {
  id: string;
  assetId?: string;
  name: string;
  type: string;
  size: number;
  kind: 'image' | 'file';
  url: string;
  width?: number;
  height?: number;
  imageGenerationSlotIndex?: number;
  clientGroupKey?: string;
  previewUrl?: string;
  uploadStatus?: 'uploading';
};

export type ChatImageGenerationFailure = {
  slotIndex: number;
  message: string;
};

export type ChatMessageAction = {
  id: string;
  label: string;
  kind?: 'primary' | 'default';
  submitContent: string;
};

export type AiAgent = {
  id: string;
  name: string;
  description: string;
  icon: 'chat' | 'cube' | 'chart' | 'custom';
  builtIn: boolean;
  capabilities: Array<'chat' | 'reasoning' | 'analysis' | 'imageUpload' | 'fileUpload' | 'mention'>;
  runMode: 'quick' | 'reasoning';
  modelConfigId?: string | null;
  systemPrompt: string;
  tools: string[];
  skills: string[];
  retrievalStrategy: 'semantic' | 'hybrid' | 'keyword';
  webSearchEnabled: boolean;
  multimodal: {
    imageUpload: boolean;
    fileUpload: boolean;
  };
  createdAt?: string;
};

export type ChatMessage = {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  capability?: 'image_generation';
  capabilityContext?: SendChatPayload['capabilityContext'];
  imageModelConfigId?: string | null;
  generationJobId?: string | null;
  imageGenerationExpectedCount?: number;
  imageGenerationFailures?: ChatImageGenerationFailure[];
  reasoningContent?: string | null;
  actions?: ChatMessageAction[];
  agentId: string;
  modelConfigId?: string | null;
  attachments?: ChatAttachment[];
  creditCost?: number | null;
  createdAt: string;
  isCompleted?: boolean;
};

export type ChatConversation = {
  id: string;
  userId: string;
  title: string;
  agentId: string;
  modelConfigId?: string | null;
  metadata?: {
    previewText?: string;
    contextUsage?: ChatContextUsage;
  };
  createdAt: string;
  updatedAt: string;
};

export type ChatContextUsage = {
  modelConfigId: string;
  model: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  usedTokens: number;
  estimated: boolean;
  contextWindow?: number;
  maxContextWindow?: number;
  effectiveContextWindowPercent?: number;
  contextWindowSource?: 'config' | 'catalog';
  usedPercent?: number;
  remainingPercent?: number;
  updatedAt: string;
};

export type ChatConversationDetail = {
  conversation: ChatConversation;
  messages: ChatMessage[];
};

export type SendChatPayload = {
  userId: string;
  conversationId?: string;
  editMessageId?: string;
  agentId: string;
  modelConfigId?: string | null;
  imageModelConfigId?: string | null;
  attachments?: ChatAttachment[];
  content: string;
  capabilityContext?: {
    imageGeneration?: {
      modeKey?: string;
      modeTitle?: string;
      promptText?: string;
      promptHint?: string;
      regenerationCount?: number;
      accumulatedCreditCost?: number;
      outputSize?: string;
      outputCount?: number;
      outputBackground?: 'transparent' | 'opaque' | 'auto';
      aspectRatio?: string;
      resolution?: string;
      inputPrompt?: string;
      resolvedPrompt?: string;
      referenceAttachments?: ChatAttachment[];
      referenceAssetIds?: string[];
      referenceCount?: number;
      requestMode?: 'edit' | 'generation';
      referenceGroups?: Array<{
        key: string;
        label: string;
        attachmentIds: string[];
        required?: boolean;
        maxCount?: number;
      }>;
    };
  };
  autoImageGeneration?: boolean;
  requestedCapabilities?: Array<'image_generation'>;
};

export type ChatStreamEvent =
  | { type: 'conversation'; conversation: ChatConversation }
  | { type: 'user_message'; message: ChatMessage }
  | { type: 'assistant_message'; message: ChatMessage }
  | { type: 'reasoning_delta'; delta: string }
  | { type: 'answer_delta'; delta: string }
  | { type: 'done'; conversation: ChatConversation; messages: ChatMessage[] }
  | { type: 'error'; message: string };

export type ModuleItem = {
  id: string;
  title: string;
  subtitle: string;
  priority: 'P0' | 'P1';
  icon: ComponentType<LucideProps>;
  stats: string[];
  description: string;
};

export type CreativeModuleCode =
  | 'digital_human'
  | 'virtual_portrait_assets'
  | 'real_person_assets'
  | 'ai_voice'
  | 'scene_library'
  | 'product_assets'
  | 'finished_assets'
  | 'create_video';

export type RealPersonResourceType = 'real_person';

export type ContentResourceType = 'digital_human' | 'virtual_portrait' | 'voice' | 'scene' | 'product' | 'finished_video' | 'other';

export type ContentAssetResourceType = ContentResourceType | RealPersonResourceType;

export type ContentAssetGroup = {
  id: string;
  userId: string;
  username?: string;
  resourceType: ContentAssetResourceType;
  name: string;
  description: string;
  metadata: Record<string, unknown>;
  assetCount?: number;
  coverAssets?: ContentAsset[];
  createdAt: string;
  updatedAt: string;
};

export type PaginatedResult<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
};

export type ContentAsset = {
  id: string;
  userId: string;
  groupId: string;
  resourceType: ContentAssetResourceType;
  name: string;
  description: string;
  originalFileName: string;
  storedFileName: string;
  mimeType: string;
  fileSize: number;
  filePath: string;
  fileUrl: string;
  assetKind: string;
  lifecycleStatus: 'temporary' | 'retained' | 'permanent';
  parentAssetId: string | null;
  expiresAt: string | null;
  retainedAt: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
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
  renderMode?: 'local_preview' | 'provider_generation';
  renderStatus?: 'queued' | 'rendering' | 'rendered' | 'failed';
  audioSource?: 'confirmed_audio' | 'provider_audio' | 'silent_fallback';
  assetId?: string;
  generatedAt: string;
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
  analysisProcess?: Array<{
    key: string;
    label: string;
    items: Array<{ label: string; value: string }>;
    conclusion: string;
  }>;
  videoGenerationResult?: VideoGenerationResult;
};

export type VideoGenerationTask = {
  id: string;
  userId: string;
  sourceUrl: string;
  prompt?: string;
  title: string;
  status: 'pending' | 'parsing' | 'waiting_edit' | 'generating' | 'success' | 'failed';
  rawParseResult: VideoParseResult;
  editableParseResult: VideoParseResult;
  referenceSkillIds?: string[];
  selectedSkillIds?: string[];
  expertContext?: Record<string, unknown>;
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
