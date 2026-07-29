import {
  trimReferenceVideo,
} from '../../../../../api/content';
import {
  applyPlanningSession,
  analyzePlanningSession,
  createPlanningEventSource,
  createPlanningSession,
  generatePlanningCandidates,
  getContentPlanningConfig,
  getPlanningSession,
  getPlanningSessionUpdates,
  selectPlanningCandidate,
  updatePlanningConfirmation,
  updatePlanningSettings,
  type PlanningApplyPayload,
  type PlanningCandidate,
  type PlanningRealtimeEvent,
  type PlanningSession,
  type PlanningSettings,
  type PlanningUiStep,
} from '../../../../../api/content-planning';
import { resolveAssetUrl } from '../../../../../api/request';
import type { ContentAssetResourceType, User } from '../../../../../types';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from 'react';
import {
  buildPlanningSeedMaterials,
  mergePlanningSessionUpdates,
  normalizePlanningPromptTokens,
  planningCompletionRatio,
  planningShouldPoll,
  planningStepIndex,
  planningSteps,
  resolvePlanningStep,
} from '../../planningHelpers';
import type { LocalMaterialFile, MaterialKind, SelectedMaterials } from '../../types';
import { readVideoDuration, shouldTrimReferenceVideo } from '../../videoMetadata';
import type { ConfirmedReferenceVideo } from '../ReferenceVideoCard';
import type { TrimSelection } from '../TrimReferenceVideoModal';
import {
  audioMaterial,
  defaultSettings,
  type BusyAction,
  stageItems,
  videoMaterial,
} from './promptPlanningConfig';
import {
  createOwnedObjectUrl,
  deleteServerReferenceVideo,
  ensureMaterialAssetIds,
  getLimit,
  getLocalFiles,
  getRemainingCapacity,
  hasSessionMaterialBundle,
  isAllowedAudioFile,
  readAudioDuration,
  replaceSeedMaterials,
  revokeLocalMaterialList,
  revokeSelectedMaterials,
  toConfirmedReferenceVideo,
} from './materialHelpers';
import {
  buildAnalysisDraft,
  buildCaptionDraftCards,
  buildReasoningText,
  formatCandidateScript,
  getAnalyzeLoadingCopy,
  getGenerateLoadingCopy,
  invalidatePlanningSessionResult,
  isReasoningStreamWaiting,
  normalizePlanningSettingsDraft,
  normalizeProductInsights,
  sanitizePlanningMaterials,
  serializeAnalysisDraft,
  serializeSessionAnalysis,
  serializeSessionStep1,
  serializeSettingsDraft,
  serializeStep1Draft,
  type AnalysisDraft,
} from './planningSessionHelpers';

type UsePromptPlanningControllerInput = {
  currentUser: User;
  initialPrompt: string;
  initialSelectedMaterials: SelectedMaterials;
  onApplyPlanningResult: (payload: PlanningApplyPayload) => void;
};

