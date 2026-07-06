import { Button, Image, message } from 'antd';
import { CopyOutlined, DownCircleOutlined, EditOutlined, FileOutlined } from '@ant-design/icons';
import { ChevronRight } from 'lucide-react';
import { useEffect, useRef, useState, type RefObject } from 'react';
import type { ChatMessage } from '../../../types';
import { resolveAssetUrl } from '../../../api/request';
import { MarkdownContent, splitThinking } from '../utils/markdown';
import './ChatMessageList.scss';

type ChatMessageListProps = {
  hasStreamingAssistant: boolean;
  messages: ChatMessage[];
  onActionClick: (content: string) => void;
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
  onUpdateUserMessage,
  onScroll,
  onScrollToBottom,
  scrollContainerRef,
  sending,
  showScrollBottom,
}: ChatMessageListProps) {
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState('');
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

  return (
    <>
      <div className="chat-history" onScroll={onScroll} ref={scrollContainerRef}>
        {messages.map((item) => {
          const parsed = item.role === 'assistant' ? splitThinking(item.content) : null;
          const thinkingContent = item.role === 'assistant' ? item.reasoningContent || parsed?.thinking : '';
          const answerContent = item.role === 'assistant' ? parsed?.answer || item.content : item.content;
          const isEditingUserMessage = item.role === 'user' && editingMessageId === item.id;

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
                    answerContent ? <MarkdownContent content={answerContent} /> : <div className="chat-answer-placeholder">正在组织回答...</div>
                  ) : (
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
                  )}
                  {Boolean(item.attachments?.length) && (
                    <div className="chat-message-attachments">
                      {item.attachments?.map((attachment) => (
                        attachment.kind === 'image' ? (
                          <Image
                            alt={attachment.name}
                            className="chat-message-image"
                            key={attachment.id}
                            src={resolveAssetUrl(attachment.url)}
                          />
                        ) : (
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
                        )
                      ))}
                    </div>
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

      {showScrollBottom && (
        <Button className="chat-scroll-bottom" icon={<DownCircleOutlined />} onClick={onScrollToBottom} shape="circle" type="default" />
      )}
    </>
  );
}
