import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Dropdown, Input, Modal, Spin, Tooltip, Upload, message } from 'antd';
import type { UploadFile, UploadProps } from 'antd';
import { ArrowUp, Bot, Clapperboard, Edit3, Link2, MoreHorizontal, Paperclip, Plus, RefreshCw, Repeat2, RotateCcw, Trash2, UploadCloud, Users, X } from 'lucide-react';
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
  type VideoRemakeCardType,
  type VideoRemakeChatMessage,
  type VideoRemakeSession,
  type VideoRemakeSessionSummary,
  type VideoRemakePipUploadResult,
} from '../../../api/video-remake';
import { listContentAssetGroups, listContentAssets, uploadContentAsset } from '../../../api/content';
import { API_BASE_URL } from '../../../api/request';
import type { ContentAsset, ContentAssetGroup, User } from '../../../types';
import { renderVideoRemakeCard } from './cardRegistry';
import { ViralWorkbenchStartPanel } from '../shared/ViralWorkbenchStartPanel';
import {
  cardStatusLabels,
  cardTypeLabels,
  asItems,
  asRecord,
  fieldBool,
  fieldText,
  formatDate,
  mediaUrl,
  downstreamCardTypesByUpstream,
} from './videoRemakeCardUtils';
import { withAuthToken } from '../../../utils/session';
import { formatRelativeCalendarDateTime } from '../../../utils/dateTime';
import { useWorkspaceHeader } from '../../../layouts/ProtectedLayout';
import { VideoWorkbenchLayout } from '../../../layouts/VideoWorkbenchLayout';
import { FloatingComposer } from '../../../components/FloatingComposer';
import './VideoRemakePage.scss';

type VideoRemakePageProps = {
  currentUser: User;
};

type VideoRemakeAssetData = {
  groupList: ContentAssetGroup[];
  assetList: ContentAsset[];
};

const pageDataRequests = new Map<string, Promise<VideoRemakeSessionSummary[]>>();
const assetDataRequests = new Map<string, Promise<VideoRemakeAssetData>>();
const MAX_USER_VIDEO_PREVIEW_EDGE = 480;
const MAX_CONCURRENT_VIDEO_REMAKE_SESSIONS = 8;

function requestVideoRemakePageData(userId: string) {
  const cached = pageDataRequests.get(userId);
  if (cached) {
    return cached;
  }
  const promise = listVideoRemakeSessions(userId);
  pageDataRequests.set(userId, promise);
  promise.finally(() => pageDataRequests.delete(userId));
  return promise;
}

function requestVideoRemakeAssets(userId: string) {
  const cached = assetDataRequests.get(userId);
  if (cached) {
    return cached;
  }
  const promise = Promise.all([
    listContentAssetGroups(userId),
    listContentAssets({ userId }),
  ]).then(([groupList, assetList]) => ({ groupList, assetList }));
  assetDataRequests.set(userId, promise);
  promise.finally(() => assetDataRequests.delete(userId));
  return promise;
}

function cardAnchorId(cardId: string) {
  return `video-remake-card-${cardId}`;
}

function strictNumberInputValue(value: unknown) {
  if (typeof value === 'string' && !value.trim()) {
    return Number.NaN;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : Number.NaN;
}

function validateCardBeforeConfirm(card: VideoRemakeCardMessage, data: unknown) {
  const items = asItems(asRecord(data).items);
  const hasAssetIds = (item: Record<string, unknown>) => Array.isArray(item.assetIds) && item.assetIds.some((entry) => fieldText(entry).trim());
  if (card.cardType === 'character_setting') {
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      if (item.required === false || fieldText(item.referenceMode) !== 'asset') {
        continue;
      }
      const hasReference = Boolean(
        hasAssetIds(item)
        || fieldText(item.assetId).trim()
        || fieldText(item.groupId).trim()
        || fieldText(item.materialId).trim()
        || fieldText(item.materialGroupId).trim()
        || fieldText(item.replacementAssetId).trim()
        || fieldText(item.replacementGroupId).trim(),
      );
      if (!hasReference) {
        return `${fieldText(item.label).trim() || `人物 ${index + 1}`} 已选择“参考素材”，请先选择人物素材后再确认。`;
      }
    }
  }
  if (card.cardType === 'scene_setting' || card.cardType === 'product_setting') {
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      if (item.required === false || fieldText(item.referenceMode) !== 'asset') {
        continue;
      }
      if (card.cardType === 'product_setting' && fieldBool(item.noProduct)) {
        continue;
      }
      const hasReference = Boolean(
        hasAssetIds(item)
        || fieldText(item.assetId).trim()
        || fieldText(item.groupId).trim(),
      );
      if (!hasReference) {
        const label = fieldText(item.label).trim() || `${card.cardType === 'scene_setting' ? '场景' : '产品'} ${index + 1}`;
        return `${label} 已选择“参考素材”，请先选择素材后再确认。`;
      }
    }
  }
  if (card.cardType === 'pip_setting') {
    const ranges = items
      .filter((item) => item.required !== false)
      .map((item, index) => {
        const startSecond = strictNumberInputValue(item.startSecond);
        const endSecond = strictNumberInputValue(item.endSecond);
        const label = fieldText(item.label).trim() || `画中画 ${index + 1}`;
        if (!Number.isFinite(startSecond) || !Number.isFinite(endSecond)) {
          return { label, error: `${label} 请填写开始和结束时间`, startSecond, endSecond };
        }
        if (startSecond < 0 || endSecond <= startSecond) {
          return { label, error: `${label} 时间范围不正确`, startSecond, endSecond };
        }
        if (!fieldText(item.replacementAssetUrl).trim() && !fieldText(item.replacementPrompt || item.content).trim()) {
          return { label, error: `${label} 请上传图片素材或填写画中画描述提示词`, startSecond, endSecond };
        }
        return { label, startSecond, endSecond };
      });
    const firstError = ranges.find((item) => item.error);
    if (firstError?.error) {
      return firstError.error;
    }
    const sorted = ranges.slice().sort((left, right) => left.startSecond - right.startSecond);
    for (let index = 1; index < sorted.length; index += 1) {
      if (sorted[index].startSecond < sorted[index - 1].endSecond) {
        return `${sorted[index - 1].label} 和 ${sorted[index].label} 的时间范围重叠`;
      }
    }
  }
  return '';
}

