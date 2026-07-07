import { randomBytes } from 'node:crypto';
import type { Server as HttpServer } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import type { AiAgent } from '../agents/agent.types.js';
import { agentRepository } from '../agents/agent.repository.js';
import type { AiModelConfig } from '../model-configs/model-config.types.js';
import { modelConfigRepository } from '../model-configs/model-config.repository.js';
import { extractBearerToken, verifyAuthToken } from '../../shared/auth.js';
import { resolveSkillInvocation } from '../skills/skill.service.js';
import { userRepository } from '../users/user.repository.js';
import { dispatchChatCapability, resolveChatCapabilityInvocation } from './chat-capability.service.js';
import { assertModelConfigReady, streamConfiguredModel } from './chat-completion.service.js';
import { chatRepository } from './chat.repository.js';
import type { ChatAttachment, ChatConversation, ChatMessage, SendChatPayload } from './chat.types.js';

export type ChatStreamSink = {
  send: (event: unknown) => void;
  end: () => void;
  signal?: AbortSignal;
};

export type ParsedChatStreamPayload = {
  userId: string;
  content: string;
  agentId: string;
  modelConfigId: string | null;
  imageModelConfigId: string | null;
  attachments: ChatAttachment[];
  capabilityContext?: SendChatPayload['capabilityContext'];
  requestedCapabilities?: SendChatPayload['requestedCapabilities'];
  conversationId?: string;
  editMessageId?: string;
};

export function makeChatTitle(content: string) {
  const compact = content.replace(/\s+/g, ' ').trim();
  return compact.length > 24 ? `${compact.slice(0, 24)}...` : compact || '新的对话';
}

function makeConversationPreview(content: string) {
  const compact = content.replace(/\s+/g, ' ').trim();
  return compact.length > 48 ? `${compact.slice(0, 48)}...` : compact;
}

export function parseChatAttachments(value: unknown): ChatAttachment[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.slice(0, 16).flatMap((item) => {
    if (!item || typeof item !== 'object') {
      return [];
    }
    const attachment = item as Partial<ChatAttachment>;
    const name = String(attachment.name || '').trim().slice(0, 160);
    const type = String(attachment.type || '').trim().slice(0, 120);
    const url = String(attachment.url || '').trim();
    const size = Number(attachment.size || 0);
    const kind = attachment.kind === 'image' ? 'image' : 'file';

    if (!name || !url || !Number.isFinite(size) || size <= 0 || size > 3 * 1024 * 1024) {
      return [];
    }

    return [{
      id: String(attachment.id || randomBytes(8).toString('hex')),
      kind,
      name,
      size,
      type,
      url,
    }];
  });
}

function stringValue(value: unknown, maxLength: number) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : undefined;
}

function parseImageGenerationReferenceGroups(value: unknown): NonNullable<NonNullable<SendChatPayload['capabilityContext']>['imageGeneration']>['referenceGroups'] {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const groups = value.slice(0, 16).flatMap((item) => {
    if (!item || typeof item !== 'object') {
      return [];
    }
    const source = item as Record<string, unknown>;
    const key = stringValue(source.key, 80);
    const label = stringValue(source.label, 80);
    const attachmentIds = Array.isArray(source.attachmentIds)
      ? source.attachmentIds.map((id) => stringValue(id, 160)).filter((id): id is string => Boolean(id))
      : [];
    if (!key || !label) {
      return [];
    }
    const maxCount = Number(source.maxCount);
    return [{
      key,
      label,
      attachmentIds: attachmentIds.slice(0, 16),
      required: source.required === true,
      maxCount: Number.isFinite(maxCount) && maxCount > 0 ? Math.floor(maxCount) : undefined,
    }];
  });
  return groups.length ? groups : undefined;
}

