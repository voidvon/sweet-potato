import { Input } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { t } from '@shared/i18n';
import { showApiError } from '@shared/utils/apiError';
import { appSocketManager } from '@/app/AppSocketManager';
import type { MediaAttachmentItem } from '../../../../components/MediaAttachmentStack';
import { resolveAssetUrl } from '../../../../api/request';
import {
  getAssetExtraction,
  getContentAsset,
  startAssetExtraction,
  uploadContentAsset,
} from '../../../../api/content';
import type { AssetExtraction, AssetExtractionUpdatedEvent } from '../../../../api/content';
import {
  analyzePlanningSession,
  cancelPlanningRemotionRender,
  createPlanningSession,
  generatePlanningCampaignImages,
  generatePlanningNarration,
  generatePlanningRemotionJSON,
  getPlanningVoices,
  getRemotionVideoPresets,
  getPlanningSession,
  startPlanningRemotionRender,
} from '../../../../api/content-planning';
import type {
  PlanningSession,
  PlanningSessionUpdatedEvent,
  PlanningVoice,
  RemotionVideoPreset,
} from '../../../../api/content-planning';
import {
  listContentWorkflows,
  saveContentWorkflow,
} from '../../../../api/content-workflows';
import type { ContentWorkflow } from '../../../../api/content-workflows';
import type { ContentAssetResourceType, User } from '../../../../types';
import type { MaterialKind } from '../types';
import type { DocumentExtractionView } from './AttachmentExtractionModal';
import { MaterialSlot } from './MaterialSlot';
import { ensureUploadGroupId } from './prompt-planning/materialHelpers';
import { WorkspaceSection } from './WorkspaceSection';

const MAX_ATTACHMENTS = 12;
const ACCEPTED_FILE_TYPES = 'image/*,video/*,.pptx,.pdf,application/pdf';
const referenceAttachmentMaterial: MaterialKind = {
  hint: t('最多 12 个'),
  key: 'image',
  label: t('附件'),
  maxCount: MAX_ATTACHMENTS,
  meta: t('可选'),
};

type ReferenceAttachmentKind = 'image' | 'video' | 'presentation' | 'pdf';

export type LightweightReferenceAttachment = {
  assetId?: string;
  file?: File;
  id: string;
  kind: ReferenceAttachmentKind;
  mimeType: string;
  name: string;
  previewUrl?: string;
};

export type LightweightCreationRecord = {
  analysisError: string;
  analysisSession: PlanningSession | null;
  attachments: LightweightReferenceAttachment[];
  brief: string;
  createdAt: string;
  documentExtractions: DocumentExtractionView[];
  extractionError: string;
  id: string;
  status: 'uploading' | 'parsing' | 'completed' | 'failed';
  title: string;
};

export type LightweightMarketingVideoController = ReturnType<typeof useLightweightMarketingVideoController>;

type LightweightWorkflowState = Record<string, unknown> & {
  analysisSessionId?: string;
  attachments: Array<{
    assetId?: string;
    id: string;
    kind: ReferenceAttachmentKind;
    mimeType: string;
    name: string;
  }>;
  brief: string;
  createdAt?: string;
  extractionError?: string;
  kind: 'draft' | 'record';
};