function shouldShowCardStatus(card: VideoRemakeCardMessage) {
  return !['uploading', 'video_basic_info', 'expert_analysis', 'generation_progress', 'llm_thinking'].includes(card.cardType);
}

function shouldShowCardStatusBadge(card: VideoRemakeCardMessage) {
  return !['video_basic_info', 'expert_analysis', 'llm_thinking', 'final_video'].includes(card.cardType);
}

function shouldShowCardEyebrow(card: VideoRemakeCardMessage) {
  return !['uploading', 'video_basic_info', 'generation_progress', 'llm_thinking'].includes(card.cardType);
}

function isCompletedFinalVideoCard(card: VideoRemakeCardMessage) {
  if (card.cardType !== 'final_video') {
    return false;
  }
  const data = asRecord(card.data);
  return Boolean(fieldText(data.videoUrl) || fieldText(data.status) === 'completed');
}

function isFinalVideoCardStuckAfterSegmentsCompleted(card: VideoRemakeCardMessage) {
  if (card.cardType !== 'final_video' || isCompletedFinalVideoCard(card)) {
    return false;
  }
  const data = asRecord(card.data);
  const status = fieldText(data.status);
  if (card.status !== 'pending' && status !== 'generating') {
    return false;
  }
  const segments = asItems(data.generatedSegments).length
    ? asItems(data.generatedSegments)
    : asItems(data.segments);
  return segments.length > 0 && segments.every((segment) => fieldText(segment.status) === 'completed');
}

function cardVisualStatus(card: VideoRemakeCardMessage) {
  return card.status === 'expired' && isCompletedFinalVideoCard(card) ? 'confirmed' : card.status;
}

function isProgressExecutionCompleted(item: Record<string, unknown>) {
  const status = fieldText(item.status || item.state || item.executionStatus).toLowerCase();
  return item.completed === true
    || ['completed', 'success', 'succeeded', 'done', 'finished', '已完成'].includes(status);
}

function isGenerationProgressCompleted(card: VideoRemakeCardMessage) {
  if (card.cardType !== 'generation_progress') {
    return false;
  }
  const data = asRecord(card.data);
  const status = fieldText(data.status);
  if (card.status === 'confirmed' || status === 'completed') {
    return true;
  }
  if (card.status === 'failed' || status === 'failed') {
    return false;
  }
  const executions = Array.isArray(data.executions)
    ? data.executions.map(asRecord).filter((item) => Object.keys(item).length > 0)
    : [];
  const totalExperts = Number(data.totalExperts || executions.length || 0);
  if (totalExperts <= 0) {
    return false;
  }
  const completedExperts = Math.min(
    totalExperts,
    Math.max(Number(data.completedExperts || 0), executions.filter(isProgressExecutionCompleted).length),
  );
  return completedExperts >= totalExperts;
}

