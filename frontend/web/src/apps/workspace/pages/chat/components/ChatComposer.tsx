import { useRef } from 'react';
import { Button, Dropdown, Image, Input, Space, Upload } from 'antd';
import { CloseOutlined, FileOutlined, PaperClipOutlined, PictureOutlined, PlusOutlined } from '@ant-design/icons';
import type { GetRef, InputRef, UploadProps } from 'antd';
import { ArrowUp, Square } from 'lucide-react';
import type { AiAgent, ChatAttachment } from '../../../types';
import { resolveAssetUrl } from '../../../api/request';
import { FloatingComposer } from '../../../components/FloatingComposer';
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
  const uploadProps = (accept?: string): UploadProps => ({
    accept,
    beforeUpload: (file) => {
      onAddFiles([file]);
      return false;
    },
    multiple: true,
    showUploadList: false,
  });

  function handleHiddenFileSelect(fileList: FileList | null) {
    const files = Array.from(fileList || []);
    if (files.length > 0) {
      onAddFiles(files);
    }
  }

  const attachmentList = attachments.length > 0 ? (
    <div className="chat-attachment-list">
      {attachments.map((attachment) => (
        <div className={`chat-attachment-chip ${attachment.kind}`} key={attachment.id}>
          {attachment.kind === 'image' ? (
            <Image
              alt={attachment.name}
              className="chat-attachment-preview"
              src={resolveAssetUrl(attachment.url)}
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
            <Input
              className="chat-floating-input"
              onChange={(event) => {
                onInputChange(event.target.value);
              }}
              onPressEnter={(event) => {
                event.preventDefault();
                handlePrimaryAction();
              }}
              placeholder="直接向模型提问"
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
        <TextArea
          autoSize={{ minRows: 3, maxRows: 8 }}
          bordered={false}
          onChange={(event) => {
            onInputChange(event.target.value);
          }}
          onPressEnter={(event) => {
            event.preventDefault();
            if (!event.shiftKey) {
              handlePrimaryAction();
            }
          }}
          placeholder="直接向模型提问"
          ref={welcomeInputRef}
          value={input}
        />
      </div>

      {attachmentList}
      {toolbar}
    </section>
  );
}
