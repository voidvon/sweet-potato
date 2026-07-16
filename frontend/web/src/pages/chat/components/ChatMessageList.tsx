import { Button, Dropdown, Image, Modal, Tag, Tooltip, message } from 'antd';
import { CloseCircleOutlined, CopyOutlined, DeleteOutlined, DownloadOutlined, EditOutlined, FileOutlined, MoreOutlined } from '@ant-design/icons';
import { ChevronRight, ImageOff, RefreshCw, Zap } from 'lucide-react';
import { Children, cloneElement, useEffect, useState, type CSSProperties, type ReactElement, type ReactNode, type RefObject } from 'react';
import type { ChatAttachment, ChatMessage, ModelConfig } from '../../../types';
import { resolveAssetUrl } from '../../../api/request';
import { listModelConfigs } from '../../../api/model-config';
import { ClawReferenceGroups, type ClawReferenceGroupConfig } from './ClawReferenceGroups';
import { MarkdownContent, splitThinking } from '../utils/markdown';
import { ImageAttachmentStack } from './ImageAttachmentStack';
import { formatRelativeCalendarDateTime } from '../../../utils/dateTime';
import './ChatMessageList.scss';

type ChatMessageListProps = {
  hasStreamingAssistant: boolean;
  messages: ChatMessage[];
  onActionClick: (content: string) => void;
  onContinueEditImage: (message: ChatMessage) => void;
  onDeleteMessage: (message: ChatMessage) => void;
  onRefillComposerFromMessage: (message: ChatMessage) => void;
  onRegenerateImage: (userMessage: ChatMessage, assistantMessage: ChatMessage, currentCreditCost?: number) => void;
  onScroll: () => void;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  sending: boolean;
};

type ImageGenerationContext = NonNullable<NonNullable<ChatMessage['capabilityContext']>['imageGeneration']>;

type ImageGenerationCellStyle = CSSProperties & {
  '--chat-image-aspect-ratio'?: string;
};

function imageExtension(contentType: string, attachmentName: string) {
  const mimeType = contentType.split(';', 1)[0].trim().toLowerCase();
  const extensionByMimeType: Record<string, string> = {
    'image/avif': 'avif',
    'image/gif': 'gif',
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
  };
  if (extensionByMimeType[mimeType]) {
    return extensionByMimeType[mimeType];
  }
  const extension = /\.([a-z0-9]+)$/i.exec(attachmentName)?.[1];
  return extension?.toLowerCase() || 'png';
}

function imageDownloadFileName(
  attachment: ChatAttachment,
  imageGeneration: ImageGenerationContext | undefined,
  contentType: string,
  downloadedAt: Date,
) {
  const moduleName = imageGeneration?.modeTitle?.trim() || '图片生成';
  const resolution = imageGeneration?.resolution?.trim()
    || imageGeneration?.outputSize?.trim()
    || (attachment.width && attachment.height ? `${attachment.width}x${attachment.height}` : '未知分辨率');
  const pad = (value: number) => String(value).padStart(2, '0');
  const timestamp = `${pad(downloadedAt.getMonth() + 1)}${pad(downloadedAt.getDate())}-${pad(downloadedAt.getHours())}${pad(downloadedAt.getMinutes())}`;
  return `${moduleName}-${resolution}-${timestamp}.${imageExtension(contentType, attachment.name)}`;
}

