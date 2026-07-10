import type { ComponentType } from 'react';
import type { LucideProps } from 'lucide-react';

export type User = {
  id: string;
  username: string;
  displayName: string;
  avatarUrl?: string;
  role: 'admin' | 'user';
  roleIds?: string[];
  assignedRoles?: UserRoleSummary[];
  permissions?: string[];
  permissionCodes?: string[];
  resourceIds?: string[];
  resourceKeys?: string[];
  creditBalance?: number;
  createdAt: string;
  lastLoginAt?: string;
};

export type UserRoleSummary = {
  id: string;
  key: string;
  name: string;
  description?: string | null;
  isDefault?: boolean;
  isSystem?: boolean;
  permissions?: string[];
  permissionCodes?: string[];
  resourceIds?: string[];
  resourceKeys?: string[];
};

export type ManagedUser = {
  id: string;
  username: string;
  displayName: string;
  role: 'admin' | 'user';
  roleIds?: string[];
  assignedRoles?: UserRoleSummary[];
  permissions?: string[];
  permissionCodes?: string[];
  resourceIds?: string[];
  resourceKeys?: string[];
  isBlacklisted: boolean;
  creditBalance: number;
  createdAt: string;
  lastLoginAt?: string;
};

export type ManagedRole = {
  id: string;
  key: string;
  name: string;
  description?: string | null;
  isSystem?: boolean;
  isDefault?: boolean;
  assignedUserCount?: number;
  grantedResourceIds?: string[];
  grantedResources?: RouteResourceSummary[];
  createdAt?: string;
  updatedAt?: string;
};

export type RoleCreatePayload = {
  name: string;
  description?: string;
  resourceIds?: string[];
  isDefault?: boolean;
};

export type RoleUpdatePayload = {
  name: string;
  description?: string;
  resourceIds?: string[];
  isDefault?: boolean;
};

export type RouteResourceType = 'directory' | 'menu';

export type RouteResourcePlatform = 'web' | 'admin';

export type RouteResourceSummary = {
  id: string;
  parentId?: string | null;
  name: string;
  resourceKey: string;
  resourceType: RouteResourceType;
  platform: RouteResourcePlatform;
  permissionCode: string;
  path?: string;
  status?: boolean;
  isSystem?: boolean;
};

export type ManagedRouteResource = RouteResourceSummary & {
  sortOrder?: number;
  children?: ManagedRouteResource[];
  createdAt?: string;
  updatedAt?: string;
};

export type RouteResourceMutationPayload = {
  parentId?: string | null;
  name: string;
  resourceKey: string;
  resourceType: RouteResourceType;
  platform: RouteResourcePlatform;
  path?: string;
  permissionCode: string;
  status?: boolean;
  sortOrder?: number;
};

export type BillingSettings = {
  id: number;
  videoUploadCreditsPerMb: number;
  videoUnderstandingCreditsPer1MTokens: number;
  createdAt: string;
  updatedAt: string;
};

export type LlmBillingSettings = {
  multiplier: number;
  inputCreditsPer1M: number;
  outputCreditsPer1M: number;
  cachedInputCreditsPer1M: number;
  maxOutputCreditsForReserve: number;
  priceCurrency?: 'USD' | 'CNY';
  priceSource?: string;
  priceUpdatedAt?: string;
};

export type LlmModelPricing = {
  id: string;
  provider: string;
  providerName: string;
  model: string;
  displayName: string;
  defaultBaseUrl: string;
  currency: 'USD' | 'CNY';
  inputPricePer1M: number;
  outputPricePer1M: number;
  cachedInputPricePer1M: number;
  priceSource: string;
  priceUpdatedAt: string;
  createdAt?: string;
  updatedAt?: string;
};

export type ImageBillingSettings = {
  creditsPerRequest: number;
  priceSource?: string;
};

export type VideoBillingSettings = {
  multiplier: number;
  creditsPer1MTokens: number;
  priceSource?: string;
};

export type AudioBillingSettings = {
  multiplier: number;
  voiceCloneCredits: number;
  speechCreditsPer1kChars: number;
  priceSource?: string;
};

export type CreditLedgerEntry = {
  id: string;
  userId: string;
  type: 'reserve_debit' | 'reserve_refund' | 'llm_extra_debit' | 'admin_adjust' | 'usage_debit';
  creditDelta: number;
  creditBalanceAfter: number;
  creditBaseCost?: number | null;
  creditBilledCost?: number | null;
  sourceType?: string | null;
  sourceId?: string | null;
  snapshot: Record<string, unknown>;
  createdAt: string;
};

export type MyCreditLedgerEntry = Pick<
  CreditLedgerEntry,
  'id' | 'type' | 'creditDelta' | 'creditBalanceAfter' | 'sourceType' | 'createdAt'
> & {
  modelName?: string;
};

export type AdminCreditLedgerEntry = Pick<
  CreditLedgerEntry,
  'id' | 'userId' | 'type' | 'creditDelta' | 'creditBalanceAfter' | 'sourceType' | 'createdAt'
