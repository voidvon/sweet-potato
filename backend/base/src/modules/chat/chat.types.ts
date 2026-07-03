import type { ChatCapabilityContext, ChatConversationMetadata, ChatRequestedCapability } from './chat-capability.types.js';

export type ChatConversation = {
  id: string;
  userId: string;
  title: string;
  agentId: string;
  modelConfigId?: string | null;
  metadata?: ChatConversationMetadata;
  createdAt: string;
  updatedAt: string;
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
  createdAt: string;
  isCompleted?: boolean;
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
  capabilityContext?: ChatCapabilityContext;
  requestedCapabilities?: ChatRequestedCapability[];
};
