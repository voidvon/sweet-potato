import { db } from '../../db/database.js';
import type { ChatConversation, ChatMessage } from './chat.types.js';

type ChatMessageRow = Omit<ChatMessage, 'attachments' | 'actions' | 'capabilityContext' | 'imageGenerationFailures' | 'isCompleted'> & {
  actions?: string;
  attachments?: string;
  capabilityContext?: string | null;
  imageGenerationFailures?: string | null;
  isCompleted?: number | boolean;
};

type ChatConversationRow = Omit<ChatConversation, 'metadata'> & {
  metadata?: string | null;
};

const conversationSelect = `
  SELECT
    id,
    user_id as userId,
    title,
    agent_id as agentId,
    model_config_id as modelConfigId,
    metadata,
    created_at as createdAt,
    updated_at as updatedAt
  FROM chat_conversations
`;

const messageSelect = `
  SELECT
    id,
    conversation_id as conversationId,
    role,
    content,
    capability_context as capabilityContext,
    image_model_config_id as imageModelConfigId,
    generation_job_id as generationJobId,
    image_generation_expected_count as imageGenerationExpectedCount,
    image_generation_failures as imageGenerationFailures,
    reasoning_content as reasoningContent,
    actions,
    agent_id as agentId,
    model_config_id as modelConfigId,
    attachments,
    is_completed as isCompleted,
    created_at as createdAt
  FROM chat_messages
`;

function parseConversation(row: ChatConversationRow) {
  return {
    ...row,
    metadata: row.metadata ? JSON.parse(row.metadata) : {},
  } as ChatConversation;
}

function serializeConversation(conversation: ChatConversation) {
  return {
    ...conversation,
    modelConfigId: conversation.modelConfigId || null,
    metadata: JSON.stringify(conversation.metadata || {}),
  };
}

function parseMessage(row: ChatMessageRow) {
  return {
    ...row,
    actions: row.actions ? JSON.parse(row.actions) : [],
    attachments: row.attachments ? JSON.parse(row.attachments) : [],
    capabilityContext: row.capabilityContext ? JSON.parse(row.capabilityContext) : undefined,
    imageGenerationFailures: row.imageGenerationFailures ? JSON.parse(row.imageGenerationFailures) : [],
    isCompleted: Boolean(row.isCompleted),
  } as ChatMessage;
}

function serializeMessage(message: ChatMessage) {
  return {
    ...message,
    capabilityContext: message.capabilityContext ? JSON.stringify(message.capabilityContext) : null,
    imageModelConfigId: message.imageModelConfigId || null,
    generationJobId: message.generationJobId || null,
    imageGenerationExpectedCount: message.imageGenerationExpectedCount || null,
    imageGenerationFailures: JSON.stringify(message.imageGenerationFailures || []),
    reasoningContent: message.reasoningContent || null,
    actions: JSON.stringify(message.actions || []),
    modelConfigId: message.modelConfigId || null,
    attachments: JSON.stringify(message.attachments || []),
    isCompleted: message.isCompleted === false ? 0 : 1,
  };
}

