import { Button, Dropdown, Image, Modal, Tag, Tooltip, message } from 'antd';
import { CloseCircleOutlined, CopyOutlined, DeleteOutlined, DownloadOutlined, EditOutlined, FileOutlined, MoreOutlined } from '@ant-design/icons';
import { ChevronRight, RefreshCw, Zap } from 'lucide-react';
import { Children, cloneElement, useEffect, useRef, useState, type ReactElement, type ReactNode, type RefObject } from 'react';
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
  onDeleteMessage: (message: ChatMessage) => void;
  onRegenerateImage: (userMessage: ChatMessage, assistantMessage: ChatMessage, currentCreditCost?: number) => void;
  onUpdateUserMessage: (messageId: string, content: string) => void;
  onScroll: () => void;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  sending: boolean;
};

const imageGenerationModeToneMap: Record<string, string> = {
  dialog: 'blue',
  detail: 'amber',
  outfit: 'violet',
  'model-views': 'indigo',
  'pose-reference': 'cyan',
  upscale: 'lime',
  cutout: 'orange',
  background: 'emerald',
  'scene-extract': 'fuchsia',
  'model-face-swap': 'rose',
  'head-swap': 'rose',
  'face-swap': 'rose',
  redraw: 'blue',
  'detail-enhance': 'amber',
  'print-extract': 'fuchsia',
  'face-enhance': 'cyan',
};

