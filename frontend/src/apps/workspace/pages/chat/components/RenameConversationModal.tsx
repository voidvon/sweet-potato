import { useEffect, useState } from 'react';
import { Input, Modal, message } from 'antd';
import type { ChatConversation } from '../../../types';
import './RenameConversationModal.scss';
import { t } from '@shared/i18n';

type RenameConversationModalProps = {
  conversation?: ChatConversation;
  onCancel: () => void;
  onSubmit: (conversationId: string, title: string) => Promise<void>;
  open: boolean;
};

export function RenameConversationModal({
  conversation,
  onCancel,
  onSubmit,
  open,
}: RenameConversationModalProps) {
  const [title, setTitle] = useState('');

  useEffect(() => {
    setTitle(conversation?.title || '');
  }, [conversation]);

  async function handleSubmit() {
    if (!conversation) {
      return;
    }

    const nextTitle = title.trim();
    if (!nextTitle) {
      message.warning(t("会话名称不能为空"));
      return;
    }

    await onSubmit(conversation.id, nextTitle);
  }

  return (
    <Modal
      cancelText={t("取消")}
      centered
      className="chat-rename-modal"
      okText={t("保存")}
      onCancel={onCancel}
      onOk={() => void handleSubmit()}
      open={open}
      title={t("修改会话名")}
      zIndex={1600}
    >
      <Input
        autoFocus
        maxLength={80}
        onChange={(event) => setTitle(event.target.value)}
        onPressEnter={() => void handleSubmit()}
        placeholder={t("请输入会话名称")}
        showCount
        value={title}
      />
    </Modal>
  );
}
