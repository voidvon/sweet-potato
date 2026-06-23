import { useEffect, useMemo, useRef, useState } from 'react';
import type { FocusEvent, KeyboardEvent, SyntheticEvent } from 'react';
import { Button, Dropdown, Image, Input, Space, Upload } from 'antd';
import { CloseOutlined, FileOutlined, PaperClipOutlined, PictureOutlined, PlusOutlined } from '@ant-design/icons';
import type { GetRef, InputRef, UploadProps } from 'antd';
import { ArrowUp, Square } from 'lucide-react';
import type { AiAgent, ChatAttachment } from '../../../types';
import { FloatingComposer } from '../../../components/FloatingComposer';
import { chatCapabilityChips, chatCapabilityOptions } from '../chatCapabilities';
import './ChatComposer.scss';

const { TextArea } = Input;
type TextAreaRef = GetRef<typeof Input.TextArea>;

type ChatComposerProps = {
  activeAgent?: AiAgent;
  attachments: ChatAttachment[];
  input: string;
  onAddFiles: (files: File[]) => void;
  onInputChange: (value: string) => void;
  onRemoveAttachment: (attachmentId: string) => void;
  onSend: () => void;
  onStop: () => void;
  sending: boolean;
  showFloatingAddButton?: boolean;
  variant?: 'floating' | 'welcome';
};

type MentionMatch = {
  query: string;
  start: number;
  end: number;
};