export function ChatMessageList({
  hasStreamingAssistant,
  messages,
  onActionClick,
  onDeleteMessage,
  onRegenerateImage,
  onUpdateUserMessage,
  onScroll,
  scrollContainerRef,
  sending,
}: ChatMessageListProps) {
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState('');
  const [imageConfigs, setImageConfigs] = useState<ModelConfig[]>([]);
  const [previewImageGroup, setPreviewImageGroup] = useState<{
    current: number;
    images: ChatAttachment[];
    open: boolean;
  }>({
    current: 0,
    images: [],
    open: false,
  });
  const editorRef = useRef<HTMLTextAreaElement | null>(null);

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

  useEffect(() => {
    if (!editingMessageId) {
      return;
    }
    const messageItem = messages.find((item) => item.id === editingMessageId && item.role === 'user');
    if (!messageItem) {
      setEditingMessageId(null);
      setEditingContent('');
    }
  }, [editingMessageId, messages]);

  useEffect(() => {
    if (!editingMessageId) {
      return;
    }
    editorRef.current?.focus();
    const length = editorRef.current?.value.length ?? 0;
    editorRef.current?.setSelectionRange(length, length);
  }, [editingMessageId]);

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

  function startEditing(messageItem: ChatMessage) {
    setEditingMessageId(messageItem.id);
    setEditingContent(messageItem.content);
  }

  function cancelEditing() {
    setEditingMessageId(null);
    setEditingContent('');
  }

  async function submitEditing(messageId: string) {
    const nextContent = editingContent.trim();
    if (!nextContent || sending) {
      return;
    }
    await onUpdateUserMessage(messageId, nextContent);
    cancelEditing();
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

  function renderUserMessageContent(messageItem: ChatMessage, isEditingUserMessage: boolean) {
    if (isEditingUserMessage) {
      return (
        <>
          <textarea
            className="chat-user-message-editor"
            onChange={(event) => setEditingContent(event.target.value)}
            ref={editorRef}
            value={editingContent}
          />
          <div className="chat-user-message-editor-actions">
            <Button onClick={cancelEditing} size="small">
              取消
            </Button>
            <Button onClick={() => void submitEditing(messageItem.id)} size="small" type="primary">
              更新
            </Button>
          </div>
        </>
      );
    }

    const imageGeneration = messageItem.capabilityContext?.imageGeneration;
    const promptHint = imageGeneration?.promptHint?.trim();
    const promptText = imageGeneration?.promptText?.trim() || messageItem.content.trim();
    const shouldShowPromptText = Boolean(promptText && promptText !== promptHint);

    if (!promptHint) {
      return <div>{messageItem.content}</div>;
    }

    return (
      <div className="chat-user-generation-text">
        <div className="chat-user-generation-hint">{promptHint}</div>
        {shouldShowPromptText ? (
          <div className="chat-user-generation-extra">{promptText}</div>
        ) : null}
      </div>
    );
  }

  function isGeneratedImageAttachment(attachment: ChatAttachment) {
    return attachment.kind === 'image'
      && (attachment.name.startsWith('generated-image') || attachment.url.includes('chat-generated-image-'));
  }

  async function downloadAttachment(attachment: ChatAttachment) {
    const response = await fetch(resolveAssetUrl(attachment.url));
    if (!response.ok) {
      throw new Error('图片下载失败');
    }
    const blob = await response.blob();
    const objectUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = attachment.name || 'generated-image.png';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(objectUrl);
  }

  function downloadGeneratedImages(attachments: ChatAttachment[]) {
    attachments.forEach((attachment, index) => {
      window.setTimeout(() => {
        void downloadAttachment(attachment).catch((error) => {
          message.error(error instanceof Error ? error.message : '图片下载失败');
        });
      }, index * 120);
    });
  }

  function renderPreviewActions(
    originalNode: ReactElement,
    attachments: ChatAttachment[],
    current: number,
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
          void downloadAttachment(currentAttachment).catch((error) => {
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

  function renderImageGenerationHeader(messageItem: ChatMessage, previousUserMessage: ChatMessage | undefined) {
    const imageGeneration = previousUserMessage?.capabilityContext?.imageGeneration || messageItem.capabilityContext?.imageGeneration;
    const modeTitle = imageGeneration?.modeTitle || '图片生成';
    const modeTone = imageGenerationModeToneMap[imageGeneration?.modeKey || ''] || 'blue';
    const modelName = imageModelName(messageItem, previousUserMessage);
    return (
      <div className="chat-image-generation-header">
        <Tag className={`chat-image-generation-mode-tag tone-${modeTone}`}>{modeTitle}</Tag>
        {modelName ? <span className="chat-image-generation-model-name">{modelName}</span> : null}
        <time dateTime={messageItem.createdAt}>{formatRelativeCalendarDateTime(messageItem.createdAt)}</time>
      </div>
    );
  }

  return (
    <>
      <div className="chat-history" onScroll={onScroll} ref={scrollContainerRef}>
        <div className="chat-history-content">
          {messages.map((item, messageIndex) => {
            const parsed = item.role === 'assistant' ? splitThinking(item.content) : null;
            const thinkingContent = item.role === 'assistant' ? item.reasoningContent || parsed?.thinking : '';
            const answerContent = item.role === 'assistant' ? parsed?.answer || item.content : item.content;
            const isEditingUserMessage = item.role === 'user' && editingMessageId === item.id;
            const imageAttachments = item.attachments?.filter((attachment) => attachment.kind === 'image') || [];
            const fileAttachments = item.attachments?.filter((attachment) => attachment.kind !== 'image') || [];
            const imageGenerationFailures = item.imageGenerationFailures || [];
            const previousUserMessage = [...messages.slice(0, messageIndex)].reverse().find((messageItem) => messageItem.role === 'user');
            const previousImageGenerationContext = previousUserMessage?.capabilityContext?.imageGeneration;
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
            const imageGenerationAttachmentsBySlot = new Map(
              imageAttachments.map((attachment, index) => [attachment.imageGenerationSlotIndex ?? index, attachment]),
            );
            const attachmentList = Boolean(item.attachments?.length) ? (
              <div className={`chat-message-attachments ${item.role}`}>
                {item.role === 'user' && imageAttachments.length ? renderUserImageAttachments(item, imageAttachments) : null}
                {item.role === 'assistant' ? imageAttachments.map((attachment) => (
                  <Image
                    alt={attachment.name}
                    className="chat-message-image"
                    key={attachment.id}
                    src={resolveAssetUrl(attachment.url)}
                  />
                )) : null}
                {fileAttachments.map(renderFileAttachment)}
              </div>
            ) : null;
            const hasGroupedUserImageAttachments = item.role === 'user'
              && imageAttachments.length > 0
              && Boolean(item.capabilityContext?.imageGeneration?.referenceGroups?.some((group) => (
                group.attachmentIds.some((attachmentId) => imageAttachments.some((attachment) => attachment.id === attachmentId))
              )));

            if (isImageGenerationAssistant) {
              return (
                <div className="chat-message-shell assistant image-generation" key={item.id}>
                  {imageGenerationSlotCount ? (
                    <>
                      {renderImageGenerationHeader(item, previousUserMessage)}
                      <Image.PreviewGroup
                        preview={{
                          actionsRender: (originalNode, info) => renderPreviewActions(originalNode, imageAttachments, info.current),
                        }}
                      >
                        <div className={`chat-image-generation-grid ${imageGenerationLayoutClass}`}>
                          {Array.from({ length: imageGenerationSlotCount }, (_, index) => {
                            const attachment = imageGenerationAttachmentsBySlot.get(index);
                            const failure = imageGenerationFailureBySlot.get(index);
                            return attachment ? (
                              <div className="chat-image-generation-cell" key={attachment.id}>
                                <Image
                                  alt={attachment.name}
                                  className="chat-image-generation-image"
                                  height="100%"
                                  src={resolveAssetUrl(attachment.url)}
                                  width="100%"
                                />
                              </div>
                            ) : failure || isLegacyImageGenerationFailed ? (
                              <div className="chat-image-generation-cell failed" key={`failed-${index}`}>
                                <Tooltip title={failure?.message || answerContent || '图片生成失败'}>
                                  <CloseCircleOutlined className="chat-image-generation-failed-icon" />
                                </Tooltip>
                                <span>生成失败</span>
                              </div>
                            ) : (
                              <div className="chat-image-generation-cell loading" key={`loading-${index}`}>
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
                          disabled={sending || !previousUserMessage}
                          icon={<RefreshCw size={12} strokeWidth={2} />}
                          onClick={() => confirmRegenerateImage(previousUserMessage, item)}
                          size="small"
                          variant="filled"
                        >
                          {regenerateLabel(previousUserMessage)}
                        </Button>
                        <Dropdown
                          menu={{
                            items: [
                              {
                                key: 'download',
                                icon: <DownloadOutlined />,
                                label: '下载',
                                disabled: !imageAttachments.length,
                                onClick: () => downloadGeneratedImages(imageAttachments),
                              },
                              {
                                danger: true,
                                key: 'delete',
                                icon: <DeleteOutlined />,
                                label: '删除',
                                onClick: () => confirmDeleteImageResult(item),
                              },
                            ],
                          }}
                          trigger={['click']}
                        >
                          <Button
                            aria-label="更多操作"
                            className="chat-image-generation-more"
                            color="default"
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
                          disabled={sending || !previousUserMessage}
                          icon={<RefreshCw size={12} strokeWidth={2} />}
                          onClick={() => confirmRegenerateImage(previousUserMessage, item)}
                          size="small"
                          variant="filled"
                        >
                          {regenerateLabel(previousUserMessage)}
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
                      {attachmentList}
                      <div className="chat-user-message-content">
                        {renderUserMessageContent(item, isEditingUserMessage)}
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
                {item.role === 'user' && !isEditingUserMessage && (
                  <div className="chat-user-message-hover-actions">
                    <Button
                      aria-label="复制消息"
                      className="chat-user-message-hover-button"
                      shape="circle"
                      icon={<CopyOutlined />}
                      onClick={() => void handleCopy(item.content)}
                      size="small"
                      type="text"
                    />
                    <Button
                      aria-label="编辑消息"
                      className="chat-user-message-hover-button"
                      disabled={sending}
                      shape="circle"
                      icon={<EditOutlined />}
                      onClick={() => startEditing(item)}
                      size="small"
                      type="text"
                    />
                  </div>
                )}
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
          actionsRender: (originalNode, info) => renderPreviewActions(originalNode, previewImageGroup.images, info.current),
        }}
      />

    </>
  );
}