function cardDisplayTitle(card: VideoRemakeCardMessage) {
  if (card.cardType === 'expert_analysis') {
    return fieldText(asRecord(card.data).roleName) || card.title;
  }
  if (card.cardType === 'generation_progress') {
    const data = asRecord(card.data);
    const kind = fieldText(data.kind);
    const status = fieldText(data.status);
    if (kind === 'url_parsing') {
      if (status === 'completed') {
        return '视频链接解析完成';
      }
      if (status === 'failed') {
        return '视频链接解析失败';
      }
      return '视频链接解析中';
    }
    if (fieldText(data.kind) === 'video_generation') {
      return status === 'completed' ? '视频生成完成' : '视频生成中';
    }
    if (status === 'completed' || isGenerationProgressCompleted(card)) {
      return '视频解析完成';
    }
    if (status === 'failed') {
      return '积分不足';
    }
    return '视频解析中';
  }
  if (card.cardType === 'uploading') {
    const status = fieldText(asRecord(card.data).status);
    return status === 'uploaded' ? '视频上传完成' : '视频上传中';
  }
  if (card.cardType === 'final_video') {
    const data = asRecord(card.data);
    const versionLabel = fieldText(data.versionLabel || data.version)
      || (fieldText(data.versionNumber) ? `v${fieldText(data.versionNumber)}` : '');
    const regenerationMode = fieldText(data.regenerationMode);
    const regeneratedSegmentIndexes = Array.isArray(data.regeneratedSegmentIndexes)
      ? data.regeneratedSegmentIndexes.map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0)
      : [];
    const regeneratedSegmentIndex = Number(data.regeneratedSegmentIndex || 0);
    const segmentLabel = regeneratedSegmentIndexes.length
      ? `分段 ${regeneratedSegmentIndexes.join('、')}`
      : regeneratedSegmentIndex > 0
        ? `分段 ${regeneratedSegmentIndex}`
        : '';
    if (regenerationMode === 'segment' && segmentLabel) {
      return versionLabel
        ? `分段重新生成 ${versionLabel} · ${segmentLabel}`
        : `分段重新生成 · ${segmentLabel}`;
    }
    return versionLabel ? `最终视频 ${versionLabel}` : card.title;
  }
  if (card.cardType === 'seedance_prompt') {
    return '提示词';
  }
  return card.title;
}

function cardStatusDisplay(card: VideoRemakeCardMessage, active?: boolean) {
  const data = asRecord(card.data);
  const kind = fieldText(data.kind);
  const status = fieldText(data.status);
  if (card.cardType === 'uploading') {
    return status === 'uploaded' ? '已完成' : '上传中';
  }
  if (card.cardType === 'generation_progress') {
    if (kind === 'url_parsing') {
      if (status === 'completed') {
        return '已完成';
      }
      if (status === 'failed') {
        return '失败';
      }
      return '解析中';
    }
    if (fieldText(data.kind) === 'video_generation') {
      return status === 'completed' ? '已完成' : '生成中';
    }
    return status === 'completed' || isGenerationProgressCompleted(card) ? '已完成' : '解析中';
  }
  if (card.cardType === 'director_normalize') {
    if (card.status === 'failed' || status === 'failed') {
      return '失败';
    }
    return card.status === 'confirmed' || status === 'completed' ? '已完成' : '生成中';
  }
  if (card.cardType === 'final_video' && card.status === 'pending') {
    return fieldText(data.regenerationMode) === 'segment' ? '分段重生成中' : '生成中';
  }
  if (card.cardType === 'final_video' && card.status === 'expired' && isCompletedFinalVideoCard(card)) {
    return '已确认';
  }
  if (card.cardType === 'final_video' && card.status === 'editing') {
    return '待确认';
  }
  if (card.cardType === 'storyboard_script' && card.status === 'pending') {
    return '解析中';
  }
  if (card.cardType === 'seedance_prompt' && card.status === 'pending') {
    return '生成中';
  }
  if (active) {
    return '当前卡片';
  }
  return cardStatusLabels[card.status];
}

function cardNodeLabel(card: VideoRemakeCardMessage) {
  const map: Record<string, string> = {
    uploading: '上',
    video_basic_info: '视',
    basic_info: '基',
    expert_analysis: '解',
    generation_progress: '解',
    llm_thinking: 'AI',
    character_setting: '人',
    scene_setting: '场',
    product_setting: '产',
    pip_setting: '画',
    voice_audio_setting: '声',
    script_content: '口',
    storyboard_script: '分',
    seedance_prompt: '提',
    final_video: '完',
  };
  return map[card.cardType] || '系';
}

function shouldShowExpertRetry(card: VideoRemakeCardMessage) {
  return card.cardType === 'expert_analysis'
    && card.status === 'confirmed'
    && !fieldBool(asRecord(card.data).retrying);
}

const finalVideoRetryBlockingCardTypes = new Set([
  'character_setting',
  'scene_setting',
  'product_setting',
  'pip_setting',
  'voice_audio_setting',
  'script_content',
  'storyboard_script',
  'seedance_prompt',
]);

function shouldShowFinalVideoRetry(card: VideoRemakeCardMessage, messages: VideoRemakeChatMessage[]) {
  if (card.cardType !== 'final_video' || card.status !== 'failed') {
    return false;
  }
  const currentIndex = messages.findIndex((item) => item.type === 'card' && item.cardId === card.cardId);
  if (currentIndex < 0) {
    return false;
  }
  const hasNewerBlockingCard = messages.slice(currentIndex + 1).some((item) => (
    item.type === 'card'
    && item.status !== 'expired'
    && finalVideoRetryBlockingCardTypes.has(item.cardType)
  ));
  return !hasNewerBlockingCard;
}

