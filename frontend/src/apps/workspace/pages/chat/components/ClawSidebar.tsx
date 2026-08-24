import { useState } from 'react';
import { Button, Dropdown, message } from 'antd';
import type { MenuProps } from 'antd';
import { MoreHorizontal } from 'lucide-react';
import { ClearOutlined, DeleteOutlined, EditOutlined } from '@ant-design/icons';
import { SessionEmptyState } from '../../../components/SessionEmptyState';
import type { ChatConversation } from '../../../types';
import { formatRelativeCalendarDateTime } from '../../../utils/dateTime';
import { RenameConversationModal } from './RenameConversationModal';
import { t } from '@shared/i18n';

type ClawSidebarProps = {
  activeConversationId?: string;
  conversations: ChatConversation[];
  hasStreamingAssistant?: boolean;
  onClear: (conversation: ChatConversation) => void;
  onDelete: (conversation: ChatConversation) => void;
  onOpenConversation: (conversation: ChatConversation) => void;
  onRename: (conversationId: string, title: string) => Promise<unknown>;
  sending?: boolean;
};

export function ClawSidebar({
  activeConversationId,
  conversations,
  hasStreamingAssistant,
  onClear,
  onDelete,
  onOpenConversation,
  onRename,
  sending,
}: ClawSidebarProps) {
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<ChatConversation>();

  async function handleRename(conversationId: string, title: string) {
    try {
      await onRename(conversationId, title);
      setRenameOpen(false);
      setRenameTarget(undefined);
      message.success(t("会话名称已更新"));
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("会话重命名失败"));
    }
  }

  function openRenameModal(conversation: ChatConversation) {
    setRenameTarget(conversation);
    setRenameOpen(true);
  }

  return (
    <>
      <div className="chat-sidebar-section">
        {conversations.length ? (
          <div className="video-workbench-list">
            {conversations.map((conversation) => (
              <div
                className={`video-workbench-list-item chat-session-item ${conversation.id === activeConversationId ? 'active' : ''}`}
                key={conversation.id}
                onClick={() => onOpenConversation(conversation)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onOpenConversation(conversation);
                  }
                }}
                role="button"
                tabIndex={0}
              >
                <div className="video-workbench-list-main">
                  <span className="chat-session-title-row">
                    <span className="video-workbench-list-title">{conversation.title || t("未命名会话")}</span>
                    <Dropdown
                      menu={{
                        items: buildConversationMenuItems(conversation, onClear, onDelete, openRenameModal),
                        onClick: ({ domEvent }) => domEvent.stopPropagation(),
                      }}
                      placement="bottomRight"
                      trigger={['click']}
                    >
                      <Button
                        aria-label={t("会话操作")}
                        className="video-workbench-item-action chat-session-action"
                        icon={<MoreHorizontal size={16} />}
                        onClick={(event) => event.stopPropagation()}
                        type="text"
                      />
                    </Dropdown>
                  </span>
                  <span className="chat-session-meta">
                    <small className="chat-session-preview">
                      {conversationPreviewText(conversation, {
                        active: conversation.id === activeConversationId,
                        hasStreamingAssistant,
                        sending,
                      })}
                    </small>
                    <time className="chat-session-time" dateTime={conversation.updatedAt}>
                      {formatRelativeCalendarDateTime(conversation.updatedAt)}
                    </time>
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <SessionEmptyState description={t("新建会话，开始你的图片创作。")} />
        )}
      </div>

      <RenameConversationModal
        conversation={renameTarget}
        onCancel={() => setRenameOpen(false)}
        onSubmit={handleRename}
        open={renameOpen}
      />
    </>
  );
}

function buildConversationMenuItems(
  conversation: ChatConversation,
  onClear: (conversation: ChatConversation) => void,
  onDelete: (conversation: ChatConversation) => void,
  onRename: (conversation: ChatConversation) => void,
): MenuProps['items'] {
  return [
    {
      key: 'rename',
      icon: <EditOutlined />,
      label: t("编辑名称"),
      onClick: () => onRename(conversation),
    },
    {
      key: 'clear',
      icon: <ClearOutlined />,
      label: t("清空会话"),
      onClick: () => onClear(conversation),
    },
    {
      key: 'delete',
      danger: true,
      icon: <DeleteOutlined />,
      label: t("删除会话"),
      onClick: () => onDelete(conversation),
    },
  ];
}

function conversationPreviewText(
  conversation: ChatConversation,
  options?: {
    active?: boolean;
    hasStreamingAssistant?: boolean;
    sending?: boolean;
  },
) {
  if (options?.active && options.hasStreamingAssistant) {
    return t("正在思考...");
  }
  if (options?.active && options.sending) {
    return t("正在发送...");
  }
  const preview = typeof conversation.metadata?.previewText === 'string'
    ? conversation.metadata.previewText.trim()
    : '';
  return preview || t("暂无消息");
}
