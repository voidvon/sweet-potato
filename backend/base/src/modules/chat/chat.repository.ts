import { db } from '../../db/database.js';
import type { ChatConversation, ChatMessage } from './chat.types.js';

type ChatMessageRow = Omit<ChatMessage, 'attachments' | 'actions' | 'isCompleted'> & {
  actions?: string;
  attachments?: string;
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
    isCompleted: Boolean(row.isCompleted),
  } as ChatMessage;
}

function serializeMessage(message: ChatMessage) {
  return {
    ...message,
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
    updatedReasoningContent?: string | null;
    isCompleted?: boolean;
  }) {
    db.prepare(`
      UPDATE chat_messages
      SET
        content = @content,
        attachments = @attachments,
        reasoning_content = @reasoningContent,
        is_completed = @isCompleted
      WHERE id = @id
    `).run({
      id: input.id,
      content: input.content,
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
        id, conversation_id, role, content, reasoning_content, actions, agent_id, model_config_id, attachments, is_completed, created_at
      )
      VALUES (
        @id, @conversationId, @role, @content, @reasoningContent, @actions, @agentId, @modelConfigId, @attachments, @isCompleted, @createdAt
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