function isLatestFinalVideoCard(card: VideoRemakeCardMessage, messages: VideoRemakeChatMessage[]) {
  if (card.cardType !== 'final_video' || card.status === 'pending' || !isCompletedFinalVideoCard(card)) {
    return false;
  }
  const latest = messages
    .filter((item): item is VideoRemakeCardMessage => item.type === 'card' && item.cardType === 'final_video')
    .at(-1);
  return latest?.cardId === card.cardId;
}

function shouldShowStoryboardRetry(card: VideoRemakeCardMessage) {
  return card.cardType === 'storyboard_script'
    && (card.status === 'editing' || card.status === 'confirmed');
}

function isStoryboardResolving(card: VideoRemakeCardMessage) {
  if (card.cardType !== 'storyboard_script') {
    return false;
  }
  if (card.status === 'expired') {
    return false;
  }
  const data = asRecord(card.data);
  const status = fieldText(data.status);
  const message = fieldText(data.message);
  return card.status === 'pending'
    || ['thinking', 'regenerating', 'generating'].includes(status)
    || /生成中|解析中|思考/u.test(message);
}

const recoverableLlmCardTypes = new Set<VideoRemakeCardType>([
  'director_normalize',
  'llm_thinking',
  'storyboard_script',
  'seedance_prompt',
]);

function shouldShowStuckCardRefresh(card: VideoRemakeCardMessage) {
  if (!recoverableLlmCardTypes.has(card.cardType) || card.status === 'expired') {
    return false;
  }
  const data = asRecord(card.data);
  const status = fieldText(data.status);
  const message = fieldText(data.message);
  return card.status === 'pending'
    || ['thinking', 'regenerating', 'generating', 'running', 'pending'].includes(status)
    || /生成中|解析中|整理中|思考/u.test(message);
}

function isBlockedByResolvingStoryboard(card: VideoRemakeCardMessage, messages: VideoRemakeChatMessage[]) {
  if (!['seedance_prompt', 'final_video'].includes(card.cardType)) {
    return false;
  }
  return messages.some((item) => item.type === 'card' && isStoryboardResolving(item));
}

function affectedDownstreamLabels(card: VideoRemakeCardMessage, messages: VideoRemakeChatMessage[], options?: { includePlanned?: boolean }) {
  const downstreamTypes = downstreamCardTypesByUpstream[card.cardType] || [];
  const labels = downstreamTypes.flatMap((cardType) => {
    if (options?.includePlanned) {
      return [cardTypeLabels[cardType]];
    }
    const affectedCard = messages
      .filter((item): item is VideoRemakeCardMessage => item.type === 'card' && item.cardType === cardType && item.status !== 'expired')
      .at(-1);
    return affectedCard ? [cardTypeLabels[cardType]] : [];
  });
  return Array.from(new Set(labels));
}

type DownstreamInvalidationChoice = 'confirm' | 'save_only' | 'cancel';

function confirmDownstreamInvalidation(input: { card: VideoRemakeCardMessage; messages: VideoRemakeChatMessage[]; actionText: string; includePlanned?: boolean; allowSaveOnly?: boolean }) {
  const labels = affectedDownstreamLabels(input.card, input.messages, { includePlanned: input.includePlanned });
  if (!labels.length) {
    return Promise.resolve<DownstreamInvalidationChoice>('confirm');
  }
  return new Promise<DownstreamInvalidationChoice>((resolve) => {
    let settled = false;
    let modal: ReturnType<typeof Modal.confirm>;
    const finish = (choice: DownstreamInvalidationChoice) => {
      if (settled) {
        return;
      }
      settled = true;
      modal?.destroy();
      resolve(choice);
    };
    modal = Modal.confirm({
      title: `${input.actionText}会使下游卡片失效`,
      content: `继续后，${labels.join('、')}会失效，需要重新确认或生成。确定继续吗？`,
      okText: '确认并失效',
      cancelText: '取消',
      footer: (
        <div className="ant-modal-confirm-btns">
          <Button onClick={() => finish('cancel')}>取消</Button>
          {input.allowSaveOnly ? (
            <Button onClick={() => finish('save_only')}>仅修改</Button>
          ) : null}
          <Button type="primary" onClick={() => finish('confirm')}>确认并失效</Button>
        </div>
      ),
      onCancel: () => finish('cancel'),
    });
  });
}

function isConfirmedCardEdit(card: VideoRemakeCardMessage) {
  return card.status === 'confirmed' || asRecord(card.data).editingFromConfirmed === true;
}

function latestCardIdOfType(messages: VideoRemakeChatMessage[], cardType?: VideoRemakeCardType) {
  if (!cardType) {
    return '';
  }
  return [...messages]
    .reverse()
    .find((item): item is VideoRemakeCardMessage => item.type === 'card' && item.cardType === cardType)?.cardId || '';
}