function parseImageGenerationContext(value: unknown): NonNullable<NonNullable<SendChatPayload['capabilityContext']>['imageGeneration']> | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const source = value as Record<string, unknown>;
  const outputCount = Number(source.outputCount);
  const outputBackground = stringValue(source.outputBackground, 20);
  const parsedOutputBackground: 'transparent' | 'white' | 'black' | undefined =
    outputBackground === 'transparent' || outputBackground === 'white' || outputBackground === 'black'
      ? outputBackground
      : undefined;
  const context = {
    modeKey: stringValue(source.modeKey, 80),
    modeTitle: stringValue(source.modeTitle, 80),
    promptText: stringValue(source.promptText, 4000),
    promptHint: stringValue(source.promptHint, 4000),
    outputSize: stringValue(source.outputSize, 40),
    outputCount: Number.isFinite(outputCount) ? Math.max(1, Math.floor(outputCount)) : undefined,
    outputBackground: parsedOutputBackground,
    aspectRatio: stringValue(source.aspectRatio, 20),
    resolution: stringValue(source.resolution, 20),
    referenceGroups: parseImageGenerationReferenceGroups(source.referenceGroups),
  };
  return Object.values(context).some((item) => item !== undefined) ? context : undefined;
}

export function parseCapabilityContext(value: unknown): SendChatPayload['capabilityContext'] {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const source = value as { imageGeneration?: unknown; imageModelConfigId?: unknown; xingtuProfileId?: unknown };
  return {
    imageModelConfigId: typeof source.imageModelConfigId === 'string' ? source.imageModelConfigId.trim() : undefined,
    imageGeneration: parseImageGenerationContext(source.imageGeneration),
    xingtuProfileId: typeof source.xingtuProfileId === 'string' ? source.xingtuProfileId.trim() : undefined,
  };
}

export function parseRequestedCapabilities(value: unknown): SendChatPayload['requestedCapabilities'] {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const items = value
    .map((item) => String(item || '').trim())
    .filter(Boolean) as NonNullable<SendChatPayload['requestedCapabilities']>;
  return items.length ? items : undefined;
}

function parseStreamPayload(body: Record<string, unknown>): ParsedChatStreamPayload {
  return {
    userId: String(body.userId || '').trim(),
    content: String(body.content || '').trim(),
    agentId: String(body.agentId || '').trim(),
    modelConfigId: typeof body.modelConfigId === 'string' ? body.modelConfigId : null,
    imageModelConfigId: typeof body.imageModelConfigId === 'string' ? body.imageModelConfigId : null,
    attachments: parseChatAttachments(body.attachments),
    capabilityContext: parseCapabilityContext(body.capabilityContext),
    requestedCapabilities: parseRequestedCapabilities(body.requestedCapabilities),
    conversationId: String(body.conversationId || '').trim() || undefined,
    editMessageId: String(body.editMessageId || '').trim() || undefined,
  };
}