export function ChatMessageList({
  hasStreamingAssistant,
  messages,
  onActionClick,
  onContinueEditImage,
  onDeleteMessage,
  onRefillComposerFromMessage,
  onRegenerateImage,
  onScroll,
  scrollContainerRef,
  sending,
}: ChatMessageListProps) {
  const [imageConfigs, setImageConfigs] = useState<ModelConfig[]>([]);
  const [loadedImageUrls, setLoadedImageUrls] = useState<Set<string>>(() => new Set());
  const [unavailableImageUrls, setUnavailableImageUrls] = useState<Set<string>>(() => new Set());
  const [previewImageGroup, setPreviewImageGroup] = useState<{
    current: number;
    images: ChatAttachment[];
    open: boolean;
  }>({
    current: 0,
    images: [],
    open: false,
  });

  useEffect(() => {
    let ignore = false;

    async function loadImageConfigs() {
      try {
        const configs = await listModelConfigs('image');
        if (!ignore) {
          setImageConfigs(configs);
        }
      } catch {
        if (!ignore) {
          setImageConfigs([]);
        }
      }
    }

    void loadImageConfigs();
    return () => {
      ignore = true;
    };
  }, []);

  function markImageUnavailable(url: string) {
    setUnavailableImageUrls((current) => {
      if (current.has(url)) {
        return current;
      }
      const next = new Set(current);
      next.add(url);
      return next;
    });
  }

  function markImageLoaded(url: string) {
    setLoadedImageUrls((current) => {
      if (current.has(url)) {
        return current;
      }
      const next = new Set(current);
      next.add(url);
      return next;
    });
  }

  function imageClassName(baseClassName: string, url: string) {
    return [
      baseClassName,
      loadedImageUrls.has(url) ? '' : 'chat-image-pending',
    ].filter(Boolean).join(' ');
  }

  function unavailableImage(className = '') {
    return (
      <span className={['chat-image-unavailable', className].filter(Boolean).join(' ')}>
        <ImageOff aria-hidden="true" size={22} strokeWidth={1.7} />
        <span>图片已清理或过期</span>
      </span>
    );
  }

  function fallbackCopyText(content: string) {
    const textarea = document.createElement('textarea');
    textarea.value = content;
    textarea.setAttribute('readonly', 'true');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    textarea.style.pointerEvents = 'none';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    const copied = document.execCommand('copy');
    document.body.removeChild(textarea);
    return copied;
  }

  async function handleCopy(content: string) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(content);
      } else if (!fallbackCopyText(content)) {
        throw new Error('copy_failed');
      }
      message.success('已复制');
    } catch {
      try {
        if (!fallbackCopyText(content)) {
          throw new Error('copy_failed');
        }
        message.success('已复制');
      } catch {
        message.error('复制失败');
      }
    }
  }

  function renderFileAttachment(attachment: ChatAttachment) {
    return (
      <a
        className="chat-message-attachment file"
        href={resolveAssetUrl(attachment.url)}
        key={attachment.id}
        rel="noreferrer"
        target="_blank"
      >
        <>
          <span>
            <FileOutlined />
          </span>
          <strong>{attachment.name}</strong>
        </>
      </a>
    );
  }

  function renderUserImageStack(imageAttachments: ChatAttachment[]) {
    return (
      <ImageAttachmentStack
        attachments={imageAttachments}
        onPreview={(_attachment, index) => setPreviewImageGroup({
          current: index,
          images: imageAttachments,
          open: true,
        })}
      />
    );
  }

  function renderUserImageAttachments(messageItem: ChatMessage, imageAttachments: ChatAttachment[]) {
    const referenceGroups = messageItem.capabilityContext?.imageGeneration?.referenceGroups || [];
    const attachmentById = new Map(imageAttachments.map((attachment) => [attachment.id, attachment]));
    const renderedAttachmentIds = new Set<string>();
    const groupedAttachments = Object.fromEntries(referenceGroups.map((group) => {
      const groupAttachments = group.attachmentIds
        .map((attachmentId) => attachmentById.get(attachmentId))
        .filter((attachment): attachment is ChatAttachment => Boolean(attachment));
      groupAttachments.forEach((attachment) => renderedAttachmentIds.add(attachment.id));
      return [group.key, groupAttachments];
    }));
    const visibleGroups: ClawReferenceGroupConfig[] = referenceGroups
      .map((group) => {
        return {
          key: group.key,
          label: group.label,
          maxCount: group.maxCount,
          required: group.required,
        };
      })
      .filter((group) => groupedAttachments[group.key]?.length > 0);
    const ungroupedAttachments = imageAttachments.filter((attachment) => !renderedAttachmentIds.has(attachment.id));
    if (ungroupedAttachments.length) {
      groupedAttachments.reference = ungroupedAttachments;
      visibleGroups.push({ key: 'reference', label: '参考图' });
    }

    if (!visibleGroups.length) {
      return renderUserImageStack(imageAttachments);
    }

    return (
      <ClawReferenceGroups
        className="chat-message-claw-reference-groups"
        groupedAttachments={groupedAttachments}
        groups={visibleGroups}
        readonly
      />
    );
  }

  function mentionKindForAttachment(attachment: ChatAttachment) {
    if (attachment.type.startsWith('audio/')) {
      return 'audio';
    }
    if (attachment.type.startsWith('video/')) {
      return 'video';
    }
    return 'image';
  }

  function renderReadonlyMentionChip(option: {
    attachment?: ChatAttachment;
    key: string;
    label: string;
    token: string;
  }) {
    const attachment = option.attachment;
    const kind = attachment ? mentionKindForAttachment(attachment) : 'image';
    const previewUrl = attachment?.kind === 'image' && attachment.url ? resolveAssetUrl(attachment.url) : '';
    const fallbackIcon = kind === 'audio' ? '♪' : kind === 'video' ? '视' : option.label.slice(0, 1);
    return (
      <span
        className="mention-rich-textarea-chip chat-user-message-mention-chip"
        data-attachment-id={attachment?.id}
        data-mention-kind={kind}
        data-token={option.token}
        key={option.key}
      >
        {previewUrl && !unavailableImageUrls.has(attachment?.url || '') ? (
          <img
            alt={option.label}
            className={imageClassName('', attachment?.url || '')}
            onError={() => markImageUnavailable(attachment?.url || '')}
            onLoad={() => markImageLoaded(attachment?.url || '')}
            src={previewUrl}
          />
        ) : (
          <span className="mention-rich-textarea-chip-icon">{fallbackIcon}</span>
        )}
        <b>{option.label}</b>
      </span>
    );
  }

  function renderReadonlyRichText(value: string, attachments: ChatAttachment[]) {
    const mentionOptions = attachments.map((attachment, index) => {
      const label = `图${index + 1}`;
      return {
        attachment,
        label,
        token: `@${label}`,
      };
    });
    const mentionTokens = mentionOptions.map((option) => option.token).sort((left, right) => right.length - left.length);

    return value.split('\n').map((line, lineIndex) => {
      const nodes: ReactNode[] = [];
      let index = 0;
      while (index < line.length) {
        const matchedToken = mentionTokens.find((token) => line.startsWith(token, index));
        if (matchedToken) {
          const option = mentionOptions.find((item) => item.token === matchedToken);
          if (option) {
            nodes.push(renderReadonlyMentionChip({ ...option, key: `${lineIndex}-${index}-${matchedToken}` }));
            index += matchedToken.length;
            continue;
          }
        }
        const nextTokenIndex = mentionTokens
          .map((token) => line.indexOf(token, index + 1))
          .filter((tokenIndex) => tokenIndex !== -1)
          .sort((left, right) => left - right)[0] ?? line.length;
        nodes.push(<span key={`${lineIndex}-${index}-text`}>{line.slice(index, nextTokenIndex)}</span>);
        index = nextTokenIndex;
      }
      return (
        <p key={lineIndex}>
          {nodes.length ? nodes : <br />}
        </p>
      );
    });
  }

  function resolveUserVisibleMessageText(messageItem: ChatMessage) {
    const imageGeneration = messageItem.capabilityContext?.imageGeneration;
    const promptHint = imageGeneration?.promptHint?.trim();
    const promptText = imageGeneration?.promptText?.trim() || messageItem.content.trim();
    if (!promptHint) {
      return messageItem.content;
    }
    return promptText && promptText !== promptHint ? promptText : '';
  }

  function renderUserMessageContent(messageItem: ChatMessage) {
    const visibleText = resolveUserVisibleMessageText(messageItem);
    return visibleText ? (
      renderReadonlyRichText(visibleText, messageItem.attachments || [])
    ) : null;
  }

  function renderUserGenerationHint(messageItem: ChatMessage) {
    const imageGeneration = messageItem.capabilityContext?.imageGeneration;
    if (!imageGeneration) {
      return null;
    }
    const promptHint = imageGeneration?.promptHint?.trim();
    return (
      <div className="chat-user-generation-text">
        {promptHint ? <span className="chat-user-generation-hint">{promptHint}</span> : null}
        {renderImageGenerationModeTag(imageGeneration)}
      </div>
    );
  }

  function isGeneratedImageAttachment(attachment: ChatAttachment) {
    return attachment.kind === 'image'
      && (attachment.imageGenerationSlotIndex !== undefined
        || attachment.name.startsWith('generated-image'));
  }

  async function downloadAttachment(
    attachment: ChatAttachment,
    imageGeneration: ImageGenerationContext | undefined,
    downloadedAt = new Date(),
  ) {
    const response = await fetch(resolveAssetUrl(attachment.url));
    if (!response.ok) {
      throw new Error('图片下载失败');
    }
    const blob = await response.blob();
    const objectUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = imageGeneration
      ? imageDownloadFileName(
        attachment,
        imageGeneration,
        response.headers.get('content-type') || blob.type,
        downloadedAt,
      )
      : attachment.name || 'generated-image.png';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(objectUrl);
  }

  function downloadGeneratedImages(attachments: ChatAttachment[], imageGeneration: ImageGenerationContext | undefined) {
    const downloadedAt = new Date();
    attachments.forEach((attachment, index) => {
      window.setTimeout(() => {
        void downloadAttachment(attachment, imageGeneration, downloadedAt).catch((error) => {
          message.error(error instanceof Error ? error.message : '图片下载失败');
        });
      }, index * 120);
    });
  }

  function renderPreviewActions(
    originalNode: ReactElement,
    attachments: ChatAttachment[],
    current: number,
    imageGeneration: ImageGenerationContext | undefined,
  ) {
    const currentAttachment = attachments[current] || attachments[0];
    if (!currentAttachment) {
      return originalNode;
    }
    const actionsNode = originalNode as ReactElement<{ children?: ReactNode; className?: string }>;
    const actionsClassName = actionsNode.props.className?.split(' ')[0] || 'ant-image-preview-actions';
    return cloneElement(actionsNode, undefined, [
      ...Children.toArray(actionsNode.props.children),
      <button
        aria-label="download"
        className={`${actionsClassName}-action chat-image-preview-download`}
        key="download"
        onClick={() => {
          void downloadAttachment(currentAttachment, imageGeneration).catch((error) => {
            message.error(error instanceof Error ? error.message : '图片下载失败');
          });
        }}
        title="下载"
        type="button"
      >
        <DownloadOutlined />
      </button>,
    ]);
  }

  function confirmRegenerateImage(previousUserMessage: ChatMessage | undefined, assistantMessage: ChatMessage) {
    if (assistantMessage.isCompleted === false) {
      message.warning('图片正在生成中，完成后再试');
      return;
    }
    if (!previousUserMessage) {
      return;
    }
    Modal.confirm({
      title: '再次生成',
      centered: true,
      content: '将使用上一条提示词和参考图重新生成图片，确认继续？',
      okText: '再次生成',
      cancelText: '取消',
      onOk() {
        onRegenerateImage(previousUserMessage, assistantMessage, resolveImageGenerationCreditCost(assistantMessage, previousUserMessage));
      },
    });
  }

  function confirmDeleteImageResult(messageItem: ChatMessage) {
    if (messageItem.isCompleted === false) {
      message.warning('图片正在生成中，完成后再删除');
      return;
    }
    Modal.confirm({
      title: '删除生图结果',
      centered: true,
      content: '删除后这条生图结果将从当前对话中移除，确认删除？',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk() {
        onDeleteMessage(messageItem);
      },
    });
  }

  function confirmDeleteUserMessage(messageItem: ChatMessage) {
    Modal.confirm({
      title: '删除消息',
      centered: true,
      content: '删除后这条消息将从当前对话中移除，确认删除？',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk() {
        onDeleteMessage(messageItem);
      },
    });
  }

  function formatCreditAmount(value: number) {
    if (Number.isInteger(value)) {
      return String(value);
    }
    return value.toFixed(6).replace(/\.?0+$/, '');
  }

  function numericValue(value: unknown, fallback = 0) {
    const numeric = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
  }

  function imageModelCreditsPerRequest(config: ModelConfig | undefined) {
    const settings = config?.settings && typeof config.settings === 'object'
      ? config.settings as Record<string, unknown>
      : {};
    const billing = settings.billing && typeof settings.billing === 'object' && !Array.isArray(settings.billing)
      ? settings.billing as Record<string, unknown>
      : {};
    return Math.max(0, numericValue(billing.creditsPerRequest, numericValue(billing.perRequestUsd, 0)));
  }

  function fallbackImageGenerationCreditCost(messageItem: ChatMessage, previousUserMessage: ChatMessage | undefined) {
    const modelConfigId = previousUserMessage?.imageModelConfigId;
    if (!modelConfigId) {
      return undefined;
    }
    const config = imageConfigs.find((item) => item.id === modelConfigId);
    if (!config) {
      return undefined;
    }
    const generatedCount = (messageItem.attachments || []).filter((attachment) => attachment.kind === 'image').length;
    if (generatedCount <= 0) {
      return undefined;
    }
    const accumulatedCreditCost = numericValue(previousUserMessage?.capabilityContext?.imageGeneration?.accumulatedCreditCost, 0);
    return accumulatedCreditCost + imageModelCreditsPerRequest(config) * generatedCount;
  }

  function resolveImageGenerationCreditCost(messageItem: ChatMessage, previousUserMessage: ChatMessage | undefined) {
    return typeof messageItem.creditCost === 'number'
      ? messageItem.creditCost
      : fallbackImageGenerationCreditCost(messageItem, previousUserMessage);
  }

  function renderImageGenerationCreditCost(messageItem: ChatMessage, previousUserMessage: ChatMessage | undefined) {
    const creditCost = resolveImageGenerationCreditCost(messageItem, previousUserMessage);
    if (typeof creditCost !== 'number') {
      return null;
    }
    return (
      <span className="chat-image-generation-cost" aria-label={`消耗 ${formatCreditAmount(creditCost)} Credit`}>
        消耗
        <Zap size={12} fill="currentColor" />
        {formatCreditAmount(creditCost)}
      </span>
    );
  }

  function regenerateLabel(previousUserMessage: ChatMessage | undefined) {
    const count = Number(previousUserMessage?.capabilityContext?.imageGeneration?.regenerationCount || 0);
    return count > 0 ? `再次生成·${count}` : '再次生成';
  }

  function imageModelName(messageItem: ChatMessage, previousUserMessage: ChatMessage | undefined) {
    const modelConfigId = previousUserMessage?.imageModelConfigId || messageItem.imageModelConfigId;
    const config = imageConfigs.find((item) => item.id === modelConfigId);
    return config?.name || config?.model || '';
  }

  function imageGenerationModelLabel(
    messageItem: ChatMessage,
    previousUserMessage: ChatMessage | undefined,
    imageGeneration: ImageGenerationContext | undefined,
  ) {
    const modelName = imageModelName(messageItem, previousUserMessage);
    const outputRequirement = [imageGeneration?.aspectRatio, imageGeneration?.resolution]
      .map((value) => value?.trim())
      .filter(Boolean)
      .join(' ');
    return [modelName, outputRequirement].filter(Boolean).join(' · ');
  }

  function renderImageGenerationModeTag(imageGeneration: ImageGenerationContext | undefined) {
    const modeTitle = imageGeneration?.modeTitle || '图片生成';
    return <Tag className="chat-image-generation-mode-tag">{modeTitle}</Tag>;
  }

  function renderImageGenerationHeader(messageItem: ChatMessage, previousUserMessage: ChatMessage | undefined) {
    const imageGeneration = previousUserMessage?.capabilityContext?.imageGeneration || messageItem.capabilityContext?.imageGeneration;
    const modelLabel = imageGenerationModelLabel(messageItem, previousUserMessage, imageGeneration);
    return (
      <div className="chat-image-generation-header">
        {renderImageGenerationModeTag(imageGeneration)}
        {modelLabel ? <span className="chat-image-generation-model-name">{modelLabel}</span> : null}
        <time dateTime={messageItem.createdAt}>{formatRelativeCalendarDateTime(messageItem.createdAt)}</time>
      </div>
    );
  }

  function imageGenerationAspectRatio(
    attachment?: ChatAttachment,
    imageGeneration?: ImageGenerationContext,
  ) {
    if (attachment?.width && attachment.height) {
      return `${attachment.width} / ${attachment.height}`;
    }
    const outputSizeMatch = imageGeneration?.outputSize?.match(/^\s*(\d+)\s*[x×]\s*(\d+)\s*$/i);
    if (outputSizeMatch) {
      return `${outputSizeMatch[1]} / ${outputSizeMatch[2]}`;
    }
    const aspectRatioMatch = imageGeneration?.aspectRatio?.match(/^\s*(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)\s*$/);
    if (aspectRatioMatch) {
      return `${aspectRatioMatch[1]} / ${aspectRatioMatch[2]}`;
    }
    return '';
  }

  function imageGenerationCellClassName(
    attachment?: ChatAttachment,
    imageGeneration?: ImageGenerationContext,
  ) {
    return [
      'chat-image-generation-cell',
      imageGenerationAspectRatio(attachment, imageGeneration) ? 'has-intrinsic-size' : '',
    ].filter(Boolean).join(' ');
  }

  function imageGenerationCellStyle(
    attachment?: ChatAttachment,
    imageGeneration?: ImageGenerationContext,
  ): ImageGenerationCellStyle | undefined {
    const aspectRatio = imageGenerationAspectRatio(attachment, imageGeneration);
    if (!aspectRatio) {
      return undefined;
    }
    return {
      '--chat-image-aspect-ratio': aspectRatio,
    };
  }

  return (
    <>
      <div
        className="chat-history"
        onScroll={onScroll}
        ref={scrollContainerRef}
      >
        <div className="chat-history-content">
          {messages.map((item, messageIndex) => {
            const parsed = item.role === 'assistant' ? splitThinking(item.content) : null;
            const thinkingContent = item.role === 'assistant' ? item.reasoningContent || parsed?.thinking : '';
            const answerContent = item.role === 'assistant' ? parsed?.answer || item.content : item.content;
            const imageAttachments = item.attachments?.filter((attachment) => attachment.kind === 'image') || [];
            const fileAttachments = item.attachments?.filter((attachment) => attachment.kind !== 'image') || [];
            const imageGenerationFailures = item.imageGenerationFailures || [];
            const previousUserMessage = [...messages.slice(0, messageIndex)].reverse().find((messageItem) => messageItem.role === 'user');
            const previousImageGenerationContext = previousUserMessage?.capabilityContext?.imageGeneration;
            const imageGenerationContext = previousImageGenerationContext || item.capabilityContext?.imageGeneration;
            const isImageGenerationAssistant = item.role === 'assistant'
              && (
                item.capability === 'image_generation'
                || Boolean(item.generationJobId)
                || item.imageGenerationExpectedCount !== undefined
                || imageAttachments.some(isGeneratedImageAttachment)
                || imageGenerationFailures.length > 0
                || Boolean(previousImageGenerationContext && item.isCompleted === false)
              );
            const isImageGenerationLoading = isImageGenerationAssistant && item.isCompleted === false;
            const imageGenerationFailureBySlot = new Map(imageGenerationFailures.map((failure) => [failure.slotIndex, failure]));
            const isLegacyImageGenerationFailed = isImageGenerationAssistant
              && item.isCompleted !== false
              && answerContent.startsWith('图片生成失败');
            const isImageGenerationFailed = isLegacyImageGenerationFailed || imageGenerationFailures.length > 0;
            const expectedImageGenerationSlotCount = item.imageGenerationExpectedCount
              || previousImageGenerationContext?.outputCount
              || 0;
            const imageGenerationSlotCount = isImageGenerationLoading
              ? Math.max(1, expectedImageGenerationSlotCount || imageAttachments.length)
              : isImageGenerationFailed
                ? Math.max(
                  1,
                  expectedImageGenerationSlotCount,
                  imageAttachments.length,
                  ...imageGenerationFailures.map((failure) => failure.slotIndex + 1),
                )
                : imageAttachments.length;
            const imageGenerationLayoutClass = imageGenerationSlotCount === 1
              ? 'single'
              : imageGenerationSlotCount === 2
                ? 'double'
                : imageGenerationSlotCount === 4
                ? 'quad'
                : 'multi';
            const canOperateImageGeneration = !isImageGenerationLoading;
            const imageGenerationAttachmentsBySlot = new Map(
              imageAttachments.map((attachment, index) => [attachment.imageGenerationSlotIndex ?? index, attachment]),
            );
            const attachmentList = Boolean(item.attachments?.length) ? (
              <div className={`chat-message-attachments ${item.role}`}>
                {item.role === 'user' && imageAttachments.length ? renderUserImageAttachments(item, imageAttachments) : null}
                {item.role === 'assistant' ? imageAttachments.map((attachment) => (
                  unavailableImageUrls.has(attachment.url) ? (
                    <span className="chat-message-image-frame" key={attachment.id}>
                      {unavailableImage()}
                    </span>
                  ) : (
                    <Image
                      alt={attachment.name}
                      className={imageClassName('chat-message-image', attachment.url)}
                      key={attachment.id}
                      onError={() => markImageUnavailable(attachment.url)}
                      onLoad={() => markImageLoaded(attachment.url)}
                      src={resolveAssetUrl(attachment.url)}
                    />
                  )
                )) : null}
                {fileAttachments.map(renderFileAttachment)}
              </div>
            ) : null;
            const hasGroupedUserImageAttachments = item.role === 'user'
              && imageAttachments.length > 0
              && Boolean(item.capabilityContext?.imageGeneration?.referenceGroups?.some((group) => (
                group.attachmentIds.some((attachmentId) => imageAttachments.some((attachment) => attachment.id === attachmentId))
              )));
            const userMessageContent = item.role === 'user'
              ? renderUserMessageContent(item)
              : null;
            const userVisibleMessageText = item.role === 'user'
              ? resolveUserVisibleMessageText(item)
              : '';

            if (isImageGenerationAssistant) {
              return (
                <div className="chat-message-shell assistant image-generation" key={item.id}>
                  {imageGenerationSlotCount ? (
                    <>
                      {renderImageGenerationHeader(item, previousUserMessage)}
                      <Image.PreviewGroup
                        preview={{
                          actionsRender: (originalNode, info) => renderPreviewActions(originalNode, imageAttachments, info.current, imageGenerationContext),
                        }}
                      >
                        <div className={`chat-image-generation-grid ${imageGenerationLayoutClass}`}>
                          {Array.from({ length: imageGenerationSlotCount }, (_, index) => {
                            const attachment = imageGenerationAttachmentsBySlot.get(index);
                            const failure = imageGenerationFailureBySlot.get(index);
                            return attachment ? (
                              <div
                                className={imageGenerationCellClassName(attachment, imageGenerationContext)}
                                key={attachment.id}
                                style={imageGenerationCellStyle(attachment, imageGenerationContext)}
                              >
                                {unavailableImageUrls.has(attachment.url) ? unavailableImage('is-generation') : (
                                  <Image
                                    alt={attachment.name}
                                    className={imageClassName('chat-image-generation-image', attachment.url)}
                                    height="100%"
                                    onError={() => markImageUnavailable(attachment.url)}
                                    onLoad={() => markImageLoaded(attachment.url)}
                                    src={resolveAssetUrl(attachment.url)}
                                    width="100%"
                                  />
                                )}
                              </div>
                            ) : failure || isLegacyImageGenerationFailed ? (
                              <div
                                className={`${imageGenerationCellClassName(undefined, imageGenerationContext)} failed`}
                                key={`failed-${index}`}
                                style={imageGenerationCellStyle(undefined, imageGenerationContext)}
                              >
                                <Tooltip title={failure?.message || answerContent || '图片生成失败'}>
                                  <CloseCircleOutlined className="chat-image-generation-failed-icon" />
                                </Tooltip>
                                <span>生成失败</span>
                              </div>
                            ) : (
                              <div
                                className={`${imageGenerationCellClassName(undefined, imageGenerationContext)} loading`}
                                key={`loading-${index}`}
                                style={imageGenerationCellStyle(undefined, imageGenerationContext)}
                              >
                                <span />
                              </div>
                            );
                          })}
                        </div>
                      </Image.PreviewGroup>
                      <div className="chat-image-generation-actions">
                        {renderImageGenerationCreditCost(item, previousUserMessage)}
                        <Button
                          className="chat-image-generation-action"
                          color="default"
                          disabled={sending || !previousUserMessage || !canOperateImageGeneration}
                          icon={<RefreshCw size={12} strokeWidth={2} />}
                          onClick={() => confirmRegenerateImage(previousUserMessage, item)}
                          size="small"
                          variant="filled"
                        >
                          {regenerateLabel(previousUserMessage)}
                        </Button>
                        <Button
                          className="chat-image-generation-action"
                          color="default"
                          disabled={sending || !imageAttachments.length || !canOperateImageGeneration}
                          icon={<EditOutlined />}
                          onClick={() => onContinueEditImage(item)}
                          size="small"
                          variant="filled"
                        >
                          继续编辑
                        </Button>
                        <Dropdown
                          menu={{
                            items: [
                              {
                                key: 'download',
                                icon: <DownloadOutlined />,
                                label: '下载',
                                disabled: !imageAttachments.length || !canOperateImageGeneration,
                                onClick: () => downloadGeneratedImages(imageAttachments, imageGenerationContext),
                              },
                              {
                                danger: true,
                                key: 'delete',
                                icon: <DeleteOutlined />,
                                label: '删除',
                                disabled: !canOperateImageGeneration,
                                onClick: () => confirmDeleteImageResult(item),
                              },
                            ],
                          }}
                          disabled={!canOperateImageGeneration}
                          trigger={['click']}
                        >
                          <Button
                            aria-label="更多操作"
                            className="chat-image-generation-more"
                            color="default"
                            disabled={!canOperateImageGeneration}
                            icon={<MoreOutlined />}
                            size="small"
                            variant="filled"
                          />
                        </Dropdown>
                      </div>
                    </>
                  ) : (
                    <>
                      {renderImageGenerationHeader(item, previousUserMessage)}
                      <div className="chat-image-generation-error">
                        {answerContent || '图片生成失败'}
                      </div>
                      <div className="chat-image-generation-actions">
                        {renderImageGenerationCreditCost(item, previousUserMessage)}
                        <Button
                          className="chat-image-generation-action"
                          color="default"
                          disabled={sending || !previousUserMessage || !canOperateImageGeneration}
                          icon={<RefreshCw size={12} strokeWidth={2} />}
                          onClick={() => confirmRegenerateImage(previousUserMessage, item)}
                          size="small"
                          variant="filled"
                        >
                          {regenerateLabel(previousUserMessage)}
                        </Button>
                        <Button
                          className="chat-image-generation-action"
                          color="default"
                          disabled={sending || !imageAttachments.length || !canOperateImageGeneration}
                          icon={<EditOutlined />}
                          onClick={() => onContinueEditImage(item)}
                          size="small"
                          variant="filled"
                        >
                          继续编辑
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              );
            }

            return (
              <div className={`chat-message-shell ${item.role}${hasGroupedUserImageAttachments ? ' has-reference-groups' : ''}`} key={item.id}>
                <article className={`chat-message ${item.role}`}>
                  {thinkingContent && (
                    <details className={`chat-thinking ${item.isCompleted === false ? 'streaming' : ''}`} open={item.isCompleted === false}>
                      <summary>
                        <span className="chat-thinking-summary">
                          <ChevronRight className="chat-thinking-summary-icon" size={16} />
                          <span>{item.isCompleted === false ? '正在思考' : '思考过程'}</span>
                        </span>
                      </summary>
                      <MarkdownContent content={thinkingContent} />
                    </details>
                  )}
                  {item.role === 'assistant' ? (
                    <>
                      {answerContent ? <MarkdownContent content={answerContent} /> : <div className="chat-answer-placeholder">正在组织回答...</div>}
                      {attachmentList}
                    </>
                  ) : (
                    <>
                      {renderUserGenerationHint(item)}
                      {attachmentList}
                      {userMessageContent ? (
                        <div className="chat-user-message-content">
                          {userMessageContent}
                        </div>
                      ) : null}
                      <div className="chat-user-message-actions">
                        {userVisibleMessageText ? (
                          <Button
                            className="chat-image-generation-action"
                            color="default"
                            icon={<CopyOutlined />}
                            onClick={() => void handleCopy(userVisibleMessageText)}
                            size="small"
                            variant="filled"
                          >
                            复制
                          </Button>
                        ) : null}
                        <Button
                          className="chat-image-generation-action"
                          color="default"
                          disabled={sending}
                          icon={<EditOutlined />}
                          onClick={() => onRefillComposerFromMessage(item)}
                          size="small"
                          variant="filled"
                        >
                          重新编辑
                        </Button>
                        <Dropdown
                          menu={{
                            items: [
                              {
                                danger: true,
                                key: 'delete',
                                icon: <DeleteOutlined />,
                                label: '删除',
                                disabled: sending,
                                onClick: () => confirmDeleteUserMessage(item),
                              },
                            ],
                          }}
                          trigger={['click']}
                        >
                          <Button
                            aria-label="更多操作"
                            className="chat-image-generation-more"
                            color="default"
                            disabled={sending}
                            icon={<MoreOutlined />}
                            size="small"
                            variant="filled"
                          />
                        </Dropdown>
                      </div>
                    </>
                  )}
                  {item.role === 'assistant' && (
                    <div className="chat-message-actions">
                      {item.actions?.map((action) => (
                        <Button
                          className="chat-message-action"
                          disabled={sending}
                          key={action.id}
                          onClick={() => onActionClick(action.submitContent)}
                          size="small"
                          type={action.kind === 'primary' ? 'primary' : 'default'}
                        >
                          {action.label}
                        </Button>
                      ))}
                    </div>
                  )}
                </article>
                {item.role === 'assistant' && (
                  <div className="chat-assistant-message-hover-actions">
                    <Button
                      aria-label="复制消息"
                      className="chat-assistant-message-hover-button"
                      shape="circle"
                      icon={<CopyOutlined />}
                      onClick={() => void handleCopy(answerContent)}
                      size="small"
                      type="text"
                    />
                  </div>
                )}
              </div>
            );
          })}
          {sending && !hasStreamingAssistant && (
            <div className="chat-typing">
              <span />
              <span />
              <span />
            </div>
          )}
        </div>
      </div>

      <Image.PreviewGroup
        items={previewImageGroup.images.map((attachment) => ({
          alt: attachment.name,
          src: resolveAssetUrl(attachment.url),
        }))}
        preview={{
          current: previewImageGroup.current,
          open: previewImageGroup.open,
          onChange: (current) => {
            setPreviewImageGroup((group) => ({
              ...group,
              current,
            }));
          },
          onOpenChange: (open, info) => {
            setPreviewImageGroup((group) => ({
              ...group,
              current: info.current ?? group.current,
              open,
            }));
          },
          actionsRender: (originalNode, info) => renderPreviewActions(originalNode, previewImageGroup.images, info.current, undefined),
        }}
      />

    </>
  );
}
