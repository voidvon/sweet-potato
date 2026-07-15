import { Modal } from 'antd';
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronUp,
  LoaderCircle,
  Minus,
  Music4,
  Play,
  Plus,
  Video,
  RefreshCcw,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MutableRefObject,
} from 'react';
import {
  createContentAssetGroup,
  deleteReferenceVideo,
  listContentAssetGroups,
  trimReferenceVideo,
  uploadContentAsset,
} from '../../../../api/content';
import {
  applyPlanningSession,
  analyzePlanningSession,
  createPlanningEventSource,
  createPlanningSession,
  generatePlanningCandidates,
  getPlanningSession,
  getPlanningSessionUpdates,
  selectPlanningCandidate,
  updatePlanningConfirmation,
  updatePlanningSettings,
  type PlanningApplyPayload,
  type PlanningCandidate,
  type PlanningGeneration,
  type PlanningJobStage,
  type PlanningMaterialCaption,
  type PlanningProductInsights,
  type PlanningRealtimeEvent,
  type PlanningSession,
  type PlanningSettings,
  type PlanningUiStep,
} from '../../../../api/content-planning';
import { resolveAssetUrl } from '../../../../api/request';
import type { ContentAssetResourceType, User } from '../../../../types';
import {
  buildPlanningSeedMaterials,
  formatPlanningTimeRange,
  mergePlanningSessionUpdates,
  normalizePlanningPromptTokens,
  planningCompletionRatio,
  planningShouldPoll,
  planningStepIndex,
  planningSteps,
  resolvePlanningStep,
} from '../planningHelpers';
import type {
  LocalMaterialFile,
  MaterialKind,
  PromptPanel as PromptPanelKind,
  SelectedMaterialValue,
  SelectedMaterials,
} from '../types';
import { readVideoDuration, shouldTrimReferenceVideo } from '../videoMetadata';
import { MaterialSlot } from './MaterialSlot';
import { ReferenceVideoCard, type ConfirmedReferenceVideo } from './ReferenceVideoCard';
import { ReferenceVideoPreviewModal } from './ReferenceVideoPreviewModal';
import { TrimReferenceVideoModal, type TrimSelection } from './TrimReferenceVideoModal';

type PromptPlanningModalProps = {
  currentUser: User;
  initialPrompt: string;
  initialSelectedMaterials: SelectedMaterials;
  kind: PromptPanelKind;
  onApplyPlanningResult: (payload: PlanningApplyPayload) => void;
  onClose: () => void;
};

type BusyAction =
  | 'idle'
  | 'restoring'
  | 'analyzing'
  | 'confirming'
  | 'generating'
  | 'selecting'
  | 'applying';

type AnalysisDraft = {
  useBreakdown: boolean;
  materialCaptions: PlanningMaterialCaption[];
  productInsights: PlanningProductInsights;
};

type PlanningStageItem = {
  jobStage: PlanningJobStage;
  role: string;
  shortLabel: string;
};

type CaptionDraftCard = {
  id: string;
  label: string;
  previewUrl: string;
  description: string;
};

const modalCopy: Record<PromptPanelKind, { title: string; subtitle: string; action: string }> = {
  marketing: {
    title: '爆款策划',
    subtitle: '上传商品图，AI 帮你策划这条电商视频的脚本',
    action: '开始识别 · 2积分',
  },
  reverse: {
    title: '爆款策划',
    subtitle: '上传商品图，AI 帮你策划这条电商视频的脚本',
    action: '开始识别 · 2积分',
  },
  write: {
    title: '爆款策划',
    subtitle: '上传商品图，AI 帮你策划这条电商视频的脚本',
    action: '开始识别 · 2积分',
  },
};

const railSteps: Record<PlanningUiStep, string> = {
  step1: '商品素材',
  step2: '确认信息',
  step3: '视频设定',
  step4: '挑选脚本',
};

const stageItems: PlanningStageItem[] = [
  { jobStage: 'planner_running', role: 'Planner', shortLabel: '规划' },
  { jobStage: 'strategy_running', role: 'Strategy', shortLabel: '方向' },
  { jobStage: 'timeline_running', role: 'Timeline', shortLabel: '节奏' },
  { jobStage: 'copywriter_running', role: 'Copywriter', shortLabel: '文案' },
  { jobStage: 'visual_director_running', role: 'Visual', shortLabel: '分镜' },
  { jobStage: 'validator_running', role: 'Validator', shortLabel: '校验' },
];

const imageMaterial: MaterialKind = { key: 'image', label: '商品素材', hint: '1-9 张', meta: '必传', minCount: 1, maxCount: 9 };
const videoMaterial: MaterialKind = { key: 'video', label: '参考视频', hint: '限 1 条', meta: '选填', maxCount: 1 };
const audioMaterial: MaterialKind = { key: 'audio', label: '参考音色', hint: '限 1 段', meta: '选填', maxCount: 1 };

const sceneOptions: Array<{ value: PlanningSettings['businessScene']; label: string }> = [
  { value: 'ecommerce', label: '电商带货' },
  { value: 'local_service', label: '同城到店' },
  { value: 'door_to_door', label: '上门服务' },
  { value: 'education', label: '教育培训' },
];

const languageOptions: Array<{ value: PlanningSettings['spokenLanguage']; label: string }> = [
  { value: 'zh', label: '中文' },
  { value: 'en', label: '英文' },
  { value: 'ja', label: '日文' },
  { value: 'de', label: '德文' },
  { value: 'fr', label: '法文' },
];

const durationOptions: PlanningSettings['durationSeconds'][] = [5, 10, 15];
const stylePresets = ['干净明亮', '高级感', '直播感', '生活化', '电影质感', '不限'];
const contentTypeOptions = ['智能匹配', '带货类', '种草类', '同城类', '知识类', '娱乐类', '卖点钩子', '不限定'];
const shootingMethodOptions = ['智能匹配', '口播', '桌拍', '情景演绎', 'Vlog/生活记录', '跟拍/运动镜头', '一镜到底', '品牌TVC', '不限定'];

const defaultSettings: PlanningSettings = {
  businessScene: 'unrestricted',
  contentType: '',
  shootingMethod: '',
  spokenLanguage: 'zh',
  displayOnly: false,
  extraInstruction: '',
  durationSeconds: 5,
  styleKeywords: ['干净明亮'],
  deepThink: true,
  webSearch: false,
  candidateCount: 1,
  referencePolicy: {
    useBreakdown: true,
    lockedContentPreset: null,
  },
};