function confirmFinalVideoRegeneration(versionLabel: string) {
  return new Promise<boolean>((resolve) => {
    Modal.confirm({
      title: '重新生成视频？',
      content: `${versionLabel ? `将基于 ${versionLabel} 的当前设定` : '将基于当前设定'}重新生成一个新的视频版本，原视频会保留。确定继续吗？`,
      okText: '重新生成',
      cancelText: '取消',
      onOk: () => resolve(true),
      onCancel: () => resolve(false),
    });
  });
}

function formatFileSize(value?: number) {
  if (!value || !Number.isFinite(value)) {
    return '';
  }
  if (value < 1024 * 1024) {
    return `${Math.max(1, Math.round(value / 1024))} KB`;
  }
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function UserVideoPreview({ src }: { src: string }) {
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    setDimensions(null);
  }, [src]);

  const style = useMemo(() => {
    if (!dimensions) {
      return undefined;
    }
    const longestEdge = Math.max(dimensions.width, dimensions.height);
    const scale = longestEdge > MAX_USER_VIDEO_PREVIEW_EDGE ? MAX_USER_VIDEO_PREVIEW_EDGE / longestEdge : 1;
    return {
      width: `${Math.round(dimensions.width * scale)}px`,
      height: `${Math.round(dimensions.height * scale)}px`,
    };
  }, [dimensions]);

  return (
    <video
      controls
      preload="metadata"
      src={src}
      style={style}
      onLoadedMetadata={(event) => {
        const { videoWidth, videoHeight } = event.currentTarget;
        if (!videoWidth || !videoHeight) {
          return;
        }
        setDimensions((current) => {
          if (current?.width === videoWidth && current.height === videoHeight) {
            return current;
          }
          return { width: videoWidth, height: videoHeight };
        });
      }}
    />
  );
}

function sessionStatusMeta(status: VideoRemakeSession['status']) {
  const map: Record<VideoRemakeSession['status'], { label: string; tone: string }> = {
    created: { label: '待解析', tone: 'neutral' },
    running: { label: '解析中', tone: 'blue' },
    waiting_credit: { label: '待充值', tone: 'orange' },
    waiting_edit: { label: '待生成视频', tone: 'blue' },
    generating: { label: '视频生成中', tone: 'blue' },
    completed: { label: '视频生成完成', tone: 'green' },
    failed: { label: '解析失败', tone: 'red' },
    cancelled: { label: '已取消', tone: 'gray' },
  };
  return map[status] || { label: status, tone: 'neutral' };
}

function isProcessingVideoRemakeSession(status: VideoRemakeSession['status']) {
  return ['running', 'generating'].includes(status);
}

