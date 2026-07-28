import {
  listContentAssetGroups,
  listContentAssets,
} from '../../../../api/content';
import { listVideoRemakeSessions } from '../../../../api/video-remake';
import type {
  ContentAsset,
  ContentAssetGroup,
} from '../../../../types';
import type {
  VideoRemakeCardMessage,
  VideoRemakeCardType,
  VideoRemakeChatMessage,
  VideoRemakeSession,
  VideoRemakeSessionSummary,
} from '../../../../api/video-remake';
import {
  asItems,
  asRecord,
  cardStatusLabels,
  cardTypeLabels,
  downstreamCardTypesByUpstream,
  fieldBool,
  fieldText,
} from '../videoRemakeCardUtils';

type VideoRemakeAssetData = {
  groupList: ContentAssetGroup[];
  assetList: ContentAsset[];
};

const pageDataRequests = new Map<string, Promise<VideoRemakeSessionSummary[]>>();
const assetDataRequests = new Map<string, Promise<VideoRemakeAssetData>>();
export function requestVideoRemakePageData(userId: string) {
  const cached = pageDataRequests.get(userId);
  if (cached) {
    return cached;
  }
  const promise = listVideoRemakeSessions(userId);
  pageDataRequests.set(userId, promise);
  promise.finally(() => pageDataRequests.delete(userId));
  return promise;
}

export function requestVideoRemakeAssets(userId: string) {
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

export function cardAnchorId(cardId: string) {
  return `video-remake-card-${cardId}`;
}

export function strictNumberInputValue(value: unknown) {
  if (typeof value === 'string' && !value.trim()) {
    return Number.NaN;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : Number.NaN;
}

export function validateCardBeforeConfirm(card: VideoRemakeCardMessage, data: unknown) {
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

export function shouldShowCardStatus(card: VideoRemakeCardMessage) {
  return !['uploading', 'video_basic_info', 'expert_analysis', 'generation_progress', 'llm_thinking'].includes(card.cardType);
}

export function shouldShowCardStatusBadge(card: VideoRemakeCardMessage) {
  return !['video_basic_info', 'expert_analysis', 'llm_thinking', 'final_video'].includes(card.cardType);
}

export function shouldShowCardEyebrow(card: VideoRemakeCardMessage) {
  return !['uploading', 'video_basic_info', 'generation_progress', 'llm_thinking'].includes(card.cardType);
}

export function isCompletedFinalVideoCard(card: VideoRemakeCardMessage) {
  if (card.cardType !== 'final_video') {
    return false;
  }
  const data = asRecord(card.data);
  return Boolean(fieldText(data.videoUrl) || fieldText(data.status) === 'completed');
}

export function isFinalVideoCardStuckAfterSegmentsCompleted(card: VideoRemakeCardMessage) {
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

export function cardVisualStatus(card: VideoRemakeCardMessage) {
  return card.status === 'expired' && isCompletedFinalVideoCard(card) ? 'confirmed' : card.status;
}

export function isProgressExecutionCompleted(item: Record<string, unknown>) {
  const status = fieldText(item.status || item.state || item.executionStatus).toLowerCase();
  return item.completed === true
    || ['completed', 'success', 'succeeded', 'done', 'finished', '已完成'].includes(status);
}

export function isGenerationProgressCompleted(card: VideoRemakeCardMessage) {
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

export function cardDisplayTitle(card: VideoRemakeCardMessage) {
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

export function cardStatusDisplay(card: VideoRemakeCardMessage, active?: boolean) {
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

export function cardNodeLabel(card: VideoRemakeCardMessage) {
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

export function shouldShowExpertRetry(card: VideoRemakeCardMessage) {
  return card.cardType === 'expert_analysis'
    && card.status === 'confirmed'
    && !fieldBool(asRecord(card.data).retrying);
}

export const finalVideoRetryBlockingCardTypes = new Set([
  'character_setting',
  'scene_setting',
  'product_setting',
  'pip_setting',
  'voice_audio_setting',
  'script_content',
  'storyboard_script',
  'seedance_prompt',
]);

export function shouldShowFinalVideoRetry(card: VideoRemakeCardMessage, messages: VideoRemakeChatMessage[]) {
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

export function isLatestFinalVideoCard(card: VideoRemakeCardMessage, messages: VideoRemakeChatMessage[]) {
  if (card.cardType !== 'final_video' || card.status === 'pending' || !isCompletedFinalVideoCard(card)) {
    return false;
  }
  const latest = messages
    .filter((item): item is VideoRemakeCardMessage => item.type === 'card' && item.cardType === 'final_video')
    .at(-1);
  return latest?.cardId === card.cardId;
}

export function shouldShowStoryboardRetry(card: VideoRemakeCardMessage) {
  return card.cardType === 'storyboard_script'
    && (card.status === 'editing' || card.status === 'confirmed');
}

export function isStoryboardResolving(card: VideoRemakeCardMessage) {
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

export const recoverableLlmCardTypes = new Set<VideoRemakeCardType>([
  'director_normalize',
  'llm_thinking',
  'storyboard_script',
  'seedance_prompt',
]);

export function shouldShowStuckCardRefresh(card: VideoRemakeCardMessage) {
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

export function isBlockedByResolvingStoryboard(card: VideoRemakeCardMessage, messages: VideoRemakeChatMessage[]) {
  if (!['seedance_prompt', 'final_video'].includes(card.cardType)) {
    return false;
  }
  return messages.some((item) => item.type === 'card' && isStoryboardResolving(item));
}

export function affectedDownstreamLabels(card: VideoRemakeCardMessage, messages: VideoRemakeChatMessage[], options?: { includePlanned?: boolean }) {
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

export function sessionStatusMeta(status: VideoRemakeSession['status']) {
  const map: Record<VideoRemakeSession['status'], { label: string; tone: string }> = {
    created: { label: '待解析', tone: 'neutral' },
    running: { label: '解析中', tone: 'processing' },
    waiting_credit: { label: '待充值', tone: 'blocked' },
    waiting_edit: { label: '待生成视频', tone: 'warning' },
    generating: { label: '视频生成中', tone: 'processing' },
    completed: { label: '视频生成完成', tone: 'success' },
    failed: { label: '解析失败', tone: 'danger' },
    cancelled: { label: '已取消', tone: 'muted' },
  };
  return map[status] || { label: status, tone: 'neutral' };
}

export function isProcessingVideoRemakeSession(status: VideoRemakeSession['status']) {
  return ['running', 'generating'].includes(status);
}
