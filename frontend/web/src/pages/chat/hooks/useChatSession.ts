import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, message } from 'antd';
import { useSearchParams } from 'react-router-dom';
import {
  clearChatConversationMessages,
  createChatMessage,
  deleteChatConversation,
  deleteChatMessage,
  getChatConversation,
  listChatConversations,
  renameChatConversation,
  streamChatMessage,
  uploadChatAttachment,
} from '../../../api/chat';
import { appRealtimeEventNames, type AppGenerationJobUpdatedDetail } from '../../../events/appRealtimeEvents';
import { getStoredUser } from '../../../utils/session';
import type { AiAgent, ChatAttachment, ChatConversation, ChatMessage, SendChatPayload } from '../../../types';
import { resolveChatCapabilityPayload } from '../chatCapabilities';

const defaultChatAgent: AiAgent = {
  id: 'quick-answer',
  name: '快速问答',
  description: '适合直接向模型提问，快速获得结构化答案。',
  icon: 'chat',
  builtIn: true,
  capabilities: ['chat'],
  runMode: 'quick',
  systemPrompt: '你是一个高效、准确的 AI 助手，回答要简洁清楚。',
  tools: [],
  skills: ['通用问答'],
  retrievalStrategy: 'semantic',
  webSearchEnabled: false,
  multimodal: { imageUpload: false, fileUpload: false },
};

function mergeMessage(items: ChatMessage[], messageItem: ChatMessage, fallbackId?: string) {
  const index = items.findIndex((item) => item.id === messageItem.id || Boolean(fallbackId && item.id === fallbackId));
  if (index === -1) {
    return [...items, messageItem];
  }

  return items.map((item, itemIndex) => (itemIndex === index
    ? {
        ...messageItem,
        capability: messageItem.capability ?? item.capability,
        capabilityContext: messageItem.capabilityContext ?? item.capabilityContext,
        imageModelConfigId: messageItem.imageModelConfigId ?? item.imageModelConfigId,
        generationJobId: messageItem.generationJobId ?? item.generationJobId,
        imageGenerationExpectedCount: messageItem.imageGenerationExpectedCount ?? item.imageGenerationExpectedCount,
        imageGenerationFailures: messageItem.imageGenerationFailures ?? item.imageGenerationFailures,
        creditCost: messageItem.creditCost ?? item.creditCost,
      }
      : item));
}

function imageGenerationFailureContent(errorMessage: string) {
  return errorMessage.startsWith('生成失败，') ? errorMessage : `图片生成失败：${errorMessage}`;
}

const maxAttachmentCount = 6;
const maxAttachmentSizeMb = 10;
const maxAttachmentBytes = maxAttachmentSizeMb * 1024 * 1024;
const bottomLockThreshold = 4;

