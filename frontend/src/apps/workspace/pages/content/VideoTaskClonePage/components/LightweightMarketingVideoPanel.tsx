import { Input } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { t } from '@shared/i18n';
import type { MediaAttachmentItem } from '../../../../components/MediaAttachmentStack';
import { resolveAssetUrl } from '../../../../api/request';
import {
  getAssetExtraction,
  getContentAsset,
  startAssetExtraction,
  uploadContentAsset,
} from '../../../../api/content';
import {
  analyzePlanningSession,
  createPlanningSession,
  generatePlanningCampaignImages,
  generatePlanningNarration,
  getPlanningVoices,
  getPlanningSession,
} from '../../../../api/content-planning';
import type { PlanningSession, PlanningVoice } from '../../../../api/content-planning';
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

export function useLightweightMarketingVideoController(currentUser: User) {
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
  const [workflowsLoaded, setWorkflowsLoaded] = useState(false);
  const previewUrlsRef = useRef(new Set<string>());
  const uploadGroupIdsRef = useRef<Partial<Record<ContentAssetResourceType, string>>>({});
  const workflowSaveQueueRef = useRef<Promise<unknown>>(Promise.resolve());
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
    if (!selectedRecord || !session || (session.status !== 'analyzing' && campaignImageStatus !== 'generating' && narrationStatus !== 'generating')) return undefined;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const latest = await getPlanningSession(session.id, currentUser.id);
        if (cancelled) return;
        updateRecord(selectedRecord.id, (record) => ({
          ...record,
          analysisError: latest.status === 'failed'
            ? latest.errorMessage || t('AI 内容分析失败')
            : latest.analysis.campaignImageGeneration?.status === 'failed'
              ? latest.analysis.campaignImageGeneration.errorMessage || t('宣传图片生成失败')
              : latest.analysis.narrationGeneration?.status === 'failed'
                ? latest.analysis.narrationGeneration.errorMessage || t('旁白与字幕生成失败')
              : '',
          analysisSession: latest,
        }));
        if (latest.status === 'analyzing' || latest.analysis.campaignImageGeneration?.status === 'generating' || latest.analysis.narrationGeneration?.status === 'generating') {
          timer = setTimeout(() => void poll(), 1000);
        }
      } catch (error) {
        if (!cancelled) {
          updateRecord(selectedRecord.id, (record) => ({
            ...record,
            analysisError: error instanceof Error ? error.message : t('AI 内容分析状态读取失败'),
          }));
          timer = setTimeout(() => void poll(), 2000);
        }
      }
    };
    timer = setTimeout(() => void poll(), 800);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [
    currentUser.id,
    selectedRecord?.analysisSession?.analysis.campaignImageGeneration?.status,
    selectedRecord?.analysisSession?.analysis.narrationGeneration?.status,
    selectedRecord?.analysisSession?.id,
    selectedRecord?.analysisSession?.status,
    selectedRecord?.id,
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
        const extraction = await waitForAssetExtraction(document.assetId);
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
      updateRecord(id, (current) => ({
        ...current,
        analysisError: error instanceof Error ? error.message : t('AI 内容分析失败'),
      }));
    }
  };

  const generateCampaignImages = async (id: string) => {
    const record = records.find((item) => item.id === id);
    const session = record?.analysisSession;
    if (!record || !session || session.status !== 'confirming'
      || session.analysis.campaignImageGeneration?.status === 'generating') return;
    try {
      const queued = await generatePlanningCampaignImages({
        sessionId: session.id,
        userId: currentUser.id,
      });
      const updatedRecord = { ...record, analysisSession: queued };
      updateRecord(id, () => updatedRecord);
      await persistRecord(updatedRecord);
    } catch (error) {
      updateRecord(id, (current) => ({
        ...current,
        analysisError: error instanceof Error ? error.message : t('宣传图片生成失败'),
      }));
    }
  };

  const generateNarration = async (id: string) => {
    const record = records.find((item) => item.id === id);
    const session = record?.analysisSession;
    const scenes = session?.analysis.campaignPlan?.scenes || [];
    if (!record || !session || session.status !== 'confirming' || scenes.length === 0
      || session.analysis.narrationGeneration?.status === 'generating') return;
    try {
      const queued = await generatePlanningNarration({
        sessionId: session.id,
        userId: currentUser.id,
        voice: narrationVoice || narrationVoices[0]?.id || '',
        speed: narrationSpeed,
      });
      const updatedRecord = { ...record, analysisSession: queued };
      updateRecord(id, () => updatedRecord);
      await persistRecord(updatedRecord);
    } catch (error) {
      updateRecord(id, (current) => ({
        ...current,
        analysisError: error instanceof Error ? error.message : t('旁白与字幕生成失败'),
      }));
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
    createError,
    createRecord,
    creatingRecordId,
    generateCampaignImages,
    generateNarration,
    narrationSpeed,
    narrationVoice,
    narrationVoices,
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
    setSelectedRecordId,
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
      const extraction = await waitForAssetExtraction(document.assetId);
      views.push(await extractionView(document, extraction));
    }
    const analysisSession = workflow.state.analysisSessionId
      ? await getPlanningSession(workflow.state.analysisSessionId, userId).catch(() => null)
      : null;
    return {
      ...initial,
      analysisError: analysisSession?.status === 'failed'
        ? analysisSession.errorMessage || t('AI 内容分析失败')
        : analysisSession?.analysis.narrationGeneration?.status === 'failed'
          ? analysisSession.analysis.narrationGeneration.errorMessage || t('旁白与字幕生成失败')
          : '',
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

async function extractionView(
  document: LightweightReferenceAttachment,
  extraction: Awaited<ReturnType<typeof waitForAssetExtraction>>,
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
  const currentStep = record.status === 'uploading'
    ? 'attachment_upload'
    : record.status === 'parsing'
      ? 'attachment_parsing'
      : analysisStatus === 'analyzing'
        ? 'ai_analysis'
        : narrationStatus === 'generating' || narrationStatus === 'completed' || narrationStatus === 'failed'
          ? 'narration_caption'
          : campaignImageStatus === 'generating' || campaignImageStatus === 'completed' || campaignImageStatus === 'failed'
            ? 'promotion_image'
        : analysisStatus === 'confirming'
          ? 'promotion_image'
          : 'ai_analysis';
  const status = record.status === 'failed'
    ? 'failed' as const
    : record.status === 'uploading'
      ? 'uploading' as const
      : record.status === 'parsing' || analysisStatus === 'analyzing' || campaignImageStatus === 'generating' || narrationStatus === 'generating'
        ? 'processing' as const
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

async function waitForAssetExtraction(assetId: string) {
  let extraction = await startAssetExtraction(assetId);
  const filterSummary = extraction.result.metadata?.filterSummary;
  const excludedCount = filterSummary && typeof filterSummary === 'object'
    ? Number((filterSummary as Record<string, unknown>).excluded || 0)
    : 0;
  if (extraction.status === 'completed' && excludedCount > 0 && !extraction.result.filteredArtifacts) {
    extraction = await startAssetExtraction(assetId, true);
  }
  for (let attempt = 0; attempt < 320; attempt += 1) {
    if (extraction.status === 'completed') return extraction;
    if (extraction.status === 'failed') throw new Error(extraction.errorMessage || t('附件解析失败'));
    await new Promise((resolve) => setTimeout(resolve, 750));
    extraction = await getAssetExtraction(assetId);
  }
  throw new Error(t('附件解析超时，请稍后重试。'));
}
