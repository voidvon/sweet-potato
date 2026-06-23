import { Button, Empty, Image, message } from 'antd';
import { CopyOutlined, DownCircleOutlined, FileOutlined } from '@ant-design/icons';
import { ChevronRight } from 'lucide-react';
import type { RefObject } from 'react';
import type { ChatMessage } from '../../../types';
import { MarkdownContent, splitThinking } from '../utils/markdown';
import './ChatMessageList.scss';

type ChatMessageListProps = {
  hasStreamingAssistant: boolean;
  messages: ChatMessage[];
  onActionClick: (content: string) => void;
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
  onScroll,
  onScrollToBottom,
  scrollContainerRef,
  sending,
  showScrollBottom,
}: ChatMessageListProps) {
  async function handleCopy(content: string) {
    try {
      await navigator.clipboard.writeText(content);
      message.success('已复制');
    } catch {
      message.error('复制失败');
    }
  }

  return (
    <>
      <div className="chat-history" onScroll={onScroll} ref={scrollContainerRef}>
        {messages.length === 0 ? (
          <div className="chat-empty-state">
            <Empty description="开始一次 AI 对话" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          </div>
        ) : (
          messages.map((item) => {
            const parsed = item.role === 'assistant' ? splitThinking(item.content) : null;
            const thinkingContent = item.role === 'assistant' ? item.reasoningContent || parsed?.thinking : '';
            const answerContent = item.role === 'assistant' ? parsed?.answer || item.content : item.content;

            return (
              <article className={`chat-message ${item.role}`} key={item.id}>
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
                  <div>{item.content}</div>
                )}
                {Boolean(item.attachments?.length) && (
                  <div className="chat-message-attachments">
                    {item.attachments?.map((attachment) => (
                      attachment.kind === 'image' ? (
                        <Image
                          alt={attachment.name}
                          className="chat-message-image"
                          key={attachment.id}
                          src={attachment.url}
                        />
                      ) : (
                        <a
                          className="chat-message-attachment file"
                          href={attachment.url}
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
                    <Button
                      className="chat-message-action"
                      icon={<CopyOutlined />}
                      onClick={() => void handleCopy(answerContent)}
                      size="small"
                      type="text"
                    >
                      复制
                    </Button>
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
            );
          })
        )}
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
