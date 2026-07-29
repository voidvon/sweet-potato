import { useEffect, useMemo, useState } from 'react';
import { Tooltip } from 'antd';
import { RefreshCw, RotateCcw } from 'lucide-react';
import {
  type VideoRemakeCardMessage,
  type VideoRemakeChatMessage,
  type VideoRemakePipUploadResult,
} from '../../../../api/video-remake';
import type { ContentAsset, ContentAssetGroup } from '../../../../types';
import { renderVideoRemakeCard } from '../cardRegistry';
import {
  cardAnchorId,
  cardDisplayTitle,
  cardNodeLabel,
  cardStatusDisplay,
  cardVisualStatus,
  isBlockedByResolvingStoryboard,
  isLatestFinalVideoCard,
  shouldShowCardStatusBadge,
  shouldShowExpertRetry,
  shouldShowFinalVideoRetry,
  shouldShowStoryboardRetry,
  shouldShowStuckCardRefresh,
} from './videoRemakePageHelpers';
import { formatRelativeCalendarDateTime } from '../../../../utils/dateTime';
import { mediaUrl } from '../videoRemakeCardUtils';
import { AppButton } from '@shared/components/AppButton';

const MAX_USER_VIDEO_PREVIEW_EDGE = 480;
function formatFileSize(value?: number) {
  if (!value || !Number.isFinite(value)) {
    return '';
  }
  if (value < 1024 * 1024) {
    return `${Math.max(1, Math.round(value / 1024))} KB`;
  }
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

export function UserVideoPreview({ src }: { src: string }) {
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

export function MessageItem({
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
                  <AppButton
                    className="remake-card-regenerate-button"
                    disabled={cardDisabled}
                    icon={<RotateCcw size={13} />}
                    onClick={() => void onRegenerateCard(item)}
                    size="small"
                    tone="brand"
                    type="primary"
                  >
                    重新生成视频
                  </AppButton>
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