function getAttachmentKind(file: File): ReferenceAttachmentKind | null {
  const name = file.name.toLowerCase();
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';
  if (file.type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (name.endsWith('.pptx')) return 'presentation';
  return null;
}

function isDocument(attachment: LightweightReferenceAttachment) {
  return attachment.kind === 'presentation' || attachment.kind === 'pdf';
}

export function useLightweightMarketingVideoController(
  currentUser: User,
  onVideoProductionsChange?: () => void | Promise<unknown>,
) {
  const [attachments, setAttachments] = useState<LightweightReferenceAttachment[]>([]);
  const [brief, setBriefValue] = useState('');
  const [records, setRecords] = useState<LightweightCreationRecord[]>([]);
  const [selectedRecordId, setSelectedRecordId] = useState('');
  const [creatingRecordId, setCreatingRecordId] = useState('');
  const [createError, setCreateError] = useState('');
  const [uploadNotice, setUploadNotice] = useState('');
  const [narrationVoices, setNarrationVoices] = useState<PlanningVoice[]>([]);
  const [narrationVoice, setNarrationVoiceValue] = useState('');
  const [narrationSpeed, setNarrationSpeedValue] = useState(1);
  const [remotionPresets, setRemotionPresets] = useState<RemotionVideoPreset[]>([]);
  const [remotionPresetId, setRemotionPresetIdValue] = useState('clean-marketing');
  const [generatingRemotionRecordId, setGeneratingRemotionRecordId] = useState('');
  const [submittingRenderRecordId, setSubmittingRenderRecordId] = useState('');
  const [workflowsLoaded, setWorkflowsLoaded] = useState(false);
  const previewUrlsRef = useRef(new Set<string>());
  const uploadGroupIdsRef = useRef<Partial<Record<ContentAssetResourceType, string>>>({});
  const workflowSaveQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const notifiedRenderAssetIdsRef = useRef(new Set<string>());
  const selectedRecord = records.find((record) => record.id === selectedRecordId);

  useEffect(() => {
    let cancelled = false;
    void getPlanningVoices().then((result) => {
      if (cancelled) return;
      setNarrationVoices(result.voices || []);
      if (result.voices?.[0]?.id) {
        setNarrationVoiceValue((current) => (
          current && result.voices.some((voice) => voice.id === current)
            ? current
            : result.voices[0].id
        ));
      }
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [currentUser.id]);

  useEffect(() => {
    let cancelled = false;
    void getRemotionVideoPresets().then((result) => {
      if (cancelled) return;
      setRemotionPresets(result.presets || []);
      setRemotionPresetIdValue((current) => (
        result.presets?.some((preset) => preset.id === current)
          ? current
          : result.presets?.[0]?.id || 'clean-marketing'
      ));
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [currentUser.id]);

  useEffect(() => {
    const generation = selectedRecord?.analysisSession?.analysis.narrationGeneration;
    if (!generation || !selectedRecordId) return;
    if (generation.voice) {
      setNarrationVoiceValue((current) => {
        if (narrationVoices.length === 0) return generation.voice;
        if (narrationVoices.some((voice) => voice.id === generation.voice)) return generation.voice;
        return narrationVoices[0]?.id || '';
      });
    }
    if (generation.speed > 0) setNarrationSpeedValue(generation.speed);
  }, [narrationVoices, selectedRecord?.analysisSession?.analysis.narrationGeneration?.voice, selectedRecordId]);

  useEffect(() => {
    const presetId = selectedRecord?.analysisSession?.analysis.remotionGeneration?.presetId;
    if (presetId && remotionPresets.some((preset) => preset.id === presetId)) {
      setRemotionPresetIdValue(presetId);
    }
  }, [remotionPresets, selectedRecord?.analysisSession?.analysis.remotionGeneration?.presetId, selectedRecordId]);

  const updateRecord = (
    id: string,
    updater: (record: LightweightCreationRecord) => LightweightCreationRecord,
  ) => {
    setRecords((current) => current.map((record) => (record.id === id ? updater(record) : record)));
  };

  const persistRecord = (record: LightweightCreationRecord) => {
    const operation = workflowSaveQueueRef.current.then(() => saveContentWorkflow(recordToWorkflowInput(record)));
    workflowSaveQueueRef.current = operation.catch(() => undefined);
    return operation.then(() => undefined);
  };

  useEffect(() => {
    const previewUrls = previewUrlsRef.current;
    return () => previewUrls.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const workflows = await listContentWorkflows<LightweightWorkflowState>('lightweight-marketing-video');
        if (cancelled) return;
        const draft = workflows.find((workflow) => workflow.recordKey === 'default' && workflow.state.kind === 'draft');
        if (draft) {
          setBriefValue(String(draft.state.brief || ''));
          const restoredDraftAttachments = await restoreAttachments(draft.state.attachments.filter((attachment) => attachment.assetId));
          if (cancelled) return;
          setAttachments(restoredDraftAttachments);
        }
        const recordWorkflows = workflows.filter((workflow) => workflow.recordKey !== 'default' && workflow.state.kind === 'record');
        const initial = recordWorkflows.map(workflowToInitialRecord);
        setRecords(initial);
        setWorkflowsLoaded(true);
        for (const workflow of recordWorkflows) {
          void hydrateWorkflowRecord(workflow, currentUser.id).then((record) => {
            if (!cancelled) updateRecord(record.id, () => record);
          });
        }
      } catch {
        if (!cancelled) setWorkflowsLoaded(true);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [currentUser.id]);

  useEffect(() => {
    if (!workflowsLoaded) return undefined;
    const timer = setTimeout(() => {
      const draftState: LightweightWorkflowState = {
        attachments: serializeAttachments(attachments),
        brief,
        kind: 'draft',
      };
      const recordSnapshots = records.map(recordToWorkflowInput);
      workflowSaveQueueRef.current = workflowSaveQueueRef.current.then(async () => {
        await saveContentWorkflow({
          currentStep: 'materials',
          moduleKey: 'lightweight-marketing-video',
          recordKey: 'default',
          schemaVersion: 1,
          state: draftState,
          status: 'draft',
          title: t('轻量营销视频草稿'),
        });
        await Promise.all(recordSnapshots.map((snapshot) => saveContentWorkflow(snapshot)));
      }).catch(() => undefined);
    }, 350);
    return () => clearTimeout(timer);
  }, [attachments, brief, records, workflowsLoaded]);

  useEffect(() => {
    const session = selectedRecord?.analysisSession;
    const campaignImageStatus = session?.analysis.campaignImageGeneration?.status;
    const narrationStatus = session?.analysis.narrationGeneration?.status;
    const renderStatus = session?.analysis.renderGeneration?.status;
    if (!selectedRecord || !session || (session.status !== 'analyzing'
      && campaignImageStatus !== 'generating'
      && narrationStatus !== 'generating'
      && renderStatus !== 'queued'
      && renderStatus !== 'rendering')) return undefined;
    let cancelled = false;
    // Analysis and promotion-image tasks may need one state reconciliation
    // request. Narration is fully event-driven after its POST response so its
    // generation never turns into session-query traffic in the Network panel.
    const allowStateReconciliation = session.status === 'analyzing' || campaignImageStatus === 'generating';
    let hasSeenSocketConnection = false;

    const applySession = (latest: PlanningSession, notifyFailure = false) => {
      if (cancelled || latest.id !== session.id) return;
      const errorMessage = latest.status === 'failed'
        ? latest.errorMessage || t('AI 内容分析失败')
        : latest.analysis.campaignImageGeneration?.status === 'failed'
          ? latest.analysis.campaignImageGeneration.errorMessage || t('宣传图片生成失败')
          : latest.analysis.narrationGeneration?.status === 'failed'
            ? latest.analysis.narrationGeneration.errorMessage || t('旁白与字幕生成失败')
            : latest.analysis.renderGeneration?.status === 'failed'
              ? latest.analysis.renderGeneration.errorMessage || t('视频渲染失败')
            : '';
      updateRecord(selectedRecord.id, (record) => {
        if (record.analysisSession?.updatedAt && latest.updatedAt < record.analysisSession.updatedAt) {
          return record;
        }
        return {
          ...record,
          analysisError: errorMessage,
          analysisSession: latest,
        };
      });
      if (notifyFailure && errorMessage) {
        showApiError(new Error(errorMessage));
      }
      const completedRender = latest.analysis.renderGeneration;
      if (completedRender?.status === 'completed'
        && completedRender.assetId
        && !notifiedRenderAssetIdsRef.current.has(completedRender.assetId)) {
        notifiedRenderAssetIdsRef.current.add(completedRender.assetId);
        void onVideoProductionsChange?.();
      }
    };

    const syncLatestSession = async () => {
      try {
        const latest = await getPlanningSession(session.id, currentUser.id);
        applySession(latest);
      } catch (error) {
        if (!cancelled) {
          updateRecord(selectedRecord.id, (record) => ({
            ...record,
            analysisError: error instanceof Error ? error.message : t('AI 内容分析状态读取失败'),
          }));
        }
      }
    };

    const unsubscribe = appSocketManager.subscribe((event) => {
      const method = String(event.method || '');
      if (method === 'app/connected') {
        if (allowStateReconciliation && hasSeenSocketConnection) {
          void syncLatestSession();
        }
        hasSeenSocketConnection = true;
        return;
      }
      if (method !== 'content-planning-session-updated' && method !== 'app/content-planning-session-updated') return;
      const payload = (event.params || {}) as PlanningSessionUpdatedEvent;
      if (payload.sessionId !== session.id || payload.userId !== currentUser.id || !payload.session) return;
      applySession(payload.session, true);
    });

    // Covers the narrow race where a very fast task finishes between the POST
    // response and this subscription being attached. Subsequent updates are
    // delivered exclusively through the application WebSocket.
    if (allowStateReconciliation) {
      void syncLatestSession();
    }
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [
    currentUser.id,
    selectedRecord?.analysisSession?.analysis.campaignImageGeneration?.status,
    selectedRecord?.analysisSession?.analysis.narrationGeneration?.status,
    selectedRecord?.analysisSession?.analysis.renderGeneration?.status,
    selectedRecord?.analysisSession?.id,
    selectedRecord?.analysisSession?.status,
    selectedRecord?.id,
    onVideoProductionsChange,
  ]);

  const addFiles = (files: FileList | File[]) => {
    const candidates = Array.from(files);
    const supported = candidates.filter((file) => getAttachmentKind(file));
    const remaining = Math.max(0, MAX_ATTACHMENTS - attachments.length);
    const accepted = supported.slice(0, remaining);
    if (supported.length !== candidates.length) {
      setUploadNotice(t('已忽略不支持的文件，仅支持图片、视频、PPTX 和 PDF。'));
    } else if (accepted.length !== supported.length || remaining === 0) {
      setUploadNotice(t('参考附件最多上传 12 个。'));
    } else {
      setUploadNotice('');
    }
    const next = accepted.map((file) => {
      const kind = getAttachmentKind(file) as ReferenceAttachmentKind;
      const previewUrl = kind === 'image' || kind === 'video' ? URL.createObjectURL(file) : undefined;
      if (previewUrl) previewUrlsRef.current.add(previewUrl);
      return {
        file,
        id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
        kind,
        mimeType: file.type,
        name: file.name,
        previewUrl,
      };
    });
    if (next.length > 0) {
      setAttachments((current) => [...current, ...next]);
      setCreateError('');
    }
  };

  const removeAttachment = (id: string) => {
    setAttachments((current) => {
      const target = current.find((attachment) => attachment.id === id);
      if (target?.previewUrl) {
        URL.revokeObjectURL(target.previewUrl);
        previewUrlsRef.current.delete(target.previewUrl);
      }
      return current.filter((attachment) => attachment.id !== id);
    });
    setCreateError('');
    setUploadNotice('');
  };

  const ensureAttachmentsUploaded = async (source: LightweightReferenceAttachment[]) => {
    const groupId = source.length > 0 ? await ensureUploadGroupId({
      currentUser,
      resourceType: 'other',
      uploadGroupIdsRef,
    }) : undefined;
    const uploaded: LightweightReferenceAttachment[] = [];
    for (const attachment of source) {
      if (attachment.assetId) {
        uploaded.push(attachment);
        continue;
      }
      if (!attachment.file) {
        throw new Error(t('本地附件已失效，请重新选择文件。'));
      }
      const asset = await uploadContentAsset({
        file: attachment.file,
        userId: currentUser.id,
        groupId,
        resourceType: 'other',
        name: attachment.name,
        metadata: {
          assetKind: 'lightweight_marketing_reference',
          kind: attachment.kind,
          source: 'lightweight_marketing_video',
          temporary: true,
        },
      });
      uploaded.push({ ...attachment, assetId: asset.id });
    }
    setAttachments((current) => current.map((attachment) => (
      uploaded.find((item) => item.id === attachment.id) || attachment
    )));
    return uploaded;
  };

  const createRecord = async () => {
    const documents = attachments.filter(isDocument);
    if (creatingRecordId || documents.length === 0) {
      if (documents.length === 0) setCreateError(t('请先上传需要解析的 PPTX 或 PDF 文件。'));
      return;
    }
    const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
    const now = new Date();
    const firstName = documents[0].name.replace(/\.(pptx|pdf)$/i, '');
    const record: LightweightCreationRecord = {
      analysisError: '',
      analysisSession: null,
      attachments: [...attachments],
      brief: brief.trim(),
      createdAt: now.toISOString(),
      documentExtractions: [],
      extractionError: '',
      id,
      status: 'uploading',
      title: `${firstName} · ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
    };
    setRecords((current) => [record, ...current]);
    setSelectedRecordId(id);
    setCreatingRecordId(id);
    setCreateError('');
    let latestRecord = record;
    try {
      await persistRecord(record);
      const uploaded = await ensureAttachmentsUploaded(record.attachments);
      latestRecord = { ...record, attachments: uploaded, status: 'parsing' };
      updateRecord(id, () => latestRecord);
      await persistRecord(latestRecord);
      const views: DocumentExtractionView[] = [];
      for (const document of uploaded.filter(isDocument)) {
        if (!document.assetId) continue;
        const extraction = await waitForAssetExtraction(document.assetId, currentUser.id);
        const derivedAssets = await Promise.allSettled(
          [...(extraction.result.artifacts || []), ...(extraction.result.filteredArtifacts || [])]
            .map((artifact) => getContentAsset(artifact.id)),
        );
        const assets = Object.fromEntries(derivedAssets.flatMap((result) => (
          result.status === 'fulfilled' ? [[result.value.id, result.value]] : []
        )));
        views.push({ attachmentId: document.id, assetId: document.assetId, extraction, assets });
        latestRecord = { ...latestRecord, documentExtractions: [...views] };
        updateRecord(id, () => latestRecord);
      }
      latestRecord = { ...latestRecord, documentExtractions: views, status: 'completed' };
      updateRecord(id, () => latestRecord);
      await persistRecord(latestRecord);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : t('附件解析失败');
      updateRecord(id, (current) => ({
        ...current,
        extractionError: errorMessage,
        status: 'failed',
      }));
      const failedRecord = { ...latestRecord, extractionError: errorMessage, status: 'failed' as const };
      void persistRecord(failedRecord).catch(() => undefined);
    } finally {
      setCreatingRecordId('');
    }
  };

  const analyzeRecord = async (id: string) => {
    const record = records.find((item) => item.id === id);
    if (!record || record.status !== 'completed' || record.analysisSession?.status === 'analyzing') return;
    updateRecord(id, (current) => ({ ...current, analysisError: '' }));
    try {
      const media = record.attachments.map((attachment) => ({
        assetId: attachment.assetId as string,
        kind: attachment.kind === 'presentation' || attachment.kind === 'pdf'
          ? 'document' as const
          : attachment.kind,
      }));
      const session = record.analysisSession || await createPlanningSession({
        userId: currentUser.id,
        prompt: record.brief,
        media,
      });
      const queued = await analyzePlanningSession({
        userId: currentUser.id,
        sessionId: session.id,
        productName: '',
        prompt: record.brief,
        imageAssetIds: [],
        media,
      });
      const updatedRecord = { ...record, analysisSession: queued };
      updateRecord(id, () => updatedRecord);
      await persistRecord(updatedRecord);
    } catch (error) {
      const errorMessage = showApiError(error, t('AI 内容分析失败'));
      updateRecord(id, (current) => ({
        ...current,
        analysisError: errorMessage,
      }));
    }
  };

  const generateCampaignImages = async (id: string) => {
    const record = records.find((item) => item.id === id);
    const session = record?.analysisSession;
    if (!record || !session || session.status !== 'confirming'
      || session.analysis.campaignImageGeneration?.status === 'generating') return;
    updateRecord(id, (current) => ({ ...current, analysisError: '' }));
    try {
      const queued = await generatePlanningCampaignImages({
        sessionId: session.id,
        userId: currentUser.id,
      });
      const updatedRecord = { ...record, analysisError: '', analysisSession: queued };
      updateRecord(id, () => updatedRecord);
      await persistRecord(updatedRecord);
    } catch (error) {
      const errorMessage = showApiError(error, t('宣传图片生成失败'));
      updateRecord(id, (current) => ({
        ...current,
        analysisError: errorMessage,
      }));
    }
  };

  const generateNarration = async (id: string) => {
    const record = records.find((item) => item.id === id);
    const session = record?.analysisSession;
    const scenes = session?.analysis.campaignPlan?.scenes || [];
    if (!record || !session || session.status !== 'confirming' || scenes.length === 0
      || session.analysis.narrationGeneration?.status === 'generating') return;
    updateRecord(id, (current) => ({ ...current, analysisError: '' }));
    try {
      const queued = await generatePlanningNarration({
        sessionId: session.id,
        userId: currentUser.id,
        voice: narrationVoice || narrationVoices[0]?.id || '',
        speed: narrationSpeed,
      });
      const updatedRecord = { ...record, analysisError: '', analysisSession: queued };
      updateRecord(id, () => updatedRecord);
      await persistRecord(updatedRecord);
    } catch (error) {
      const errorMessage = showApiError(error, t('旁白与字幕生成失败'));
      updateRecord(id, (current) => ({
        ...current,
        analysisError: errorMessage,
      }));
    }
  };

  const generateRemotionJSON = async (id: string) => {
    const record = records.find((item) => item.id === id);
    const session = record?.analysisSession;
    if (!record || !session || generatingRemotionRecordId === id) return;
    setGeneratingRemotionRecordId(id);
    updateRecord(id, (current) => ({ ...current, analysisError: '' }));
    try {
      const updated = await generatePlanningRemotionJSON({
        sessionId: session.id,
        userId: currentUser.id,
        presetId: remotionPresetId,
      });
      const updatedRecord = { ...record, analysisError: '', analysisSession: updated };
      updateRecord(id, () => updatedRecord);
      await persistRecord(updatedRecord);
    } catch (error) {
      const errorMessage = showApiError(error, t('Remotion JSON 生成失败'));
      updateRecord(id, (current) => ({ ...current, analysisError: errorMessage }));
    } finally {
      setGeneratingRemotionRecordId('');
    }
  };

  const renderVideo = async (id: string) => {
    const record = records.find((item) => item.id === id);
    const session = record?.analysisSession;
    if (!record || !session || submittingRenderRecordId === id) return;
    setSubmittingRenderRecordId(id);
    updateRecord(id, (current) => ({ ...current, analysisError: '' }));
    try {
      const updated = await startPlanningRemotionRender({ sessionId: session.id, userId: currentUser.id });
      const updatedRecord = { ...record, analysisError: '', analysisSession: updated };
      updateRecord(id, () => updatedRecord);
      await persistRecord(updatedRecord);
    } catch (error) {
      const errorMessage = showApiError(error, t('视频渲染启动失败'));
      updateRecord(id, (current) => ({ ...current, analysisError: errorMessage }));
    } finally {
      setSubmittingRenderRecordId('');
    }
  };

  const cancelRender = async (id: string) => {
    const record = records.find((item) => item.id === id);
    const session = record?.analysisSession;
    if (!record || !session || submittingRenderRecordId === id) return;
    setSubmittingRenderRecordId(id);
    try {
      const updated = await cancelPlanningRemotionRender({ sessionId: session.id, userId: currentUser.id });
      const updatedRecord = { ...record, analysisError: '', analysisSession: updated };
      updateRecord(id, () => updatedRecord);
      await persistRecord(updatedRecord);
    } catch (error) {
      const errorMessage = showApiError(error, t('取消视频渲染失败'));
      updateRecord(id, (current) => ({ ...current, analysisError: errorMessage }));
    } finally {
      setSubmittingRenderRecordId('');
    }
  };

  const attachmentItems: MediaAttachmentItem[] = attachments.map((attachment, index) => ({
    caption: attachment.kind === 'presentation'
      ? 'PPTX'
      : attachment.kind === 'pdf'
        ? 'PDF'
        : t('附件 {{0}}', { '0': index + 1 }),
    fileKind: attachment.kind === 'presentation' ? 'presentation' : attachment.kind === 'pdf' ? 'pdf' : undefined,
    id: attachment.id,
    name: attachment.name,
    previewable: false,
    src: attachment.previewUrl,
    type: attachment.kind === 'image' ? 'image' : attachment.kind === 'video' ? 'video' : 'file',
  }));

  return {
    addFiles,
    analyzeRecord,
    attachmentItems,
    attachments,
    brief,
    canCreateRecord: attachments.some(isDocument) && !creatingRecordId,
    cancelRender,
    createError,
    createRecord,
    creatingRecordId,
    generateCampaignImages,
    generateNarration,
    generateRemotionJSON,
    generatingRemotionRecordId,
    narrationSpeed,
    narrationVoice,
    narrationVoices,
    remotionPresetId,
    remotionPresets,
    renderVideo,
    records,
    removeAttachment,
    selectedRecord,
    selectedRecordId,
    setBrief: (value: string) => {
      setBriefValue(value);
      setCreateError('');
    },
    setNarrationSpeed: (value: number) => {
      if (Number.isFinite(value)) setNarrationSpeedValue(Math.min(2, Math.max(0.5, value)));
    },
    setNarrationVoice: (value: string) => setNarrationVoiceValue(value),
    setRemotionPresetId: (value: string) => setRemotionPresetIdValue(value),
    setSelectedRecordId,
    submittingRenderRecordId,
    uploadNotice,
  };
}

type LightweightMarketingVideoPanelProps = {
  controller: LightweightMarketingVideoController;
};

export function LightweightMarketingVideoPanel({ controller }: LightweightMarketingVideoPanelProps) {
  const busy = Boolean(controller.creatingRecordId);
  return (
    <div className="lightweight-video-workflow">
      <WorkspaceSection
        className="lightweight-video-attachments"
        description={t('支持图片、视频、PPTX 和 PDF，单次最多 12 个文件。')}
        title={t('参考附件')}
      >
        <div className="lightweight-video-material-grid video-task-material-grid">
          <MaterialSlot
            accept={ACCEPTED_FILE_TYPES}
            attachmentItems={controller.attachmentItems}
            disabled={controller.attachments.length >= MAX_ATTACHMENTS || busy}
            item={referenceAttachmentMaterial}
            multiple
            onClear={() => undefined}
            onLocalFiles={(_, files) => controller.addFiles(files)}
            onOpen={() => undefined}
            onRemoveOne={(_, materialId) => {
              if (materialId) controller.removeAttachment(materialId);
            }}
            openMode="local"
            selected={undefined}
          />
        </div>
        {controller.uploadNotice ? <p className="lightweight-video-upload-notice">{controller.uploadNotice}</p> : null}
      </WorkspaceSection>

      <WorkspaceSection
        className="lightweight-video-brief"
        description={t('说明产品、目标受众、投放平台、视频时长和期望风格。')}
        title={t('营销需求')}
      >
        <Input.TextArea
          autoSize={{ minRows: 4, maxRows: 8 }}
          disabled={busy}
          maxLength={1000}
          onChange={(event) => controller.setBrief(event.target.value)}
          placeholder={t('例如：为这款产品制作 15 秒宣传视频，风格专业、清晰、有科技感。')}
          value={controller.brief}
        />
      </WorkspaceSection>
    </div>
  );
}

function serializeAttachments(attachments: LightweightReferenceAttachment[]) {
  return attachments.map((attachment) => ({
    ...(attachment.assetId ? { assetId: attachment.assetId } : {}),
    id: attachment.id,
    kind: attachment.kind,
    mimeType: attachment.mimeType,
    name: attachment.name,
  }));
}

async function restoreAttachments(items: LightweightWorkflowState['attachments']) {
  return Promise.all((Array.isArray(items) ? items : []).map(async (item): Promise<LightweightReferenceAttachment> => {
    let previewUrl: string | undefined;
    if (item.assetId && (item.kind === 'image' || item.kind === 'video')) {
      try {
        const asset = await getContentAsset(item.assetId);
        previewUrl = resolveAssetUrl(asset.fileUrl);
      } catch {
        previewUrl = undefined;
      }
    }
    return {
      ...(item.assetId ? { assetId: item.assetId } : {}),
      id: item.id,
      kind: item.kind,
      mimeType: item.mimeType,
      name: item.name,
      ...(previewUrl ? { previewUrl } : {}),
    };
  }));
}

function workflowToInitialRecord(workflow: ContentWorkflow<LightweightWorkflowState>): LightweightCreationRecord {
  const state = workflow.state;
  const interruptedUpload = workflow.currentStep === 'attachment_upload'
    && state.attachments.some((attachment) => !attachment.assetId);
  return {
    analysisError: '',
    analysisSession: null,
    attachments: (state.attachments || []).map((attachment) => ({ ...attachment })),
    brief: String(state.brief || ''),
    createdAt: String(state.createdAt || workflow.createdAt),
    documentExtractions: [],
    extractionError: interruptedUpload
      ? t('页面刷新时本地附件尚未上传完成，请重新选择文件并创建任务。')
      : String(state.extractionError || ''),
    id: workflow.recordKey,
    status: workflow.status === 'failed' || interruptedUpload
      ? 'failed'
      : workflow.currentStep === 'attachment_upload'
        ? 'uploading'
        : workflow.currentStep === 'attachment_parsing'
          ? 'parsing'
          : 'completed',
    title: workflow.title,
  };
}

async function hydrateWorkflowRecord(
  workflow: ContentWorkflow<LightweightWorkflowState>,
  userId: string,
): Promise<LightweightCreationRecord> {
  const initial = workflowToInitialRecord(workflow);
  const attachments = await restoreAttachments(workflow.state.attachments);
  if (initial.status === 'failed') return { ...initial, attachments };
  try {
    const views: DocumentExtractionView[] = [];
    for (const document of attachments.filter(isDocument)) {
      if (!document.assetId) continue;
      const extraction = await waitForAssetExtraction(document.assetId, userId);
      views.push(await extractionView(document, extraction));
    }
    const analysisSession = workflow.state.analysisSessionId
      ? await getPlanningSession(workflow.state.analysisSessionId, userId).catch(() => null)
      : null;
    return {
      ...initial,
      analysisError: planningSessionError(analysisSession),
      analysisSession,
      attachments,
      documentExtractions: views,
      extractionError: '',
      status: 'completed',
    };
  } catch (error) {
    return {
      ...initial,
      attachments,
      extractionError: error instanceof Error ? error.message : t('附件解析失败'),
      status: 'failed',
    };
  }
}

function planningSessionError(session: PlanningSession | null) {
  if (!session) return '';
  if (session.status === 'failed') return session.errorMessage || t('AI 内容分析失败');
  if (session.analysis.campaignImageGeneration?.status === 'failed') {
    return session.analysis.campaignImageGeneration.errorMessage || t('宣传图片生成失败');
  }
  if (session.analysis.narrationGeneration?.status === 'failed') {
    return session.analysis.narrationGeneration.errorMessage || t('旁白与字幕生成失败');
  }
  if (session.analysis.remotionGeneration?.status === 'failed') {
    return session.analysis.remotionGeneration.errorMessage || t('Remotion JSON 生成失败');
  }
  if (session.analysis.renderGeneration?.status === 'failed') {
    return session.analysis.renderGeneration.errorMessage || t('视频渲染失败');
  }
  return '';
}

async function extractionView(
  document: LightweightReferenceAttachment,
  extraction: AssetExtraction,
): Promise<DocumentExtractionView> {
  const derivedAssets = await Promise.allSettled(
    [...(extraction.result.artifacts || []), ...(extraction.result.filteredArtifacts || [])]
      .map((artifact) => getContentAsset(artifact.id)),
  );
  const assets = Object.fromEntries(derivedAssets.flatMap((result) => (
    result.status === 'fulfilled' ? [[result.value.id, result.value]] : []
  )));
  return {
    attachmentId: document.id,
    assetId: document.assetId as string,
    extraction,
    assets,
  };
}

function recordToWorkflowInput(record: LightweightCreationRecord) {
  const analysisStatus = record.analysisSession?.status;
  const campaignImageStatus = record.analysisSession?.analysis.campaignImageGeneration?.status;
  const narrationStatus = record.analysisSession?.analysis.narrationGeneration?.status;
  const remotionStatus = record.analysisSession?.analysis.remotionGeneration?.status;
  const renderStatus = record.analysisSession?.analysis.renderGeneration?.status;
  const currentStep = record.status === 'uploading'
    ? 'attachment_upload'
    : record.status === 'parsing'
      ? 'attachment_parsing'
      : analysisStatus === 'analyzing'
        ? 'ai_analysis'
        : narrationStatus === 'generating' || narrationStatus === 'completed' || narrationStatus === 'failed'
          ? remotionStatus === 'completed' || remotionStatus === 'failed'
            ? renderStatus === 'queued' || renderStatus === 'rendering' || renderStatus === 'completed' || renderStatus === 'failed' || renderStatus === 'cancelled'
              ? 'video_render'
              : 'remotion_json'
            : 'narration_caption'
          : campaignImageStatus === 'generating' || campaignImageStatus === 'completed' || campaignImageStatus === 'failed'
            ? 'promotion_image'
        : analysisStatus === 'confirming'
          ? 'promotion_image'
          : 'ai_analysis';
  const status = record.status === 'failed'
    ? 'failed' as const
    : record.status === 'uploading'
      ? 'uploading' as const
      : record.status === 'parsing' || analysisStatus === 'analyzing' || campaignImageStatus === 'generating' || narrationStatus === 'generating' || renderStatus === 'queued' || renderStatus === 'rendering'
        ? 'processing' as const
        : renderStatus === 'completed'
          ? 'completed' as const
        : 'paused' as const;
  const state: LightweightWorkflowState = {
    ...(record.analysisSession?.id ? { analysisSessionId: record.analysisSession.id } : {}),
    attachments: serializeAttachments(record.attachments),
    brief: record.brief,
    createdAt: record.createdAt,
    extractionError: record.extractionError,
    kind: 'record',
  };
  return {
    currentStep,
    moduleKey: 'lightweight-marketing-video' as const,
    recordKey: record.id,
    schemaVersion: 1,
    state,
    status,
    title: record.title,
  };
}

async function waitForAssetExtraction(assetId: string, userId: string) {
  let extraction = await startAssetExtraction(assetId);
  const filterSummary = extraction.result.metadata?.filterSummary;
  const excludedCount = filterSummary && typeof filterSummary === 'object'
    ? Number((filterSummary as Record<string, unknown>).excluded || 0)
    : 0;
  if (extraction.status === 'completed' && excludedCount > 0 && !extraction.result.filteredArtifacts) {
    extraction = await startAssetExtraction(assetId, true);
  }
  if (extraction.status === 'completed') return extraction;
  if (extraction.status === 'failed') throw new Error(extraction.errorMessage || t('附件解析失败'));

  return new Promise<AssetExtraction>((resolve, reject) => {
    let latest = extraction;
    let settled = false;
    let unsubscribe: () => void = () => undefined;
    const timeout = window.setTimeout(() => {
      finish(new Error(t('附件解析超时，请稍后重试。')));
    }, 4 * 60 * 1000);

    const finish = (result: AssetExtraction | Error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      unsubscribe();
      if (result instanceof Error) reject(result);
      else resolve(result);
    };
    const applyExtraction = (next: AssetExtraction) => {
      if (next.assetId !== assetId || next.id !== extraction.id) return;
      if (latest.updatedAt && next.updatedAt < latest.updatedAt) return;
      latest = next;
      if (next.status === 'completed') finish(next);
      else if (next.status === 'failed') finish(new Error(next.errorMessage || t('附件解析失败')));
    };
    const syncLatest = () => {
      void getAssetExtraction(assetId).then(applyExtraction).catch(() => undefined);
    };

    unsubscribe = appSocketManager.subscribe((event) => {
      const method = String(event.method || '');
      if (method === 'app/connected') {
        syncLatest();
        return;
      }
      if (method !== 'asset-extraction-updated' && method !== 'app/asset-extraction-updated') return;
      const payload = (event.params || {}) as AssetExtractionUpdatedEvent;
      if (payload.assetId !== assetId || payload.userId !== userId || !payload.extraction) return;
      applyExtraction(payload.extraction);
    });
    // Covers completion between the POST response and WebSocket subscription.
    syncLatest();
  });
}