export async function handleCapabilityConversation(input: {
  userId: string;
  content: string;
  agent: AiAgent;
  modelConfig: AiModelConfig;
  imageModelConfig?: AiModelConfig;
  attachments: ChatAttachment[];
  capabilityContext?: SendChatPayload['capabilityContext'];
  requestedCapabilities?: SendChatPayload['requestedCapabilities'];
  conversation?: ChatConversation;
  existingHistory?: ChatMessage[];
  editedUserMessage?: ChatMessage;
}) {
  const invocation = resolveChatCapabilityInvocation(input.content, input.requestedCapabilities);
  if (!invocation) {
    return null;
  }

  const now = new Date().toISOString();
  const conversation: ChatConversation = input.conversation
    ? { ...input.conversation, agentId: input.agent.id, modelConfigId: input.modelConfig.id, updatedAt: now }
    : {
        id: randomBytes(12).toString('hex'),
        userId: input.userId,
        title: makeChatTitle(invocation.cleanedContent || input.content),
        agentId: input.agent.id,
        modelConfigId: input.modelConfig.id,
        metadata: {},
        createdAt: now,
        updatedAt: now,
      };

  const result = await dispatchChatCapability({
    userId: input.userId,
    content: input.content,
    agent: input.agent,
    modelConfig: input.modelConfig,
    imageModelConfig: input.imageModelConfig,
    history: input.existingHistory || [],
    attachments: input.attachments,
    invocation,
    capabilityContext: input.capabilityContext,
    conversation,
  });

  const nextConversation: ChatConversation = {
    ...conversation,
    metadata: {
      ...result.metadata,
      previewText: result.metadata.previewText || makeConversationPreview(result.assistantContent || input.content),
    },
    updatedAt: now,
  };
  const userMessage: ChatMessage = {
    id: input.editedUserMessage?.id || randomBytes(12).toString('hex'),
    conversationId: nextConversation.id,
    role: 'user',
    content: input.content,
    agentId: input.agent.id,
    modelConfigId: nextConversation.modelConfigId || undefined,
    attachments: input.attachments,
    createdAt: input.editedUserMessage?.createdAt || now,
  };
  const assistantMessage: ChatMessage = {
    id: randomBytes(12).toString('hex'),
    conversationId: nextConversation.id,
    role: 'assistant',
    content: result.assistantContent,
    actions: result.assistantActions || [],
    agentId: input.agent.id,
    modelConfigId: nextConversation.modelConfigId || undefined,
    attachments: result.assistantAttachments || [],
    createdAt: new Date(Date.now() + 1).toISOString(),
    isCompleted: true,
  };

  if (input.conversation) {
    chatRepository.touchConversation(nextConversation);
  } else {
    chatRepository.createConversation(nextConversation);
  }
  if (input.editedUserMessage) {
    chatRepository.replaceMessageContent({
      id: userMessage.id,
      content: userMessage.content,
      attachments: userMessage.attachments,
    });
    chatRepository.createMessages([assistantMessage]);
  } else {
    chatRepository.createMessages([userMessage, assistantMessage]);
  }

  return {
    conversation: nextConversation,
    userMessage,
    assistantMessage,
    messages: input.existingHistory
      ? [...input.existingHistory, userMessage, assistantMessage]
      : chatRepository.listMessages(nextConversation.id),
  };
}

function createWebSocketStreamSink(socket: WebSocket): ChatStreamSink {
  const controller = new AbortController();
  const abort = () => {
    if (!controller.signal.aborted) {
      controller.abort();
    }
  };
  socket.once('close', abort);
  socket.once('error', abort);
  return {
    send(event: unknown) {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(event));
      }
    },
    end() {
      abort();
      if (socket.readyState === WebSocket.OPEN) {
        socket.close(1000, 'done');
      }
    },
    signal: controller.signal,
  };
}