export function usePromptPlanningController({
  currentUser,
  initialPrompt,
  initialSelectedMaterials,
  onApplyPlanningResult,
}: UsePromptPlanningControllerInput) {
  const uploadGroupIdsRef = useRef<Partial<Record<ContentAssetResourceType, string>>>({});
  const ownedObjectUrlsRef = useRef(new Set<string>());
  const pollSinceRef = useRef('');
  const materialsRef = useRef<SelectedMaterials>({});
  const busyActionRef = useRef<BusyAction>('idle');
  const analyzeLockRef = useRef(false);
  const generateLockRef = useRef(false);
  const restorePromiseRef = useRef<Promise<PlanningSession> | null>(null);
  const syncedSessionIdRef = useRef<string | null>(null);
  const selectCandidateRequestRef = useRef(0);
  const thinkingBodyRef = useRef<HTMLPreElement | null>(null);
  const thinkingAutoScrollRef = useRef(true);
  const thinkingPanelVisibleRef = useRef(false);
  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const audioInputRef = useRef<HTMLInputElement | null>(null);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);

  const [busyAction, setBusyAction] = useState<BusyAction>('idle');
  const [analysisCredits, setAnalysisCredits] = useState<number | null>(null);
  const [generationCredits, setGenerationCredits] = useState<number | null>(null);
  const [session, setSession] = useState<PlanningSession | null>(null);
  const [hydratedSessionId, setHydratedSessionId] = useState('');
  const [viewStep, setViewStep] = useState<PlanningUiStep>('step1');
  const [errorMessage, setErrorMessage] = useState('');
  const [prompt, setPrompt] = useState(initialPrompt);
  const [productName, setProductName] = useState('');
  const [materials, setMaterials] = useState<SelectedMaterials>(() => sanitizePlanningMaterials(buildPlanningSeedMaterials(null, initialSelectedMaterials)));
  const [settingsDraft, setSettingsDraft] = useState<PlanningSettings>(defaultSettings);
  const [analysisDraft, setAnalysisDraft] = useState<AnalysisDraft>(() => buildAnalysisDraft(null, defaultSettings.referencePolicy.useBreakdown));
  const [selectedCandidateId, setSelectedCandidateId] = useState('');
  const [isThinkingCollapsed, setIsThinkingCollapsed] = useState(false);
  const [scriptEditorValue, setScriptEditorValue] = useState('');
  const [isEditingScript, setIsEditingScript] = useState(false);
  const [isScriptEdited, setIsScriptEdited] = useState(false);
  const [previewVideo, setPreviewVideo] = useState<ConfirmedReferenceVideo | null>(null);
  const [pendingTrimFile, setPendingTrimFile] = useState<File | null>(null);
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);

  const isAnalyzing = busyAction === 'analyzing' || session?.status === 'analyzing';
  const isGenerating = busyAction === 'generating' || session?.status === 'generating';
  const isBusy = busyAction !== 'idle' || isAnalyzing || isGenerating;
  const analysisCreditLabel = analysisCredits === null
    ? ''
    : ` · ${analysisCredits.toLocaleString('zh-CN', { maximumFractionDigits: 6 })}积分`;
  const generationCreditLabel = generationCredits === null
    ? ''
    : ` · ${generationCredits.toLocaleString('zh-CN', { maximumFractionDigits: 6 })}积分`;
  const resolvedStep = session ? resolvePlanningStep(session) : 'step1';
  const resolvedStepIndex = planningStepIndex(resolvedStep);
  const activeStep = useMemo<PlanningUiStep>(() => {
    if (busyAction === 'analyzing' || session?.status === 'analyzing') {
      return 'step1';
    }
    return viewStep;
  }, [busyAction, session?.status, viewStep]);
  const railState = useMemo(() => {
    const maxUnlockedStepIndex = session ? resolvedStepIndex : 0;
    return planningSteps.map((step, index) => {
      const isCurrent = step === activeStep;
      const isCompleted = !isCurrent && index < resolvedStepIndex;
      const isUnlocked = index <= maxUnlockedStepIndex;
      return {
        step,
        index,
        isCompleted,
        isCurrent,
        isUnlocked,
        isDisabled: !isUnlocked,
      };
    });
  }, [activeStep, resolvedStepIndex, session]);
  const stageRatio = planningCompletionRatio(session?.jobStage || 'idle', stageItems.length);
  const imageFiles = getLocalFiles(materials.image);
  const referenceVideoFile = getLocalFiles(materials.video)[0] || null;
  const referenceAudioFile = getLocalFiles(materials.audio)[0] || null;
  const hasReferenceVideo = Boolean(referenceVideoFile || session?.materialBundle.referenceVideo);
  const usesReferencePreset = hasReferenceVideo && analysisDraft.useBreakdown;
  const isManualPresetMissing = !usesReferencePreset
    && (!settingsDraft.contentType.trim() || !settingsDraft.shootingMethod.trim());
  const selectedCandidate = useMemo(
    () => session?.generation.candidates.find((candidate) => candidate.id === selectedCandidateId)
      || session?.generation.candidates.find((candidate) => candidate.id === session.generation.selectedCandidateId)
      || session?.generation.candidates[0]
      || null,
    [selectedCandidateId, session],
  );
  const shouldShowDeepThink = Boolean(session && hydratedSessionId === session.id)
    && session?.settings.deepThink === true
    && settingsDraft.deepThink === true;
  const thinkingText = useMemo(
    () => (shouldShowDeepThink && session ? buildReasoningText(session.generation) : ''),
    [
      session?.generation.reasoningLogs,
      session?.generation.reasoningStream?.content,
      session?.generation.stageOutputs,
      session?.generation.validatorSummary,
      shouldShowDeepThink,
    ],
  );
  const isWaitingForThinkingDelta = shouldShowDeepThink
    && session?.status === 'generating'
    && isReasoningStreamWaiting(session.generation);
  const captionDraftCards = useMemo(
    () => buildCaptionDraftCards(analysisDraft.materialCaptions),
    [analysisDraft.materialCaptions],
  );
  const step1Dirty = useMemo(() => (
    session ? serializeStep1Draft(prompt, productName, materials) !== serializeSessionStep1(session) : false
  ), [materials, productName, prompt, session]);
  const analysisDirty = useMemo(() => (
    session ? serializeAnalysisDraft(analysisDraft) !== serializeSessionAnalysis(session, analysisDraft.useBreakdown) : false
  ), [analysisDraft, session]);
  const settingsDirty = useMemo(() => (
    session ? serializeSettingsDraft(settingsDraft) !== serializeSettingsDraft(session.settings) : false
  ), [session, settingsDraft]);
  const applyBlockedByDirty = step1Dirty || analysisDirty || settingsDirty;
  const canApply = session?.status === 'ready_to_apply'
    && Boolean(selectedCandidate)
    && !applyBlockedByDirty
    && session.generation.candidates.some((candidate) => candidate.id === selectedCandidate?.id);
  const showStep1Loading = isAnalyzing;
  const showStep4Loading = isGenerating;
  const showThinkingPanel = activeStep === 'step4' && shouldShowDeepThink && Boolean(thinkingText);
  const showGenerationStages = showStep4Loading && shouldShowDeepThink && Boolean(thinkingText);
  const showReadyCandidates = (session?.status === 'ready_to_apply' || session?.status === 'applied')
    && Boolean(session.generation.candidates.length);
  const analyzeCopy = getAnalyzeLoadingCopy(session?.jobStage || 'idle', { hasVideo: hasReferenceVideo });
  const generateCopy = getGenerateLoadingCopy(
    session?.jobStage || 'idle',
    Boolean(thinkingText),
    shouldShowDeepThink,
  );
  const footerPoints = activeStep === 'step3' || activeStep === 'step4' ? generationCredits : null;

  const updateBusyAction = (next: BusyAction) => {
    busyActionRef.current = next;
    setBusyAction(next);
  };

  useEffect(() => {
    materialsRef.current = materials;
  }, [materials]);

  useEffect(() => {
    if (session?.status === 'generating') {
      thinkingAutoScrollRef.current = true;
      setIsThinkingCollapsed(false);
      return;
    }
    if (session?.status === 'ready_to_apply' || session?.status === 'applied') {
      setIsThinkingCollapsed(true);
    }
  }, [session?.id, session?.status]);

  useEffect(() => {
    const enteredThinkingPanel = showThinkingPanel && !thinkingPanelVisibleRef.current;
    thinkingPanelVisibleRef.current = showThinkingPanel;
    if (enteredThinkingPanel) {
      thinkingAutoScrollRef.current = true;
    }
    if (!showThinkingPanel || isThinkingCollapsed || !thinkingAutoScrollRef.current) {
      return undefined;
    }
    let layoutFrame = 0;
    const mountFrame = window.requestAnimationFrame(() => {
      layoutFrame = window.requestAnimationFrame(() => {
        const body = thinkingBodyRef.current;
        if (body) {
          body.scrollTop = body.scrollHeight;
        }
      });
    });
    return () => {
      window.cancelAnimationFrame(mountFrame);
      if (layoutFrame) {
        window.cancelAnimationFrame(layoutFrame);
      }
    };
  }, [isThinkingCollapsed, isWaitingForThinkingDelta, showThinkingPanel, thinkingText]);

  useEffect(() => () => {
    audioPlayerRef.current?.pause();
    revokeSelectedMaterials(materialsRef.current, ownedObjectUrlsRef.current);
  }, []);

  useEffect(() => {
    let disposed = false;
    const restoreLatest = async () => {
      updateBusyAction('restoring');
      setErrorMessage('');
      const restorePromise = restorePromiseRef.current || createPlanningSession({
        userId: currentUser.id,
        restoreLatest: true,
      });
      restorePromiseRef.current = restorePromise;
      try {
        const restored = await restorePromise;
        if (disposed) {
          return;
        }
        pollSinceRef.current = restored.updatedAt;
        setSession(restored);
        if (hasSessionMaterialBundle(restored)) {
          setMaterials((current) => sanitizePlanningMaterials(replaceSeedMaterials(
            current,
            buildPlanningSeedMaterials(restored, current),
            ownedObjectUrlsRef.current,
          )));
        }
      } catch {
        if (!disposed) {
          setSession(null);
          setViewStep('step1');
        }
      } finally {
        if (restorePromiseRef.current === restorePromise) {
          restorePromiseRef.current = null;
        }
        if (!disposed) {
          updateBusyAction('idle');
        }
      }
    };
    void restoreLatest();
    return () => {
      disposed = true;
    };
  }, [currentUser.id]);

  useEffect(() => {
    let disposed = false;
    void getContentPlanningConfig()
      .then((config) => {
        if (!disposed) {
          setAnalysisCredits(config.analysisCredits);
          setGenerationCredits(config.generationCredits);
        }
      })
      .catch(() => {
        if (!disposed) {
          setAnalysisCredits(null);
          setGenerationCredits(null);
          setErrorMessage('积分配置加载失败，请关闭弹窗后重试。');
        }
      });
    return () => {
      disposed = true;
    };
  }, [currentUser.id]);

  useEffect(() => {
    if (!session) {
      syncedSessionIdRef.current = null;
      setHydratedSessionId('');
      return;
    }
    const isNewSession = syncedSessionIdRef.current !== session.id;
    syncedSessionIdRef.current = session.id;
    pollSinceRef.current = session.updatedAt;
    setViewStep((current) => {
      if (session.status === 'generating' && !isNewSession) {
        return current;
      }
      return resolvePlanningStep(session);
    });
    setSettingsDraft(session.settings);
    setAnalysisDraft(buildAnalysisDraft(session, session.settings.referencePolicy.useBreakdown));
    setSelectedCandidateId(session.generation.selectedCandidateId || session.generation.candidates[0]?.id || '');
    setPrompt(session.materialBundle.prompt || initialPrompt);
    setProductName(session.materialBundle.productName || '');
    if (hasSessionMaterialBundle(session)) {
      setMaterials((current) => sanitizePlanningMaterials(replaceSeedMaterials(
        current,
        buildPlanningSeedMaterials(session, current),
        ownedObjectUrlsRef.current,
      )));
    }
    setHydratedSessionId(session.id);
  }, [initialPrompt, session]);

  useEffect(() => {
    if (!selectedCandidate) {
      setScriptEditorValue('');
      setIsEditingScript(false);
      setIsScriptEdited(false);
      return;
    }
    setScriptEditorValue(formatCandidateScript(selectedCandidate));
    setIsEditingScript(false);
    setIsScriptEdited(false);
  }, [selectedCandidate?.id]);

  useEffect(() => {
    if (!session || !planningShouldPoll(session.status)) {
      return undefined;
    }
    let disposed = false;
    const intervalMs = session.status === 'analyzing' ? 1200 : 1800;
    const poll = async () => {
      try {
        const updates = await getPlanningSessionUpdates({
          sessionId: session.id,
          userId: currentUser.id,
          since: pollSinceRef.current || undefined,
        });
        if (disposed) {
          return;
        }
        pollSinceRef.current = updates.updatedAt;
        if (!planningShouldPoll(updates.status) || updates.jobStage === 'failed') {
          const fullSession = await getPlanningSession(session.id, currentUser.id);
          if (disposed) {
            return;
          }
          pollSinceRef.current = fullSession.updatedAt;
          setSession(fullSession);
          updateBusyAction('idle');
          setErrorMessage(fullSession.status === 'failed'
            ? fullSession.errorMessage || '素材分析失败，请重试。'
            : '');
          if (fullSession.status === 'confirming') {
            setMaterials((current) => sanitizePlanningMaterials(replaceSeedMaterials(
              current,
              buildPlanningSeedMaterials(fullSession, current),
              ownedObjectUrlsRef.current,
            )));
          }
          return;
        }
        setErrorMessage('');
        setSession((current) => (current ? mergePlanningSessionUpdates(current, updates) : current));
      } catch (error) {
        if (disposed) {
          return;
        }
        updateBusyAction('idle');
        setErrorMessage(error instanceof Error ? error.message : '策划进度拉取失败');
      }
    };
    void poll();
    const timer = window.setInterval(() => {
      void poll();
    }, intervalMs);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [currentUser.id, session?.id, session?.status]);

  useEffect(() => {
    if (!session || session.status !== 'generating') {
      return undefined;
    }
    const activeSessionId = session.id;
    const source = createPlanningEventSource();
    const handlePlanningEvent = (event: MessageEvent<string>) => {
      let payload: PlanningRealtimeEvent;
      try {
        payload = JSON.parse(event.data || '{}') as PlanningRealtimeEvent;
      } catch {
        return;
      }
      if (payload.sessionId !== activeSessionId) {
        return;
      }
      setSession((current) => {
        if (!current || current.id !== activeSessionId) {
          return current;
        }
        const reasoningLogs = [...current.generation.reasoningLogs];
        if (payload.reasoningLog && !reasoningLogs.some((log) => log.id === payload.reasoningLog?.id)) {
          reasoningLogs.push(payload.reasoningLog);
          reasoningLogs.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
        }
        return {
          ...current,
          generation: {
            ...current.generation,
            reasoningLogs,
            reasoningStream: payload.reasoningStream,
          },
        };
      });
    };
    source.addEventListener('planning', handlePlanningEvent as EventListener);
    return () => {
      source.removeEventListener('planning', handlePlanningEvent as EventListener);
      source.close();
    };
  }, [session?.id, session?.status]);

  const onAnalysisDraftChange = (next: AnalysisDraft) => {
    setAnalysisDraft(next);
  };

  const clearMaterial = (item: MaterialKind) => {
    setMaterials((current) => {
      const next = { ...current };
      revokeLocalMaterialList(getLocalFiles(next[item.key]), ownedObjectUrlsRef.current);
      delete next[item.key];
      return next;
    });
    if (item.key === 'audio') {
      audioPlayerRef.current?.pause();
      setIsAudioPlaying(false);
    }
  };

  const removeMaterialAt = (kind: MaterialKind['key'], index: number) => {
    setMaterials((current) => {
      const nextFiles = getLocalFiles(current[kind]).filter((_, fileIndex) => fileIndex !== index);
      const removed = getLocalFiles(current[kind]).filter((_, fileIndex) => fileIndex === index);
      revokeLocalMaterialList(removed, ownedObjectUrlsRef.current);
      if (!nextFiles.length) {
        const next = { ...current };
        delete next[kind];
        return next;
      }
      return {
        ...current,
        [kind]: nextFiles,
      };
    });
  };

  const handleLocalFiles = async (item: MaterialKind, files: FileList | File[]) => {
    const incomingFiles = Array.from(files);
    if (item.key === 'audio') {
      const file = incomingFiles.find(isAllowedAudioFile);
      if (!file) {
        setErrorMessage('参考音频仅支持 MP3 或 WAV 格式。');
        return;
      }
      const duration = await readAudioDuration(file);
      const localFile = {
        audioDuration: duration,
        file,
        id: `${item.key}-${crypto.randomUUID()}`,
        name: file.name,
        type: item.key,
        url: createOwnedObjectUrl(file, ownedObjectUrlsRef.current),
      } satisfies LocalMaterialFile;
      setMaterials((current) => {
        revokeLocalMaterialList(getLocalFiles(current.audio), ownedObjectUrlsRef.current);
        return {
          ...current,
          audio: [localFile],
        };
      });
      return;
    }

    if (item.key === 'video') {
      const file = incomingFiles[0];
      if (!file) {
        return;
      }
      const duration = await readVideoDuration(file);
      const localFile = {
        file,
        id: `${item.key}-${crypto.randomUUID()}`,
        name: file.name,
        trimDuration: duration,
        type: item.key,
        url: createOwnedObjectUrl(file, ownedObjectUrlsRef.current),
      } satisfies LocalMaterialFile;
      setMaterials((current) => {
        revokeLocalMaterialList(getLocalFiles(current.video), ownedObjectUrlsRef.current);
        return {
          ...current,
          video: [localFile],
        };
      });
      if (shouldTrimReferenceVideo(duration)) {
        setPendingTrimFile(file);
      }
      return;
    }

    const selectedFiles = incomingFiles.slice(0, getRemainingCapacity(item, materials[item.key]));
    const localFiles = selectedFiles.map((file) => ({
      file,
      id: `${item.key}-${crypto.randomUUID()}`,
      name: file.name,
      type: item.key,
      url: createOwnedObjectUrl(file, ownedObjectUrlsRef.current),
    })) satisfies LocalMaterialFile[];
    setMaterials((current) => {
      const currentFiles = getLocalFiles(current[item.key]);
      return {
        ...current,
        [item.key]: [...currentFiles, ...localFiles].slice(0, getLimit(item)),
      };
    });
  };

  const handleVideoInput = async (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files?.length) {
      await handleLocalFiles(videoMaterial, [event.target.files[0]]);
    }
    event.target.value = '';
  };

  const handleAudioInput = async (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files?.length) {
      await handleLocalFiles(audioMaterial, [event.target.files[0]]);
    }
    event.target.value = '';
  };

  const handleAnalyze = async () => {
    if (analyzeLockRef.current || busyActionRef.current !== 'idle' || session?.status === 'analyzing') {
      return;
    }
    if (imageFiles.length === 0) {
      setErrorMessage('请至少选择 1 张商品图后再开始识别。');
      return;
    }
    analyzeLockRef.current = true;
    setSelectedCandidateId('');
    setIsEditingScript(false);
    setIsScriptEdited(false);
    setViewStep('step1');
    setSession((current) => (current ? invalidatePlanningSessionResult(current, {
      jobStage: 'uploading_assets',
      status: 'analyzing',
      uiStep: 'step1',
    }) : current));
    updateBusyAction('analyzing');
    setErrorMessage('');
    try {
      const [imageAssetIds, videoAssetIds, audioAssetIds] = await Promise.all([
        ensureMaterialAssetIds({
          currentUser,
          resourceType: 'other',
          files: imageFiles,
          uploadGroupIdsRef,
        }),
        ensureMaterialAssetIds({
          currentUser,
          resourceType: 'other',
          files: referenceVideoFile ? [referenceVideoFile] : [],
          uploadGroupIdsRef,
        }),
        ensureMaterialAssetIds({
          currentUser,
          resourceType: 'voice',
          files: referenceAudioFile ? [referenceAudioFile] : [],
          uploadGroupIdsRef,
        }),
      ]);
      const media = [
        ...imageAssetIds.map((assetId) => ({ assetId, kind: 'image' as const })),
        ...videoAssetIds.map((assetId) => ({ assetId, kind: 'video' as const })),
        ...audioAssetIds.map((assetId) => ({ assetId, kind: 'audio' as const })),
      ];
      const createdSession = session || await createPlanningSession({
        userId: currentUser.id,
        prompt: prompt.trim(),
        productName: productName.trim(),
        media,
      });
      const analyzedSession = await analyzePlanningSession({
        userId: currentUser.id,
        sessionId: createdSession.id,
        productName: productName.trim(),
        prompt: prompt.trim(),
        imageAssetIds,
        referenceVideoAssetId: videoAssetIds[0],
        referenceAudioAssetId: audioAssetIds[0],
        media,
      });
      pollSinceRef.current = analyzedSession.updatedAt;
      setSession(analyzedSession);
      setViewStep(resolvePlanningStep(analyzedSession));
      if (!planningShouldPoll(analyzedSession.status)) {
        updateBusyAction('idle');
      }
    } catch (error) {
      updateBusyAction('idle');
      setErrorMessage(error instanceof Error ? error.message : '策划分析失败');
    } finally {
      analyzeLockRef.current = false;
    }
  };

  const handleConfirmAnalysis = async () => {
    if (!session) {
      return;
    }
    setSession((current) => (current ? invalidatePlanningSessionResult(current, {
      jobStage: 'idle',
      status: 'configuring',
      uiStep: 'step3',
    }) : current));
    updateBusyAction('confirming');
    setErrorMessage('');
    setSelectedCandidateId('');
    try {
      const next = await updatePlanningConfirmation({
        userId: currentUser.id,
        sessionId: session.id,
        viralBreakdown: analysisDraft.useBreakdown ? session.analysis.viralBreakdown : null,
        materialCaptions: analysisDraft.materialCaptions.map((caption, index) => ({
          ...caption,
          label: `图片${index + 1}`,
          description: caption.description.trim(),
        })),
        productInsights: normalizeProductInsights(analysisDraft.productInsights),
        referencePolicy: {
          ...session.settings.referencePolicy,
          useBreakdown: analysisDraft.useBreakdown,
        },
      });
      setSession(next);
      updateBusyAction('idle');
      setViewStep(resolvePlanningStep(next));
    } catch (error) {
      updateBusyAction('idle');
      setErrorMessage(error instanceof Error ? error.message : '确认分析信息失败');
    }
  };

  const handleGenerate = async (regenerate = false) => {
    if (!session || generateLockRef.current || busyActionRef.current !== 'idle') {
      return;
    }
    if (isManualPresetMissing) {
      setViewStep('step3');
      return;
    }
    generateLockRef.current = true;
    const normalizedSettings = normalizePlanningSettingsDraft(settingsDraft);
    const settings = usesReferencePreset
      ? { ...normalizedSettings, contentType: '', shootingMethod: '' }
      : normalizedSettings;
    const fallbackInvalidatedSession = invalidatePlanningSessionResult(session, {
      jobStage: 'planner_running',
      settings,
      status: 'generating',
      uiStep: 'step4',
    });
    let savedSession: PlanningSession | null = null;
    updateBusyAction('generating');
    setErrorMessage('');
    setSelectedCandidateId('');
    setViewStep('step4');
    setIsThinkingCollapsed(false);
    setSession(fallbackInvalidatedSession);
    try {
      savedSession = await updatePlanningSettings({
        userId: currentUser.id,
        sessionId: session.id,
        settings,
      });
      const next = await generatePlanningCandidates({
        userId: currentUser.id,
        sessionId: session.id,
        regenerate,
      });
      pollSinceRef.current = next.updatedAt;
      setSession({
        ...next,
        settings: savedSession.settings,
      });
      setViewStep(resolvePlanningStep(next));
      if (!planningShouldPoll(next.status)) {
        updateBusyAction('idle');
      }
    } catch (error) {
      setSession(savedSession || invalidatePlanningSessionResult(session, {
        jobStage: 'idle',
        settings,
        status: 'configuring',
        uiStep: 'step3',
      }));
      updateBusyAction('idle');
      setErrorMessage(error instanceof Error ? error.message : '候选脚本生成失败');
    } finally {
      generateLockRef.current = false;
    }
  };

  const handleSelectCandidate = async (candidate: PlanningCandidate) => {
    if (!session || session.status === 'generating') {
      return;
    }
    if (candidate.id === selectedCandidateId && !session.generation.selectedCandidateId) {
      return;
    }
    const previousId = selectedCandidateId;
    const requestId = selectCandidateRequestRef.current + 1;
    selectCandidateRequestRef.current = requestId;
    setSelectedCandidateId(candidate.id);
    setErrorMessage('');
    if (candidate.id === session.generation.selectedCandidateId) {
      return;
    }
    try {
      const next = await selectPlanningCandidate({
        userId: currentUser.id,
        sessionId: session.id,
        candidateId: candidate.id,
      });
      if (selectCandidateRequestRef.current !== requestId) {
        return;
      }
      setSession(next);
    } catch (error) {
      if (selectCandidateRequestRef.current !== requestId) {
        return;
      }
      setSelectedCandidateId(previousId);
      setErrorMessage(error instanceof Error ? error.message : '切换候选失败');
    }
  };

  const handleApply = async () => {
    if (!session || !selectedCandidate) {
      setErrorMessage('请先选择一个可应用的候选脚本。');
      return;
    }
    if (session.status !== 'ready_to_apply') {
      setErrorMessage('当前策划结果尚未进入可应用状态。');
      return;
    }
    if (applyBlockedByDirty) {
      setErrorMessage('上游信息已变更，请重新识别或重新生成后再应用。');
      return;
    }
    if (!session.generation.candidates.some((candidate) => candidate.id === selectedCandidate.id)) {
      setErrorMessage('当前候选脚本已失效，请重新生成或重新选择。');
      return;
    }
    updateBusyAction('applying');
    setErrorMessage('');
    try {
      const payload = await applyPlanningSession({
        userId: currentUser.id,
        sessionId: session.id,
        candidateId: selectedCandidate.id,
      });
      const finalPayload = isScriptEdited && scriptEditorValue.trim()
        ? {
          ...payload,
          allowlist: {
            ...payload.allowlist,
            prompt: normalizePlanningPromptTokens(scriptEditorValue.trim()),
          },
        }
        : payload;
      onApplyPlanningResult(finalPayload);
    } catch (error) {
      updateBusyAction('idle');
      setErrorMessage(error instanceof Error ? error.message : '应用策划结果失败');
    }
  };

  const clearAll = () => {
    audioPlayerRef.current?.pause();
    setIsAudioPlaying(false);
    revokeSelectedMaterials(materials, ownedObjectUrlsRef.current);
    setMaterials({});
    setPrompt('');
    setProductName('');
    setSession(null);
    setHydratedSessionId('');
    syncedSessionIdRef.current = null;
    setViewStep('step1');
    setSettingsDraft(defaultSettings);
    setAnalysisDraft(buildAnalysisDraft(null, defaultSettings.referencePolicy.useBreakdown));
    setSelectedCandidateId('');
    setScriptEditorValue('');
    setIsEditingScript(false);
    setIsScriptEdited(false);
    setPreviewVideo(null);
    setPendingTrimFile(null);
    setErrorMessage('');
    updateBusyAction('idle');
  };

  const handleTrimConfirmed = async (selection: TrimSelection) => {
    const previousVideo = referenceVideoFile ? toConfirmedReferenceVideo(referenceVideoFile) : null;
    const result = await trimReferenceVideo({
      end: Number(selection.end.toFixed(1)),
      file: selection.file,
      start: Number(selection.start.toFixed(1)),
    });
    const nextFile = {
      assetId: result.assetId,
      id: `video-${crypto.randomUUID()}`,
      name: result.originalFileName || result.name || selection.file.name || '参考视频 01',
      serverFileUrl: result.fileUrl,
      storedFileName: result.storedFileName,
      type: 'video',
      url: resolveAssetUrl(result.fileUrl),
      trimDuration: result.duration,
      trimEnd: result.end,
      trimStart: result.start,
    } satisfies LocalMaterialFile;

    setMaterials((current) => {
      revokeLocalMaterialList(getLocalFiles(current.video), ownedObjectUrlsRef.current);
      return {
        ...current,
        video: [nextFile],
      };
    });
    setPendingTrimFile(null);
    if (previousVideo) {
      void deleteServerReferenceVideo(previousVideo);
    }
  };

  const toggleAudio = (file: LocalMaterialFile) => {
    if (!audioPlayerRef.current) {
      audioPlayerRef.current = new Audio();
    }
    const audio = audioPlayerRef.current;
    if (!audio.src || audio.src !== file.url) {
      audio.src = file.url;
      audio.currentTime = 0;
    }
    if (!audio.paused) {
      audio.pause();
      setIsAudioPlaying(false);
      return;
    }
    audio.onended = () => setIsAudioPlaying(false);
    void audio.play().then(() => setIsAudioPlaying(true)).catch(() => setIsAudioPlaying(false));
  };

  const toggleThinkingCollapsed = () => {
    setIsThinkingCollapsed((current) => {
      if (current) {
        thinkingAutoScrollRef.current = true;
      }
      return !current;
    });
  };

  return {
    activeStep,
    analysisCreditLabel,
    analysisCredits,
    analysisDirty,
    analysisDraft,
    analyzeCopy,
    audioInputRef,
    canApply,
    captionDraftCards,
    clearAll,
    clearMaterial,
    errorMessage,
    footerPoints,
    generationCreditLabel,
    generationCredits,
    generateCopy,
    handleAnalyze,
    handleApply,
    handleAudioInput,
    handleConfirmAnalysis,
    handleGenerate,
    handleLocalFiles,
    handleSelectCandidate,
    handleTrimConfirmed,
    handleVideoInput,
    imageFiles,
    isAnalyzing,
    isAudioPlaying,
    isBusy,
    isEditingScript,
    isGenerating,
    isManualPresetMissing,
    isScriptEdited,
    isThinkingCollapsed,
    isWaitingForThinkingDelta,
    materials,
    onAnalysisDraftChange,
    pendingTrimFile,
    previewVideo,
    productName,
    railState,
    referenceAudioFile,
    referenceVideoFile,
    removeMaterialAt,
    scriptEditorValue,
    selectedCandidate,
    session,
    setAnalysisDraft,
    setIsEditingScript,
    setIsScriptEdited,
    setPendingTrimFile,
    setPreviewVideo,
    setProductName,
    setScriptEditorValue,
    setSettingsDraft,
    setViewStep,
    settingsDraft,
    showGenerationStages,
    showReadyCandidates,
    showStep1Loading,
    showStep4Loading,
    showThinkingPanel,
    stageRatio,
    thinkingAutoScrollRef,
    thinkingBodyRef,
    thinkingText,
    toggleAudio,
    toggleThinkingCollapsed,
    videoInputRef,
    usesReferencePreset,
  };
}

export type PromptPlanningController = ReturnType<typeof usePromptPlanningController>;
