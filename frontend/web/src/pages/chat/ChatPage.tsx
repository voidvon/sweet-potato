import { Spin } from 'antd';
import { useEffect } from 'react';
import { ClawDialogComposer } from './components/ClawDialogComposer';
import { ChatMessageList } from './components/ChatMessageList';
import { ClawSidebar } from './components/ClawSidebar';
import { useChatSession } from './hooks/useChatSession';
import { useWorkspaceHeader } from '../../layouts/ProtectedLayout';
import { VideoWorkbenchLayout } from '../../layouts/VideoWorkbenchLayout';
import { Button } from 'antd';
import { Plus } from 'lucide-react';
import '../content/VideoRemakePage/VideoRemakePage.scss';
import './ChatPage.scss';

export function ChatPage() {
  const chat = useChatSession();
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
      composerDraftContext={chat.composerDraftContext}
      composerDraftImageModelConfigId={chat.composerDraftImageModelConfigId}
      continueEditFocusToken={chat.continueEditFocusToken}
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
        sidebarTitle={(
          <>
            <span>会话</span>
            <Button
              aria-label="新建会话"
              icon={<Plus size={14} />}
              onClick={chat.startNewConversation}
              size="small"
              type="text"
            >
              新建
            </Button>
          </>
        )}
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
              onContinueEditImage={(messageItem) => chat.continueEditImageMessage(messageItem)}
              onRegenerateImage={(userMessage, assistantMessage, currentCreditCost) => void chat.regenerateImageMessage(userMessage, assistantMessage, currentCreditCost)}
              onRefillComposerFromMessage={(messageItem) => chat.refillComposerFromMessage(messageItem)}
              onScroll={chat.handleChatScroll}
              scrollContainerRef={chat.scrollContainerRef}
              sending={chat.sending}
            />
          </div>
        </main>
      </VideoWorkbenchLayout>
    </section>
  );
}
