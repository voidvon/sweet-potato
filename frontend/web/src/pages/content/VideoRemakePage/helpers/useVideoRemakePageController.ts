import { createElement, useCallback, useEffect, useMemo } from 'react';
import { Button, Input, Modal, Upload, message } from 'antd';
import type { UploadFile, UploadProps } from 'antd';
import { RefreshCw } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import {
  cancelVideoRemakeCard,
  confirmVideoRemakeCard,
  createVideoRemakeSession,
  deleteVideoRemakeSession,
  editVideoRemakeCard,
  getVideoRemakeSession,
  listVideoRemakeSessions,
  parseVideoRemakeSessionUrl,
  recoverVideoRemakeCard,
  regenerateVideoRemakeCard,
  regenerateVideoRemakeFinalSegment,
  regenerateVideoRemakeFinalSegments,
  resumeVideoRemakeSession,
  retryVideoRemakeExpert,
  renameVideoRemakeSession,
  runVideoRemakeSession,
  syncVideoRemakeSession,
  sendVideoRemakeChat,
  uploadVideoRemakePipAsset,
  uploadVideoRemakeSessionVideo,
  type VideoRemakeCardMessage,
  type VideoRemakeChatMessage,
  type VideoRemakeSession,
  type VideoRemakeSessionSummary,
} from '../../../../api/video-remake';
import { uploadContentAsset } from '../../../../api/content';
import { API_BASE_URL } from '../../../../api/request';
import type { User } from '../../../../types';
import {
  asRecord,
  cardTypeLabels,
  fieldText,
} from '../videoRemakeCardUtils';
import {
  cardAnchorId,
  isFinalVideoCardStuckAfterSegmentsCompleted,
  isBlockedByResolvingStoryboard,
  isProcessingVideoRemakeSession,
  requestVideoRemakeAssets,
  requestVideoRemakePageData,
  validateCardBeforeConfirm,
} from './videoRemakePageHelpers';
import { useVideoRemakePageState } from './useVideoRemakePageState';
import { withAuthToken } from '../../../../utils/session';
import { useWorkspaceHeader } from '../../../../layouts/ProtectedLayout';

type DownstreamInvalidationChoice = 'confirm' | 'save_only' | 'cancel';
type ConfirmDownstreamInvalidation = (input: {
  card: VideoRemakeCardMessage;
  messages: VideoRemakeChatMessage[];
  actionText: string;
  includePlanned?: boolean;
  allowSaveOnly?: boolean;
}) => Promise<DownstreamInvalidationChoice>;
type ConfirmFinalVideoRegeneration = (versionLabel: string) => Promise<boolean>;

type VideoRemakePageControllerOptions = {
  currentUser: User;
  confirmDownstreamInvalidation: ConfirmDownstreamInvalidation;
  confirmFinalVideoRegeneration: ConfirmFinalVideoRegeneration;
};

const MAX_CONCURRENT_VIDEO_REMAKE_SESSIONS = 8;

function isConfirmedCardEdit(card: VideoRemakeCardMessage) {
  return card.status === 'confirmed' || asRecord(card.data).editingFromConfirmed === true;
}

function latestCardIdOfType(messages: VideoRemakeChatMessage[], cardType?: VideoRemakeCardMessage['cardType']) {
  if (!cardType) {
    return '';
  }
  return [...messages]
    .reverse()
    .find((item): item is VideoRemakeCardMessage => item.type === 'card' && item.cardType === cardType)?.cardId || '';
}