function isMentionBoundary(character: string | undefined) {
  return !character || /\s|[([{'"'“‘，。！？、]/.test(character);
}

function getMentionMatch(value: string, cursor: number) {
  const nextValue = String(value || '');
  const safeCursor = Math.max(0, Math.min(cursor, nextValue.length));
  const textBeforeCursor = nextValue.slice(0, safeCursor);
  const mentionIndex = Math.max(textBeforeCursor.lastIndexOf('@'), textBeforeCursor.lastIndexOf('＠'));
  if (mentionIndex < 0) {
    return null;
  }

  const prefixCharacter = textBeforeCursor[mentionIndex - 1];
  if (!isMentionBoundary(prefixCharacter)) {
    return null;
  }

  const query = textBeforeCursor.slice(mentionIndex + 1);
  if (/\s/.test(query)) {
    return null;
  }

  return {
    query,
    start: mentionIndex,
    end: safeCursor,
  } satisfies MentionMatch;
}

function getMatchedMentionRange(value: string, cursor: number, mentions: string[]) {
  const nextValue = String(value || '');
  const safeCursor = Math.max(0, Math.min(cursor, nextValue.length));

  for (const mention of mentions) {
    let searchStart = 0;
    while (searchStart < nextValue.length) {
      const mentionStart = nextValue.indexOf(mention, searchStart);
      if (mentionStart < 0) {
        break;
      }

      const mentionEnd = mentionStart + mention.length;
      const trailingSpaceEnd = nextValue[mentionEnd] === ' ' ? mentionEnd + 1 : mentionEnd;
      const prefixCharacter = nextValue[mentionStart - 1];
      const suffixCharacter = nextValue[mentionEnd];
      const matchesCursor = safeCursor === mentionEnd || safeCursor === trailingSpaceEnd;

      if (matchesCursor && isMentionBoundary(prefixCharacter) && (!suffixCharacter || /\s/.test(suffixCharacter))) {
        return {
          start: mentionStart,
          end: trailingSpaceEnd,
        };
      }

      searchStart = mentionEnd;
    }
  }

  return null;
}

export function ChatComposer({
  activeAgent,
  attachments,
  input,
  onAddFiles,
  onInputChange,
  onRemoveAttachment,
  onSend,
  onStop,
  sending,
  showFloatingAddButton = false,
  variant = 'floating',
}: ChatComposerProps) {
  const isWelcome = variant === 'welcome';
  const isFloating = variant === 'floating';
  const hasContent = Boolean(input.trim() || attachments.length);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const floatingInputRef = useRef<InputRef>(null);
  const welcomeInputRef = useRef<TextAreaRef>(null);
  const mentionBlurTimeoutRef = useRef<number | undefined>(undefined);
  const [selectionStart, setSelectionStart] = useState(input.length);
  const [activeMentionIndex, setActiveMentionIndex] = useState(0);
  const uploadProps = (accept?: string): UploadProps => ({
    accept,
    beforeUpload: (file) => {
      onAddFiles([file]);
      return false;
    },
    multiple: true,
    showUploadList: false,
  });

  function insertCapabilityMention(mention: string) {
    const normalized = input.trimStart();
    if (normalized.startsWith(mention)) {
      return;
    }
    const prefix = input.trim() ? `${input.replace(/\s+$/, '')} ` : '';
    onInputChange(`${prefix}${mention} `);
  }

  function handleHiddenFileSelect(fileList: FileList | null) {
    const files = Array.from(fileList || []);
    if (files.length > 0) {
      onAddFiles(files);
    }
  }

  function getInputElement() {
    if (isFloating) {
      return floatingInputRef.current?.input || null;
    }
    return welcomeInputRef.current?.resizableTextArea?.textArea || null;
  }

  const mentionMatch = useMemo(
    () => getMentionMatch(input, selectionStart),
    [input, selectionStart],
  );

  const mentionOptions = useMemo(() => {
    if (!mentionMatch) {
      return [];
    }

    const normalizedQuery = mentionMatch.query.trim().toLowerCase();
    if (!normalizedQuery) {
      return chatCapabilityOptions;
    }

    return chatCapabilityOptions.filter((option) => {
      const haystacks = [
        option.label,
        option.mention,
        option.description || '',
        ...(option.keywords || []),
      ].map((item) => item.toLowerCase());
      return haystacks.some((item) => item.includes(normalizedQuery));
    });
  }, [mentionMatch]);
  const capabilityMentions = useMemo(
    () => chatCapabilityOptions.map((option) => option.mention),
    [],
  );

  const mentionOpen = Boolean(mentionMatch && mentionOptions.length > 0);

  useEffect(() => {
    if (!mentionOpen) {
      setActiveMentionIndex(0);
      return;
    }
    setActiveMentionIndex((current) => Math.min(current, mentionOptions.length - 1));
  }, [mentionOpen, mentionOptions.length]);

  useEffect(() => () => {
    if (mentionBlurTimeoutRef.current) {
      window.clearTimeout(mentionBlurTimeoutRef.current);
    }
  }, []);

  function focusInputAt(position: number) {
    window.requestAnimationFrame(() => {
      const inputElement = getInputElement();
      if (!inputElement) {
        return;
      }
      inputElement.focus();
      inputElement.setSelectionRange(position, position);
      setSelectionStart(position);
    });
  }

  function replaceMention(optionMention: string) {
    if (!mentionMatch) {
      insertCapabilityMention(optionMention);
      return;
    }

    const prefix = input.slice(0, mentionMatch.start);
    const suffix = input.slice(mentionMatch.end);
    const normalizedSuffix = suffix.replace(/^\s*/, '');
    const nextValue = `${prefix}${optionMention} ${normalizedSuffix}`;
    const nextCursor = `${prefix}${optionMention} `.length;
    onInputChange(nextValue);
    setActiveMentionIndex(0);
    focusInputAt(nextCursor);
  }

  function handleInputKeyDown(event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) {
    if (event.key === 'Backspace' && !event.nativeEvent.isComposing) {
      const selectionCursor = event.currentTarget.selectionStart ?? selectionStart;
      const selectionEnd = event.currentTarget.selectionEnd ?? selectionCursor;
      if (selectionCursor === selectionEnd) {
        const matchedMentionRange = getMatchedMentionRange(input, selectionCursor, capabilityMentions);
        if (matchedMentionRange) {
          event.preventDefault();
          const nextValue = `${input.slice(0, matchedMentionRange.start)}${input.slice(matchedMentionRange.end)}`.replace(/\s{2,}/g, ' ');
          onInputChange(nextValue);
          focusInputAt(matchedMentionRange.start);
          return;
        }
      }
    }

    if (!mentionOpen) {
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveMentionIndex((current) => (current + 1) % mentionOptions.length);
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveMentionIndex((current) => (current - 1 + mentionOptions.length) % mentionOptions.length);
      return;
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      const selectedOption = mentionOptions[activeMentionIndex];
      if (selectedOption) {
        replaceMention(selectedOption.mention);
      }
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      setSelectionStart(-1);
    }
  }

  function handleSelectionChange(event: SyntheticEvent<HTMLInputElement | HTMLTextAreaElement>) {
    setSelectionStart(event.currentTarget.selectionStart ?? 0);
  }

  function handleInputBlur() {
    mentionBlurTimeoutRef.current = window.setTimeout(() => {
      setSelectionStart(-1);
    }, 120);
  }

  function handleInputFocus(event: FocusEvent<HTMLInputElement | HTMLTextAreaElement>) {
    if (mentionBlurTimeoutRef.current) {
      window.clearTimeout(mentionBlurTimeoutRef.current);
      mentionBlurTimeoutRef.current = undefined;
    }
    setSelectionStart(event.currentTarget.selectionStart ?? input.length);
  }

  const mentionDropdown = mentionOpen ? (
    <div className={`chat-mention-dropdown ${isFloating ? 'floating' : 'welcome'}`} role="listbox">
      {mentionOptions.map((option, index) => (
        <Button
          className={`chat-mention-option ${index === activeMentionIndex ? 'active' : ''}`}
          key={option.id}
          onMouseDown={(event) => {
            event.preventDefault();
            replaceMention(option.mention);
          }}
          size="small"
          type="text"
        >
          <span className="chat-mention-option-title">{option.label}</span>
          {option.description ? <span className="chat-mention-option-description">{option.description}</span> : null}
        </Button>
      ))}
    </div>
  ) : null;

  const attachmentList = attachments.length > 0 ? (
    <div className="chat-attachment-list">
      {attachments.map((attachment) => (
        <div className={`chat-attachment-chip ${attachment.kind}`} key={attachment.id}>
          {attachment.kind === 'image' ? (
            <Image
              alt={attachment.name}
              className="chat-attachment-preview"
              src={attachment.url}
            />
          ) : (
            <span className="chat-attachment-file-icon">
              <FileOutlined />
            </span>
          )}
          {attachment.kind === 'file' && <span>{attachment.name}</span>}
          <Button
            aria-label="移除附件"
            className="chat-attachment-remove"
            icon={<CloseOutlined />}
            onClick={() => onRemoveAttachment(attachment.id)}
            size="small"
            type="text"
          />
        </div>
      ))}
    </div>
  ) : null;

  const sendButtonIcon = sending ? <Square size={16} fill="currentColor" /> : <ArrowUp size={18} />;
  const sendButtonDisabled = !sending && !hasContent;
  const sendButtonLabel = sending ? '停止生成' : '发送消息';
  const handlePrimaryAction = sending ? onStop : onSend;

  const toolbar = (
    <div className="chat-composer-toolbar">
      <Space size={8}>
        {!isFloating && (
          <>
            <Upload {...uploadProps('image/*')}>
              <Button icon={<PictureOutlined />} type="text" />
            </Upload>
            <Upload {...uploadProps()}>
              <Button icon={<PaperClipOutlined />} type="text" />
            </Upload>
          </>
        )}
        {!isWelcome && activeAgent && <span className="composer-agent-label">{activeAgent.name}</span>}
      </Space>

      <Space size={12}>
        <Button
          className="send-button"
          aria-label={sendButtonLabel}
          disabled={sendButtonDisabled}
          icon={sendButtonIcon}
          onClick={handlePrimaryAction}
          type="primary"
        />
      </Space>
    </div>
  );

  const floatingAddButton = showFloatingAddButton ? (
    <>
      <input
        accept="image/*"
        className="chat-floating-file-input"
        multiple
        onChange={(event) => {
          handleHiddenFileSelect(event.target.files);
          event.target.value = '';
        }}
        ref={imageInputRef}
        type="file"
      />
      <input
        className="chat-floating-file-input"
        multiple
        onChange={(event) => {
          handleHiddenFileSelect(event.target.files);
          event.target.value = '';
        }}
        ref={fileInputRef}
        type="file"
      />
      <Dropdown
        menu={{
          items: [
            { key: 'image', icon: <PictureOutlined />, label: '添加图片' },
            { key: 'file', icon: <PaperClipOutlined />, label: '添加附件' },
          ],
          onClick: ({ key }) => {
            if (key === 'image') {
              imageInputRef.current?.click();
            }
            if (key === 'file') {
              fileInputRef.current?.click();
            }
          },
        }}
        placement="topLeft"
        trigger={['click']}
      >
        <Button
          className="chat-floating-add-button send-button"
          icon={<PlusOutlined />}
          type="text"
        />
      </Dropdown>
    </>
  ) : null;

  if (isFloating) {
    return (
      <FloatingComposer
        after={(
        <Button
          className="chat-floating-send send-button"
          aria-label={sendButtonLabel}
          disabled={sendButtonDisabled}
          icon={sendButtonIcon}
          onClick={handlePrimaryAction}
          type="primary"
        />
        )}
        className="chat-floating-composer"
        input={(
          <div className="chat-input-shell">
            {mentionDropdown}
            <Input
              className="chat-floating-input"
              onBlur={handleInputBlur}
              onChange={(event) => {
                onInputChange(event.target.value);
                setSelectionStart(event.target.selectionStart ?? event.target.value.length);
              }}
              onFocus={handleInputFocus}
              onKeyDown={handleInputKeyDown}
              onPressEnter={(event) => {
                if (mentionOpen) {
                  event.preventDefault();
                  return;
                }
                if (!event.shiftKey) {
                  event.preventDefault();
                  handlePrimaryAction();
                }
              }}
              onSelect={handleSelectionChange}
              placeholder="直接向模型提问，或输入 @ 调用垂类能力"
              ref={floatingInputRef}
              value={input}
            />
          </div>
        )}
        before={floatingAddButton}
        maxWidth="760px"
        topContent={attachmentList}
        wrapClassName="chat-floating-composer-wrap"
      />
    );
  }

  return (
    <section className={`chat-composer-card ${isWelcome ? 'welcome-composer-card' : ''}`}>
      <div className="chat-input-shell">
        {mentionDropdown}
        <TextArea
          autoSize={{ minRows: 3, maxRows: 8 }}
          bordered={false}
          onBlur={handleInputBlur}
          onChange={(event) => {
            onInputChange(event.target.value);
            setSelectionStart(event.target.selectionStart ?? event.target.value.length);
          }}
          onFocus={handleInputFocus}
          onKeyDown={handleInputKeyDown}
          onPressEnter={(event) => {
            if (mentionOpen) {
              event.preventDefault();
              return;
            }
            if (!event.shiftKey) {
              event.preventDefault();
              handlePrimaryAction();
            }
          }}
          onSelect={handleSelectionChange}
          placeholder="直接向模型提问，或输入 @ 调用垂类能力"
          ref={welcomeInputRef}
          value={input}
        />
      </div>

      <div className="chat-capability-strip">
        {chatCapabilityChips.map((mention) => (
          <Button className="chat-capability-chip" key={mention} onClick={() => insertCapabilityMention(mention)} size="small">
            {mention}
          </Button>
        ))}
      </div>

      {attachmentList}
      {toolbar}
    </section>
  );
}