export function PromptPlanningModal({
  currentUser,
  initialPrompt,
  initialSelectedMaterials,
  kind,
  onApplyPlanningResult,
  onClose,
}: PromptPlanningModalProps) {
  const copy = modalCopy[kind];
  const uploadGroupIdsRef = useRef<Partial<Record<ContentAssetResourceType, string>>>({});
  const ownedObjectUrlsRef = useRef(new Set<string>());
  const pollSinceRef = useRef('');
  const materialsRef = useRef<SelectedMaterials>({});
  const busyActionRef = useRef<BusyAction>('idle');
  const analyzeLockRef = useRef(false);
  const generateLockRef = useRef(false);
  const restorePromiseRef = useRef<Promise<PlanningSession> | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const audioInputRef = useRef<HTMLInputElement | null>(null);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const thinkingBodyRef = useRef<HTMLPreElement | null>(null);
  const [busyAction, setBusyAction] = useState<BusyAction>('idle');
  const [session, setSession] = useState<PlanningSession | null>(null);
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
  const resolvedStep = session ? resolvePlanningStep(session) : 'step1';
  const resolvedStepIndex = planningStepIndex(resolvedStep);
  const activeStep = useMemo<PlanningUiStep>(() => {
    if (busyAction === 'analyzing' || session?.status === 'analyzing') {
      return 'step1';
    }
    if (session?.status === 'generating') {
      return 'step4';
    }
    return viewStep;
  }, [busyAction, session?.status, viewStep]);
  const maxUnlockedStepIndex = session ? resolvedStepIndex : 0;
  const railState = useMemo(() => planningSteps.map((step, index) => {
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
  }), [activeStep, maxUnlockedStepIndex, resolvedStepIndex]);
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
  const thinkingText = useMemo(
    () => buildReasoningText(session?.generation),
    [
      session?.generation.reasoningLogs,
      session?.generation.reasoningStream?.content,
      session?.generation.stageOutputs,
      session?.generation.validatorSummary,
    ],
  );
  const isWaitingForThinkingDelta = session?.status === 'generating'
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
  const showThinkingPanel = activeStep === 'step4' && Boolean(thinkingText);
  const showGenerationStages = showStep4Loading && Boolean(thinkingText);
  const showReadyCandidates = (session?.status === 'ready_to_apply' || session?.status === 'applied')
    && Boolean(session.generation.candidates.length);

  const updateBusyAction = (next: BusyAction) => {
    busyActionRef.current = next;
    setBusyAction(next);
  };

  useEffect(() => {
    materialsRef.current = materials;
  }, [materials]);

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
    if (!session) {
      return;
    }
    pollSinceRef.current = session.updatedAt;
    setViewStep(resolvePlanningStep(session));
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

  useEffect(() => {
    if (!thinkingText || isThinkingCollapsed || session?.status !== 'generating') {
      return undefined;
    }
    const frame = window.requestAnimationFrame(() => {
      const body = thinkingBodyRef.current;
      if (body) {
        body.scrollTop = body.scrollHeight;
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [isThinkingCollapsed, session?.status, thinkingText]);

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
    setSelectedCandidateId(candidate.id);
    setErrorMessage('');
    if (candidate.id === session.generation.selectedCandidateId) {
      return;
    }

    updateBusyAction('selecting');
    try {
      const next = await selectPlanningCandidate({
        userId: currentUser.id,
        sessionId: session.id,
        candidateId: candidate.id,
      });
      setSession(next);
      updateBusyAction('idle');
    } catch (error) {
      setSelectedCandidateId(previousId);
      updateBusyAction('idle');
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

  const triggerVideoInput = () => videoInputRef.current?.click();
  const triggerAudioInput = () => audioInputRef.current?.click();

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

  const analyzeCopy = getAnalyzeLoadingCopy(session?.jobStage || 'idle', {
    hasAudio: Boolean(referenceAudioFile || session?.materialBundle.referenceAudio),
    hasVideo: hasReferenceVideo,
  });
  const generateCopy = getGenerateLoadingCopy(session?.jobStage || 'idle', Boolean(thinkingText));
  const footerPoints = activeStep === 'step3' || activeStep === 'step4' ? 3 : 0;

  return (
    <Modal
      centered
      className="video-task-epa-modal"
      closable={false}
      footer={null}
      maskClosable
      onCancel={onClose}
      open
      rootClassName="video-task-epa-modal-root"
      style={{ padding: 0 }}
      styles={{ body: { padding: 0 } }}
      title={null}
      width={980}
    >
      <section aria-labelledby="video-task-epa-title" className="video-task-epa-panel" role="dialog">
        <input
          accept="video/*"
          className="video-task-epa-native-input"
          onChange={handleVideoInput}
          ref={videoInputRef}
          type="file"
        />
        <input
          accept=".mp3,.wav,audio/mpeg,audio/mp3,audio/wav,audio/x-wav"
          className="video-task-epa-native-input"
          onChange={handleAudioInput}
          ref={audioInputRef}
          type="file"
        />

        <header className="video-task-epa-head">
          <div className="video-task-epa-head-text">
            <strong id="video-task-epa-title">{copy.title}</strong>
            <span>{copy.subtitle}</span>
          </div>
          <button aria-label="关闭" className="video-task-epa-close" onClick={onClose} type="button">
            <X size={18} />
          </button>
        </header>

        <div className="video-task-epa-body">
          <nav aria-label="策划步骤" className="video-task-epa-rail">
            {railState.map((item) => {
              return (
                <button
                  className={[
                    item.isCurrent ? 'is-active' : '',
                    item.isCompleted ? 'is-completed' : '',
                  ].filter(Boolean).join(' ')}
                  aria-current={item.isCurrent ? 'step' : undefined}
                  disabled={item.isDisabled}
                  key={item.step}
                  onClick={() => {
                    if (!session || item.isDisabled) {
                      return;
                    }
                    setViewStep(item.step);
                  }}
                  type="button"
                >
                  <span aria-hidden="true">
                    {item.isCompleted ? <Check size={18} strokeWidth={2.8} /> : item.index + 1}
                  </span>
                  {railSteps[item.step]}
                </button>
              );
            })}
          </nav>

          <main className={`video-task-epa-main video-task-epa-step-shell-${activeStep}`}>
              {errorMessage ? (
                <div className="video-task-epa-alert is-error">
                  <AlertCircle size={16} />
                  <span>{errorMessage}</span>
                </div>
              ) : null}

              {activeStep === 'step1' && (
                  showStep1Loading ? (
                    <CenteredLoadingCard
                      description={analyzeCopy.description}
                      progress={stageRatio}
                      title={analyzeCopy.title}
                    />
                  ) : (
                    <>
                      <FieldHeading title="商品素材" subtitle="必填 · 1-9 张 · 可拖入/粘贴" />
                      <div className="video-task-epa-product-slot">
                        <MaterialSlot
                          item={imageMaterial}
                          onClear={clearMaterial}
                          onLocalFiles={handleLocalFiles}
                          onOpen={() => undefined}
                          onRemoveOne={() => removeMaterialAt('image', imageFiles.length - 1)}
                          openMode="local"
                          selected={materials.image}
                        />
                      </div>

                      <FieldHeading
                        title="参考视频"
                        subtitle="选填 · 1条 · AI 拆解节奏/镜头/结构，脚本照爆款复刻"
                      />
                      {referenceVideoFile ? (
                        <ReferenceVideoCard
                          onPreview={() => setPreviewVideo(toConfirmedReferenceVideo(referenceVideoFile))}
                          onRemove={() => clearMaterial(videoMaterial)}
                          onReplace={triggerVideoInput}
                          video={toConfirmedReferenceVideo(referenceVideoFile)}
                        />
                      ) : (
                        <button className="video-task-epa-upload-bar" onClick={triggerVideoInput} type="button">
                          <Video size={20} />
                          <strong>点击上传参考视频</strong>
                          <span>支持 mp4 / mov，识别时会自动拆解节奏与镜头结构</span>
                        </button>
                      )}

                      <FieldHeading
                        title="参考音色"
                        subtitle="选填 · 1段 · 口播照这个音色配音（锁音色）"
                      />
                      {referenceAudioFile ? (
                        <AudioReferenceCard
                          file={referenceAudioFile}
                          isPlaying={isAudioPlaying}
                          onPlayToggle={() => toggleAudio(referenceAudioFile)}
                          onRemove={() => clearMaterial(audioMaterial)}
                          onReplace={triggerAudioInput}
                        />
                      ) : (
                        <button className="video-task-epa-audio-upload" onClick={triggerAudioInput} type="button">
                          <div className="video-task-epa-audio-upload-main">
                            <Music4 size={16} />
                            <strong>点击上传参考音色</strong>
                          </div>
                          <span>mp3 / wav · 口播对口型用该音色</span>
                        </button>
                      )}

                      <FieldHeading
                        title="想介绍的商品"
                        subtitle="选填 · 多主体时帮 AI 聚焦"
                      />
                      <input
                        className="video-task-epa-inline-input"
                        onChange={(event) => setProductName(event.currentTarget.value)}
                        placeholder="如：连衣裙"
                        type="text"
                        value={productName}
                      />
                    </>
                  )
                )}

              {activeStep === 'step2' && session && (
                  <>
                    <section className="video-task-epa-analysis-section">
                      <div className="video-task-epa-section-head">
                        <div>
                          <strong>参考视频爆款拆解</strong>
                          <span>脚本将照这条视频的结构复刻</span>
                        </div>
                        {session.analysis.viralBreakdown ? (
                          <button
                            className={`video-task-epa-text-action${analysisDraft.useBreakdown ? '' : ' is-muted'}`}
                            onClick={() => {
                              onAnalysisDraftChange({
                                ...analysisDraft,
                                useBreakdown: !analysisDraft.useBreakdown,
                              });
                            }}
                            type="button"
                          >
                            {analysisDraft.useBreakdown ? '不复刻这条视频' : '恢复复刻这条视频'}
                          </button>
                        ) : null}
                      </div>
                      <div className="video-task-epa-breakdown-card">
                        {session.analysis.viralBreakdown ? (
                          <>
                            {session.analysis.viralBreakdown.tags.length ? (
                              <div className="video-task-epa-pill-line is-soft">
                                {session.analysis.viralBreakdown.tags.map((tag) => (
                                  <span className="video-task-epa-pill" key={tag}>{tag}</span>
                                ))}
                              </div>
                            ) : null}
                            <BreakdownLine label="结构框架" value={session.analysis.viralBreakdown.structureFramework} />
                            <BreakdownLine label="情绪曲线" value={session.analysis.viralBreakdown.emotionCurve} />
                            {session.analysis.viralBreakdown.segments.map((segment) => (
                              <BreakdownLine
                                key={`${segment.timeRange}-${segment.title}`}
                                label={formatPlanningTimeRange(segment.timeRange)}
                                value={`${segment.title}${segment.summary ? ` ${segment.summary}` : ''}`}
                              />
                            ))}
                            <BreakdownTagLine label="可替换" tags={session.analysis.viralBreakdown.replaceableElements} tone="green" />
                            <BreakdownTagLine label="建议保留" tags={session.analysis.viralBreakdown.keepElements} tone="gray" />
                            <BreakdownLine
                              label="适用品类"
                              value={session.analysis.viralBreakdown.applicableCategories.join('、')}
                            />
                          </>
                        ) : (
                          <div className="video-task-epa-empty-hint">未识别到参考视频拆解结果，后续会按商品素材独立生成脚本。</div>
                        )}
                      </div>
                    </section>

                    <section className="video-task-epa-analysis-section">
                      <div className="video-task-epa-section-head">
                        <div>
                          <strong>素材分析</strong>
                          <span>每张图的画面描述，可编辑，用于生成保持主体一致</span>
                        </div>
                      </div>
                      <div className="video-task-epa-caption-list">
                        {captionDraftCards.length ? captionDraftCards.map((caption, index) => (
                          <article className="video-task-epa-caption-card" key={caption.id}>
                            <img alt={caption.label} src={resolveAssetUrl(caption.previewUrl)} />
                            <div className="video-task-epa-caption-edit">
                              <span className="video-task-epa-caption-tag">@图片{index + 1}</span>
                              <textarea
                                onChange={(event) => onAnalysisDraftChange({
                                  ...analysisDraft,
                                  materialCaptions: analysisDraft.materialCaptions.map((item, itemIndex) => (
                                    itemIndex === index
                                      ? { ...item, label: caption.label, description: event.currentTarget.value }
                                      : item
                                  )),
                                })}
                                rows={2}
                                value={caption.description}
                              />
                            </div>
                          </article>
                        )) : (
                          <div className="video-task-epa-empty-hint">还没有商品图识别结果，请返回上一步补充图片后重新识别。</div>
                        )}
                      </div>
                    </section>

                    <section className="video-task-epa-analysis-section">
                      <div className="video-task-epa-section-head">
                        <div>
                          <strong>商品洞察</strong>
                          <span>名称、特性、卖点、目标人群和使用场景都会带入脚本生成</span>
                        </div>
                      </div>
                      <div className="video-task-epa-grid-2">
                        <label className="video-task-epa-stack-field">
                          <span>商品名称</span>
                          <input
                            className="video-task-epa-inline-input"
                            onChange={(event) => onAnalysisDraftChange({
                              ...analysisDraft,
                              productInsights: {
                                ...analysisDraft.productInsights,
                                productName: event.currentTarget.value,
                              },
                            })}
                            type="text"
                            value={analysisDraft.productInsights.productName}
                          />
                        </label>
                        <label className="video-task-epa-stack-field">
                          <span>商品类目</span>
                          <input
                            className="video-task-epa-inline-input"
                            onChange={(event) => onAnalysisDraftChange({
                              ...analysisDraft,
                              productInsights: {
                                ...analysisDraft.productInsights,
                                productCategory: event.currentTarget.value,
                              },
                            })}
                            type="text"
                            value={analysisDraft.productInsights.productCategory}
                          />
                        </label>
                      </div>
                      <div className="video-task-epa-grid-2 is-tags">
                        <EditableTagField
                          label="产品特性"
                          onChange={(values) => onAnalysisDraftChange({
                            ...analysisDraft,
                            productInsights: {
                              ...analysisDraft.productInsights,
                              productFeatures: values,
                            },
                          })}
                          placeholder="如 大方领、泡泡袖，回车添加"
                          values={analysisDraft.productInsights.productFeatures}
                        />
                        <EditableTagField
                          label="核心卖点"
                          onChange={(values) => onAnalysisDraftChange({
                            ...analysisDraft,
                            productInsights: {
                              ...analysisDraft.productInsights,
                              coreSellingPoints: values,
                            },
                          })}
                          placeholder="如 显锁骨、遮手臂，回车添加"
                          values={analysisDraft.productInsights.coreSellingPoints}
                        />
                        <EditableTagField
                          label="目标人群"
                          onChange={(values) => onAnalysisDraftChange({
                            ...analysisDraft,
                            productInsights: {
                              ...analysisDraft.productInsights,
                              targetAudience: values,
                            },
                          })}
                          placeholder="如 18-30 岁年轻女性，回车添加"
                          values={analysisDraft.productInsights.targetAudience}
                        />
                        <EditableTagField
                          label="使用场景"
                          onChange={(values) => onAnalysisDraftChange({
                            ...analysisDraft,
                            productInsights: {
                              ...analysisDraft.productInsights,
                              useScenarios: values,
                            },
                          })}
                          placeholder="如 草坪野餐、海边度假，回车添加"
                          values={analysisDraft.productInsights.useScenarios}
                        />
                      </div>
                    </section>
                  </>
                )}

              {activeStep === 'step3' && session && (
                  <>
                    <section className="video-task-epa-settings-section">
                      <FieldHeading title="业务场景" subtitle="选填 · 影响话术与结尾引导" />
                      <div className="video-task-epa-pill-line">
                        {sceneOptions.map((option) => {
                          const active = option.value === settingsDraft.businessScene;
                          return (
                            <button
                              aria-pressed={active}
                              className={active ? 'is-active' : ''}
                              key={option.value}
                              onClick={() => setSettingsDraft((current) => ({
                                ...current,
                                businessScene: active ? 'unrestricted' : option.value,
                              }))}
                              type="button"
                            >
                              {option.label}
                              {active ? <Check aria-hidden="true" size={13} /> : null}
                            </button>
                          );
                        })}
                      </div>
                    </section>

                    {usesReferencePreset ? (
                      <section className="video-task-epa-settings-section">
                        <FieldHeading title="内容类型 · 拍摄方式" subtitle="" />
                        <div className="video-task-epa-locked-note">
                          <Check aria-hidden="true" size={15} />
                          <span>已由参考视频决定，脚本将照其结构与镜头复刻，无需手动选择</span>
                        </div>
                      </section>
                    ) : (
                      <div className="video-task-epa-manual-preset-stack">
                        <section className="video-task-epa-settings-section">
                          <FieldHeading title="内容类型" subtitle="必选" />
                          <div className="video-task-epa-pill-line is-wrap">
                            {contentTypeOptions.map((option) => {
                              const active = settingsDraft.contentType === option;
                              return (
                                <button
                                  aria-pressed={active}
                                  className={active ? 'is-active' : ''}
                                  key={option}
                                  onClick={() => setSettingsDraft((current) => ({ ...current, contentType: option }))}
                                  type="button"
                                >
                                  {option}
                                  {active ? <Check aria-hidden="true" size={13} /> : null}
                                </button>
                              );
                            })}
                          </div>
                        </section>
                        <section className="video-task-epa-settings-section">
                          <FieldHeading title="拍摄方式" subtitle="必选 · 口播会自动配合词对口型" />
                          <div className="video-task-epa-pill-line is-wrap">
                            {shootingMethodOptions.map((option) => {
                              const active = settingsDraft.shootingMethod === option;
                              return (
                                <button
                                  aria-pressed={active}
                                  className={active ? 'is-active' : ''}
                                  key={option}
                                  onClick={() => setSettingsDraft((current) => ({ ...current, shootingMethod: option }))}
                                  type="button"
                                >
                                  {option}
                                  {active ? <Check aria-hidden="true" size={13} /> : null}
                                </button>
                              );
                            })}
                          </div>
                        </section>
                      </div>
                    )}

                    <section className="video-task-epa-settings-section">
                      <FieldHeading title="口播语言" subtitle="选填 · 只切台词/口播语言，分镜与画面描述仍中文" />
                      <div className="video-task-epa-pill-line">
                        {languageOptions.map((option) => (
                          <button
                            aria-pressed={option.value === settingsDraft.spokenLanguage}
                            className={option.value === settingsDraft.spokenLanguage ? 'is-active' : ''}
                            key={option.value}
                            onClick={() => setSettingsDraft((current) => ({ ...current, spokenLanguage: option.value }))}
                            type="button"
                          >
                            {option.label}
                            {option.value === settingsDraft.spokenLanguage ? <Check aria-hidden="true" size={13} /> : null}
                          </button>
                        ))}
                      </div>
                    </section>

                    <SwitchRow
                      checked={settingsDraft.displayOnly}
                      description="勾选后生成的脚本不带口播台词，仅作视觉展示（自动写入补充说明）"
                      label="仅展示"
                      onChange={(checked) => setSettingsDraft((current) => ({ ...current, displayOnly: checked }))}
                    />

                    <section className="video-task-epa-settings-section">
                      <FieldHeading title="补充说明" subtitle="可选 · 想强调的开头、卖点、节奏都可以写" />
                      <textarea
                        className="video-task-epa-large-textarea"
                        onChange={(event) => setSettingsDraft((current) => ({ ...current, extraInstruction: event.currentTarget.value }))}
                        placeholder="例如：前 2 秒要有钩子；多给面料和细节特写；结尾自然引导下单。"
                        rows={3}
                        value={settingsDraft.extraInstruction}
                      />
                    </section>

                    <section className="video-task-epa-settings-section">
                      <FieldHeading title="视频时长" subtitle="必选 · 决定镜头分几段" />
                      <div className="video-task-epa-pill-line">
                        {durationOptions.map((option) => (
                          <button
                            aria-pressed={option === settingsDraft.durationSeconds}
                            className={option === settingsDraft.durationSeconds ? 'is-active' : ''}
                            key={option}
                            onClick={() => setSettingsDraft((current) => ({ ...current, durationSeconds: option }))}
                            type="button"
                          >
                            {option} 秒
                            {option === settingsDraft.durationSeconds ? <Check aria-hidden="true" size={13} /> : null}
                          </button>
                        ))}
                      </div>
                    </section>

                    <section className="video-task-epa-settings-section">
                      <FieldHeading title="视频风格" subtitle="必选" />
                      <div className="video-task-epa-pill-line is-wrap">
                        {stylePresets.map((style) => {
                          const active = settingsDraft.styleKeywords.includes(style);
                          return (
                            <button
                              aria-pressed={active}
                              className={active ? 'is-active' : ''}
                              key={style}
                              onClick={() => setSettingsDraft((current) => ({
                                ...current,
                                styleKeywords: active ? current.styleKeywords.filter((item) => item !== style) : [style],
                              }))}
                              type="button"
                            >
                              {style}
                              {active ? <Check aria-hidden="true" size={13} /> : null}
                            </button>
                          );
                        })}
                      </div>
                    </section>

                    <section className="video-task-epa-settings-section">
                      <FieldHeading title="生成设置" subtitle="选填" />
                      <div className="video-task-epa-setting-stack">
                        <SwitchRow
                          checked={settingsDraft.deepThink}
                          description="更懂图、效果更好、生成较慢（约 1-2 分钟）"
                          emphasis={settingsDraft.deepThink}
                          label="深度思考"
                          onChange={(checked) => setSettingsDraft((current) => ({ ...current, deepThink: checked }))}
                        />
                        <SwitchRow
                          checked={settingsDraft.webSearch}
                          description="结合实时信息辅助改写，按需开启"
                          label="联网搜索"
                          onChange={(checked) => setSettingsDraft((current) => ({ ...current, webSearch: checked }))}
                        />
                      </div>
                    </section>
                  </>
                )}

              {activeStep === 'step4' && session && (
                  <>
                    {showStep4Loading ? (
                      <WideLoadingCard
                        description={generateCopy.description}
                        progress={stageRatio}
                        showStages={showGenerationStages}
                        stageItems={stageItems}
                        stages={session.generation.stages}
                        title={generateCopy.title}
                      />
                    ) : null}

                    {showThinkingPanel ? (
                      <section className="video-task-epa-thinking-panel">
                        <button
                          className="video-task-epa-thinking-head"
                          onClick={() => setIsThinkingCollapsed((current) => !current)}
                          type="button"
                        >
                          <div>
                            <span className="video-task-epa-thinking-dot" />
                            <strong>深度思考过程</strong>
                          </div>
                          <span>{isThinkingCollapsed ? '展开' : '收起'} {isThinkingCollapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}</span>
                        </button>
                        {!isThinkingCollapsed ? (
                          <pre
                            aria-busy={isWaitingForThinkingDelta}
                            aria-live="polite"
                            className="video-task-epa-thinking-body"
                            ref={thinkingBodyRef}
                          >
                            {thinkingText}
                            {isWaitingForThinkingDelta ? (
                              <>
                                {'\n'}
                                <span className="video-task-epa-thinking-placeholder">
                                  思考中
                                  <span aria-hidden="true" className="video-task-epa-thinking-dots">
                                    <i />
                                    <i />
                                    <i />
                                  </span>
                                </span>
                              </>
                            ) : null}
                          </pre>
                        ) : null}
                      </section>
                    ) : null}

                    {showReadyCandidates ? (
                      <>
                        <div className="video-task-epa-candidate-row">
                          {session.generation.candidates.map((candidate, index) => {
                            const isActive = candidate.id === selectedCandidate?.id;
                            return (
                              <button
                                className={`video-task-epa-candidate-card${isActive ? ' is-active' : ''}`}
                                key={candidate.id}
                                onClick={() => void handleSelectCandidate(candidate)}
                                type="button"
                              >
                                <span className="video-task-epa-candidate-pill">脚本{index + 1}</span>
                                <strong>{candidate.title}</strong>
                                <p>{candidate.summary}</p>
                              </button>
                            );
                          })}
                        </div>

                        <section className="video-task-epa-script-card">
                          <div className="video-task-epa-script-head">
                            <div>
                              <strong>选中脚本（逐秒分镜）</strong>
                              <span>点「编辑」可微调，确认后回填</span>
                            </div>
                            <button
                              className="video-task-epa-edit-btn"
                              onClick={() => setIsEditingScript((current) => !current)}
                              type="button"
                            >
                              {isEditingScript ? '完成' : '编辑'}
                            </button>
                          </div>
                          <textarea
                            className="video-task-epa-script-editor"
                            onChange={(event) => {
                              setScriptEditorValue(event.currentTarget.value);
                              setIsScriptEdited(true);
                            }}
                            readOnly={!isEditingScript}
                            rows={18}
                            value={scriptEditorValue}
                          />
                        </section>
                      </>
                    ) : !showStep4Loading ? (
                      <div className="video-task-epa-empty-hint">脚本生成完成后，这里会展示候选脚本与逐秒分镜。</div>
                    ) : null}
                  </>
                )}
          </main>

          <footer className="video-task-epa-footer">
              <div className="video-task-epa-footer-left">
                <button className="video-task-epa-clear" onClick={clearAll} type="button">
                  <Trash2 size={15} />
                  清除
                </button>
                {footerPoints ? (
                  <span className="video-task-epa-points">
                    <Zap size={14} />
                    {footerPoints}
                  </span>
                ) : null}
              </div>

              <div className="video-task-epa-footer-right">
                {activeStep === 'step1' ? (
                  <>
                    <button className="video-task-epa-btn video-task-epa-btn-text" onClick={onClose} type="button">
                      取消
                    </button>
                    <button
                      className="video-task-epa-btn video-task-epa-btn-accent"
                      disabled={isAnalyzing || isBusy || imageFiles.length === 0}
                      onClick={() => void handleAnalyze()}
                      type="button"
                    >
                      {isAnalyzing ? <LoaderCircle className="is-spinning" size={16} /> : null}
                      {isAnalyzing ? '分析中...' : copy.action}
                    </button>
                  </>
                ) : null}

                {activeStep === 'step2' ? (
                  <>
                    <button
                      className="video-task-epa-btn video-task-epa-btn-secondary"
                      disabled={isBusy}
                      onClick={() => void handleAnalyze()}
                      type="button"
                    >
                      {busyAction === 'analyzing' ? <LoaderCircle className="is-spinning" size={16} /> : <RefreshCcw size={15} />}
                      重新识别 · 2积分
                    </button>
                    <button
                      className="video-task-epa-btn video-task-epa-btn-accent"
                      disabled={isBusy}
                      onClick={() => {
                        if (session?.status === 'confirming' || analysisDirty) {
                          void handleConfirmAnalysis();
                          return;
                        }
                        setViewStep('step3');
                      }}
                      type="button"
                    >
                      {busyAction === 'confirming' ? <LoaderCircle className="is-spinning" size={16} /> : null}
                      下一步
                    </button>
                  </>
                ) : null}

                {activeStep === 'step3' ? (
                  <>
                    <button
                      className="video-task-epa-btn video-task-epa-btn-text"
                      onClick={() => setViewStep('step2')}
                      type="button"
                    >
                      返回上一步
                    </button>
                    {isManualPresetMissing ? (
                      <span className="video-task-epa-footer-warning">
                        <AlertCircle aria-hidden="true" size={14} />
                        请先选择内容类型、拍摄方式
                      </span>
                    ) : null}
                    <div className="video-task-epa-stepper">
                      <button
                        aria-label="减少候选数量"
                        className="video-task-epa-stepper-btn"
                        disabled={settingsDraft.candidateCount <= 1}
                        onClick={() => setSettingsDraft((current) => ({
                          ...current,
                          candidateCount: Math.max(1, current.candidateCount - 1),
                        }))}
                        type="button"
                      >
                        <Minus size={12} />
                      </button>
                      <span>{settingsDraft.candidateCount} 条</span>
                      <button
                        aria-label="增加候选数量"
                        className="video-task-epa-stepper-btn"
                        disabled={settingsDraft.candidateCount >= 3}
                        onClick={() => setSettingsDraft((current) => ({
                          ...current,
                          candidateCount: Math.min(3, current.candidateCount + 1),
                        }))}
                        type="button"
                      >
                        <Plus size={12} />
                      </button>
                    </div>
                    <button
                      className="video-task-epa-btn video-task-epa-btn-accent"
                      disabled={isBusy || isManualPresetMissing}
                      onClick={() => void handleGenerate()}
                      type="button"
                    >
                      {busyAction === 'generating' ? <LoaderCircle className="is-spinning" size={16} /> : null}
                      生成脚本 · 3积分
                    </button>
                  </>
                ) : null}

                {activeStep === 'step4' ? (
                  <>
                    <button
                      className="video-task-epa-btn video-task-epa-btn-text"
                      onClick={() => setViewStep('step3')}
                      type="button"
                    >
                      返回上一步
                    </button>
                    <button
                      className="video-task-epa-btn video-task-epa-btn-secondary"
                      disabled={isBusy || !session || session.status === 'generating'}
                      onClick={() => void handleGenerate(true)}
                      type="button"
                    >
                      {busyAction === 'generating' ? <LoaderCircle className="is-spinning" size={16} /> : <RefreshCcw size={15} />}
                      {session?.status === 'generating' ? '生成中...' : '重新生成 · 3积分'}
                    </button>
                    <button
                      className="video-task-epa-btn video-task-epa-btn-accent"
                      disabled={isBusy || !canApply}
                      onClick={() => void handleApply()}
                      type="button"
                    >
                      {busyAction === 'applying' ? <LoaderCircle className="is-spinning" size={16} /> : null}
                      应用到视频 →
                    </button>
                  </>
                ) : null}
              </div>
          </footer>
        </div>
      </section>

      {pendingTrimFile ? (
        <TrimReferenceVideoModal
          file={pendingTrimFile}
          onCancel={() => {
            setPendingTrimFile(null);
            clearMaterial(videoMaterial);
          }}
          onConfirm={handleTrimConfirmed}
        />
      ) : null}

      {previewVideo ? (
        <ReferenceVideoPreviewModal
          onClose={() => setPreviewVideo(null)}
          video={previewVideo}
        />
      ) : null}
    </Modal>
  );

  function onAnalysisDraftChange(next: AnalysisDraft) {
    setAnalysisDraft(next);
  }

  async function handleLocalFiles(item: MaterialKind, files: FileList | File[]) {
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
  }

  function clearMaterial(item: MaterialKind) {
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
  }

  function removeMaterialAt(kind: MaterialKind['key'], index: number) {
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
  }

  async function handleTrimConfirmed(selection: TrimSelection) {
    const previousVideo = referenceVideoFile ? toConfirmedReferenceVideo(referenceVideoFile) : null;
    const result = await trimReferenceVideo({
      end: Number(selection.end.toFixed(1)),
      file: selection.file,
      start: Number(selection.start.toFixed(1)),
    });
    const nextFile = {
      id: `video-${crypto.randomUUID()}`,
      name: result.originalFileName || result.name || selection.file.name || '参考视频 01',
      type: 'video',
      url: resolveAssetUrl(result.fileUrl),
      serverFileUrl: result.fileUrl,
      storedFileName: result.storedFileName,
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
  }

  function toggleAudio(file: LocalMaterialFile) {
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
  }
}

function FieldHeading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="video-task-epa-field-head">
      <strong>{title}</strong>
      <span>{subtitle}</span>
    </div>
  );
}

function BreakdownLine({ label, value }: { label: string; value?: string }) {
  if (!value) {
    return null;
  }
  return (
    <div className="video-task-epa-breakdown-line">
      <span>{label}</span>
      <p>{value}</p>
    </div>
  );
}

function BreakdownTagLine({
  label,
  tags,
  tone,
}: {
  label: string;
  tags: string[];
  tone: 'gray' | 'green';
}) {
  if (!tags.length) {
    return null;
  }
  return (
    <div className="video-task-epa-breakdown-line">
      <span>{label}</span>
      <div className={`video-task-epa-tag-group is-${tone}`}>
        {tags.map((tag) => (
          <em key={tag}>{tag}</em>
        ))}
      </div>
    </div>
  );
}

function EditableTagField({
  label,
  onChange,
  placeholder,
  values,
}: {
  label: string;
  onChange: (values: string[]) => void;
  placeholder: string;
  values: string[];
}) {
  const [draft, setDraft] = useState('');

  const commitDraft = () => {
    const next = normalizeTagToken(draft);
    if (!next) {
      setDraft('');
      return;
    }
    if (values.includes(next)) {
      setDraft('');
      return;
    }
    onChange([...values, next]);
    setDraft('');
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',' || event.key === '，') {
      event.preventDefault();
      commitDraft();
    }
  };

  return (
    <div className="video-task-epa-tag-field">
      <span>{label}</span>
      <div className="video-task-epa-tag-list">
        {values.map((value) => (
          <button
            className="video-task-epa-tag-chip"
            aria-label={`删除${value}`}
            key={value}
            onClick={() => onChange(values.filter((item) => item !== value))}
            type="button"
          >
            <span>{value}</span>
            <X aria-hidden="true" size={12} />
          </button>
        ))}
      </div>
      <input
        className="video-task-epa-tag-add-input"
        onBlur={commitDraft}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        type="text"
        value={draft}
      />
    </div>
  );
}

function SwitchRow({
  checked,
  description,
  emphasis = false,
  label,
  onChange,
}: {
  checked: boolean;
  description: string;
  emphasis?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      className={`video-task-epa-switch-row`}
      onClick={() => onChange(!checked)}
      type="button"
    >
      <div className={`video-task-epa-switch${checked ? ' is-checked' : ''}`}>
        <span />
      </div>
      <div className="video-task-epa-switch-copy">
        <strong>{label}</strong>
        <span>{description}</span>
      </div>
    </button>
  );
}

function CenteredLoadingCard({
  description,
  progress,
  title,
}: {
  description: string;
  progress: number;
  title: string;
}) {
  return (
    <div className="video-task-epa-loading-shell">
      <div className="video-task-epa-loading-card">
        <div className="video-task-epa-loading-copy">
          <LoaderCircle className="is-spinning" size={18} />
          <div>
            <strong>{title}</strong>
            <span>{description}</span>
          </div>
        </div>
        <div className="video-task-epa-loading-progress">
          <span style={{ width: `${Math.max(progress * 100, 12)}%` }} />
        </div>
      </div>
    </div>
  );
}

function WideLoadingCard({
  description,
  progress,
  showStages,
  stageItems,
  stages,
  title,
}: {
  description: string;
  progress: number;
  showStages: boolean;
  stageItems: PlanningStageItem[];
  stages: PlanningGeneration['stages'];
  title: string;
}) {
  return (
    <div className="video-task-epa-wide-loading">
      <div className="video-task-epa-loading-copy">
        <LoaderCircle className="is-spinning" size={18} />
        <div>
          <strong>{title}</strong>
          <span>{description}</span>
        </div>
      </div>
      <div className="video-task-epa-loading-progress">
        <span style={{ width: `${Math.max(progress * 100, 12)}%` }} />
      </div>
      {showStages ? (
        <div className="video-task-epa-stage-strip">
          {stageItems.map((stage) => {
            const current = stages.find((item) => item.role === stage.role);
            const status = current?.status || 'pending';
            return (
              <span className={`video-task-epa-stage-pill is-${status}`} key={stage.role}>
                {stage.shortLabel}
              </span>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function AudioReferenceCard({
  file,
  isPlaying,
  onPlayToggle,
  onRemove,
  onReplace,
}: {
  file: LocalMaterialFile;
  isPlaying: boolean;
  onPlayToggle: () => void;
  onRemove: () => void;
  onReplace: () => void;
}) {
  const duration = Number.isFinite(file.audioDuration) && file.audioDuration ? `${Math.round(file.audioDuration)}s` : '音频';

  return (
    <div className="video-task-epa-audio-card">
      <button className="video-task-epa-audio-play" onClick={onPlayToggle} type="button">
        <Play size={18} fill="currentColor" />
      </button>
      <div className="video-task-epa-audio-info">
        <strong>{file.name}</strong>
        <span>{isPlaying ? '播放中' : duration}</span>
      </div>
      <div className="video-task-reference-actions">
        <button onClick={onPlayToggle} type="button">{isPlaying ? '暂停' : '试听'}</button>
        <button onClick={onReplace} type="button">换一段</button>
        <button className="is-danger" onClick={onRemove} type="button">移除</button>
      </div>
    </div>
  );
}

function buildAnalysisDraft(session: PlanningSession | null, useBreakdown: boolean): AnalysisDraft {
  return {
    useBreakdown,
    materialCaptions: session?.analysis.materialCaptions || [],
    productInsights: session?.analysis.productInsights || {
      productName: '',
      productCategory: '',
      productFeatures: [],
      coreSellingPoints: [],
      targetAudience: [],
      useScenarios: [],
    },
  };
}

function buildCaptionDraftCards(captions: PlanningMaterialCaption[]): CaptionDraftCard[] {
  return captions.map((caption, index) => ({
    description: caption.description,
    id: caption.id,
    label: caption.label || `图片${index + 1}`,
    previewUrl: caption.previewUrl,
  }));
}

const auditStageLabels: Record<string, string> = {
  planner: '1. 分析输入与约束',
  strategy: '2. 策略规划与差异化路线',
  timeline: '3. 细化时间轴与节奏',
  copywriter: '4. 撰写文案与字数检查',
  visualDirector: '5. 视觉落地与分镜定稿',
  validator: '6. 校验、修正与最终选择',
};

const hiddenAuditFields = new Set([
  'candidateId',
  'fullScript',
  'id',
  'materialRefs',
  'prompt',
  'script',
  'segmentId',
  'selectedCandidateId',
  'sourceStrategyId',
  'strategyId',
]);

const auditFieldLabels: Record<string, string> = {
  action: '主体动作',
  audienceAngle: '受众角度',
  beat: '节奏',
  brief: '策划简报',
  camera: '镜头',
  candidateDirections: '候选方向',
  candidateId: '候选 ID',
  candidates: '候选脚本',
  dialogue: '口播',
  emotionalArc: '情绪曲线',
  endSecond: '结束时间',
  followReferenceStructure: '沿用参考结构',
  goal: '目标',
  hardConstraints: '硬性约束',
  hook: '开场钩子',
  issues: '问题',
  lighting: '光线',
  lines: '分段文案',
  materialRefs: '素材引用',
  repairAdvice: '修复建议',
  score: '评分',
  selectedCandidateId: '推荐方案',
  segmentId: '分段 ID',
  segments: '时间段',
  soundEffect: '音效',
  spaceRelation: '空间关系',
  startSecond: '开始时间',
  storyboard: '逐秒分镜',
  strategies: '创意策略',
  strategyId: '策略 ID',
  summary: '摘要',
  tags: '标签',
  text: '文案',
  timelines: '时间轴',
  title: '标题',
  visual: '画面',
};

function buildReasoningText(generation?: PlanningGeneration) {
  if (!generation) {
    return '';
  }
  const contents = generation.reasoningLogs
    .map((log) => log.content.trim())
    .filter(Boolean);
  const streamingContent = generation.reasoningStream?.content.trim() || '';
  const storedOutputs = formatStoredStageOutputs(generation.stageOutputs || {});
  if (storedOutputs && !streamingContent) {
    return storedOutputs;
  }
  const visibleContents = [...Array.from(new Set(contents)), streamingContent].filter(Boolean);
  if (visibleContents.length) {
    return visibleContents.join('\n\n');
  }
  return generation.validatorSummary.trim();
}

function isReasoningStreamWaiting(generation?: PlanningGeneration) {
  const content = generation?.reasoningStream?.content.trim();
  if (!content) {
    return false;
  }
  return content.split('\n').filter((line) => line.trim()).length === 1;
}

function formatStoredStageOutputs(outputs: Record<string, unknown>) {
  return ['planner', 'strategy', 'timeline', 'copywriter', 'visualDirector', 'validator']
    .flatMap((stage) => {
      const output = outputs[stage];
      if (output === undefined || output === null) {
        return [];
      }
      return [auditStageLabels[stage], ...formatAuditValue(output, 0), ''];
    })
    .join('\n')
    .trim();
}

function formatAuditValue(value: unknown, depth: number): string[] {
  const indent = '  '.repeat(depth);
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => {
      if (isAuditPrimitive(item)) {
        return [`${indent}${index + 1}. ${formatAuditPrimitive(item)}`];
      }
      return [`${indent}${index + 1}.`, ...formatAuditValue(item, depth + 1)];
    });
  }
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, item]) => {
      if (hiddenAuditFields.has(key)) {
        return [];
      }
      const label = auditFieldLabels[key] || key;
      if (isAuditPrimitive(item)) {
        return [`${indent}${label}：${formatAuditPrimitive(item)}`];
      }
      return [`${indent}${label}：`, ...formatAuditValue(item, depth + 1)];
    });
  }
  return [`${indent}${formatAuditPrimitive(value)}`];
}

function isAuditPrimitive(value: unknown) {
  return value === null || ['boolean', 'number', 'string', 'undefined'].includes(typeof value);
}

function formatAuditPrimitive(value: unknown) {
  if (typeof value === 'boolean') {
    return value ? '是' : '否';
  }
  if (value === null || value === undefined || value === '') {
    return '无';
  }
  return String(value)
    .replace(/candidate-strategy-\d+-[a-z0-9]+/giu, '候选脚本')
    .replace(/strategy-\d+-[a-z0-9]+(?:-(?:segment|shot)-\d+)?/giu, '对应方案');
}

function invalidatePlanningSessionResult(
  session: PlanningSession,
  patch: Partial<Pick<PlanningSession, 'jobStage' | 'settings' | 'status' | 'uiStep'>>,
): PlanningSession {
  return {
    ...session,
    ...patch,
    applySnapshot: null,
    errorMessage: '',
    generation: {
      ...session.generation,
      candidates: [],
      reasoningLogs: [],
      selectedCandidateId: '',
      stageOutputs: {},
      stages: [],
      validatorSummary: '',
    },
  };
}

function formatCandidateScript(candidate: PlanningCandidate) {
  const storyboard = candidate.script?.storyboard || candidate.storyboard;
  const title = candidate.script?.title || candidate.title;
  const summary = candidate.script?.summary || candidate.summary;

  const parts = [
    `## ${title}`,
    summary,
    '',
    '逐秒分镜：',
  ].filter(Boolean);

  storyboard.forEach((segment) => {
    parts.push(
      '',
      `${segment.startSecond}-${segment.endSecond}s`,
      segment.visual ? `画面：${segment.visual}` : '',
      segment.action ? `主体动作：${segment.action}` : '',
      segment.camera ? `景别/运镜：${segment.camera}` : '',
      segment.spaceRelation ? `空间关系：${segment.spaceRelation}` : '',
      segment.lighting ? `光线：${segment.lighting}` : '',
      `口播：${segment.dialogue || '无，仅画面展示'}`,
      segment.soundEffect ? `音效与音乐：${segment.soundEffect}` : '',
    );
  });

  if (!storyboard.length && candidate.fullScript) {
    parts.push(candidate.fullScript);
  }

  return parts.filter(Boolean).join('\n');
}

function getAnalyzeLoadingCopy(
  jobStage: PlanningJobStage,
  references: { hasAudio: boolean; hasVideo: boolean },
) {
  if (jobStage === 'analyzing_reference_video') {
    if (!references.hasVideo && references.hasAudio) {
      return {
        title: '商品图识别完成，正在分析参考音色',
        description: '正在提取音色、语速与口播风格，请勿关闭',
      };
    }
    return {
      title: '商品图识别完成，正在拆解参考视频',
      description: '正在解析镜头/节奏/结构，脚本会照参考视频结构复刻，请勿关闭',
    };
  }
  if (!references.hasVideo && !references.hasAudio) {
    return {
      title: 'AI 正在识别商品素材',
      description: '正在分析商品主体、外观、核心卖点与使用场景，约 15-30 秒，请勿关闭',
    };
  }
  if (!references.hasVideo && references.hasAudio) {
    return {
      title: 'AI 正在分析商品素材 + 参考音色',
      description: '正在识别商品并提取参考音色的语速与口播风格，约 30-60 秒，请勿关闭',
    };
  }
  return {
    title: 'AI 正在分析素材 + 参考视频',
    description: '识别商品并拆解参考视频的节奏/镜头/结构，约 30-60 秒，请勿关闭',
  };
}

function getGenerateLoadingCopy(jobStage: PlanningJobStage, hasReasoning: boolean) {
  if (hasReasoning || jobStage === 'timeline_running' || jobStage === 'copywriter_running' || jobStage === 'visual_director_running' || jobStage === 'validator_running') {
    return {
      title: 'AI 正在深度思考',
      description: '构思逐秒分镜脚本，约 1-2 分钟 · 可关闭弹窗，后台继续生成',
    };
  }
  return {
    title: '正在发起生成',
    description: '可关闭弹窗，后台会继续生成，重新打开自动恢复',
  };
}

function normalizeProductInsights(value: PlanningProductInsights): PlanningProductInsights {
  return {
    productName: value.productName.trim(),
    productCategory: value.productCategory.trim(),
    productFeatures: normalizeTokens(value.productFeatures),
    coreSellingPoints: normalizeTokens(value.coreSellingPoints),
    targetAudience: normalizeTokens(value.targetAudience),
    useScenarios: normalizeTokens(value.useScenarios),
  };
}

function normalizePlanningSettingsDraft(settings: PlanningSettings): PlanningSettings {
  const normalizedKeywords = Array.from(new Set(settings.styleKeywords.map((item) => item.trim()).filter(Boolean))).slice(0, 6);
  return {
    ...settings,
    businessScene: sceneOptions.some((option) => option.value === settings.businessScene) ? settings.businessScene : 'unrestricted',
    candidateCount: Math.max(1, Math.min(3, Math.round(settings.candidateCount))),
    durationSeconds: [5, 10, 15].includes(settings.durationSeconds) ? settings.durationSeconds : 5,
    contentType: settings.contentType.trim(),
    shootingMethod: settings.shootingMethod.trim(),
    extraInstruction: settings.extraInstruction.trim(),
    styleKeywords: normalizedKeywords.length ? normalizedKeywords : ['干净明亮'],
  };
}

function normalizeTokens(value: string[]) {
  return value
    .flatMap((item) => item.split(/\n|,|，/))
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeTagToken(value: string) {
  return value.replace(/[，,]+$/g, '').trim();
}

function serializeAnalysisDraft(analysisDraft: AnalysisDraft) {
  return JSON.stringify({
    materialCaptions: analysisDraft.materialCaptions.map((caption, index) => ({
      label: `图片${index + 1}`,
      description: caption.description.trim(),
      previewUrl: caption.previewUrl,
    })),
    productInsights: normalizeProductInsights(analysisDraft.productInsights),
    useBreakdown: analysisDraft.useBreakdown,
  });
}

function serializeSessionAnalysis(session: PlanningSession, useBreakdown: boolean) {
  return JSON.stringify({
    materialCaptions: session.analysis.materialCaptions.map((caption, index) => ({
      label: `图片${index + 1}`,
      description: caption.description.trim(),
      previewUrl: caption.previewUrl,
    })),
    productInsights: normalizeProductInsights(session.analysis.productInsights),
    useBreakdown,
  });
}

function serializeSettingsDraft(settings: PlanningSettings) {
  const normalized = normalizePlanningSettingsDraft(settings);
  return JSON.stringify({
    businessScene: normalized.businessScene,
    candidateCount: normalized.candidateCount,
    contentType: normalized.contentType,
    deepThink: normalized.deepThink,
    displayOnly: normalized.displayOnly,
    durationSeconds: normalized.durationSeconds,
    extraInstruction: normalized.extraInstruction,
    shootingMethod: normalized.shootingMethod,
    spokenLanguage: normalized.spokenLanguage,
    styleKeywords: normalized.styleKeywords,
    webSearch: normalized.webSearch,
  });
}

function serializeStep1Draft(prompt: string, productName: string, materials: SelectedMaterials) {
  return JSON.stringify({
    materials: serializeMaterials(materials),
    productName: productName.trim(),
    prompt: prompt.trim(),
  });
}

function serializeSessionStep1(session: PlanningSession) {
  return JSON.stringify({
    materials: [
      ...session.materialBundle.imageMaterials.map((asset) => `${asset.kind}:${asset.assetId}`),
      ...(session.materialBundle.referenceVideo ? [`video:${session.materialBundle.referenceVideo.assetId}`] : []),
      ...(session.materialBundle.referenceAudio ? [`audio:${session.materialBundle.referenceAudio.assetId}`] : []),
    ],
    productName: session.materialBundle.productName.trim(),
    prompt: session.materialBundle.prompt.trim(),
  });
}

function serializeMaterials(materials: SelectedMaterials) {
  return [
    ...getLocalFiles(materials.image).map(serializeLocalMaterial),
    ...getLocalFiles(materials.video).map(serializeLocalMaterial),
    ...getLocalFiles(materials.audio).map(serializeLocalMaterial),
  ];
}

function serializeLocalMaterial(file: LocalMaterialFile) {
  return file.assetId
    ? `${file.type}:${file.assetId}`
    : file.serverFileUrl
    || `${file.type}:${file.name}:${file.file?.size || 0}`;
}

function sanitizePlanningMaterials(materials: SelectedMaterials): SelectedMaterials {
  const next: SelectedMaterials = {};
  const images = getLocalFiles(materials.image).slice(0, 9);
  const videos = getLocalFiles(materials.video).slice(0, 1);
  const audios = getLocalFiles(materials.audio).slice(0, 1);
  if (images.length) {
    next.image = images;
  }
  if (videos.length) {
    next.video = videos;
  }
  if (audios.length) {
    next.audio = audios;
  }
  return next;
}

function getLimit(kind: MaterialKind) {
  if (kind.maxCount !== undefined) {
    return kind.maxCount;
  }
  if (kind.key === 'image') {
    return 9;
  }
  return 1;
}

function getLocalFiles(value: SelectedMaterialValue): LocalMaterialFile[] {
  return Array.isArray(value) ? value : [];
}

function getRemainingCapacity(kind: MaterialKind, current: SelectedMaterialValue) {
  return Math.max(getLimit(kind) - getLocalFiles(current).length, 0);
}

function createOwnedObjectUrl(file: File, ownedObjectUrls: Set<string>) {
  const url = URL.createObjectURL(file);
  ownedObjectUrls.add(url);
  return url;
}

function isAllowedAudioFile(file: File) {
  const mimeType = file.type.toLowerCase();
  const name = file.name.toLowerCase();
  return mimeType === 'audio/mpeg'
    || mimeType === 'audio/mp3'
    || mimeType === 'audio/wav'
    || mimeType === 'audio/x-wav'
    || name.endsWith('.mp3')
    || name.endsWith('.wav');
}

function readAudioDuration(file: File) {
  return new Promise<number | undefined>((resolve) => {
    const audio = document.createElement('audio');
    const objectUrl = URL.createObjectURL(file);
    const cleanup = () => {
      audio.removeAttribute('src');
      URL.revokeObjectURL(objectUrl);
    };
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => {
      const duration = Number.isFinite(audio.duration) ? audio.duration : undefined;
      cleanup();
      resolve(duration);
    };
    audio.onerror = () => {
      cleanup();
      resolve(undefined);
    };
    audio.src = objectUrl;
  });
}

function revokeLocalMaterialList(files: LocalMaterialFile[], ownedObjectUrls: Set<string>) {
  files.forEach((file) => {
    if (ownedObjectUrls.has(file.url)) {
      URL.revokeObjectURL(file.url);
      ownedObjectUrls.delete(file.url);
    }
  });
}

function revokeSelectedMaterials(materials: SelectedMaterials, ownedObjectUrls: Set<string>) {
  Object.values(materials).forEach((value) => revokeLocalMaterialList(getLocalFiles(value), ownedObjectUrls));
}

function replaceSeedMaterials(current: SelectedMaterials, next: SelectedMaterials, ownedObjectUrls: Set<string>) {
  revokeSelectedMaterials(current, ownedObjectUrls);
  return next;
}

function hasSessionMaterialBundle(session: PlanningSession) {
  return session.materialBundle.imageMaterials.length > 0
    || Boolean(session.materialBundle.referenceVideo)
    || Boolean(session.materialBundle.referenceAudio);
}

function implicitUploadGroupName(resourceType: ContentAssetResourceType) {
  if (resourceType === 'voice') {
    return '视频制作参考音频';
  }
  return '视频制作参考素材';
}

async function ensureUploadGroupId(input: {
  currentUser: User;
  resourceType: ContentAssetResourceType;
  uploadGroupIdsRef: MutableRefObject<Partial<Record<ContentAssetResourceType, string>>>;
}) {
  const cached = input.uploadGroupIdsRef.current[input.resourceType];
  if (cached) {
    return cached;
  }
  const groups = await listContentAssetGroups(input.currentUser.id, input.resourceType);
  const existing = groups.find((group) => group.metadata?.systemDefault === true || group.name === implicitUploadGroupName(input.resourceType));
  if (existing) {
    input.uploadGroupIdsRef.current[input.resourceType] = existing.id;
    return existing.id;
  }
  const created = await createContentAssetGroup({
    userId: input.currentUser.id,
    resourceType: input.resourceType,
    name: implicitUploadGroupName(input.resourceType),
    metadata: {
      hiddenFromGroupUi: true,
      source: 'local_upload',
      systemDefault: true,
    },
  });
  input.uploadGroupIdsRef.current[input.resourceType] = created.id;
  return created.id;
}

async function ensureMaterialAssetIds(input: {
  currentUser: User;
  resourceType: ContentAssetResourceType;
  files: LocalMaterialFile[];
  uploadGroupIdsRef: MutableRefObject<Partial<Record<ContentAssetResourceType, string>>>;
}) {
  if (!input.files.length) {
    return [];
  }
  const groupId = await ensureUploadGroupId({
    currentUser: input.currentUser,
    resourceType: input.resourceType,
    uploadGroupIdsRef: input.uploadGroupIdsRef,
  });
  return Promise.all(input.files.map(async (file) => {
    if (file.assetId) {
      return file.assetId;
    }
    if (!file.file) {
      throw new Error(`缺少待上传素材文件：${file.name}`);
    }
    const uploaded = await uploadContentAsset({
      file: file.file,
      userId: input.currentUser.id,
      groupId,
      resourceType: input.resourceType,
      name: file.name,
      metadata: file.audioDuration
        ? { duration: file.audioDuration, source: 'local_upload' }
        : { source: 'local_upload' },
    });
    file.assetId = uploaded.id;
    file.serverFileUrl = uploaded.fileUrl;
    file.storedFileName = uploaded.storedFileName;
    file.url = resolveAssetUrl(uploaded.fileUrl);
    return uploaded.id;
  }));
}

function toConfirmedReferenceVideo(file: LocalMaterialFile): ConfirmedReferenceVideo {
  const duration = file.trimDuration ?? 15;
  return {
    duration,
    end: file.trimEnd ?? duration,
    fileUrl: file.serverFileUrl ?? file.url,
    name: file.name,
    start: file.trimStart ?? 0,
    storedFileName: file.storedFileName ?? '',
    videoUrl: file.url,
  };
}

async function deleteServerReferenceVideo(video: ConfirmedReferenceVideo) {
  if (!video.storedFileName && (!video.fileUrl || video.fileUrl.startsWith('blob:'))) {
    return;
  }
  try {
    await deleteReferenceVideo({
      fileUrl: video.fileUrl,
      storedFileName: video.storedFileName,
    });
  } catch {
    // Best-effort cleanup only.
  }
}