function MessageItem({
  item,
  messages,
  assets,
  groups,
  disabled,
  active,
  onConfirmCard,
  onCancelCard,
  onEditCard,
  onEnsureAssets,
  onRegenerateCard,
  onRecoverCard,
  onRegenerateFinalSegment,
  onRegenerateFinalSegments,
  onSyncSession,
  syncing,
  onRetryExpert,
  onUploadPipImage,
  onUploadReferenceImage,
  cardDrafts,
  onCardDraftChange,
  videoAspectRatio,
  videoDurationSeconds,
}: {
  item: VideoRemakeChatMessage;
  messages: VideoRemakeChatMessage[];
  assets: ContentAsset[];
  groups: ContentAssetGroup[];
  disabled?: boolean;
  active?: boolean;
  onConfirmCard: (card: VideoRemakeCardMessage, data: unknown) => Promise<void>;
  onCancelCard: (card: VideoRemakeCardMessage) => Promise<void>;
  onEditCard: (card: VideoRemakeCardMessage) => Promise<void>;
  onEnsureAssets: () => Promise<void>;
  onRegenerateCard: (card: VideoRemakeCardMessage, instruction?: string) => Promise<void>;
  onRecoverCard: (card: VideoRemakeCardMessage) => Promise<void>;
  onRegenerateFinalSegment: (card: VideoRemakeCardMessage, segmentIndex: number, prompt?: string) => Promise<void>;
  onRegenerateFinalSegments: (card: VideoRemakeCardMessage, segments: Array<{ segmentIndex: number; prompt?: string }>) => Promise<void>;
  onSyncSession: () => Promise<void>;
  syncing?: boolean;
  onRetryExpert: (card: VideoRemakeCardMessage) => Promise<void>;
  onUploadPipImage: (file: File) => Promise<VideoRemakePipUploadResult>;
  onUploadReferenceImage: (kind: 'scene' | 'product', file: File) => Promise<ContentAsset>;
  cardDrafts: Record<string, unknown>;
  onCardDraftChange: (card: VideoRemakeCardMessage, value: unknown | ((current: unknown) => unknown)) => void;
  videoAspectRatio?: string;
  videoDurationSeconds?: number;
}) {
  if (item.type === 'text') {
    if (item.attachment?.type === 'video') {
      return (
        <article className="remake-message remake-message-user remake-message-video">
          <div className="remake-user-video-bubble">
            <strong>{item.content}</strong>
            <UserVideoPreview src={mediaUrl(item.attachment.url)} />
            <div className="remake-user-video-meta">
              <span>{item.attachment.title}</span>
              {item.attachment.fileSize ? <small>{formatFileSize(item.attachment.fileSize)}</small> : null}
            </div>
          </div>
          <time dateTime={item.createdAt}>{formatRelativeCalendarDateTime(item.createdAt)}</time>
        </article>
      );
    }
    return (
      <article className={`remake-message remake-message-${item.role} ${item.role === 'assistant' || item.role === 'system' ? 'remake-message-timeline' : ''}`}>
        {item.role === 'assistant' || item.role === 'system' ? <span className="remake-timeline-node">系</span> : null}
        <div className="remake-message-content">
          <div>{item.content}</div>
          <time dateTime={item.createdAt}>{formatRelativeCalendarDateTime(item.createdAt)}</time>
        </div>
      </article>
    );
  }

  const lockedByStoryboard = isBlockedByResolvingStoryboard(item, messages);
  const cardDisabled = disabled || lockedByStoryboard;

  return (
    <article className={`remake-message remake-message-card remake-message-timeline ${active ? 'is-active' : ''}`} id={cardAnchorId(item.cardId)}>
      <span className="remake-timeline-node">{cardNodeLabel(item)}</span>
      <div className="remake-message-content">
        <div className={`remake-card remake-card-${cardVisualStatus(item)} ${active ? 'remake-card-focused' : ''}`}>
          {item.cardType !== 'llm_thinking' ? (
            <div className="remake-card-header">
              <div>
                <strong>{cardDisplayTitle(item)}</strong>
              </div>
              <div className="remake-card-header-actions">
                {shouldShowCardStatusBadge(item) ? (
                  <em className={`status-${cardVisualStatus(item)}`}>{cardStatusDisplay(item, active)}</em>
                ) : null}
                {isLatestFinalVideoCard(item, messages) ? (
                  <button className="remake-card-action-link" disabled={cardDisabled} onClick={() => void onRegenerateCard(item)} type="button">
                    重新生成视频
                  </button>
                ) : null}
                {item.status === 'confirmed' && !['uploading', 'video_basic_info', 'expert_analysis', 'generation_progress', 'director_normalize', 'storyboard_script', 'final_video'].includes(item.cardType) ? (
                  <button className="remake-card-edit-link" disabled={cardDisabled} onClick={() => void onEditCard(item)} type="button">
                    编辑
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
          {renderVideoRemakeCard({
            active,
            assets,
            groups,
            card: item,
            disabled: cardDisabled,
            draft: Object.prototype.hasOwnProperty.call(cardDrafts, item.cardId) ? cardDrafts[item.cardId] : item.data,
            onEnsureAssets,
            onCancel: () => onCancelCard(item),
            onConfirm: (data) => onConfirmCard(item, data),
            onDraftChange: (value) => onCardDraftChange(item, value),
            onEdit: () => onEditCard(item),
            onRegenerate: (instruction) => onRegenerateCard(item, instruction),
            onRegenerateFinalSegment: (segmentIndex, prompt) => onRegenerateFinalSegment(item, segmentIndex, prompt),
            onRegenerateFinalSegments: (segments) => onRegenerateFinalSegments(item, segments),
            onSyncProgress: ['generation_progress', 'final_video'].includes(item.cardType) ? onSyncSession : undefined,
            syncing,
            onUploadPipImage,
            onUploadReferenceImage,
            videoAspectRatio,
            videoDurationSeconds,
          })}
        </div>
        <div className="remake-message-footer remake-card-footer">
          <time dateTime={item.createdAt}>{formatRelativeCalendarDateTime(item.createdAt)}</time>
          {shouldShowStuckCardRefresh(item) ? (
            <Tooltip title="刷新卡片状态，卡住时重新开始">
              <button
                aria-label="刷新卡片状态"
                className="remake-message-icon-action"
                disabled={disabled}
                onClick={() => void onRecoverCard(item)}
                type="button"
              >
                <RefreshCw size={14} />
              </button>
            </Tooltip>
          ) : null}
          {shouldShowExpertRetry(item) ? (
            <Tooltip title="重试">
              <button
                aria-label="重试专家解析"
                className="remake-message-icon-action"
                disabled={disabled}
                onClick={() => void onRetryExpert(item)}
                type="button"
              >
                <RotateCcw size={14} />
              </button>
            </Tooltip>
          ) : null}
          {shouldShowFinalVideoRetry(item, messages) ? (
            <Tooltip title="重试">
              <button
                aria-label="重试视频生成"
                className="remake-message-icon-action"
                disabled={disabled}
                onClick={() => void onConfirmCard(item, item.data)}
                type="button"
              >
                <RotateCcw size={14} />
              </button>
            </Tooltip>
          ) : null}
          {shouldShowStoryboardRetry(item) ? (
            <Tooltip title="重新解析">
              <button
                aria-label="重新解析分镜脚本"
                className="remake-message-icon-action"
                disabled={disabled}
                onClick={() => void onRegenerateCard(item)}
                type="button"
              >
                <RotateCcw size={14} />
              </button>
            </Tooltip>
          ) : null}
        </div>
      </div>
    </article>
  );
}

export function VideoRemakePage({ currentUser }: VideoRemakePageProps) {
  const { setHeaderExtra } = useWorkspaceHeader();
  const [searchParams, setSearchParams] = useSearchParams();
  const urlSessionId = searchParams.get('sessionId')?.trim() || '';
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
      <Button icon={<RefreshCw size={15} />} loading={isLoading} onClick={() => void loadData()}>
        刷新
      </Button>,
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
      content: (
        <Input
          autoFocus
          defaultValue={currentName}
          onChange={(event) => {
            nextName = event.target.value;
          }}
          onPressEnter={() => {
            const okButton = document.querySelector<HTMLElement>('.ant-modal-confirm-btns .ant-btn-primary');
            okButton?.click();
          }}
          placeholder="请输入会话名称"
        />
      ),
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

  return (
    <div className="video-remake-page">
      <VideoWorkbenchLayout
        sidebarHeader={(
          <div className="video-remake-sidebar-header">
            <Button block icon={<Plus size={16} />} onClick={handleNewSession} type="primary">
              新建复刻
            </Button>
          </div>
        )}
        sidebarTitle="会话"
        sidebarContent={(
          <div className="video-remake-sidebar-section">
            <div className="video-workbench-list">
              {sessions.map((session) => {
                const status = sessionStatusMeta(session.status);
                const title = session.filename || '未命名复刻';
                return (
                  <div
                    className={`video-workbench-list-item video-remake-session-item ${session.id === activeSession?.id ? 'active' : ''}`}
                    key={session.id}
                    onClick={() => {
                      setShowStartPanel(false);
                      void loadSessionDetail(session.id, { silent: true, syncUrl: true, showOverlay: true });
                      setHighlightCardId('');
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setShowStartPanel(false);
                        void loadSessionDetail(session.id, { silent: true, syncUrl: true, showOverlay: true });
                        setHighlightCardId('');
                      }
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <div className="video-workbench-list-main">
                      <span className="video-remake-session-title-row">
                        <span className="video-workbench-list-title">{title}</span>
                        <Dropdown
                          menu={{
                            items: [
                              {
                                key: 'rename',
                                icon: <Edit3 size={16} />,
                                label: '编辑名称',
                                onClick: () => handleRenameSession(session),
                              },
                              {
                                key: 'delete',
                                danger: true,
                                icon: <Trash2 size={16} />,
                                label: '删除会话',
                                onClick: () => handleDeleteSession(session),
                              },
                            ],
                          }}
                          placement="bottomRight"
                          trigger={['click']}
                        >
                          <Button
                            aria-label="会话操作"
                            className="video-workbench-item-action video-remake-session-action"
                            icon={<MoreHorizontal size={18} />}
                            onClick={(event) => event.stopPropagation()}
                            type="text"
                          />
                        </Dropdown>
                      </span>
                      <span className="video-remake-session-meta">
                        <small className={`video-workbench-status ${status.tone}`}>{status.label}</small>
                        <time className="video-remake-session-time" dateTime={session.updatedAt}>
                          {formatRelativeCalendarDateTime(session.updatedAt)}
                        </time>
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        footer={activeSession && !showStartPanel ? (
          <FloatingComposer
            after={(
              <Button
                className="video-remake-floating-send"
                disabled={!chatInput.trim()}
                icon={<ArrowUp size={18} />}
                loading={activeSessionWorking}
                onClick={() => void handleSend()}
                type="primary"
              />
            )}
            before={activeSession.status === 'waiting_credit' ? (
              <Button
                icon={<RotateCcw size={16} />}
                loading={activeSessionWorking}
                onClick={() => void handleResumeBlockedSession()}
              >
                充值后继续
              </Button>
            ) : null}
            className="video-remake-floating-composer"
            input={(
              <Input
                className="video-remake-floating-input"
                disabled={activeSessionWorking}
                onChange={(event) => setChatInput(event.target.value)}
                onPressEnter={() => void handleSend()}
                placeholder="输入要修改的内容，例如：我要改画中画"
                value={chatInput}
              />
            )}
            wrapClassName="video-remake-floating-composer-wrap"
          />
        ) : null}
        startContent={(
          <div className="viral-workbench-start-shell">
            <ViralWorkbenchStartPanel
              activeMode={startMode}
              description="上传爆款视频，AI智能解析视频结构，一键复刻生成同款爆款视频"
              featureItems={[
                <><Link2 size={15} />智能解析视频结构</>,
                <><Users size={15} />AI角色专家团队协作</>,
                <><Repeat2 size={15} />素材灵活替换</>,
                <><Clapperboard size={15} />一键生成同款视频</>,
              ]}
              heroIcon={<Bot size={54} />}
              modeOptions={[
                { key: 'upload', label: '上传解析', icon: <UploadCloud size={18} /> },
                { key: 'link', label: '一键复刻', icon: <Link2 size={18} /> },
              ]}
              onModeChange={setStartMode}
              showModeTabs={false}
              title="爆款复刻"
            >
              {startMode === 'link' ? (
                <div className="viral-workbench-panel" role="tabpanel">
                  <div className="viral-workbench-input-row">
                    <Input
                      disabled={startWorking}
                      onChange={(event) => setSourceUrl(event.target.value)}
                      onPressEnter={() => void handleParseUrl()}
                      placeholder="请输入抖音、快手、小红书等平台的视频链接..."
                      value={sourceUrl}
                    />
                    <Button disabled={!sourceUrl.trim()} loading={startWorking} onClick={handleParseUrl} type="primary">
                      解析
                    </Button>
                  </div>
                  <p className="viral-workbench-platforms">支持平台：抖音、快手、小红书、B站、视频号等主流短视频平台</p>
                </div>
              ) : (
                <div className="viral-workbench-panel viral-workbench-upload-panel" role="tabpanel">
                  <div
                    onClick={(event) => {
                      if (!canStartMoreSessions) {
                        event.preventDefault();
                        showConcurrentLimitWarning();
                      }
                    }}
                  >
                    <Upload.Dragger
                      {...uploadProps}
                      openFileDialogOnClick={!startWorking && canStartMoreSessions}
                    >
                    <div className="viral-workbench-upload-drop">
                      {selectedVideoFile ? (
                        <div className="viral-workbench-selected-file viral-workbench-selected-file-inline">
                          <Paperclip size={17} />
                          <span>{selectedVideoFile.name}</span>
                          <button
                            aria-label="清除已选文件"
                            className="viral-workbench-selected-file-clear"
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              setSelectedVideoFile(null);
                            }}
                            type="button"
                          >
                            <X size={12} />
                          </button>
                        </div>
                      ) : (
                        <>
                          <UploadCloud size={34} />
                          <strong>点击或拖拽上传视频</strong>
                          <span>支持 MP4、MOV、WebM 等常见格式</span>
                        </>
                      )}
                      {selectedVideoFile ? (
                        <Button
                          loading={startWorking}
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            void handleStartUploadParse();
                          }}
                          type="primary"
                        >
                          开始解析
                        </Button>
                      ) : null}
                    </div>
                    </Upload.Dragger>
                  </div>
                </div>
              )}
            </ViralWorkbenchStartPanel>
          </div>
        )}
        showStartContent={shouldShowStartContent}
      >
        <main className={`video-remake-main ${!showStartPanel && activeSession ? 'has-session' : 'is-start'}`}>
          {sessionOverlayLoading && activeSession && !showStartPanel ? (
            <div className="video-remake-session-overlay" aria-live="polite" aria-busy="true">
              <Spin />
            </div>
          ) : null}
          <section className={`video-remake-workspace${showStartPanel ? ' is-start' : ''}`} ref={scrollRef}>
            <div className="video-remake-thread" ref={threadRef}>
            {shouldShowWorkspaceLoading ? (
              <div className="video-remake-empty"><Spin /></div>
            ) : activeMessages.length ? (
              <>
                {activeSession?.status === 'waiting_credit' ? (
                  <Alert
                    action={(
                      <Button size="small" type="primary" onClick={() => void handleResumeBlockedSession()}>
                        充值后继续
                      </Button>
                    )}
                    message="当前积分不足，系统已暂停在下一步执行前。充值后点击“充值后继续”即可从当前步骤恢复。"
                    showIcon
                    type="warning"
                  />
                ) : null}
                {activeMessages.map((item) => (
                  <MessageItem
                    active={item.type === 'card' && item.cardId === highlightCardId}
                    assets={assets}
                    cardDrafts={cardDrafts}
                    disabled={activeSessionWorking}
                    groups={groups}
                    item={item}
                    key={item.id}
                    messages={activeMessages}
                    onCardDraftChange={handleCardDraftChange}
                    onCancelCard={handleCancelCard}
                    onConfirmCard={handleConfirmCard}
                    onEditCard={handleEditCard}
                    onEnsureAssets={ensureAssetsLoaded}
                    onRecoverCard={handleRecoverCard}
                    onRegenerateCard={handleRegenerateCard}
                    onRegenerateFinalSegment={handleRegenerateFinalSegment}
                    onRegenerateFinalSegments={handleRegenerateFinalSegments}
                    onSyncSession={handleSyncSession}
                    syncing={activeSessionSyncing}
                    onRetryExpert={handleRetryExpert}
                    onUploadPipImage={handleUploadPipImage}
                    onUploadReferenceImage={handleUploadReferenceImage}
                    videoAspectRatio={currentVideoAspectRatio}
                    videoDurationSeconds={currentVideoDurationSeconds}
                  />
                ))}
              </>
            ) : (
              <div className="video-remake-empty" />
            )}
            <div ref={bottomAnchorRef} aria-hidden="true" />
            </div>
          </section>
        </main>
      </VideoWorkbenchLayout>
    </div>
  );
}