export function createChatStreamExecutor() {
  async function executeChatStream(payload: ParsedChatStreamPayload, sink: ChatStreamSink) {
    const {
      userId,
      content,
      agentId,
      modelConfigId,
      imageModelConfigId,
      attachments,
      capabilityContext,
      requestedCapabilities,
      conversationId,
      editMessageId,
    } = payload;

    if (!userId || (!content && !attachments.length) || !agentId) {
      sink.send({ type: 'error', message: '用户、智能体和消息内容必填' });
      sink.end();
      return;
    }

    const agent = agentRepository.find(agentId);
    if (!agent) {
      sink.send({ type: 'error', message: '智能体不存在' });
      sink.end();
      return;
    }

    const resolvedModelConfigId = modelConfigId || agent.modelConfigId || undefined;
    const modelConfig = resolvedModelConfigId
      ? modelConfigRepository.find(resolvedModelConfigId)
      : modelConfigRepository.list('llm').find((item) => Boolean(item.isDefault));

    if (!modelConfig) {
      sink.send({ type: 'error', message: '未找到可用的默认 LLM 模型配置' });
      sink.end();
      return;
    }

    try {
      assertModelConfigReady(modelConfig);
    } catch (error) {
      sink.send({ type: 'error', message: error instanceof Error ? error.message : '模型配置不可用' });
      sink.end();
      return;
    }

    const capabilityInvocation = resolveChatCapabilityInvocation(content, requestedCapabilities);
    const imageModelConfig = imageModelConfigId ? modelConfigRepository.find(imageModelConfigId) : undefined;
    if (capabilityInvocation?.capability === 'image_generation' && !imageModelConfig) {
      sink.send({ type: 'error', message: '请选择可用的图片模型' });
      sink.end();
      return;
    }
    if (imageModelConfig && imageModelConfig.type !== 'image') {
      sink.send({ type: 'error', message: '请选择图片模型配置' });
      sink.end();
      return;
    }
    const existingConversation = conversationId ? chatRepository.findConversation(conversationId) : undefined;
    if (existingConversation && existingConversation.userId !== userId) {
      sink.send({ type: 'error', message: '无权访问该对话' });
      sink.end();
      return;
    }
    const editTarget = editMessageId ? chatRepository.findMessage(editMessageId) : undefined;
    if (editMessageId && (!existingConversation || !editTarget || editTarget.conversationId !== existingConversation.id || editTarget.role !== 'user')) {
      sink.send({ type: 'error', message: '待编辑消息不存在或不可编辑' });
      sink.end();
      return;
    }
    let existingHistory = existingConversation ? chatRepository.listMessages(existingConversation.id) : [];
    if (editTarget) {
      existingHistory = existingHistory.filter((item) => item.createdAt < editTarget.createdAt);
      chatRepository.deleteMessagesAfter(existingConversation!.id, editTarget.createdAt);
      chatRepository.replaceMessageContent({
        id: editTarget.id,
        content,
        attachments,
      });
    }
    if (capabilityInvocation) {
      try {
        const handled = await handleCapabilityConversation({
          userId,
          content,
          agent,
          modelConfig,
          imageModelConfig,
          attachments,
          capabilityContext,
          requestedCapabilities,
          conversation: existingConversation,
          existingHistory,
          editedUserMessage: editTarget
            ? {
                ...editTarget,
                content,
                attachments,
              }
            : undefined,
        });
        if (handled) {
          sink.send({ type: 'conversation', conversation: handled.conversation });
          sink.send({ type: 'user_message', message: handled.userMessage });
          sink.send({ type: 'assistant_message', message: handled.assistantMessage });
          sink.send({ type: 'done', conversation: handled.conversation, messages: handled.messages });
          sink.end();
          return;
        }
      } catch (error) {
        sink.send({ type: 'error', message: error instanceof Error ? error.message : '能力调用失败' });
        sink.end();
        return;
      }
    }

    let skillInvocation;
    try {
      skillInvocation = await resolveSkillInvocation({ content, userId });
    } catch (error) {
      sink.send({ type: 'error', message: error instanceof Error ? error.message : '技能读取失败' });
      sink.end();
      return;
    }
    const history = existingHistory;
    const now = new Date().toISOString();
    const conversation: ChatConversation = existingConversation
      ? {
          ...existingConversation,
          agentId,
          modelConfigId: modelConfig.id,
          metadata: {
            ...(existingConversation.metadata || {}),
            previewText: makeConversationPreview(skillInvocation.userContent),
          },
          updatedAt: now,
        }
      : {
          id: randomBytes(12).toString('hex'),
          userId,
          title: makeChatTitle(skillInvocation.titleContent),
          agentId,
          modelConfigId: modelConfig.id,
          metadata: {
            previewText: makeConversationPreview(skillInvocation.userContent),
          },
          createdAt: now,
          updatedAt: now,
        };

    const userMessage: ChatMessage = {
      id: editTarget?.id || randomBytes(12).toString('hex'),
      conversationId: conversation.id,
      role: 'user',
      content: skillInvocation.userContent,
      agentId,
      modelConfigId: modelConfig.id,
      attachments,
      createdAt: editTarget?.createdAt || now,
    };
    const assistantMessage: ChatMessage = {
      id: randomBytes(12).toString('hex'),
      conversationId: conversation.id,
      role: 'assistant',
      content: '',
      reasoningContent: '',
      agentId,
      modelConfigId: modelConfig.id,
      createdAt: new Date(Date.now() + 1).toISOString(),
      isCompleted: false,
    };

    let assistantContent = '';
    let reasoningContent = '';

    try {
      for await (const chunk of streamConfiguredModel({
        userId,
        sourceId: conversation.id,
        agent,
        modelConfig,
        history,
        content: skillInvocation.modelContent,
        attachments,
        signal: sink.signal,
      })) {
        if (chunk.type === 'reasoning') {
          reasoningContent += chunk.delta;
          sink.send({ type: 'reasoning_delta', delta: chunk.delta });
        } else {
          assistantContent += chunk.delta;
          sink.send({ type: 'answer_delta', delta: chunk.delta });
        }
      }

      const completedAssistantMessage: ChatMessage = {
        ...assistantMessage,
        content: assistantContent.trim() || '模型未返回有效内容',
        reasoningContent: reasoningContent.trim() || null,
        isCompleted: true,
      };
      const completedConversation: ChatConversation = {
        ...conversation,
        metadata: {
          ...(conversation.metadata || {}),
          previewText: makeConversationPreview(completedAssistantMessage.content),
        },
      };

      if (existingConversation) {
        chatRepository.touchConversation(completedConversation);
      } else {
        chatRepository.createConversation(completedConversation);
      }
      if (editTarget) {
        chatRepository.replaceMessageContent({
          id: userMessage.id,
          content: userMessage.content,
          attachments: userMessage.attachments,
        });
      } else {
        chatRepository.createMessages([userMessage]);
      }
      chatRepository.createMessages([completedAssistantMessage]);
      const messages = chatRepository.listMessages(completedConversation.id);
      sink.send({ type: 'done', conversation: completedConversation, messages });
      sink.end();
    } catch (error) {
      sink.send({
        type: 'error',
        message: error instanceof Error ? error.message : '模型服务调用失败',
      });
      sink.end();
    }
  }

  return { executeChatStream };
}