export const chatRepository = {
  listConversations(userId: string) {
    const query = db.prepare(`
      ${conversationSelect}
      WHERE user_id = ?
      ORDER BY updated_at DESC
    `);
    return (query.all(userId) as ChatConversationRow[]).map(parseConversation);
  },

  findConversation(id: string) {
    const query = db.prepare(`${conversationSelect} WHERE id = ?`);
    const row = query.get(id) as ChatConversationRow | undefined;
    return row ? parseConversation(row) : undefined;
  },

  createConversation(conversation: ChatConversation) {
    const query = db.prepare(`
      INSERT INTO chat_conversations (id, user_id, title, agent_id, model_config_id, metadata, created_at, updated_at)
      VALUES (@id, @userId, @title, @agentId, @modelConfigId, @metadata, @createdAt, @updatedAt)
    `);
    query.run(serializeConversation(conversation));
    return conversation;
  },

  touchConversation(conversation: Pick<ChatConversation, 'id' | 'agentId' | 'modelConfigId' | 'updatedAt' | 'metadata'>) {
    const query = db.prepare(`
      UPDATE chat_conversations
      SET agent_id = @agentId, model_config_id = @modelConfigId, metadata = @metadata, updated_at = @updatedAt
      WHERE id = @id
    `);
    query.run({
      ...conversation,
      modelConfigId: conversation.modelConfigId || null,
      metadata: JSON.stringify(conversation.metadata || {}),
    });
  },

  renameConversation(id: string, title: string, updatedAt: string) {
    const query = db.prepare(`
      UPDATE chat_conversations
      SET title = ?, updated_at = ?
      WHERE id = ?
    `);
    query.run(title, updatedAt, id);
    return this.findConversation(id);
  },

  deleteConversation(id: string) {
    const transaction = db.transaction(() => {
      db.prepare('DELETE FROM chat_messages WHERE conversation_id = ?').run(id);
      db.prepare('DELETE FROM chat_conversations WHERE id = ?').run(id);
    });
    transaction();
  },

  clearMessages(conversation: ChatConversation, updatedAt: string) {
    const transaction = db.transaction(() => {
      db.prepare('DELETE FROM chat_messages WHERE conversation_id = ?').run(conversation.id);
      db.prepare(`
        UPDATE chat_conversations
        SET metadata = ?, updated_at = ?
        WHERE id = ?
      `).run(JSON.stringify({ ...(conversation.metadata || {}), previewText: '' }), updatedAt, conversation.id);
    });
    transaction();
    return this.findConversation(conversation.id);
  },

  deleteMessagesAfter(conversationId: string, createdAt: string) {
    db.prepare(`
      DELETE FROM chat_messages
      WHERE conversation_id = ? AND created_at > ?
    `).run(conversationId, createdAt);
  },

  deleteMessage(conversationId: string, messageId: string) {
    db.prepare(`
      DELETE FROM chat_messages
      WHERE conversation_id = ? AND id = ?
    `).run(conversationId, messageId);
  },

  replaceMessageContent(input: {
    id: string;
    content: string;
    attachments?: ChatMessage['attachments'];
    capabilityContext?: ChatMessage['capabilityContext'];
    imageModelConfigId?: string | null;
    generationJobId?: string | null;
    imageGenerationExpectedCount?: number;
    imageGenerationFailures?: ChatMessage['imageGenerationFailures'];
    updatedReasoningContent?: string | null;
    isCompleted?: boolean;
  }) {
    db.prepare(`
      UPDATE chat_messages
      SET
        content = @content,
        capability_context = @capabilityContext,
        image_model_config_id = @imageModelConfigId,
        generation_job_id = @generationJobId,
        image_generation_expected_count = @imageGenerationExpectedCount,
        image_generation_failures = @imageGenerationFailures,
        attachments = @attachments,
        reasoning_content = @reasoningContent,
        is_completed = @isCompleted
      WHERE id = @id
    `).run({
      id: input.id,
      content: input.content,
      capabilityContext: input.capabilityContext ? JSON.stringify(input.capabilityContext) : null,
      imageModelConfigId: input.imageModelConfigId || null,
      generationJobId: input.generationJobId || null,
      imageGenerationExpectedCount: input.imageGenerationExpectedCount || null,
      imageGenerationFailures: JSON.stringify(input.imageGenerationFailures || []),
      attachments: JSON.stringify(input.attachments || []),
      reasoningContent: input.updatedReasoningContent || null,
      isCompleted: input.isCompleted === false ? 0 : 1,
    });
    return db.prepare(`${messageSelect} WHERE id = ?`).get(input.id) as ChatMessageRow | undefined;
  },

  listMessages(conversationId: string) {
    const query = db.prepare(`
      ${messageSelect}
      WHERE conversation_id = ?
      ORDER BY created_at ASC
    `);
    return (query.all(conversationId) as ChatMessageRow[]).map(parseMessage);
  },

  createMessages(messages: ChatMessage[]) {
    const query = db.prepare(`
      INSERT INTO chat_messages (
        id, conversation_id, role, content, capability_context, image_model_config_id, generation_job_id, image_generation_expected_count, image_generation_failures, reasoning_content, actions, agent_id, model_config_id, attachments, is_completed, created_at
      )
      VALUES (
        @id, @conversationId, @role, @content, @capabilityContext, @imageModelConfigId, @generationJobId, @imageGenerationExpectedCount, @imageGenerationFailures, @reasoningContent, @actions, @agentId, @modelConfigId, @attachments, @isCompleted, @createdAt
      )
    `);
    const transaction = db.transaction(() => {
      messages.forEach((item) => query.run(serializeMessage(item)));
    });
    transaction();
  },

  findMessage(id: string) {
    const row = db.prepare(`${messageSelect} WHERE id = ?`).get(id) as ChatMessageRow | undefined;
    return row ? parseMessage(row) : undefined;
  },
};
