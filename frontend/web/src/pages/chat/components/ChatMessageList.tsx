import { Button, Dropdown, Image, Modal, message } from 'antd';
import { CopyOutlined, DeleteOutlined, DownCircleOutlined, DownloadOutlined, EditOutlined, FileOutlined, MoreOutlined, ReloadOutlined } from '@ant-design/icons';
import { ChevronRight } from 'lucide-react';
import { Children, cloneElement, useEffect, useRef, useState, type ReactElement, type ReactNode, type RefObject } from 'react';
import type { ChatAttachment, ChatMessage } from '../../../types';
import { resolveAssetUrl } from '../../../api/request';
import { MarkdownContent, splitThinking } from '../utils/markdown';
import { ImageAttachmentStack } from './ImageAttachmentStack';
import './ChatMessageList.scss';

type ChatMessageListProps = {
  hasStreamingAssistant: boolean;
  messages: ChatMessage[];
  onActionClick: (content: string) => void;
  onDeleteMessage: (message: ChatMessage) => void;
  onRegenerateImage: (content: string, attachments: ChatAttachment[]) => void;
  onUpdateUserMessage: (messageId: string, content: string) => void;
  onScroll: () => void;
  onScrollToBottom: () => void;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  sending: boolean;
  showScrollBottom: boolean;
};

export function ChatMessageList({
  hasStreamingAssistant,
  messages,
  onActionClick,
  onDeleteMessage,
  onRegenerateImage,
  onUpdateUserMessage,
  onScroll,
  onScrollToBottom,
  scrollContainerRef,
  sending,
  showScrollBottom,
}: ChatMessageListProps) {
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState('');
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

  function confirmRegenerateImage(previousUserMessage: ChatMessage | undefined) {
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
        onRegenerateImage(previousUserMessage.content, previousUserMessage.attachments || []);
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

  return (
    <>
      <div className="chat-history" onScroll={onScroll} ref={scrollContainerRef}>
        {messages.map((item, messageIndex) => {
          const parsed = item.role === 'assistant' ? splitThinking(item.content) : null;
          const thinkingContent = item.role === 'assistant' ? item.reasoningContent || parsed?.thinking : '';
          const answerContent = item.role === 'assistant' ? parsed?.answer || item.content : item.content;
          const isEditingUserMessage = item.role === 'user' && editingMessageId === item.id;
          const imageAttachments = item.attachments?.filter((attachment) => attachment.kind === 'image') || [];
          const fileAttachments = item.attachments?.filter((attachment) => attachment.kind !== 'image') || [];
          const isImageGenerationAssistant = item.role === 'assistant'
            && (item.capability === 'image_generation' || imageAttachments.some(isGeneratedImageAttachment));
          const isImageGenerationPending = isImageGenerationAssistant && item.isCompleted === false && !imageAttachments.length;
          const imageGenerationLayoutClass = imageAttachments.length === 1
            ? 'single'
            : imageAttachments.length === 4
              ? 'quad'
              : 'multi';
          const previousUserMessage = [...messages.slice(0, messageIndex)].reverse().find((messageItem) => messageItem.role === 'user');
          const attachmentList = Boolean(item.attachments?.length) ? (
            <div className={`chat-message-attachments ${item.role}`}>
              {item.role === 'user' && imageAttachments.length ? renderUserImageStack(imageAttachments) : null}
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

          if (isImageGenerationAssistant) {
            return (
              <div className="chat-message-shell assistant image-generation" key={item.id}>
                {isImageGenerationPending ? (
                  <div className="chat-image-generation-loading">
                    <span />
                    <span>生成中...</span>
                  </div>
                ) : (
                  <>
                    <Image.PreviewGroup
                      preview={{
                        actionsRender: (originalNode, info) => renderPreviewActions(originalNode, imageAttachments, info.current),
                      }}
                    >
                      <div className={`chat-image-generation-grid ${imageGenerationLayoutClass}`}>
                        {imageAttachments.map((attachment) => (
                          <div className="chat-image-generation-cell" key={attachment.id}>
                            <Image
                              alt={attachment.name}
                              className="chat-image-generation-image"
                              height="100%"
                              src={resolveAssetUrl(attachment.url)}
                              width="100%"
                            />
                          </div>
                        ))}
                      </div>
                    </Image.PreviewGroup>
                    <div className="chat-image-generation-actions">
                      <Button
                        className="chat-image-generation-action"
                        color="default"
                        disabled={sending || !previousUserMessage}
                        icon={<ReloadOutlined />}
                        onClick={() => confirmRegenerateImage(previousUserMessage)}
                        size="small"
                        variant="filled"
                      >
                        再次生成
                      </Button>
                      <Dropdown
                        menu={{
                          items: [
                            {
                              key: 'download',
                              icon: <DownloadOutlined />,
                              label: '下载',
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
                )}
              </div>
            );
          }

          return (
              <div className={`chat-message-shell ${item.role}`} key={item.id}>
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
                        {isEditingUserMessage ? (
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
                              <Button onClick={() => void submitEditing(item.id)} size="small" type="primary">
                                更新
                              </Button>
                            </div>
                          </>
                        ) : (
                          <div>{item.content}</div>
                        )}
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

      {showScrollBottom && (
        <Button className="chat-scroll-bottom" icon={<DownCircleOutlined />} onClick={onScrollToBottom} shape="circle" type="default" />
      )}
    </>
  );
}
