import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import type { Request } from 'express';
import { contentUploadLimitBytes } from '../../config/env.js';
import { dataDir } from '../../db/database.js';
import { requirePermission } from '../../shared/auth.middleware.js';
import { sendError } from '../../shared/http.js';
import { agentRepository } from '../agents/agent.repository.js';
import { modelConfigRepository } from '../model-configs/model-config.repository.js';
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
const chatFilesDir = path.join(dataDir, 'files');
mkdirSync(chatFilesDir, { recursive: true });

function sanitizeFileName(fileName: string) {
  const parsed = path.parse(fileName);
  const base = parsed.name.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'attachment';
  const ext = parsed.ext.replace(/[^\w.]+/g, '');
  return `${base}${ext}`;
}

function decodeUploadFileName(fileName: string) {
  if (!fileName) {
    return fileName;
  }
  const decoded = Buffer.from(fileName, 'latin1').toString('utf8');
  if (decoded && decoded !== fileName && /[\u4e00-\u9fff]/.test(decoded) && /[ÃÂÄÅæéèç]/.test(fileName)) {
    return decoded;
  }
  return fileName;
}

const upload = multer({
  storage: multer.diskStorage({
    destination(_req, _file, callback) {
      callback(null, chatFilesDir);
    },
    filename(_req, file, callback) {
      callback(null, `${Date.now()}-${randomBytes(6).toString('hex')}-${sanitizeFileName(decodeUploadFileName(file.originalname))}`);
    },
  }),
  limits: {
    fileSize: contentUploadLimitBytes,
  },
});

function getCurrentUserId(req: Request) {
  return req.auth?.userId || req.auth?.user?.id || '';
}

function makeConversationPreview(content: string) {
  const compact = content.replace(/\s+/g, ' ').trim();
  return compact.length > 48 ? `${compact.slice(0, 48)}...` : compact;
}

export function createChatRouter() {
  const router = Router();

  router.use(requirePermission('web.module.chat'));

  router.post('/attachments/upload', (req, res) => {
    upload.single('file')(req, res, (uploadError) => {
      if (uploadError) {
        sendError(res, 400, uploadError instanceof Error ? uploadError.message : '附件上传失败');
        return;
      }
      if (!req.file) {
        sendError(res, 400, '请选择要上传的附件');
        return;
      }

      const originalFileName = decodeUploadFileName(req.file.originalname);
      res.status(201).json({
        id: `${Date.now()}-${randomBytes(8).toString('hex')}`,
        name: originalFileName,
        type: req.file.mimetype || 'application/octet-stream',
        size: req.file.size,
        kind: (req.file.mimetype || '').startsWith('image/') ? 'image' : 'file',
        url: `/files/${encodeURIComponent(req.file.filename)}`,
      });
    });
  });

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

  router.delete('/conversations/:conversationId/messages/:messageId', (req, res) => {
    const currentUserId = getCurrentUserId(req);
    const conversation = chatRepository.findConversation(req.params.conversationId);
    if (!conversation) {
      sendError(res, 404, '对话不存在');
      return;
    }

    if (conversation.userId !== currentUserId) {
      sendError(res, 403, '无权修改该对话');
      return;
    }

    const targetMessage = chatRepository.findMessage(req.params.messageId);
    if (!targetMessage || targetMessage.conversationId !== conversation.id) {
      sendError(res, 404, '消息不存在');
      return;
    }

    chatRepository.deleteMessage(conversation.id, targetMessage.id);
    res.json({
      conversation,
      messages: chatRepository.listMessages(conversation.id),
    });
  });

  router.post('/messages', async (req, res) => {
    const userId = getCurrentUserId(req);
    const content = String(req.body.content || '').trim();
    const agentId = String(req.body.agentId || '').trim();
    const modelConfigId = typeof req.body.modelConfigId === 'string' ? req.body.modelConfigId : null;
    const imageModelConfigId = typeof req.body.imageModelConfigId === 'string' ? req.body.imageModelConfigId : null;
    const attachments = parseChatAttachments(req.body.attachments);
    const capabilityContext = parseCapabilityContext(req.body.capabilityContext);
    const requestedCapabilities = parseRequestedCapabilities(req.body.requestedCapabilities);
    const editMessageId = String(req.body.editMessageId || '').trim();

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
    const editTarget = editMessageId ? chatRepository.findMessage(editMessageId) : undefined;
    if (editMessageId && (!existingConversation || !editTarget || editTarget.conversationId !== existingConversation.id || editTarget.role !== 'user')) {
      sendError(res, 404, '待编辑消息不存在或不可编辑');
      return;
    }

    const capabilityInvocation = resolveChatCapabilityInvocation(content, requestedCapabilities);
    const imageModelConfig = imageModelConfigId
      ? modelConfigRepository.find(imageModelConfigId)
      : capabilityInvocation?.capability === 'image_generation'
        ? modelConfigRepository.list('image').find((item) => Boolean(item.isDefault)) || modelConfigRepository.list('image')[0]
        : undefined;
    if (capabilityInvocation?.capability === 'image_generation' && !imageModelConfig) {
      sendError(res, 400, '请选择可用的图片模型');
      return;
    }
    if (imageModelConfig && imageModelConfig.type !== 'image') {
      sendError(res, 400, '请选择图片模型配置');
      return;
    }
    if (capabilityInvocation?.capability === 'image_generation') {
      let existingHistory = existingConversation ? chatRepository.listMessages(existingConversation.id) : [];
      if (editTarget) {
        existingHistory = existingHistory.filter((item) => item.createdAt < editTarget.createdAt);
        chatRepository.deleteMessagesAfter(existingConversation!.id, editTarget.createdAt);
        chatRepository.replaceMessageContent({
          id: editTarget.id,
          content,
          attachments,
          capabilityContext,
          imageModelConfigId,
        });
      }
      let initialConversation: ChatConversation | undefined;
      let initialUserMessage: ChatMessage | undefined;
      let initialAssistantMessage: ChatMessage | undefined;
      const backgroundRun = handleCapabilityConversation({
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
        onConversation: (conversation) => {
          initialConversation = conversation;
        },
        onUserMessage: (message) => {
          initialUserMessage = message;
        },
        onAssistantMessage: (message) => {
          initialAssistantMessage = message;
        },
      });
      void backgroundRun.catch((error) => {
        console.error('[chat] background image generation failed', error);
      });
      if (!initialConversation || !initialUserMessage || !initialAssistantMessage) {
        sendError(res, 500, '图片生成任务创建失败');
        return;
      }
      res.status(202).json({
        conversation: initialConversation,
        messages: chatRepository.listMessages(initialConversation.id),
      });
      return;
    }
    if (capabilityInvocation) {
      const history = existingConversation ? chatRepository.listMessages(existingConversation.id) : [];
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

    const history = existingConversation ? chatRepository.listMessages(existingConversation.id) : [];
    const now = new Date().toISOString();
    const conversation: ChatConversation = existingConversation
      ? {
          ...existingConversation,
          agentId,
          modelConfigId: modelConfig.id,
          metadata: {
            ...(existingConversation.metadata || {}),
            previewText: makeConversationPreview(content),
          },
          updatedAt: now,
        }
      : {
          id: randomBytes(12).toString('hex'),
          userId,
          title: makeChatTitle(content),
          agentId,
          modelConfigId: modelConfig.id,
          metadata: {
            previewText: makeConversationPreview(content),
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
        content,
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
      content,
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