export function useVideoRemakePageController({
  currentUser,
  confirmDownstreamInvalidation,
  confirmFinalVideoRegeneration,
}: VideoRemakePageControllerOptions) {
  const { setHeaderExtra } = useWorkspaceHeader();
  const [searchParams, setSearchParams] = useSearchParams();
  const urlSessionId = searchParams.get('sessionId')?.trim() || '';
  const {
    sessions,
    setSessions,
    assets,
    setAssets,
    groups,
    setGroups,
    activeSession,
    setActiveSession,
    showStartPanel,
    setShowStartPanel,
    chatInput,
    setChatInput,
    sourceUrl,
    setSourceUrl,
    startMode,
    setStartMode,
    selectedVideoFile,
    setSelectedVideoFile,
    isLoading,
    setIsLoading,
    isResolvingUrlSession,
    setIsResolvingUrlSession,
    sessionOverlayLoading,
    setSessionOverlayLoading,
    workingSessionId,
    setWorkingSessionId,
    syncingSessionId,
    setSyncingSessionId,
    highlightCardId,
    setHighlightCardId,
    cardDrafts,
    setCardDrafts,
    activeSessionRef,
    scrollRef,
    threadRef,
    bottomAnchorRef,
    skipNextAutoScrollRef,
    preservedScrollTopRef,
    shouldStickToBottomRef,
    autoScrollFrameRef,
    assetsLoadedRef,
    loadDataRequestRef,
    loadSessionDetailRequestRef,
    deletingSessionIdsRef,
    sessionOverlayLoadingRequestRef,
    sessionOverlayLoadingShowTimerRef,
    sessionOverlayLoadingHideTimerRef,
    sessionOverlayLoadingVisibleRef,
    sessionOverlayLoadingShownAtRef,
    initialLoadUserIdRef,
    urlSessionIdRef,
    uploadLimitWarningAtRef,
    autoSyncFinalVideoSessionIdsRef,
  } = useVideoRemakePageState(urlSessionId);

  useEffect(() => {
    activeSessionRef.current = activeSession;
  }, [activeSession]);

  useEffect(() => {
    urlSessionIdRef.current = urlSessionId;
  }, [urlSessionId]);

  useEffect(() => {
    setIsResolvingUrlSession(Boolean(urlSessionId));
  }, [urlSessionId]);

  useEffect(() => () => {
    if (sessionOverlayLoadingShowTimerRef.current !== null) {
      window.clearTimeout(sessionOverlayLoadingShowTimerRef.current);
    }
    if (sessionOverlayLoadingHideTimerRef.current !== null) {
      window.clearTimeout(sessionOverlayLoadingHideTimerRef.current);
    }
  }, []);

  const syncSessionUrl = useCallback((sessionId?: string | null) => {
    urlSessionIdRef.current = sessionId || '';
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (sessionId) {
        next.set('sessionId', sessionId);
      } else {
        next.delete('sessionId');
      }
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const selectActiveSession = useCallback((session: VideoRemakeSession | null, options?: { syncUrl?: boolean }) => {
    activeSessionRef.current = session;
    setActiveSession(session);
    setCardDrafts((current) => {
      if (!session) {
        return {};
      }
      const validCardIds = new Set(
        session.messages
          .filter((item): item is VideoRemakeCardMessage => item.type === 'card' && item.status === 'editing')
          .map((item) => item.cardId),
      );
      const next: Record<string, unknown> = {};
      for (const [cardId, draft] of Object.entries(current)) {
        if (validCardIds.has(cardId)) {
          next[cardId] = draft;
        }
      }
      return next;
    });
    if (session) {
      setShowStartPanel(false);
    }
    if (options?.syncUrl !== false) {
      syncSessionUrl(session?.id || null);
    }
  }, [syncSessionUrl]);

  const setSessionOverlayLoadingVisible = useCallback((visible: boolean) => {
    sessionOverlayLoadingVisibleRef.current = visible;
    sessionOverlayLoadingShownAtRef.current = visible ? Date.now() : null;
    setSessionOverlayLoading(visible);
  }, []);

  const clearSessionOverlayLoadingShowTimer = useCallback(() => {
    if (sessionOverlayLoadingShowTimerRef.current !== null) {
      window.clearTimeout(sessionOverlayLoadingShowTimerRef.current);
      sessionOverlayLoadingShowTimerRef.current = null;
    }
  }, []);

  const clearSessionOverlayLoadingHideTimer = useCallback(() => {
    if (sessionOverlayLoadingHideTimerRef.current !== null) {
      window.clearTimeout(sessionOverlayLoadingHideTimerRef.current);
      sessionOverlayLoadingHideTimerRef.current = null;
    }
  }, []);

  const startSessionOverlayLoading = useCallback((requestId: number) => {
    sessionOverlayLoadingRequestRef.current = requestId;
    clearSessionOverlayLoadingHideTimer();
    clearSessionOverlayLoadingShowTimer();
    if (sessionOverlayLoadingVisibleRef.current) {
      return;
    }
    sessionOverlayLoadingShowTimerRef.current = window.setTimeout(() => {
      sessionOverlayLoadingShowTimerRef.current = null;
      if (sessionOverlayLoadingRequestRef.current !== requestId) {
        return;
      }
      setSessionOverlayLoadingVisible(true);
    }, 1000);
  }, [clearSessionOverlayLoadingHideTimer, clearSessionOverlayLoadingShowTimer, setSessionOverlayLoadingVisible]);

  const stopSessionOverlayLoading = useCallback((requestId: number) => {
    if (sessionOverlayLoadingRequestRef.current !== requestId) {
      return;
    }
    clearSessionOverlayLoadingShowTimer();
    if (!sessionOverlayLoadingVisibleRef.current) {
      sessionOverlayLoadingRequestRef.current = 0;
      return;
    }
    const shownAt = sessionOverlayLoadingShownAtRef.current ?? Date.now();
    const remaining = Math.max(500 - (Date.now() - shownAt), 0);
    const finish = () => {
      if (sessionOverlayLoadingRequestRef.current !== requestId) {
        return;
      }
      sessionOverlayLoadingRequestRef.current = 0;
      clearSessionOverlayLoadingHideTimer();
      setSessionOverlayLoadingVisible(false);
    };
    clearSessionOverlayLoadingHideTimer();
    if (remaining > 0) {
      sessionOverlayLoadingHideTimerRef.current = window.setTimeout(finish, remaining);
      return;
    }
    finish();
  }, [clearSessionOverlayLoadingHideTimer, clearSessionOverlayLoadingShowTimer, setSessionOverlayLoadingVisible]);

  const loadSessionDetail = useCallback(async (sessionId: string, options?: { silent?: boolean; syncUrl?: boolean; showOverlay?: boolean }) => {
    if (deletingSessionIdsRef.current.has(sessionId)) {
      return null;
    }
    const requestId = loadSessionDetailRequestRef.current + 1;
    loadSessionDetailRequestRef.current = requestId;
    try {
      if (!options?.silent) {
        setIsLoading(true);
      }
      if (options?.showOverlay) {
        startSessionOverlayLoading(requestId);
      }
      const session = await getVideoRemakeSession(sessionId);
      if (requestId !== loadSessionDetailRequestRef.current) {
        return null;
      }
      selectActiveSession(session, { syncUrl: options?.syncUrl });
      if (urlSessionIdRef.current === sessionId) {
        setIsResolvingUrlSession(false);
      }
      return session;
    } catch (error) {
      if (urlSessionIdRef.current === sessionId) {
        setIsResolvingUrlSession(false);
      }
      if (!deletingSessionIdsRef.current.has(sessionId)) {
        message.error(error instanceof Error ? error.message : '会话详情加载失败');
      }
      return null;
    } finally {
      if (options?.showOverlay) {
        stopSessionOverlayLoading(requestId);
      }
      if (!options?.silent && requestId === loadSessionDetailRequestRef.current) {
        setIsLoading(false);
      }
    }
  }, [selectActiveSession, startSessionOverlayLoading, stopSessionOverlayLoading]);

  const replaceSession = useCallback((session: VideoRemakeSession) => {
    selectActiveSession(session);
    setSessions((items) => items.map((item) => (item.id === session.id ? { ...item, ...session } : item)));
  }, [selectActiveSession]);
  const clearCardDraft = (cardId: string) => {
    setCardDrafts((current) => {
      if (!Object.prototype.hasOwnProperty.call(current, cardId)) {
        return current;
      }
      const { [cardId]: _removed, ...rest } = current;
      return rest;
    });
  };
  const handleCardDraftChange = (card: VideoRemakeCardMessage, value: unknown | ((current: unknown) => unknown)) => {
    setCardDrafts((current) => {
      const previous = Object.prototype.hasOwnProperty.call(current, card.cardId) ? current[card.cardId] : card.data;
      const nextDraft = typeof value === 'function'
        ? (value as (current: unknown) => unknown)(previous)
        : value;
      return { ...current, [card.cardId]: nextDraft };
    });
  };
  const updateActiveSession = (updater: (current: VideoRemakeSession | null) => VideoRemakeSession | null) => {
    setActiveSession((current) => {
      const next = updater(current);
      activeSessionRef.current = next;
      return next;
    });
  };

  const startSessionWorking = (sessionId?: string) => setWorkingSessionId(sessionId || '__start__');
  const stopSessionWorking = (sessionId?: string) => {
    setWorkingSessionId((current) => (current === (sessionId || '__start__') ? '' : current));
  };
  const preserveCurrentScrollPosition = () => {
    preservedScrollTopRef.current = scrollRef.current?.scrollTop ?? null;
    skipNextAutoScrollRef.current = true;
  };
  const releasePreservedScrollPosition = () => {
    const scrollTop = preservedScrollTopRef.current;
    if (scrollTop === null) {
      return;
    }
    window.requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollTop, behavior: 'auto' });
      window.requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({ top: scrollTop, behavior: 'auto' });
        preservedScrollTopRef.current = null;
      });
    });
  };
  const isNearBottom = useCallback((element: HTMLDivElement, threshold = 24) => (
    element.scrollHeight - element.scrollTop - element.clientHeight <= threshold
  ), []);
  const scrollToThreadBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    const bottomAnchor = bottomAnchorRef.current;
    if (bottomAnchor) {
      bottomAnchor.scrollIntoView({ behavior, block: 'end' });
      return;
    }
    const scrollElement = scrollRef.current;
    if (scrollElement) {
      scrollElement.scrollTo({ top: scrollElement.scrollHeight, behavior });
    }
  }, []);
  const scheduleStickToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    if (preservedScrollTopRef.current !== null || highlightCardId) {
      return;
    }
    if (!shouldStickToBottomRef.current) {
      return;
    }
    if (autoScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(autoScrollFrameRef.current);
    }
    autoScrollFrameRef.current = window.requestAnimationFrame(() => {
      autoScrollFrameRef.current = null;
      scrollToThreadBottom(behavior);
    });
  }, [highlightCardId, scrollToThreadBottom]);
  const activeSessionWorking = Boolean(activeSession && workingSessionId === activeSession.id);
  const activeSessionSyncing = Boolean(activeSession && syncingSessionId === activeSession.id);
  const startWorking = workingSessionId === '__start__';
  const shouldShowStartContent = showStartPanel && !isLoading && !isResolvingUrlSession;
  const shouldShowWorkspaceLoading = isLoading || isResolvingUrlSession || (!showStartPanel && !activeSession);
  const processingSessionCount = useMemo(() => (
    sessions.filter((session) => isProcessingVideoRemakeSession(session.status)).length
  ), [sessions]);
  const canStartMoreSessions = processingSessionCount < MAX_CONCURRENT_VIDEO_REMAKE_SESSIONS;

  const showConcurrentLimitWarning = useCallback(() => {
    const now = Date.now();
    if (now - uploadLimitWarningAtRef.current < 300) {
      return;
    }
    uploadLimitWarningAtRef.current = now;
    Modal.warning({
      centered: true,
      title: '暂时无法上传',
      content: `正在处理${processingSessionCount}个视频，请稍候再试`,
      okText: '知道了',
    });
  }, [processingSessionCount]);

  const ensureAssetsLoaded = useCallback(async (force = false) => {
    if (assetsLoadedRef.current && !force) {
      return;
    }
    try {
      const { groupList, assetList } = await requestVideoRemakeAssets(currentUser.id);
      setGroups(groupList);
      setAssets(assetList);
      assetsLoadedRef.current = true;
    } catch (error) {
      setGroups([]);
      setAssets([]);
      message.warning(error instanceof Error ? error.message : '素材库加载失败');
    }
  }, [currentUser.id]);

  const handleUploadReferenceImage = useCallback(async (kind: 'scene' | 'product', file: File) => {
    const asset = await uploadContentAsset({
      file,
      userId: currentUser.id,
      resourceType: kind,
      name: file.name,
      metadata: {
        source: 'local_upload',
        uploadedFrom: 'video_remake',
      },
    });
    assetsLoadedRef.current = false;
    await ensureAssetsLoaded(true);
    return asset;
  }, [currentUser.id, ensureAssetsLoaded]);

  const loadData = useCallback(async (options?: { silent?: boolean; force?: boolean }) => {
    const requestId = loadDataRequestRef.current + 1;
    loadDataRequestRef.current = requestId;
    try {
      if (!options?.silent) {
        setIsLoading(true);
      }
      const sessionList = options?.force
        ? await listVideoRemakeSessions(currentUser.id)
        : await requestVideoRemakePageData(currentUser.id);
      if (requestId !== loadDataRequestRef.current) {
        return;
      }
      setSessions(sessionList);
      const currentActive = activeSessionRef.current;
      if (currentActive) {
        const refreshed = sessionList.find((item) => item.id === currentActive.id);
        if (!refreshed) {
          selectActiveSession(null, { syncUrl: false });
          setShowStartPanel(true);
          setHighlightCardId('');
        } else {
          updateActiveSession((current) => (current && current.id === refreshed.id ? { ...current, ...refreshed } : current));
        }
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : '爆款复刻工作流加载失败');
    } finally {
      if (requestId === loadDataRequestRef.current) {
        setIsLoading(false);
      }
    }
  }, [currentUser.id, selectActiveSession]);

  useEffect(() => {
    if (initialLoadUserIdRef.current === currentUser.id) {
      return;
    }
    initialLoadUserIdRef.current = currentUser.id;
    void loadData();
  }, [currentUser.id, loadData]);

  useEffect(() => {
    if (!urlSessionId) {
      setIsResolvingUrlSession(false);
      return;
    }
    const matched = sessions.find((item) => item.id === urlSessionId);
    if (!matched) {
      if (sessions.length > 0 || !isLoading) {
        setIsResolvingUrlSession(false);
      }
      if (activeSessionRef.current?.id === urlSessionId) {
        selectActiveSession(null, { syncUrl: false });
        setShowStartPanel(true);
      }
      return;
    }
    const currentActive = activeSessionRef.current;
    if (!currentActive || currentActive.id !== matched.id) {
      void loadSessionDetail(matched.id, { silent: true, showOverlay: true });
      setHighlightCardId('');
      return;
    }
    setIsResolvingUrlSession(false);
    updateActiveSession((current) => (current && current.id === matched.id ? { ...current, ...matched } : current));
  }, [isLoading, loadSessionDetail, selectActiveSession, sessions, urlSessionId]);

  useEffect(() => {
    setHeaderExtra(
      createElement(Button, {
        icon: createElement(RefreshCw, { size: 15 }),
        loading: isLoading,
        onClick: () => void loadData(),
      }, '刷新'),
    );

    return () => {
      setHeaderExtra(null);
    };
  }, [isLoading, loadData, setHeaderExtra]);

  useEffect(() => {
    const source = new EventSource(withAuthToken(`${API_BASE_URL}/api/video-remake/events`));
    const handleWorkflow = (event: MessageEvent<string>) => {
      const payload = (() => {
        try {
          return JSON.parse(event.data || '{}') as { type?: string; sessionId?: string };
        } catch {
          return {};
        }
      })();
      const eventSessionId = fieldText(payload.sessionId);
      const activeSessionId = activeSessionRef.current?.id || '';
      if (eventSessionId && activeSessionId && eventSessionId !== activeSessionId) {
        void loadData({ silent: true, force: true });
        return;
      }
      void loadData({ silent: true, force: true });
      const sessionId = eventSessionId || activeSessionId;
      if (sessionId && !deletingSessionIdsRef.current.has(sessionId)) {
        void loadSessionDetail(sessionId, { silent: true });
        if (payload.type === 'workflow.done') {
          window.setTimeout(() => {
            if (!deletingSessionIdsRef.current.has(sessionId)) {
              void loadSessionDetail(sessionId, { silent: true });
            }
          }, 800);
        }
      }
    };
    source.addEventListener('workflow', handleWorkflow);
    return () => {
      source.removeEventListener('workflow', handleWorkflow);
      source.close();
    };
  }, [currentUser.id, loadData, loadSessionDetail]);

  useEffect(() => {
    const session = activeSession;
    if (!session || deletingSessionIdsRef.current.has(session.id)) {
      return;
    }
    const stuckFinalVideo = session.messages.find((item): item is VideoRemakeCardMessage => (
      item.type === 'card' && isFinalVideoCardStuckAfterSegmentsCompleted(item)
    ));
    if (!stuckFinalVideo || autoSyncFinalVideoSessionIdsRef.current.has(session.id)) {
      return;
    }
    autoSyncFinalVideoSessionIdsRef.current.add(session.id);
    void (async () => {
      try {
        const synced = await syncVideoRemakeSession(session.id);
        replaceSession(synced);
        await loadData({ silent: true, force: true });
      } catch (error) {
        console.warn('video remake final video auto sync failed', error);
      } finally {
        window.setTimeout(() => {
          autoSyncFinalVideoSessionIdsRef.current.delete(session.id);
        }, 10_000);
      }
    })();
  }, [activeSession, loadData, replaceSession]);

  const activeMessages = useMemo(() => (
    (activeSession?.messages || []).filter((item) => !(
      item.type === 'card'
      && item.cardType === 'generation_progress'
      && fieldText(asRecord(item.data).kind) === 'video_generation'
    ))
  ), [activeSession?.messages]);

  useEffect(() => {
    if (preservedScrollTopRef.current !== null) {
      scrollRef.current?.scrollTo({ top: preservedScrollTopRef.current, behavior: 'auto' });
      return;
    }
    if (skipNextAutoScrollRef.current) {
      skipNextAutoScrollRef.current = false;
      return;
    }
    if (!highlightCardId) {
      shouldStickToBottomRef.current = true;
      scrollToThreadBottom('auto');
      return;
    }
    const nextFrame = window.requestAnimationFrame(() => {
      const node = document.getElementById(cardAnchorId(highlightCardId));
      node?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    return () => window.cancelAnimationFrame(nextFrame);
  }, [activeMessages, highlightCardId, scrollToThreadBottom]);

  useEffect(() => {
    const scrollElement = scrollRef.current;
    const threadElement = threadRef.current;
    if (!scrollElement || !threadElement) {
      return;
    }
    const handleScroll = () => {
      shouldStickToBottomRef.current = isNearBottom(scrollElement);
    };
    handleScroll();
    scrollElement.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      scrollElement.removeEventListener('scroll', handleScroll);
    };
  }, [isNearBottom, activeSession?.id]);

  useEffect(() => {
    const threadElement = threadRef.current;
    if (!threadElement) {
      return;
    }
    const observer = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => {
        scheduleStickToBottom();
      });
    observer?.observe(threadElement);
    const mutationObserver = typeof MutationObserver === 'undefined'
      ? null
      : new MutationObserver(() => {
        scheduleStickToBottom();
      });
    mutationObserver?.observe(threadElement, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['style', 'class', 'src', 'poster'],
    });
    const handleAsyncLayout = () => {
      scheduleStickToBottom();
    };
    threadElement.addEventListener('load', handleAsyncLayout, true);
    threadElement.addEventListener('loadedmetadata', handleAsyncLayout, true);
    threadElement.addEventListener('loadeddata', handleAsyncLayout, true);
    threadElement.addEventListener('canplay', handleAsyncLayout, true);
    return () => {
      observer?.disconnect();
      mutationObserver?.disconnect();
      threadElement.removeEventListener('load', handleAsyncLayout, true);
      threadElement.removeEventListener('loadedmetadata', handleAsyncLayout, true);
      threadElement.removeEventListener('loadeddata', handleAsyncLayout, true);
      threadElement.removeEventListener('canplay', handleAsyncLayout, true);
      if (autoScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(autoScrollFrameRef.current);
        autoScrollFrameRef.current = null;
      }
    };
  }, [activeSession?.id, scheduleStickToBottom]);

  const currentVideoDurationSeconds = useMemo(() => {
    const workflow = asRecord(activeSession?.workflow);
    const artifacts = asRecord(workflow.artifacts);
    const videoBasicInfo = asRecord(artifacts.videoBasicInfo || activeSession?.artifacts?.video_basic_info);
    const duration = Number(videoBasicInfo.durationSeconds || 0);
    return Number.isFinite(duration) && duration > 0 ? duration : undefined;
  }, [activeSession]);

  const currentVideoAspectRatio = useMemo(() => {
    const workflow = asRecord(activeSession?.workflow);
    const artifacts = asRecord(workflow.artifacts);
    const videoBasicInfo = asRecord(artifacts.videoBasicInfo || activeSession?.artifacts?.video_basic_info);
    return fieldText(videoBasicInfo.aspectRatio);
  }, [activeSession]);

  const handleNewSession = async () => {
    selectActiveSession(null);
    setShowStartPanel(true);
    setHighlightCardId('');
    setSourceUrl('');
    setChatInput('');
    setStartMode('upload');
    setSelectedVideoFile(null);
  };

  const handleRenameSession = (session: VideoRemakeSessionSummary) => {
    const currentName = session.filename || '未命名复刻';
    let nextName = currentName;
    Modal.confirm({
      title: '编辑名称',
      content: createElement(Input, {
        autoFocus: true,
        defaultValue: currentName,
        onChange: (event) => {
          nextName = event.target.value;
        },
        onPressEnter: () => {
          const okButton = document.querySelector<HTMLElement>('.ant-modal-confirm-btns .ant-btn-primary');
          okButton?.click();
        },
        placeholder: '请输入会话名称',
      }),
      okText: '保存',
      cancelText: '取消',
      async onOk() {
        const filename = nextName.trim();
        if (!filename) {
          message.warning('会话名称不能为空');
          throw new Error('会话名称不能为空');
        }
        const updated = await renameVideoRemakeSession(session.id, { userId: currentUser.id, filename });
        setSessions((items) => items.map((item) => (item.id === updated.id ? { ...item, ...updated } : item)));
        if (activeSessionRef.current?.id === updated.id) {
          selectActiveSession(updated);
        }
        message.success('名称已更新');
      },
    });
  };

  const handleDeleteSession = (session: VideoRemakeSessionSummary) => {
    Modal.confirm({
      title: '删除会话',
      content: `确定删除「${session.filename || '未命名复刻'}」吗？`,
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      async onOk() {
        deletingSessionIdsRef.current.add(session.id);
        loadSessionDetailRequestRef.current += 1;
        try {
          await deleteVideoRemakeSession(session.id, { userId: currentUser.id });
          setSessions((items) => items.filter((item) => item.id !== session.id));
          if (activeSessionRef.current?.id === session.id) {
            selectActiveSession(null);
            setShowStartPanel(true);
            setHighlightCardId('');
          }
          await loadData({ silent: true });
          message.success('会话已删除');
        } finally {
          deletingSessionIdsRef.current.delete(session.id);
        }
      },
    });
  };

  const uploadProps: UploadProps = {
    accept: 'video/*',
    fileList: selectedVideoFile ? [{
      uid: `${selectedVideoFile.name}-${selectedVideoFile.lastModified}`,
      name: selectedVideoFile.name,
      status: 'done',
    } satisfies UploadFile] : [],
    maxCount: 1,
    onRemove() {
      setSelectedVideoFile(null);
      return true;
    },
    showUploadList: false,
    beforeUpload(file) {
      if (!canStartMoreSessions) {
        showConcurrentLimitWarning();
        return Upload.LIST_IGNORE;
      }
      setSelectedVideoFile(file);
      return false;
    },
    onDrop(event) {
      if (!canStartMoreSessions) {
        event.preventDefault();
        showConcurrentLimitWarning();
      }
    },
  };

  const handleStartUploadParse = async () => {
    if (!selectedVideoFile) {
      return;
    }
    if (!canStartMoreSessions) {
      showConcurrentLimitWarning();
      return;
    }
    try {
      startSessionWorking();
      const session = await createVideoRemakeSession({ userId: currentUser.id, filename: selectedVideoFile.name });
      const uploaded = await uploadVideoRemakeSessionVideo(session.id, { userId: currentUser.id, file: selectedVideoFile });
      setSelectedVideoFile(null);
      selectActiveSession(uploaded);
      setHighlightCardId('');
      await loadData({ silent: true });
      const running = await runVideoRemakeSession(uploaded.id);
      selectActiveSession(running);
      if (running.status === 'waiting_credit') {
        message.warning('当前积分不足，已暂停在下一步执行前，请充值后继续。');
      }
      await loadData({ silent: true });
    } catch (error) {
      message.error(error instanceof Error ? error.message : '视频上传失败');
    } finally {
      stopSessionWorking();
    }
  };

  const handleUploadPipImage = async (file: File) => {
    if (!activeSession) {
      throw new Error('请先选择会话');
    }
    if (!file.type.startsWith('image/')) {
      throw new Error('画中画素材只能上传图片');
    }
    try {
      return await uploadVideoRemakePipAsset(activeSession.id, { userId: currentUser.id, file });
    } catch (error) {
      message.error(error instanceof Error ? error.message : '画中画图片上传失败');
      throw error;
    }
  };

  const handleParseUrl = async () => {
    const url = sourceUrl.trim();
    if (!url) {
      return;
    }
    try {
      startSessionWorking();
      const session = await createVideoRemakeSession({ userId: currentUser.id });
      const parsed = await parseVideoRemakeSessionUrl(session.id, { userId: currentUser.id, url });
      setSourceUrl('');
      selectActiveSession(parsed);
      setHighlightCardId('');
      await loadData({ silent: true });
      const running = await runVideoRemakeSession(parsed.id);
      selectActiveSession(running);
      if (running.status === 'waiting_credit') {
        message.warning('当前积分不足，已暂停在下一步执行前，请充值后继续。');
      }
      await loadData({ silent: true });
    } catch (error) {
      message.error(error instanceof Error ? error.message : '视频链接解析失败');
    } finally {
      stopSessionWorking();
    }
  };

  const handleSend = async (overrideContent?: string) => {
    const content = (overrideContent ?? chatInput).trim();
    if (!content || !activeSession) {
      return;
    }
    const sessionId = activeSession.id;
    try {
      startSessionWorking(sessionId);
      setHighlightCardId('');
      setChatInput('');
      const result = await sendVideoRemakeChat(sessionId, { userId: currentUser.id, message: content });
      selectActiveSession(result.session);
      const targetCardId = latestCardIdOfType(result.session.messages, result.intent.target);
      setHighlightCardId(targetCardId);
      await loadData({ silent: true });
    } catch (error) {
      message.error(error instanceof Error ? error.message : '消息发送失败');
    } finally {
      stopSessionWorking(sessionId);
    }
  };

  const handleResumeBlockedSession = async () => {
    if (!activeSession) {
      return;
    }
    const sessionId = activeSession.id;
    try {
      startSessionWorking(sessionId);
      const resumed = await resumeVideoRemakeSession(sessionId);
      selectActiveSession(resumed);
      if (resumed.status === 'waiting_credit') {
        message.warning('积分仍不足，暂时还不能继续下一步。');
      }
      await loadData({ silent: true });
    } catch (error) {
      message.error(error instanceof Error ? error.message : '继续执行失败');
    } finally {
      stopSessionWorking(sessionId);
    }
  };

  const handleSyncSession = async () => {
    if (!activeSession) {
      return;
    }
    const sessionId = activeSession.id;
    try {
      setSyncingSessionId(sessionId);
      const synced = await syncVideoRemakeSession(sessionId);
      selectActiveSession(synced);
      setSessions((items) => items.map((item) => (item.id === synced.id ? { ...item, ...synced } : item)));
      await loadData({ silent: true });
      message.success('已同步最新进度');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '进度同步失败');
    } finally {
      setSyncingSessionId((current) => (current === sessionId ? '' : current));
    }
  };

  const handleConfirmCard = async (card: VideoRemakeCardMessage, data: unknown) => {
    if (!activeSession) {
      return;
    }
    if (isBlockedByResolvingStoryboard(card, activeSession.messages)) {
      message.warning('分镜脚本解析中，请等待完成后再修改提示词。');
      return;
    }
    const validationError = validateCardBeforeConfirm(card, data);
    if (validationError) {
      message.warning(validationError);
      return;
    }
    if (card.cardType !== 'llm_thinking') {
      const invalidationChoice = await confirmDownstreamInvalidation({
        card,
        messages: activeSession.messages,
        actionText: `确认${cardTypeLabels[card.cardType]}`,
        allowSaveOnly: isConfirmedCardEdit(card),
      });
      if (invalidationChoice === 'cancel') {
        return;
      }
      const saveOnly = invalidationChoice === 'save_only';
      const sessionId = activeSession.id;
      if (saveOnly) {
        preserveCurrentScrollPosition();
      } else {
        skipNextAutoScrollRef.current = true;
      }
      setHighlightCardId('');
      startSessionWorking(sessionId);
      try {
        const session = await confirmVideoRemakeCard(sessionId, card.cardId, {
          userId: currentUser.id,
          cardType: card.cardType,
          data,
          mode: saveOnly ? 'save_only' : 'confirm',
        });
        clearCardDraft(card.cardId);
        selectActiveSession(session);
        setSessions((items) => items.map((item) => (item.id === session.id ? { ...item, ...session } : item)));
        await loadData({ silent: true });
      } catch (error) {
        message.error(error instanceof Error ? error.message : '卡片确认失败');
      } finally {
        stopSessionWorking(sessionId);
        if (saveOnly) {
          releasePreservedScrollPosition();
        }
      }
      return;
    }
    const sessionId = activeSession.id;
    skipNextAutoScrollRef.current = true;
    setHighlightCardId('');
    startSessionWorking(sessionId);
    try {
      const session = await confirmVideoRemakeCard(sessionId, card.cardId, {
        userId: currentUser.id,
        cardType: card.cardType,
        data,
      });
      clearCardDraft(card.cardId);
      selectActiveSession(session);
      setSessions((items) => items.map((item) => (item.id === session.id ? { ...item, ...session } : item)));
      await loadData({ silent: true });
    } catch (error) {
      message.error(error instanceof Error ? error.message : '卡片确认失败');
    } finally {
      stopSessionWorking(sessionId);
    }
  };

  const handleCancelCard = async (card: VideoRemakeCardMessage) => {
    if (!activeSession) {
      return;
    }
    const sessionId = activeSession.id;
    preserveCurrentScrollPosition();
    setHighlightCardId('');
    startSessionWorking(sessionId);
    try {
      const session = await cancelVideoRemakeCard(sessionId, card.cardId, { userId: currentUser.id });
      clearCardDraft(card.cardId);
      selectActiveSession(session);
      await loadData({ silent: true });
    } catch (error) {
      message.error(error instanceof Error ? error.message : '卡片取消失败');
    } finally {
      stopSessionWorking(sessionId);
      releasePreservedScrollPosition();
    }
  };

  const handleEditCard = async (card: VideoRemakeCardMessage) => {
    if (!activeSession) {
      return;
    }
    if (isBlockedByResolvingStoryboard(card, activeSession.messages)) {
      message.warning('分镜脚本解析中，请等待完成后再修改提示词。');
      return;
    }
    const sessionId = activeSession.id;
    setHighlightCardId(card.cardId);
    startSessionWorking(sessionId);
    try {
      const session = await editVideoRemakeCard(sessionId, card.cardId, { userId: currentUser.id });
      const editingCard = session.messages.find((item): item is VideoRemakeCardMessage => (
        item.type === 'card'
        && item.cardId === card.cardId
        && item.status === 'editing'
      ));
      if (editingCard) {
        handleCardDraftChange(editingCard, editingCard.data);
      }
      selectActiveSession(session);
      setSessions((items) => items.map((item) => (item.id === session.id ? { ...item, ...session } : item)));
      await loadData({ silent: true });
    } catch (error) {
      message.error(error instanceof Error ? error.message : '卡片编辑失败');
    } finally {
      stopSessionWorking(sessionId);
    }
  };

  const handleRegenerateCard = async (card: VideoRemakeCardMessage, instruction?: string) => {
    if (!activeSession) {
      return;
    }
    const sessionBeforeRegenerate = activeSession;
    const confirmed = card.cardType === 'final_video'
      ? await confirmFinalVideoRegeneration(fieldText(asRecord(card.data).versionLabel || asRecord(card.data).version))
      : await confirmDownstreamInvalidation({
        card,
        messages: activeSession.messages,
        actionText: `重新生成${cardTypeLabels[card.cardType]}`,
        includePlanned: true,
      });
    if (!confirmed || confirmed === 'cancel') {
      return;
    }
    const sessionId = activeSession.id;
    setHighlightCardId('');
    if (card.cardType === 'final_video') {
      const startedAt = new Date().toISOString();
      const pendingCardId = crypto.randomUUID();
      updateActiveSession((current) => {
        if (!current || current.id !== sessionId) {
          return current;
        }
        const baseData = asRecord(card.data);
        const baseMessages = current.messages.map<VideoRemakeChatMessage>((messageItem) => (
          messageItem.type === 'card' && messageItem.cardId === card.cardId
            ? { ...messageItem, data: { ...asRecord(messageItem.data), regenerating: true, regeneratedAt: startedAt } }
            : messageItem
        ));
        return {
          ...current,
          status: 'generating',
          currentStep: 'merge_video',
          messages: [
            ...baseMessages,
            {
              id: crypto.randomUUID(),
              type: 'card',
              role: 'assistant',
              cardId: pendingCardId,
              cardType: 'final_video',
              title: '最终视频',
              status: 'pending',
              data: {
                ...baseData,
                generationMode: 'parallel',
                status: 'generating',
                message: '视频生成中，请稍候。',
                errorMessage: undefined,
                sourceCardId: card.cardId,
                regeneratedAt: startedAt,
              },
              createdAt: startedAt,
            },
          ],
        };
      });
      setHighlightCardId(pendingCardId);
    }
    if (card.cardType === 'storyboard_script') {
      updateActiveSession((current) => {
        if (!current || current.id !== sessionId) {
          return current;
        }
        return {
          ...current,
          messages: current.messages.map((messageItem) => (
            messageItem.type === 'card' && messageItem.cardId === card.cardId
              ? {
                ...messageItem,
                status: 'pending',
                data: {
                  status: 'regenerating',
                  message: '分镜脚本重新解析中，请稍候。',
                  previousData: messageItem.data,
                },
              }
              : messageItem
          )),
        };
      });
    }
    startSessionWorking(sessionId);
    try {
      const session = await regenerateVideoRemakeCard(sessionId, card.cardId, {
        userId: currentUser.id,
        cardType: card.cardType,
        instruction,
      });
      replaceSession(session);
      await loadData({ silent: true });
    } catch (error) {
      if (card.cardType === 'final_video') {
        replaceSession(sessionBeforeRegenerate);
      }
      message.error(error instanceof Error ? error.message : '卡片重新生成失败');
    } finally {
      stopSessionWorking(sessionId);
    }
  };

  const handleRecoverCard = async (card: VideoRemakeCardMessage) => {
    if (!activeSession) {
      return;
    }
    const sessionId = activeSession.id;
    setHighlightCardId(card.cardId);
    startSessionWorking(sessionId);
    try {
      const session = await recoverVideoRemakeCard(sessionId, card.cardId, {
        userId: currentUser.id,
        cardType: card.cardType,
      });
      replaceSession(session);
      await loadData({ silent: true });
      message.success('已刷新卡片状态');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '卡片刷新失败');
    } finally {
      stopSessionWorking(sessionId);
    }
  };

  const handleRegenerateFinalSegment = async (card: VideoRemakeCardMessage, segmentIndex: number, prompt?: string) => {
    await handleRegenerateFinalSegments(card, [{ segmentIndex, prompt }]);
  };

  const handleRegenerateFinalSegments = async (card: VideoRemakeCardMessage, segments: Array<{ segmentIndex: number; prompt?: string }>) => {
    if (!activeSession) {
      return;
    }
    const sessionId = activeSession.id;
    setHighlightCardId(card.cardId);
    startSessionWorking(sessionId);
    try {
      const session = segments.length === 1
        ? await regenerateVideoRemakeFinalSegment(sessionId, card.cardId, segments[0].segmentIndex, {
        userId: currentUser.id,
          prompt: segments[0].prompt,
        })
        : await regenerateVideoRemakeFinalSegments(sessionId, card.cardId, {
          userId: currentUser.id,
          segments,
        });
      selectActiveSession(session);
      setSessions((items) => items.map((item) => (item.id === session.id ? { ...item, ...session } : item)));
      await loadData({ silent: true });
    } catch (error) {
      message.error(error instanceof Error ? error.message : '分段重新生成失败');
    } finally {
      stopSessionWorking(sessionId);
    }
  };

  const handleRetryExpert = async (card: VideoRemakeCardMessage) => {
    if (!activeSession) {
      return;
    }
    const sessionId = activeSession.id;
    const retriedAt = new Date().toISOString();
    const cardData = asRecord(card.data);
    const expertKey = fieldText(cardData.expertKey);
    const roleName = fieldText(cardData.roleName) || card.title;
    setHighlightCardId('');
    updateActiveSession((current) => {
      if (!current || current.id !== sessionId) {
        return current;
      }
      const baseMessages = current.messages.map<VideoRemakeChatMessage>((messageItem) => (
        messageItem.type === 'card' && messageItem.cardId === card.cardId
          ? {
            ...messageItem,
            status: 'expired' as const,
            data: { ...asRecord(messageItem.data), retrying: true, retriedAt },
          }
          : messageItem
      ));
      const optimisticMessages: VideoRemakeChatMessage[] = [
        ...baseMessages,
        {
          id: crypto.randomUUID(),
          type: 'text',
          role: 'assistant',
          content: `已重新提交${roleName}，正在重新解析该专家。`,
          createdAt: retriedAt,
        },
        {
          id: crypto.randomUUID(),
          type: 'card',
          role: 'assistant',
          cardId: crypto.randomUUID(),
          cardType: 'generation_progress',
          title: '视频解析',
          status: 'pending',
          data: {
            step: 'analyze_audio',
            status: 'running',
            message: `${roleName}重新解析已开始。`,
            percent: 24,
            completedExperts: 0,
            totalExperts: 1,
            retriedExpertKey: expertKey,
            retriedExpertName: roleName,
            retriedFromCardId: card.cardId,
            retriedAt,
          },
          createdAt: retriedAt,
        },
      ];
      return {
        ...current,
        status: 'running',
        messages: optimisticMessages,
      };
    });
    startSessionWorking(sessionId);
    try {
      const session = await retryVideoRemakeExpert(sessionId, card.cardId, { userId: currentUser.id });
      selectActiveSession(session);
      await loadData({ silent: true });
    } catch (error) {
      message.error(error instanceof Error ? error.message : '专家重新解析失败');
    } finally {
      stopSessionWorking(sessionId);
    }
  };

  return {
    sessions,
    setSessions,
    assets,
    setAssets,
    groups,
    setGroups,
    activeSession,
    setActiveSession,
    showStartPanel,
    setShowStartPanel,
    chatInput,
    setChatInput,
    sourceUrl,
    setSourceUrl,
    startMode,
    setStartMode,
    selectedVideoFile,
    setSelectedVideoFile,
    isLoading,
    setIsLoading,
    isResolvingUrlSession,
    setIsResolvingUrlSession,
    sessionOverlayLoading,
    workingSessionId,
    syncingSessionId,
    highlightCardId,
    setHighlightCardId,
    cardDrafts,
    activeSessionRef,
    scrollRef,
    threadRef,
    bottomAnchorRef,
    activeSessionWorking,
    activeSessionSyncing,
    startWorking,
    shouldShowStartContent,
    shouldShowWorkspaceLoading,
    canStartMoreSessions,
    processingSessionCount,
    currentVideoDurationSeconds,
    currentVideoAspectRatio,
    activeMessages,
    syncSessionUrl,
    selectActiveSession,
    loadSessionDetail,
    showConcurrentLimitWarning,
    ensureAssetsLoaded,
    handleUploadReferenceImage,
    clearCardDraft,
    handleCardDraftChange,
    uploadProps,
    handleNewSession,
    handleRenameSession,
    handleDeleteSession,
    handleStartUploadParse,
    handleUploadPipImage,
    handleParseUrl,
    handleSend,
    handleResumeBlockedSession,
    handleSyncSession,
    handleConfirmCard,
    handleCancelCard,
    handleEditCard,
    handleRegenerateCard,
    handleRecoverCard,
    handleRegenerateFinalSegment,
    handleRegenerateFinalSegments,
    handleRetryExpert,
  };
}