>;

export type LlmUsageRecord = {
  id: string;
  userId: string;
  modelConfigId: string;
  sourceType: string;
  sourceId: string;
  promptTokens: number;
  completionTokens: number;
  cachedPromptTokens: number;
  usageRaw: Record<string, unknown>;
  billingSnapshot: Record<string, unknown>;
  creditBaseCost: number;
  creditBilledCost: number;
  creditCost: number;
  status: 'completed' | 'failed';
  createdAt: string;
};

export type MyLlmUsageRecord = Pick<
  LlmUsageRecord,
  'id' | 'modelConfigId' | 'sourceType' | 'creditCost' | 'status' | 'createdAt'
> & {
  modelName: string;
};

export type AdminLlmUsageRecord = Pick<
  LlmUsageRecord,
  'id' | 'userId' | 'modelConfigId' | 'sourceType' | 'promptTokens' | 'completionTokens' | 'cachedPromptTokens' | 'creditCost' | 'status' | 'createdAt'
> & {
  modelName: string;
};

export type BillableUsageRecord = {
  id: string;
  userId: string;
  category:
    | 'image_generation'
    | 'video_generation'
    | 'voice_clone'
    | 'speech_synthesis'
    | 'vod_upload'
    | 'vod_understanding';
  modelConfigId?: string | null;
  provider?: string | null;
  model?: string | null;
  sourceType: string;
  sourceId: string;
  taskId?: string | null;
  sessionId?: string | null;
  groupId?: string | null;
  pricingMode: 'per_request' | 'per_second' | 'per_1k_chars' | 'per_minute' | 'per_mb' | 'per_1m_tokens';
  quantitySnapshot: Record<string, unknown>;
  usageRaw: Record<string, unknown>;
  requestSnapshot: Record<string, unknown>;
  responseSnapshot: Record<string, unknown>;
  creditBaseCost: number;
  creditBilledCost: number;
  creditCost: number;
  status: 'completed' | 'failed';
  createdAt: string;
};

export type MyBillableUsageRecord = Pick<
  BillableUsageRecord,
  'id' | 'category' | 'provider' | 'model' | 'sourceType' | 'pricingMode' | 'creditCost' | 'status' | 'createdAt'
>;

export type AdminBillableUsageRecord = Pick<
  BillableUsageRecord,
  'id' | 'userId' | 'category' | 'provider' | 'model' | 'sourceType' | 'pricingMode' | 'creditCost' | 'status' | 'createdAt'
>;

export type AuthSession = {
  user: User;
  token: string;
};

export type LoginPayload = {
  username: string;
  password: string;
};

export type RegisterPayload = LoginPayload & {
  displayName?: string;
};

export type UserProfilePayload = {
  displayName: string;
  avatarUrl?: string;
};

export type PasswordPayload = {
  currentPassword: string;
  nextPassword: string;
  confirmPassword?: string;
};

export type ModelType = 'llm' | 'image' | 'video' | 'audio';

export type ModelConfig = {
  id?: string;
  type: ModelType;
  name: string;
  provider: string;
  model: string;
  apiKey: string;
  baseUrl: string;
  temperature: number;
  settings?: Record<string, unknown>;
  isDefault: boolean;
  sortOrder?: number;
  createdAt?: string;
  updatedAt?: string;
};

export type VideoReferenceType = 'image' | 'video' | 'audio';

export type ImageModelOption = {
  id: string;
  name: string;
  description: string;
  disabled?: boolean;
};

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
  name: string;
  type: string;
  size: number;
  kind: 'image' | 'file';
  url: string;
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
    capabilityState?: {
      xingtu?: {
        draftId?: string;
        profileId?: string;
        lastPage?: number;
        pendingConfirmation?: boolean;
      };
    };
  };
  createdAt: string;
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
    imageModelConfigId?: string | null;
    xingtuProfileId?: string | null;
  };
  requestedCapabilities?: Array<'xingtu_creator_search' | 'image_generation'>;
};

export type ChatStreamEvent =
  | { type: 'conversation'; conversation: ChatConversation }
  | { type: 'user_message'; message: ChatMessage }
  | { type: 'assistant_message'; message: ChatMessage }
  | { type: 'reasoning_delta'; delta: string }
  | { type: 'answer_delta'; delta: string }
  | { type: 'done'; conversation: ChatConversation; messages: ChatMessage[] }
  | { type: 'error'; message: string };

export type SkillFile = {
  category?: string;
  command: string;
  createdAt: string;
  description: string;
  enabled?: boolean;
  fileUrl: string;
  id: string;
  isDefault?: boolean;
  name: string;
  originalFileName: string;
  scenario?: string;
  storedFileName: string;
  updatedAt: string;
  userId: string;
};

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
  | 'video_remake'
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
  usedReplicationPlan?: Record<string, unknown>;
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
  viralAnalysis?: Record<string, unknown>;
  replicationPlan?: Record<string, unknown>;
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
  failureReason?: string | null;
  createdAt: string;
  updatedAt: string;
};
