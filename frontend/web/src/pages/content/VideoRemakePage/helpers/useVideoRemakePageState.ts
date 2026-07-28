import { useRef, useState } from 'react';
import type {
  VideoRemakeSession,
  VideoRemakeSessionSummary,
} from '../../../../api/video-remake';
import type { ContentAsset, ContentAssetGroup } from '../../../../types';

export function useVideoRemakePageState(urlSessionId: string) {
  const [sessions, setSessions] = useState<VideoRemakeSessionSummary[]>([]);
  const [assets, setAssets] = useState<ContentAsset[]>([]);
  const [groups, setGroups] = useState<ContentAssetGroup[]>([]);
  const [activeSession, setActiveSession] = useState<VideoRemakeSession | null>(null);
  const [showStartPanel, setShowStartPanel] = useState(true);
  const [chatInput, setChatInput] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [startMode, setStartMode] = useState<'link' | 'upload'>('upload');
  const [selectedVideoFile, setSelectedVideoFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isResolvingUrlSession, setIsResolvingUrlSession] = useState(Boolean(urlSessionId));
  const [sessionOverlayLoading, setSessionOverlayLoading] = useState(false);
  const [workingSessionId, setWorkingSessionId] = useState('');
  const [syncingSessionId, setSyncingSessionId] = useState('');
  const [highlightCardId, setHighlightCardId] = useState('');
  const [cardDrafts, setCardDrafts] = useState<Record<string, unknown>>({});
  const activeSessionRef = useRef<VideoRemakeSession | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const bottomAnchorRef = useRef<HTMLDivElement>(null);
  const skipNextAutoScrollRef = useRef(false);
  const preservedScrollTopRef = useRef<number | null>(null);
  const shouldStickToBottomRef = useRef(true);
  const autoScrollFrameRef = useRef<number | null>(null);
  const assetsLoadedRef = useRef(false);
  const loadDataRequestRef = useRef(0);
  const loadSessionDetailRequestRef = useRef(0);
  const deletingSessionIdsRef = useRef(new Set<string>());
  const sessionOverlayLoadingRequestRef = useRef(0);
  const sessionOverlayLoadingShowTimerRef = useRef<number | null>(null);
  const sessionOverlayLoadingHideTimerRef = useRef<number | null>(null);
  const sessionOverlayLoadingVisibleRef = useRef(false);
  const sessionOverlayLoadingShownAtRef = useRef<number | null>(null);
  const initialLoadUserIdRef = useRef<string | null>(null);
  const urlSessionIdRef = useRef(urlSessionId);
  const uploadLimitWarningAtRef = useRef(0);
  const autoSyncFinalVideoSessionIdsRef = useRef(new Set<string>());

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
  };
}
