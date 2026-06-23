import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import type { Request } from 'express';
import { sendError } from '../../shared/http.js';
import { agentRepository } from '../agents/agent.repository.js';
import { modelConfigRepository } from '../model-configs/model-config.repository.js';
import { resolveSkillInvocation } from '../skills/skill.service.js';
import { resolveChatCapabilityInvocation } from './chat-capability.service.js';
import { askConfiguredModel, assertModelConfigReady } from './chat-completion.service.js';
import { chatRepository } from './chat.repository.js';
import {
  handleCapabilityConversation,
  makeChatTitle,
  parseCapabilityContext,
  parseChatAttachments,
  parseRequestedCapabilities,
} from './chat-stream.service.js';
import type { ChatConversation, ChatMessage } from './chat.types.js';

function getCurrentUserId(req: Request) {
  return req.auth?.userId || req.auth?.user?.id || '';
}

function makeConversationPreview(content: string) {
  const compact = content.replace(/\s+/g, ' ').trim();
  return compact.length > 48 ? `${compact.slice(0, 48)}...` : compact;
}

export function createChatRouter() {
  const router = Router();

  router.get('/conversations', (req, res) => {
    const userId = getCurrentUserId(req);
    if (!userId) {
      sendError(res, 401, '请先登录');
      return;
    }

    res.json(chatRepository.listConversations(userId));
  });

  router.get('/conversations/:id/messages', (req, res) => {
    const currentUserId = getCurrentUserId(req);
    const conversation = chatRepository.findConversation(req.params.id);
    if (!conversation) {
      sendError(res, 404, '对话不存在');
      return;
    }

    if (conversation.userId !== currentUserId) {
      sendError(res, 403, '无权访问该对话');
      return;
    }

    res.json(chatRepository.listMessages(req.params.id));
  });

  router.get('/conversations/:id', (req, res) => {
    const currentUserId = getCurrentUserId(req);
    const conversation = chatRepository.findConversation(req.params.id);
    if (!conversation) {
      sendError(res, 404, '对话不存在');
      return;
    }

    if (conversation.userId !== currentUserId) {
      sendError(res, 403, '无权访问该对话');
      return;
    }

    res.json({
      conversation,
      messages: chatRepository.listMessages(conversation.id),
    });
  });

  router.put('/conversations/:id', (req, res) => {
    const currentUserId = getCurrentUserId(req);
    const conversation = chatRepository.findConversation(req.params.id);
    const title = String(req.body.title || '').trim();

    if (!conversation) {
      sendError(res, 404, '对话不存在');
      return;
    }

    if (conversation.userId !== currentUserId) {
      sendError(res, 403, '无权修改该对话');
      return;
    }

    if (!title) {
      sendError(res, 400, '会话名称不能为空');
      return;
    }

    const updated = chatRepository.renameConversation(conversation.id, title.slice(0, 80), new Date().toISOString());
    res.json(updated);
  });

  router.delete('/conversations/:id', (req, res) => {
    const currentUserId = getCurrentUserId(req);
    const conversation = chatRepository.findConversation(req.params.id);
    if (!conversation) {
      sendError(res, 404, '对话不存在');
      return;
    }

    if (conversation.userId !== currentUserId) {
      sendError(res, 403, '无权删除该对话');
      return;
    }

    chatRepository.deleteConversation(conversation.id);
    res.status(204).end();
  });

  router.delete('/conversations/:id/messages', (req, res) => {
    const currentUserId = getCurrentUserId(req);
    const conversation = chatRepository.findConversation(req.params.id);
    if (!conversation) {
      sendError(res, 404, '对话不存在');
      return;
    }

    if (conversation.userId !== currentUserId) {
      sendError(res, 403, '无权修改该对话');
      return;
    }

    const updated = chatRepository.clearMessages(conversation, new Date().toISOString());
    res.json({
      conversation: updated,
      messages: [],
    });
  });

  router.post('/messages', async (req, res) => {
    const userId = getCurrentUserId(req);
    const content = String(req.body.content || '').trim();
    const agentId = String(req.body.agentId || '').trim();
    const modelConfigId = typeof req.body.modelConfigId === 'string' ? req.body.modelConfigId : null;
    const attachments = parseChatAttachments(req.body.attachments);
    const capabilityContext = parseCapabilityContext(req.body.capabilityContext);
    const requestedCapabilities = parseRequestedCapabilities(req.body.requestedCapabilities);

    if (!userId || (!content && !attachments.length) || !agentId) {
      sendError(res, 401, '请先登录');
      return;
    }

    const agent = agentRepository.find(agentId);
    if (!agent) {
      sendError(res, 404, '智能体不存在');
      return;
    }

    const resolvedModelConfigId = modelConfigId || agent.modelConfigId || undefined;
    const modelConfig = resolvedModelConfigId
      ? modelConfigRepository.find(resolvedModelConfigId)
      : modelConfigRepository.list('llm').find((item) => Boolean(item.isDefault));

    if (!modelConfig) {
      sendError(res, 400, '未找到可用的默认 LLM 模型配置');
      return;
    }

    try {
      assertModelConfigReady(modelConfig);
    } catch (error) {
      sendError(res, 400, error instanceof Error ? error.message : '模型配置不可用');
      return;
    }

    const conversationId = String(req.body.conversationId || '').trim();
    const existingConversation = conversationId ? chatRepository.findConversation(conversationId) : undefined;
    if (existingConversation && existingConversation.userId !== userId) {
      sendError(res, 403, '无权访问该对话');
      return;
    }

    const capabilityInvocation = resolveChatCapabilityInvocation(content, requestedCapabilities);
    if (capabilityInvocation) {
      const history = existingConversation ? chatRepository.listMessages(existingConversation.id) : [];
      try {
        const handled = await handleCapabilityConversation({
          userId,
          content,
          agent,
          modelConfig,
          attachments,
          capabilityContext,
          requestedCapabilities,
          conversation: existingConversation,
          existingHistory: history,
        });
        if (handled) {
          res.status(201).json({
            conversation: handled.conversation,
            messages: handled.messages,
          });
          return;
        }
      } catch (error) {
        sendError(res, 400, error instanceof Error ? error.message : '能力调用失败');
        return;
      }
    }

    let skillInvocation;
    try {
      skillInvocation = await resolveSkillInvocation({ content, userId });
    } catch (error) {
      sendError(res, 400, error instanceof Error ? error.message : '技能读取失败');
      return;
    }

    const history = existingConversation ? chatRepository.listMessages(existingConversation.id) : [];
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

    let assistantContent: string;
    try {
      assistantContent = await askConfiguredModel({
        userId,
        sourceId: conversation.id,
        agent,
        modelConfig,
        history,
        content: skillInvocation.modelContent,
        attachments,
      });
    } catch (error) {
      sendError(res, 502, error instanceof Error ? error.message : '模型服务调用失败');
      return;
    }

    const userMessage: ChatMessage = {
      id: randomBytes(12).toString('hex'),
      conversationId: conversation.id,
      role: 'user',
      content: skillInvocation.userContent,
      agentId,
      modelConfigId: modelConfig.id,
      attachments,
      createdAt: now,
    };
    const assistantMessage: ChatMessage = {
      id: randomBytes(12).toString('hex'),
      conversationId: conversation.id,
      role: 'assistant',
      content: assistantContent,
      agentId,
      modelConfigId: modelConfig.id,
      createdAt: new Date(Date.now() + 1).toISOString(),
    };
    const completedConversation: ChatConversation = {
      ...conversation,
      metadata: {
        ...(conversation.metadata || {}),
        previewText: makeConversationPreview(assistantContent),
      },
    };

    if (existingConversation) {
      chatRepository.touchConversation(completedConversation);
    } else {
      chatRepository.createConversation(completedConversation);
    }
    chatRepository.createMessages([userMessage, assistantMessage]);
    res.status(201).json({
      conversation: completedConversation,
      messages: chatRepository.listMessages(completedConversation.id),
    });
  });

  return router;
}