export function useChatSession() {
  const activeAgent = defaultChatAgent;
  const [searchParams, setSearchParams] = useSearchParams();
  const urlConversationId = searchParams.get('conversationId')?.trim() || '';
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string>();
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [isResolvingConversation, setIsResolvingConversation] = useState(Boolean(urlConversationId));
  const [conversationOverlayLoading, setConversationOverlayLoading] = useState(false);
  const [userHasScrolledUp, setUserHasScrolledUp] = useState(false);
  const [continueEditFocusToken, setContinueEditFocusToken] = useState(0);
  const [composerDraftContext, setComposerDraftContext] = useState<SendChatPayload['capabilityContext']>();
  const [composerDraftImageModelConfigId, setComposerDraftImageModelConfigId] = useState<string | null>();
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const currentUser = useMemo(() => getStoredUser(), []);
  const currentUserId = currentUser?.id;
  const conversationRequestRef = useRef(0);
  const urlConversationIdRef = useRef(urlConversationId);
  const hydratedFromUrlRef = useRef(false);
  const conversationOverlayLoadingRequestRef = useRef(0);
  const conversationOverlayLoadingShowTimerRef = useRef<number | null>(null);
  const conversationOverlayLoadingHideTimerRef = useRef<number | null>(null);
  const conversationOverlayLoadingVisibleRef = useRef(false);
  const conversationOverlayLoadingShownAtRef = useRef<number | null>(null);
  const streamAbortControllerRef = useRef<AbortController | null>(null);

  const activeConversation = useMemo(
    () => conversations.find((item) => item.id === activeConversationId),
    [activeConversationId, conversations],
  );

  const hasStreamingAssistant = useMemo(
    () => messages.some((item) => item.role === 'assistant' && item.isCompleted === false),
    [messages],
  );
  useEffect(() => {
    urlConversationIdRef.current = urlConversationId;
    if (!urlConversationId) {
      hydratedFromUrlRef.current = false;
      setIsResolvingConversation(false);
      return;
    }
    if (!hydratedFromUrlRef.current) {
      setIsResolvingConversation(true);
    }
  }, [urlConversationId]);

  useEffect(() => () => {
    streamAbortControllerRef.current?.abort();
    if (conversationOverlayLoadingShowTimerRef.current !== null) {
      window.clearTimeout(conversationOverlayLoadingShowTimerRef.current);
    }
    if (conversationOverlayLoadingHideTimerRef.current !== null) {
      window.clearTimeout(conversationOverlayLoadingHideTimerRef.current);
    }
  }, []);

  const syncConversationUrl = useCallback((conversationId?: string | null) => {
    urlConversationIdRef.current = conversationId || '';
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (conversationId) {
        next.set('conversationId', conversationId);
      } else {
        next.delete('conversationId');
      }
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const setConversationOverlayLoadingVisible = useCallback((visible: boolean) => {
    conversationOverlayLoadingVisibleRef.current = visible;
    conversationOverlayLoadingShownAtRef.current = visible ? Date.now() : null;
    setConversationOverlayLoading(visible);
  }, []);

  const clearConversationOverlayLoadingShowTimer = useCallback(() => {
    if (conversationOverlayLoadingShowTimerRef.current !== null) {
      window.clearTimeout(conversationOverlayLoadingShowTimerRef.current);
      conversationOverlayLoadingShowTimerRef.current = null;
    }
  }, []);

  const clearConversationOverlayLoadingHideTimer = useCallback(() => {
    if (conversationOverlayLoadingHideTimerRef.current !== null) {
      window.clearTimeout(conversationOverlayLoadingHideTimerRef.current);
      conversationOverlayLoadingHideTimerRef.current = null;
    }
  }, []);

  const startConversationOverlayLoading = useCallback((requestId: number) => {
    conversationOverlayLoadingRequestRef.current = requestId;
    clearConversationOverlayLoadingHideTimer();
    clearConversationOverlayLoadingShowTimer();
    if (conversationOverlayLoadingVisibleRef.current) {
      return;
    }
    conversationOverlayLoadingShowTimerRef.current = window.setTimeout(() => {
      conversationOverlayLoadingShowTimerRef.current = null;
      if (conversationOverlayLoadingRequestRef.current !== requestId) {
        return;
      }
      setConversationOverlayLoadingVisible(true);
    }, 1000);
  }, [clearConversationOverlayLoadingHideTimer, clearConversationOverlayLoadingShowTimer, setConversationOverlayLoadingVisible]);

  const stopConversationOverlayLoading = useCallback((requestId: number) => {
    if (conversationOverlayLoadingRequestRef.current !== requestId) {
      return;
    }
    clearConversationOverlayLoadingShowTimer();
    if (!conversationOverlayLoadingVisibleRef.current) {
      conversationOverlayLoadingRequestRef.current = 0;
      return;
    }
    const shownAt = conversationOverlayLoadingShownAtRef.current ?? Date.now();
    const remaining = Math.max(500 - (Date.now() - shownAt), 0);
    const finish = () => {
      if (conversationOverlayLoadingRequestRef.current !== requestId) {
        return;
      }
      conversationOverlayLoadingRequestRef.current = 0;
      clearConversationOverlayLoadingHideTimer();
      setConversationOverlayLoadingVisible(false);
    };
    clearConversationOverlayLoadingHideTimer();
    if (remaining > 0) {
      conversationOverlayLoadingHideTimerRef.current = window.setTimeout(finish, remaining);
      return;
    }
    finish();
  }, [clearConversationOverlayLoadingHideTimer, clearConversationOverlayLoadingShowTimer, setConversationOverlayLoadingVisible]);

  const loadConversation = useCallback(async (conversationId: string, options?: { syncUrl?: boolean; showOverlay?: boolean }) => {
    streamAbortControllerRef.current?.abort();
    const requestId = conversationRequestRef.current + 1;
    conversationRequestRef.current = requestId;
    if (options?.showOverlay) {
      startConversationOverlayLoading(requestId);
    }
    setActiveConversationId(conversationId);
    setAttachments([]);
    setUserHasScrolledUp(false);
    try {
      const detail = await getChatConversation(conversationId);
      if (requestId !== conversationRequestRef.current) {
        return null;
      }
      setActiveConversationId(detail.conversation.id);
      setMessages(detail.messages);
      if (options?.syncUrl !== false) {
        syncConversationUrl(detail.conversation.id);
      }
      if (urlConversationIdRef.current === conversationId) {
        hydratedFromUrlRef.current = true;
        setIsResolvingConversation(false);
      }
      return detail;
    } catch (error) {
      if (requestId !== conversationRequestRef.current) {
        return null;
      }
      if (urlConversationIdRef.current === conversationId) {
        syncConversationUrl(null);
        setIsResolvingConversation(false);
      }
      hydratedFromUrlRef.current = false;
      setActiveConversationId(undefined);
      setMessages([]);
      message.error(error instanceof Error ? error.message : '对话消息加载失败');
      return null;
    } finally {
      if (options?.showOverlay) {
        stopConversationOverlayLoading(requestId);
      }
    }
  }, [startConversationOverlayLoading, stopConversationOverlayLoading, syncConversationUrl]);

  const refreshConversations = useCallback(async () => {
    if (!currentUserId) {
      return [];
    }
    const rows = await listChatConversations(currentUserId);
    setConversations(rows);
    return rows;
  }, [currentUserId]);

  useEffect(() => {
    if (!currentUserId) {
      return;
    }

    let cancelled = false;
    refreshConversations()
      .then((rows) => {
        if (cancelled) {
          return;
        }
        if (urlConversationId && !hydratedFromUrlRef.current) {
          if (urlConversationIdRef.current !== urlConversationId) {
            return;
          }
          void loadConversation(urlConversationId, { syncUrl: false, showOverlay: true });
          return;
        }
        setIsResolvingConversation(false);
        if (!activeConversationId && !rows.length) {
          setMessages([]);
        }
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setIsResolvingConversation(false);
        message.error(error instanceof Error ? error.message : '历史对话加载失败');
      });

    return () => {
      cancelled = true;
    };
  }, [activeConversationId, currentUserId, loadConversation, refreshConversations, urlConversationId]);

  useEffect(() => {
    if (!activeConversationId || !currentUserId) {
      return undefined;
    }
    const handleJobUpdated = (event: Event) => {
      const payload = (event as CustomEvent<AppGenerationJobUpdatedDetail>).detail;
      if (payload.userId !== currentUserId || payload.job?.conversationId !== activeConversationId) {
        return;
      }
      if (!payload.message) {
        return;
      }
      setMessages((current) => mergeMessage(current, payload.message!));
      if (['completed', 'partial_failed', 'failed', 'canceled'].includes(String(payload.job?.status || ''))) {
        void loadConversation(activeConversationId, { syncUrl: false });
      }
    };
    window.addEventListener(appRealtimeEventNames.generationJobUpdated, handleJobUpdated);
    return () => {
      window.removeEventListener(appRealtimeEventNames.generationJobUpdated, handleJobUpdated);
    };
  }, [activeConversationId, currentUserId]);

  const isAtBottom = useCallback(() => {
    const element = scrollContainerRef.current;
    if (!element) {
      return true;
    }
    return element.scrollHeight - element.scrollTop - element.clientHeight <= bottomLockThreshold;
  }, []);

  const scrollToBottom = useCallback((force = false) => {
    if (!force && userHasScrolledUp) {
      return;
    }

    requestAnimationFrame(() => {
      const element = scrollContainerRef.current;
      if (element) {
        element.scrollTop = element.scrollHeight;
      }
    });
  }, [userHasScrolledUp]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, sending, scrollToBottom]);

  const handleChatScroll = useCallback(() => {
    setUserHasScrolledUp(!isAtBottom());
  }, [isAtBottom]);

  const openConversation = useCallback(async (conversation: ChatConversation) => {
    await loadConversation(conversation.id, { showOverlay: true });
  }, [loadConversation]);

  const startNewConversation = useCallback(() => {
    streamAbortControllerRef.current?.abort();
    conversationRequestRef.current += 1;
    hydratedFromUrlRef.current = false;
    conversationOverlayLoadingRequestRef.current = 0;
    clearConversationOverlayLoadingShowTimer();
    clearConversationOverlayLoadingHideTimer();
    setActiveConversationId(undefined);
    setAttachments([]);
    setMessages([]);
    setIsResolvingConversation(false);
    setConversationOverlayLoadingVisible(false);
    setUserHasScrolledUp(false);
    syncConversationUrl(null);
  }, [
    clearConversationOverlayLoadingHideTimer,
    clearConversationOverlayLoadingShowTimer,
    setConversationOverlayLoadingVisible,
    syncConversationUrl,
  ]);

  const addAttachments = useCallback(async (files: File[], options?: { maxCount?: number }) => {
    const attachmentLimit = options?.maxCount ?? maxAttachmentCount;
    const remainingSlots = attachmentLimit - attachments.length;
    if (remainingSlots <= 0) {
      message.warning(`最多添加 ${attachmentLimit} 个附件`);
      return [];
    }

    const acceptedFiles = files.slice(0, remainingSlots).filter((file) => {
      if (file.size > maxAttachmentBytes) {
        message.warning(`${file.name} 超过 ${maxAttachmentSizeMb}MB，已跳过`);
        return false;
      }
      return true;
    });

    try {
      const nextAttachments = await Promise.all(acceptedFiles.map((file) => uploadChatAttachment(file)));
      setAttachments((items) => [...items, ...nextAttachments]);
      return nextAttachments;
    } catch (error) {
      message.error(error instanceof Error ? error.message : '附件添加失败');
      return [];
    }
  }, [attachments.length]);

  const removeAttachment = useCallback((attachmentId: string) => {
    setAttachments((items) => items.filter((item) => item.id !== attachmentId));
  }, []);

  const updateConversationTitle = useCallback(async (conversationId: string, title: string) => {
    const updated = await renameChatConversation(conversationId, title);
    setConversations((items) => items.map((item) => (item.id === updated.id ? updated : item)));
    await refreshConversations();
    return updated;
  }, [refreshConversations]);

  const removeConversation = useCallback((conversation: ChatConversation) => {
    Modal.confirm({
      title: '删除会话',
      content: `删除「${conversation.title}」后，该会话和消息记录都会被移除。`,
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      async onOk() {
        await deleteChatConversation(conversation.id);
        if (conversation.id === activeConversationId) {
          startNewConversation();
        }
        await refreshConversations();
        message.success('会话已删除');
      },
    });
  }, [activeConversationId, refreshConversations, startNewConversation]);

  const clearConversationMessages = useCallback((conversation: ChatConversation) => {
    Modal.confirm({
      title: '清空会话',
      content: `清空「${conversation.title}」后，会保留会话入口，但移除当前消息内容。`,
      okText: '清空',
      okButtonProps: { danger: true },
      cancelText: '取消',
      async onOk() {
        await clearChatConversationMessages(conversation.id);
        if (conversation.id === activeConversationId) {
          setMessages([]);
        }
        await refreshConversations();
        message.success('会话已清空');
      },
    });
  }, [activeConversationId, refreshConversations]);

  const sendMessage = useCallback(async (override?: {
    content?: string;
    attachments?: ChatAttachment[];
    clearComposer?: boolean;
    editMessageId?: string;
    capabilityContext?: SendChatPayload['capabilityContext'];
    imageModelConfigId?: string | null;
    requestedCapabilities?: Array<'xingtu_creator_search' | 'image_generation'>;
  }) => {
    const content = (override?.content ?? input).trim();
    const messageAttachments = override?.attachments ?? attachments;
    if ((!content && !messageAttachments.length) || !activeAgent || !currentUser) {
      return;
    }

    const sendingAttachments = messageAttachments;
    const previousMessages = messages;
    const previousConversationId = activeConversationId;
    const editMessageId = override?.editMessageId;
    const editTargetIndex = editMessageId ? messages.findIndex((item) => item.id === editMessageId && item.role === 'user') : -1;
    const baseMessages = editTargetIndex >= 0 ? messages.slice(0, editTargetIndex) : messages;
    const capabilityPayload = resolveChatCapabilityPayload(content);
    const requestedCapabilities = override?.requestedCapabilities || capabilityPayload.requestedCapabilities;
    const isImageGenerationRequest = Boolean(requestedCapabilities?.includes('image_generation'));
    const contentForSend = content || (isImageGenerationRequest ? '' : '请分析附件内容');
    const resolvedCapabilityContext = {
      ...(capabilityPayload.capabilityContext || {}),
      ...(override?.capabilityContext || {}),
    };
    const resolvedImageModelConfigId = override?.imageModelConfigId || null;
    const imageGenerationExpectedCount = isImageGenerationRequest
      ? Math.max(1, resolvedCapabilityContext.imageGeneration?.outputCount || 0)
      : undefined;
    setSending(true);
    setUserHasScrolledUp(false);
    const abortController = new AbortController();
    streamAbortControllerRef.current = abortController;
    const pendingAssistantId = `assistant-pending-${Date.now()}`;
    const optimisticUserMessage: ChatMessage = {
      id: `pending-${Date.now()}`,
      conversationId: activeConversationId || 'pending',
      role: 'user',
      content: contentForSend,
      capabilityContext: isImageGenerationRequest ? resolvedCapabilityContext : undefined,
      imageModelConfigId: isImageGenerationRequest ? resolvedImageModelConfigId : undefined,
      agentId: activeAgent.id,
      attachments: sendingAttachments,
      createdAt: new Date().toISOString(),
    };
    const optimisticAssistantMessage: ChatMessage = {
      id: pendingAssistantId,
      conversationId: activeConversationId || 'pending',
      role: 'assistant',
      content: '',
      capability: isImageGenerationRequest ? 'image_generation' : undefined,
      imageGenerationExpectedCount: isImageGenerationRequest ? imageGenerationExpectedCount : undefined,
      reasoningContent: '',
      agentId: activeAgent.id,
      createdAt: new Date(Date.now() + 1).toISOString(),
      isCompleted: false,
    };
    if (override?.clearComposer !== false) {
      setInput('');
      setAttachments([]);
      setComposerDraftContext(undefined);
      setComposerDraftImageModelConfigId(undefined);
    }
    if (editTargetIndex >= 0) {
      setMessages([
        ...baseMessages,
        {
          ...messages[editTargetIndex]!,
          content: contentForSend,
          attachments: sendingAttachments,
        },
        optimisticAssistantMessage,
      ]);
    } else {
      setMessages((items) => [...items, optimisticUserMessage, optimisticAssistantMessage]);
    }
    scrollToBottom(true);

    try {
      if (isImageGenerationRequest) {
        const result = await createChatMessage({
          userId: currentUser.id,
          conversationId: activeConversationId,
          editMessageId,
          agentId: activeAgent.id,
          attachments: sendingAttachments,
          content: contentForSend,
          ...capabilityPayload,
          capabilityContext: resolvedCapabilityContext,
          imageModelConfigId: resolvedImageModelConfigId,
          requestedCapabilities,
        });
        setInput('');
        setAttachments([]);
        setComposerDraftContext(undefined);
        setComposerDraftImageModelConfigId(undefined);
        setActiveConversationId(result.conversation.id);
        syncConversationUrl(result.conversation.id);
        setMessages((currentMessages) => result.messages.map((messageItem) => {
          const currentMessage = currentMessages.find((item) => item.id === messageItem.id);
          return {
            ...messageItem,
            capability: messageItem.capability ?? currentMessage?.capability,
            generationJobId: messageItem.generationJobId ?? currentMessage?.generationJobId,
            imageGenerationExpectedCount: messageItem.imageGenerationExpectedCount ?? currentMessage?.imageGenerationExpectedCount,
            imageGenerationFailures: messageItem.imageGenerationFailures ?? currentMessage?.imageGenerationFailures,
            creditCost: messageItem.creditCost ?? currentMessage?.creditCost,
          };
        }));
        scrollToBottom(true);
        await refreshConversations();
        return;
      }

      await streamChatMessage(
        {
          userId: currentUser.id,
          conversationId: activeConversationId,
          editMessageId,
          agentId: activeAgent.id,
          attachments: sendingAttachments,
          content: contentForSend,
          ...capabilityPayload,
          capabilityContext: resolvedCapabilityContext,
          imageModelConfigId: resolvedImageModelConfigId,
          requestedCapabilities,
        },
        (event) => {
          if (event.type === 'conversation') {
            setActiveConversationId(event.conversation.id);
            syncConversationUrl(event.conversation.id);
            return;
          }

          if (event.type === 'user_message') {
            setMessages((items) => mergeMessage(items, event.message, optimisticUserMessage.id));
            return;
          }

          if (event.type === 'assistant_message') {
            setMessages((items) => mergeMessage(
              items,
              {
                ...event.message,
                capability: isImageGenerationRequest ? 'image_generation' : event.message.capability,
                generationJobId: event.message.generationJobId,
                imageGenerationExpectedCount: isImageGenerationRequest
                  ? event.message.imageGenerationExpectedCount ?? imageGenerationExpectedCount
                  : event.message.imageGenerationExpectedCount,
              },
              pendingAssistantId,
            ));
            return;
          }

          if (event.type === 'reasoning_delta') {
            setMessages((items) =>
              items.map((item) =>
                item.id === pendingAssistantId || (item.role === 'assistant' && item.isCompleted === false)
                  ? { ...item, reasoningContent: `${item.reasoningContent || ''}${event.delta}` }
                  : item,
              ),
            );
            return;
          }

          if (event.type === 'answer_delta') {
            setMessages((items) =>
              items.map((item) =>
                item.id === pendingAssistantId || (item.role === 'assistant' && item.isCompleted === false)
                  ? { ...item, content: `${item.content}${event.delta}` }
                  : item,
              ),
            );
            return;
          }

          if (event.type === 'done') {
            setInput('');
            setAttachments([]);
            setComposerDraftContext(undefined);
            setComposerDraftImageModelConfigId(undefined);
            setActiveConversationId(event.conversation.id);
            syncConversationUrl(event.conversation.id);
            setMessages((currentMessages) => event.messages.map((messageItem) => {
              const currentMessage = currentMessages.find((item) => item.id === messageItem.id);
              return {
                ...messageItem,
                capability: messageItem.capability ?? currentMessage?.capability,
                generationJobId: messageItem.generationJobId ?? currentMessage?.generationJobId,
                imageGenerationExpectedCount: messageItem.imageGenerationExpectedCount ?? currentMessage?.imageGenerationExpectedCount,
                imageGenerationFailures: messageItem.imageGenerationFailures ?? currentMessage?.imageGenerationFailures,
                creditCost: messageItem.creditCost ?? currentMessage?.creditCost,
              };
            }));
          }
        },
        { signal: abortController.signal },
      );
      scrollToBottom(true);
      await refreshConversations();
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        setMessages((items) =>
          items.map((item) =>
            item.id === pendingAssistantId || (item.role === 'assistant' && item.isCompleted === false)
              ? {
                  ...item,
                  content: item.content || '已停止生成',
                  reasoningContent: item.reasoningContent || null,
                  isCompleted: true,
                }
              : item,
          ),
        );
        await refreshConversations();
        return;
      }

      if (isImageGenerationRequest) {
        const errorMessage = error instanceof Error ? error.message : '图片生成失败';
        const failureCount = Math.max(1, imageGenerationExpectedCount || 0);
        setMessages((items) =>
          items.map((item) =>
            item.id === pendingAssistantId || (item.role === 'assistant' && item.isCompleted === false)
              ? {
                  ...item,
                  capability: 'image_generation',
                  content: imageGenerationFailureContent(errorMessage),
                  imageGenerationExpectedCount: item.imageGenerationExpectedCount ?? failureCount,
                  imageGenerationFailures: Array.from({ length: failureCount }, (_, slotIndex) => ({
                    slotIndex,
                    message: errorMessage,
                  })),
                  reasoningContent: item.reasoningContent || null,
                  isCompleted: true,
                }
              : item,
          ),
        );
        message.error(errorMessage);
        await refreshConversations();
        return;
      }

      setInput(content);
      setAttachments(sendingAttachments);
      setActiveConversationId(previousConversationId);
      syncConversationUrl(previousConversationId || null);
      setMessages(previousMessages);
      message.error(error instanceof Error ? error.message : '消息发送失败');
    } finally {
      if (streamAbortControllerRef.current === abortController) {
        streamAbortControllerRef.current = null;
      }
      setSending(false);
    }
  }, [activeAgent, activeConversationId, attachments, currentUser, input, messages, refreshConversations, scrollToBottom, syncConversationUrl]);

  const sendCurrentMessage = useCallback(async (options?: {
    capabilityContext?: SendChatPayload['capabilityContext'];
    imageModelConfigId?: string | null;
  }) => {
    await sendMessage({
      capabilityContext: options?.capabilityContext,
      imageModelConfigId: options?.imageModelConfigId || null,
      requestedCapabilities: ['image_generation'],
    });
  }, [sendMessage]);

  const sendPresetMessage = useCallback(async (content: string) => {
    await sendMessage({ content, attachments: [], clearComposer: false });
  }, [sendMessage]);

  const updateUserMessage = useCallback(async (messageId: string, content: string) => {
    await sendMessage({
      content,
      attachments: [],
      clearComposer: false,
      editMessageId: messageId,
    });
  }, [sendMessage]);

  const removeMessage = useCallback(async (messageItem: ChatMessage) => {
    if (!messageItem.conversationId || messageItem.conversationId === 'pending') {
      setMessages((items) => items.filter((item) => item.id !== messageItem.id));
      return;
    }
    const result = await deleteChatMessage(messageItem.conversationId, messageItem.id);
    setMessages(result.messages);
    await refreshConversations();
  }, [refreshConversations]);

  const regenerateImageMessage = useCallback(async (messageItem: ChatMessage, assistantMessage?: ChatMessage, currentCreditCost?: number) => {
    const messageAttachments = messageItem.attachments || [];
    const imageAttachments = messageAttachments.filter((attachment) => attachment.kind === 'image');
    const imageGenerationContext = messageItem.capabilityContext?.imageGeneration;
    const nextRegenerationCount = Math.max(0, Number(imageGenerationContext?.regenerationCount) || 0) + 1;
    const accumulatedCreditCost = Math.max(
      Number(currentCreditCost) || 0,
      Number(assistantMessage?.creditCost) || 0,
      Number(imageGenerationContext?.accumulatedCreditCost) || 0,
    );
    const fallbackCapabilityContext: SendChatPayload['capabilityContext'] | undefined = imageAttachments.length
      ? {
          imageGeneration: {
            modeKey: 'upscale',
            modeTitle: '高清放大',
            outputCount: imageAttachments.length,
            referenceGroups: [{
              key: 'source',
              label: '原图',
              required: true,
              attachmentIds: imageAttachments.map((attachment) => attachment.id),
            }],
          },
        }
      : undefined;
    const nextCapabilityContext: SendChatPayload['capabilityContext'] | undefined = messageItem.capabilityContext || fallbackCapabilityContext
      ? {
          ...(messageItem.capabilityContext || fallbackCapabilityContext),
          imageGeneration: {
            ...((messageItem.capabilityContext || fallbackCapabilityContext)?.imageGeneration || {}),
            regenerationCount: nextRegenerationCount,
            accumulatedCreditCost,
          },
        }
      : undefined;
    await sendMessage({
      content: messageItem.content,
      attachments: messageAttachments,
      capabilityContext: nextCapabilityContext,
      clearComposer: false,
      editMessageId: messageItem.id,
      imageModelConfigId: messageItem.imageModelConfigId || null,
      requestedCapabilities: ['image_generation'],
    });
  }, [sendMessage]);

  const continueEditImageMessage = useCallback((messageItem: ChatMessage) => {
    const imageAttachments = (messageItem.attachments || []).filter((attachment) => attachment.kind === 'image');
    if (!imageAttachments.length) {
      message.warning('没有可继续编辑的图片');
      return;
    }
    setAttachments(imageAttachments);
    setInput('');
    setComposerDraftContext(undefined);
    setComposerDraftImageModelConfigId(undefined);
    setContinueEditFocusToken((value) => value + 1);
  }, []);

  const refillComposerFromMessage = useCallback((messageItem: ChatMessage) => {
    const imageGeneration = messageItem.capabilityContext?.imageGeneration;
    const promptHint = imageGeneration?.promptHint?.trim();
    const promptText = imageGeneration?.promptText?.trim() || messageItem.content.trim();
    const nextInput = promptHint && promptText === promptHint ? '' : promptText;
    setInput(nextInput);
    setAttachments(messageItem.attachments || []);
    setComposerDraftContext(messageItem.capabilityContext);
    setComposerDraftImageModelConfigId(messageItem.imageModelConfigId || undefined);
    setContinueEditFocusToken((value) => value + 1);
  }, []);

  const stopSending = useCallback(() => {
    streamAbortControllerRef.current?.abort();
  }, []);

  return {
    activeAgent,
    activeConversation,
    activeConversationId,
    addAttachments,
    attachments,
    composerDraftContext,
    composerDraftImageModelConfigId,
    continueEditFocusToken,
    continueEditImageMessage,
    clearConversationMessages,
    conversationOverlayLoading,
    conversations,
    handleChatScroll,
    hasStreamingAssistant,
    input,
    isResolvingConversation,
    messages,
    openConversation,
    removeAttachment,
    removeMessage,
    removeConversation,
    refillComposerFromMessage,
    scrollContainerRef,
    scrollToBottom,
    sendCurrentMessage,
    sendPresetMessage,
    regenerateImageMessage,
    sending,
    setInput,
    showWelcome: !isResolvingConversation && !conversationOverlayLoading && !activeConversationId && messages.length === 0,
    startNewConversation,
    stopSending,
    updateUserMessage,
    updateConversationTitle,
    userHasScrolledUp,
  };
}