function resolveSocketUserId(request: import('node:http').IncomingMessage) {
  const url = new URL(request.url || '', 'http://localhost');
  const tokenFromQuery = url.searchParams.get('token');
  const tokenFromHeader = extractBearerToken(request.headers.authorization);
  const token = tokenFromHeader || tokenFromQuery;
  if (!token) {
    return null;
  }

  const payload = verifyAuthToken(token);
  if (!payload) {
    return null;
  }

  const user = userRepository.findById(payload.sub);
  if (!user || user.isBlacklisted) {
    return null;
  }

  return user.id;
}

export function attachChatWebSocketServer(server: HttpServer) {
  const { executeChatStream } = createChatStreamExecutor();
  const wss = new WebSocketServer({ server, path: '/api/chat/messages/ws' });

  wss.on('connection', (socket, request) => {
    const authedUserId = resolveSocketUserId(request);
    if (!authedUserId) {
      socket.close(1008, 'unauthorized');
      return;
    }
    let started = false;

    socket.on('message', (message) => {
      if (started) {
        return;
      }
      started = true;

      let payload: ParsedChatStreamPayload;
      try {
        payload = parseStreamPayload(JSON.parse(String(message)) as Record<string, unknown>);
      } catch {
        const sink = createWebSocketStreamSink(socket);
        sink.send({ type: 'error', message: '聊天 WebSocket 消息格式错误' });
        sink.end();
        return;
      }

      const sink = createWebSocketStreamSink(socket);
      void executeChatStream({
        ...payload,
        userId: authedUserId,
      }, sink).catch((error) => {
        sink.send({ type: 'error', message: error instanceof Error ? error.message : '聊天 WebSocket 处理失败' });
        sink.end();
      });
    });
  });

  return wss;
}
