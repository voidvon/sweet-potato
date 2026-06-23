import { Spin } from 'antd';
import { useEffect } from 'react';
import { ChatComposer } from './components/ChatComposer';
import { ChatMessageList } from './components/ChatMessageList';
import { ClawSidebar } from './components/ClawSidebar';
import { ClawWelcome } from './components/ClawWelcome';
import { SkillCenterModal } from './components/SkillCenterModal';
import { useChatSession } from './hooks/useChatSession';
import { useSkillCenter } from './hooks/useSkillCenter';
import { useWorkspaceHeader } from '../../layouts/ProtectedLayout';
import { VideoWorkbenchLayout } from '../../layouts/VideoWorkbenchLayout';
import { Button, Space } from 'antd';
import { Plus, Zap } from 'lucide-react';
import type { ClawSkill } from './types';
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

  function handleSkillClick(skill: ClawSkill) {
    chat.setInput(`/${skill.command}`);
  }

  const renderComposer = (variant: 'floating' | 'welcome' = 'floating') => (
    <ChatComposer
      activeAgent={chat.activeAgent}
      attachments={chat.attachments}
      input={chat.input}
      onAddFiles={chat.addAttachments}
      onInputChange={chat.setInput}
      onRemoveAttachment={chat.removeAttachment}
      onSend={() => void chat.sendCurrentMessage()}
      onStop={chat.stopSending}
      sending={chat.sending}
      showFloatingAddButton={variant === 'floating'}
      variant={variant}
    />
  );

  return (
    <section className="chat-page">
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
        showStartContent={chat.showWelcome}
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
        startContent={(
          <ClawWelcome onSkillClick={handleSkillClick} skills={skillCenter.skills} />
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
              onUpdateUserMessage={(messageId, content) => void chat.updateUserMessage(messageId, content)}
              onScroll={chat.handleChatScroll}
              onScrollToBottom={() => chat.scrollToBottom(true)}
              scrollContainerRef={chat.scrollContainerRef}
              sending={chat.sending}
              showScrollBottom={chat.userHasScrolledUp}
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
