import {
  BrainCircuit,
  Braces,
  Clapperboard,
  FileImage,
  FileText,
  FileVideo,
  Image as ImageIcon,
  Mic2,
  Presentation,
  Trash2,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button, Input } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { t } from '@shared/i18n';
import { uploadContentAsset } from '../../../../api/content';
import {
  analyzePlanningSession,
  createPlanningSession,
  getPlanningSession,
} from '../../../../api/content-planning';
import type { PlanningSession } from '../../../../api/content-planning';
import type { ContentAssetResourceType, User } from '../../../../types';
import type { MaterialKind } from '../types';
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

type ReferenceAttachment = {
  assetId?: string;
  file: File;
  id: string;
  kind: ReferenceAttachmentKind;
  previewUrl?: string;
};

type LightweightMarketingVideoPanelProps = {
  currentUser: User;
};

type WorkflowStage = {
  action: string;
  description: string;
  icon: LucideIcon;
  title: string;
};

const workflowStages: WorkflowStage[] = [
  {
    action: t('开始分析'),
    description: t('结合参考附件和营销需求，提取内容摘要、卖点、受众与视觉方向。'),
    icon: BrainCircuit,
    title: t('AI 内容分析'),
  },
  {
    action: t('生成图片'),
    description: t('根据分析结果生成宣传主视觉，并选择需要写入视频的图片。'),
    icon: ImageIcon,
    title: t('宣传图片'),
  },
  {
    action: t('生成旁白与字幕'),
    description: t('生成场景旁白、字幕和时间轴信息，并支持后续试听与调整。'),
    icon: Mic2,
    title: t('旁白与字幕'),
  },
  {
    action: t('生成 JSON'),
    description: t('汇总场景、素材、旁白和字幕，生成可交给 Remotion 的结构化 JSON。'),
    icon: Braces,
    title: t('Remotion JSON'),
  },
  {
    action: t('渲染视频'),
    description: t('将最终 JSON 提交给视频插件渲染，并在右侧查看生成结果。'),
    icon: Clapperboard,
    title: t('视频渲染'),
  },
];

