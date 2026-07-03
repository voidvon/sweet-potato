import type { AiAgent } from '../agents/agent.types.js';
import type { AiModelConfig } from '../model-configs/model-config.types.js';
import type { ChatAttachment, ChatConversation, ChatMessage, ChatMessageAction } from './chat.types.js';

export type ChatCapabilityName = 'xingtu_creator_search' | 'image_generation';

export type ChatCapabilityContext = {
  xingtuProfileId?: string | null;
  imageModelConfigId?: string | null;
};

export type ChatRequestedCapability = ChatCapabilityName;

export type ChatConversationMetadata = {
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

export type ChatCapabilityInvocation = {
  capability: ChatCapabilityName;
  cleanedContent: string;
  mentionToken: string;
};

export type ChatCapabilityExecutionInput = {
  userId: string;
  content: string;
  agent: AiAgent;
  modelConfig: AiModelConfig;
  imageModelConfig?: AiModelConfig;
  history: ChatMessage[];
  attachments: ChatAttachment[];
  capabilityContext?: ChatCapabilityContext;
  conversation?: ChatConversation;
};

export type ChatCapabilityExecutionResult = {
  capability: ChatCapabilityName;
  assistantContent: string;
  assistantAttachments?: ChatAttachment[];
  assistantActions?: ChatMessageAction[];
  metadata: ChatConversationMetadata;
};

export type ChatCapabilityHandler = {
  capability: ChatCapabilityName;
  mentionTokens: string[];
  execute: (input: ChatCapabilityExecutionInput) => Promise<ChatCapabilityExecutionResult>;
};
