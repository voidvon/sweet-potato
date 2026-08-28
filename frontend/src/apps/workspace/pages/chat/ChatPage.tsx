import { Spin } from 'antd';
import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { ClawDialogComposer } from './components/ClawDialogComposer';
import { ChatMessageList } from './components/ChatMessageList';
import { ClawSidebar } from './components/ClawSidebar';
import { useChatSession } from './hooks/useChatSession';
import { useWorkspaceHeader } from '../../layouts/ProtectedLayout';
import { VideoWorkbenchLayout } from '../../layouts/VideoWorkbenchLayout';
import { Button } from 'antd';
import { Plus } from 'lucide-react';
import './ChatPage.scss';
import { t } from '@shared/i18n';

export function ChatPage() {
  const chat = useChatSession();
  const location = useLocation();
  const { setHeaderExtra } = useWorkspaceHeader();
  const showComposerHeading = chat.showWelcome
    && location.pathname === '/app/image'
    && !new URLSearchParams(location.search).has('conversationId');

  useEffect(() => {
    setHeaderExtra(
      <div className="workspace-chat-title-shell">
        <span className="workspace-chat-title">{chat.activeConversation?.title || t("新对话")}</span>
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
      composerDraftModelConfigId={chat.composerDraftModelConfigId}
      conversationModelConfigId={chat.activeConversation?.modelConfigId}
      contextUsage={chat.activeConversation?.metadata?.contextUsage}
      continueEditFocusToken={chat.continueEditFocusToken}
      input={chat.input}
      onAddFiles={chat.addAttachments}
      onInputChange={chat.setInput}
      onRemoveAttachment={chat.removeAttachment}
      onSend={(options) => void chat.sendCurrentMessage(options)}
      onStop={chat.stopSending}
      showHeading={showComposerHeading}
      sending={chat.sending}
    />
  );

  return (
    <section className={`chat-page${chat.showWelcome ? ' is-idle' : ''}`}>
      <VideoWorkbenchLayout
        footer={renderComposer()}
        sidebarTitle={(
          <>
            <span>{t("会话")}</span>
            <Button
              aria-label={t("新建会话")}
              icon={<Plus size={14} />}
              onClick={chat.startNewConversation}
              size="small"
              type="primary"
            >
              {t("新建")}
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
              onRegenerateSingleImage={(messageItem, slotIndex, additionalPrompt) => chat.regenerateSingleImageMessage(messageItem, slotIndex, additionalPrompt)}
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