function getAttachmentKind(file: File): ReferenceAttachmentKind | null {
  const name = file.name.toLowerCase();
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';
  if (file.type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (name.endsWith('.ppt') || name.endsWith('.pptx')) return 'presentation';
  return null;
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function attachmentIcon(kind: ReferenceAttachmentKind) {
  if (kind === 'image') return FileImage;
  if (kind === 'video') return FileVideo;
  if (kind === 'presentation') return Presentation;
  return FileText;
}

export function LightweightMarketingVideoPanel({ currentUser }: LightweightMarketingVideoPanelProps) {
  const [attachments, setAttachments] = useState<ReferenceAttachment[]>([]);
  const [brief, setBrief] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [analysisSession, setAnalysisSession] = useState<PlanningSession | null>(null);
  const [analysisError, setAnalysisError] = useState('');
  const [uploadNotice, setUploadNotice] = useState('');
  const previewUrlsRef = useRef(new Set<string>());
  const uploadGroupIdsRef = useRef<Partial<Record<ContentAssetResourceType, string>>>({});

  useEffect(() => {
    const previewUrls = previewUrlsRef.current;
    return () => {
      previewUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  useEffect(() => {
    if (!analysisSession || analysisSession.status !== 'analyzing') return undefined;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const latest = await getPlanningSession(analysisSession.id, currentUser.id);
        if (cancelled) return;
        setAnalysisSession(latest);
        setAnalysisError('');
        if (latest.status === 'failed') {
          setAnalysisError(latest.errorMessage || t('AI 内容分析失败'));
          return;
        }
        if (latest.status === 'analyzing') {
          timer = setTimeout(() => void poll(), 1000);
        }
      } catch (error) {
        if (!cancelled) {
          setAnalysisError(error instanceof Error ? error.message : t('AI 内容分析状态读取失败'));
          timer = setTimeout(() => void poll(), 2000);
        }
      }
    };
    timer = setTimeout(() => void poll(), 800);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [analysisSession?.id, analysisSession?.status, currentUser.id]);

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
        previewUrl,
      };
    });

    if (next.length > 0) {
      setAttachments((current) => [...current, ...next]);
      setAnalysisSession(null);
      setAnalysisError('');
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
    setAnalysisSession(null);
    setAnalysisError('');
    setUploadNotice('');
  };

  const handleAnalyze = async () => {
    if (isUploading || analysisSession?.status === 'analyzing') return;
    if (!brief.trim() && attachments.length === 0) {
      setAnalysisError(t('请填写营销需求或至少上传一个参考附件。'));
      return;
    }
    setIsUploading(true);
    setAnalysisError('');
    try {
      const groupId = attachments.length > 0 ? await ensureUploadGroupId({
        currentUser,
        resourceType: 'other',
        uploadGroupIdsRef,
      }) : undefined;
      const uploadedAttachments: ReferenceAttachment[] = [];
      for (const attachment of attachments) {
        if (attachment.assetId) {
          uploadedAttachments.push(attachment);
          continue;
        }
        const asset = await uploadContentAsset({
          file: attachment.file,
          userId: currentUser.id,
          groupId,
          resourceType: 'other',
          name: attachment.file.name,
          metadata: {
            assetKind: 'lightweight_marketing_reference',
            kind: attachment.kind,
            source: 'lightweight_marketing_video',
            temporary: true,
          },
        });
        const uploaded = { ...attachment, assetId: asset.id };
        uploadedAttachments.push(uploaded);
        setAttachments((current) => current.map((item) => (item.id === attachment.id ? uploaded : item)));
      }
      setAttachments(uploadedAttachments);
      const media = uploadedAttachments.map((attachment) => ({
        assetId: attachment.assetId as string,
        kind: attachment.kind === 'presentation' || attachment.kind === 'pdf'
          ? 'document' as const
          : attachment.kind,
      }));
      const session = analysisSession || await createPlanningSession({
        userId: currentUser.id,
        prompt: brief.trim(),
        media,
      });
      const queued = await analyzePlanningSession({
        userId: currentUser.id,
        sessionId: session.id,
        productName: '',
        prompt: brief.trim(),
        imageAssetIds: [],
        media,
      });
      setAnalysisSession(queued);
    } catch (error) {
      setAnalysisError(error instanceof Error ? error.message : t('AI 内容分析失败'));
    } finally {
      setIsUploading(false);
    }
  };

  const isAnalyzing = isUploading || analysisSession?.status === 'analyzing';
  const analysisCompleted = analysisSession?.status === 'confirming';
  const insights = analysisSession?.analysis.productInsights;

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
          disabled={attachments.length >= MAX_ATTACHMENTS || isAnalyzing}
          item={referenceAttachmentMaterial}
          multiple
          onClear={() => undefined}
          onLocalFiles={(_, files) => addFiles(files)}
          onOpen={() => undefined}
          onRemoveOne={() => undefined}
          openMode="local"
          selected={undefined}
          />
        </div>

        {uploadNotice ? <p className="lightweight-video-upload-notice">{uploadNotice}</p> : null}

        {attachments.length > 0 ? (
          <div className="lightweight-video-file-list">
            {attachments.map((attachment) => {
              const FileIcon = attachmentIcon(attachment.kind);
              return (
                <article className="lightweight-video-file" key={attachment.id}>
                  <div className="lightweight-video-file-preview">
                    {attachment.kind === 'image' && attachment.previewUrl ? (
                      <img alt="" src={attachment.previewUrl} />
                    ) : attachment.kind === 'video' && attachment.previewUrl ? (
                      <video muted playsInline preload="metadata" src={attachment.previewUrl} />
                    ) : (
                      <FileIcon size={20} />
                    )}
                  </div>
                  <div className="lightweight-video-file-copy">
                    <strong title={attachment.file.name}>{attachment.file.name}</strong>
                    <span>{formatFileSize(attachment.file.size)}</span>
                  </div>
                  <Button
                    aria-label={t('删除{{0}}', { '0': attachment.file.name })}
                    className="lightweight-video-file-remove"
                    disabled={isAnalyzing}
                    icon={<Trash2 size={14} />}
                    onClick={() => removeAttachment(attachment.id)}
                    size="small"
                    type="text"
                  />
                </article>
              );
            })}
          </div>
        ) : null}
      </WorkspaceSection>

      <WorkspaceSection
        className="lightweight-video-brief"
        description={t('说明产品、目标受众、投放平台、视频时长和期望风格。')}
        title={t('营销需求')}
      >
        <Input.TextArea
          autoSize={{ minRows: 4, maxRows: 8 }}
          disabled={isAnalyzing}
          maxLength={1000}
          onChange={(event) => {
            setBrief(event.target.value);
            setAnalysisSession(null);
            setAnalysisError('');
          }}
          placeholder={t('例如：为这款产品制作 15 秒宣传视频，风格专业、清晰、有科技感。')}
          value={brief}
        />
      </WorkspaceSection>

      <WorkspaceSection
        className="lightweight-video-stages"
        description={t('后续能力将按顺序处理，当前先完成页面结构与交互。')}
        title={t('生成流程')}
      >
        <div className="lightweight-video-stage-list">
          {workflowStages.map((stage, index) => {
            const StageIcon = stage.icon;
            const isAnalysisStage = index === 0;
            const status = isAnalysisStage
              ? (analysisCompleted ? t('已完成') : isAnalyzing ? t('分析中') : analysisError ? t('失败') : t('等待开始'))
              : t('待接入');
            return (
              <article className="lightweight-video-stage" key={stage.title}>
                <span className="lightweight-video-stage-index">{index + 2}</span>
                <span className="lightweight-video-stage-icon"><StageIcon size={17} /></span>
                <div className="lightweight-video-stage-copy">
                  <div>
                    <strong>{stage.title}</strong>
                    <span>{status}</span>
                  </div>
                  <p>{stage.description}</p>
                </div>
                <Button
                  disabled={!isAnalysisStage || isAnalyzing}
                  loading={isAnalysisStage && isAnalyzing}
                  onClick={isAnalysisStage ? () => void handleAnalyze() : undefined}
                  size="small"
                  type={isAnalysisStage ? 'primary' : 'default'}
                >
                  {isAnalysisStage && analysisCompleted ? t('重新分析') : stage.action}
                </Button>
              </article>
            );
          })}
        </div>

        {analysisError ? <p className="lightweight-video-analysis-error">{analysisError}</p> : null}

        {analysisCompleted && insights ? (
          <div className="lightweight-video-analysis-result">
            <div className="lightweight-video-analysis-heading">
              <strong>{insights.productName || t('内容分析结果')}</strong>
              {insights.productCategory ? <span>{insights.productCategory}</span> : null}
            </div>
            <AnalysisList label={t('核心卖点')} values={insights.coreSellingPoints} />
            <AnalysisList label={t('产品特征')} values={insights.productFeatures} />
            <AnalysisList label={t('目标受众')} values={insights.targetAudience} />
            <AnalysisList label={t('使用场景')} values={insights.useScenarios} />
            {analysisSession.analysis.notes.length > 0 ? (
              <AnalysisList label={t('待确认')} values={analysisSession.analysis.notes} />
            ) : null}
          </div>
        ) : null}
      </WorkspaceSection>
    </div>
  );
}

function AnalysisList({ label, values }: { label: string; values: string[] }) {
  if (!values.length) return null;
  return (
    <div className="lightweight-video-analysis-row">
      <span>{label}</span>
      <p>{values.join('、')}</p>
    </div>
  );
}
