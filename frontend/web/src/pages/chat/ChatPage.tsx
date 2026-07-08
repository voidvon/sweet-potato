import { Spin } from 'antd';
import { useEffect } from 'react';
import { ClawDialogComposer } from './components/ClawDialogComposer';
import { ChatMessageList } from './components/ChatMessageList';
import { ClawSidebar } from './components/ClawSidebar';
import { SkillCenterModal } from './components/SkillCenterModal';
import { useChatSession } from './hooks/useChatSession';
import { useSkillCenter } from './hooks/useSkillCenter';
import { useWorkspaceHeader } from '../../layouts/ProtectedLayout';
import { VideoWorkbenchLayout } from '../../layouts/VideoWorkbenchLayout';
import { Button, Space } from 'antd';
import { Plus, Zap } from 'lucide-react';
import '../content/VideoRemakePage/VideoRemakePage.scss';
import './ChatPage.scss';

export function ChatPage() {
  const chat = useChatSession();
  const skillCenter = useSkillCenter();
  const { setHeaderExtra } = useWorkspaceHeader();

  useEffect(() => {
    setHeaderExtra(
      <div className="workspace-chat-title-shell">
        <span className="workspace-chat-title">{chat.activeConversation?.title || '新对话'}</span>
      </div>,
    );

    return () => {
      setHeaderExtra(null);
    };
  }, [chat.activeConversation?.title, setHeaderExtra]);

  const renderComposer = () => (
    <ClawDialogComposer
      attachments={chat.attachments}
      input={chat.input}
      onAddFiles={chat.addAttachments}
      onInputChange={chat.setInput}
      onRemoveAttachment={chat.removeAttachment}
      onSend={(options) => void chat.sendCurrentMessage(options)}
      onStop={chat.stopSending}
      showHeading={chat.messages.length === 0}
      sending={chat.sending}
    />
  );

  return (
    <section className={`chat-page${chat.showWelcome ? ' is-idle' : ''}`}>
      <VideoWorkbenchLayout
        footer={renderComposer()}
        sidebarHeader={(
          <div className="video-remake-sidebar-header">
            <Space orientation="vertical" size={12} style={{ display: 'flex' }}>
              <Button block icon={<Plus size={16} />} onClick={chat.startNewConversation} type="primary">
                新建会话
              </Button>
              <Button block icon={<Zap size={16} />} onClick={() => skillCenter.setOpen(true)}>
                技能中心
              </Button>
            </Space>
          </div>
        )}
        sidebarTitle="会话"
        sidebarContent={(
          <ClawSidebar
            activeConversationId={chat.activeConversationId}
            conversations={chat.conversations}
            hasStreamingAssistant={chat.hasStreamingAssistant}
            onClear={chat.clearConversationMessages}
            onDelete={chat.removeConversation}
            onOpenConversation={chat.openConversation}
            onRename={chat.updateConversationTitle}
            sending={chat.sending}
          />
        )}
      >
        <main className="chat-main">
          {chat.conversationOverlayLoading ? (
            <div className="chat-session-overlay" aria-busy="true" aria-live="polite">
              <Spin />
            </div>
          ) : null}
          <div className="chat-main-body">
            <ChatMessageList
              hasStreamingAssistant={chat.hasStreamingAssistant}
              messages={chat.messages}
              onActionClick={(content) => void chat.sendPresetMessage(content)}
              onDeleteMessage={(messageItem) => void chat.removeMessage(messageItem)}
              onRegenerateImage={(userMessage, assistantMessage, currentCreditCost) => void chat.regenerateImageMessage(userMessage, assistantMessage, currentCreditCost)}
              onUpdateUserMessage={(messageId, content) => void chat.updateUserMessage(messageId, content)}
              onScroll={chat.handleChatScroll}
              scrollContainerRef={chat.scrollContainerRef}
              sending={chat.sending}
            />
          </div>
        </main>
      </VideoWorkbenchLayout>
      <SkillCenterModal
        onClose={() => skillCenter.setOpen(false)}
        onRemoveSkill={skillCenter.removeSkill}
        onUpdateSkill={skillCenter.updateSkill}
        onUploadFile={skillCenter.uploadSkillFile}
        open={skillCenter.open}
        skills={skillCenter.skills}
      />
    </section>
  );
}
