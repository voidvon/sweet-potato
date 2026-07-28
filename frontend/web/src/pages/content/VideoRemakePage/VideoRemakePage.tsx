import { Alert, Button, Dropdown, Input, Modal, Spin, Upload } from 'antd';
import { ArrowUp, Bot, Clapperboard, Edit3, Link2, MoreHorizontal, Paperclip, Plus, Repeat2, RotateCcw, Trash2, UploadCloud, Users, X } from 'lucide-react';
import {
  type VideoRemakeCardMessage,
  type VideoRemakeChatMessage,
} from '../../../api/video-remake';
import type { User } from '../../../types';
import { ViralWorkbenchStartPanel } from '../shared/ViralWorkbenchStartPanel';
import { affectedDownstreamLabels, sessionStatusMeta } from './helpers/videoRemakePageHelpers';
import { MessageItem } from './helpers/VideoRemakeMessageItem';
import { formatRelativeCalendarDateTime } from '../../../utils/dateTime';
import { VideoWorkbenchLayout } from '../../../layouts/VideoWorkbenchLayout';
import { FloatingComposer } from '../../../components/FloatingComposer';
import { useVideoRemakePageController } from './helpers/useVideoRemakePageController';
import './VideoRemakePage.scss';

type VideoRemakePageProps = {
  currentUser: User;
};

type DownstreamInvalidationChoice = 'confirm' | 'save_only' | 'cancel';

function confirmDownstreamInvalidation(input: { card: VideoRemakeCardMessage; messages: VideoRemakeChatMessage[]; actionText: string; includePlanned?: boolean; allowSaveOnly?: boolean }) {
  const labels = affectedDownstreamLabels(input.card, input.messages, { includePlanned: input.includePlanned });
  if (!labels.length) {
    return Promise.resolve<DownstreamInvalidationChoice>('confirm');
  }
  return new Promise<DownstreamInvalidationChoice>((resolve) => {
    let settled = false;
    let modal: ReturnType<typeof Modal.confirm>;
    const finish = (choice: DownstreamInvalidationChoice) => {
      if (settled) {
        return;
      }
      settled = true;
      modal?.destroy();
      resolve(choice);
    };
    modal = Modal.confirm({
      title: `${input.actionText}会使下游卡片失效`,
      content: `继续后，${labels.join('、')}会失效，需要重新确认或生成。确定继续吗？`,
      okText: '确认并失效',
      cancelText: '取消',
      footer: (
        <div className="ant-modal-confirm-btns">
          <Button onClick={() => finish('cancel')}>取消</Button>
          {input.allowSaveOnly ? (
            <Button onClick={() => finish('save_only')}>仅修改</Button>
          ) : null}
          <Button type="primary" onClick={() => finish('confirm')}>确认并失效</Button>
        </div>
      ),
      onCancel: () => finish('cancel'),
    });
  });
}

function confirmFinalVideoRegeneration(versionLabel: string) {
  return new Promise<boolean>((resolve) => {
    Modal.confirm({
      title: '重新生成视频？',
      content: `${versionLabel ? `将基于 ${versionLabel} 的当前设定` : '将基于当前设定'}重新生成一个新的视频版本，原视频会保留。确定继续吗？`,
      okText: '重新生成',
      cancelText: '取消',
      onOk: () => resolve(true),
      onCancel: () => resolve(false),
    });
  });
}

export function VideoRemakePage({ currentUser }: VideoRemakePageProps) {
  const controller = useVideoRemakePageController({
    currentUser,
    confirmDownstreamInvalidation,
    confirmFinalVideoRegeneration,
  });
  const {
    sessions,
    assets,
    groups,
    activeSession,
    showStartPanel,
    setShowStartPanel,
    chatInput,
    setChatInput,
    sourceUrl,
    setSourceUrl,
    startMode,
    setStartMode,
    selectedVideoFile,
    setSelectedVideoFile,
    sessionOverlayLoading,
    highlightCardId,
    setHighlightCardId,
    cardDrafts,
    activeSessionWorking,
    activeSessionSyncing,
    startWorking,
    shouldShowStartContent,
    shouldShowWorkspaceLoading,
    canStartMoreSessions,
    currentVideoDurationSeconds,
    currentVideoAspectRatio,
    activeMessages,
    loadSessionDetail,
    showConcurrentLimitWarning,
    ensureAssetsLoaded,
    handleUploadReferenceImage,
    handleCardDraftChange,
    uploadProps,
    handleNewSession,
    handleRenameSession,
    handleDeleteSession,
    handleStartUploadParse,
    handleUploadPipImage,
    handleParseUrl,
    handleSend,
    handleResumeBlockedSession,
    handleSyncSession,
    handleConfirmCard,
    handleCancelCard,
    handleEditCard,
    handleRegenerateCard,
    handleRecoverCard,
    handleRegenerateFinalSegment,
    handleRegenerateFinalSegments,
    handleRetryExpert,
    scrollRef,
    threadRef,
    bottomAnchorRef,
  } = controller;

  return (
    <div className="video-remake-page">
      <VideoWorkbenchLayout
        sidebarTitle={(
          <>
            <span>会话</span>
            <Button
              aria-label="新建复刻"
              icon={<Plus size={12} />}
              onClick={handleNewSession}
              size="small"
              type="primary"
            >
              新建
            </Button>
          </>
        )}
        sidebarContent={(
          <div className="video-remake-sidebar-section">
            <div className="video-workbench-list">
              {sessions.map((session) => {
                const status = sessionStatusMeta(session.status);
                const title = session.filename || '未命名复刻';
                return (
                  <div
                    className={`video-workbench-list-item video-remake-session-item ${session.id === activeSession?.id ? 'active' : ''}`}
                    key={session.id}
                    onClick={() => {
                      setShowStartPanel(false);
                      void loadSessionDetail(session.id, { silent: true, syncUrl: true, showOverlay: true });
                      setHighlightCardId('');
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setShowStartPanel(false);
                        void loadSessionDetail(session.id, { silent: true, syncUrl: true, showOverlay: true });
                        setHighlightCardId('');
                      }
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <div className="video-workbench-list-main">
                      <span className="video-remake-session-title-row">
                        <span className="video-workbench-list-title">{title}</span>
                        <Dropdown
                          menu={{
                            items: [
                              {
                                key: 'rename',
                                icon: <Edit3 size={16} />,
                                label: '编辑名称',
                                onClick: () => handleRenameSession(session),
                              },
                              {
                                key: 'delete',
                                danger: true,
                                icon: <Trash2 size={16} />,
                                label: '删除会话',
                                onClick: () => handleDeleteSession(session),
                              },
                            ],
                          }}
                          placement="bottomRight"
                          trigger={['click']}
                        >
                          <Button
                            aria-label="会话操作"
                            className="video-workbench-item-action video-remake-session-action"
                            icon={<MoreHorizontal size={18} />}
                            onClick={(event) => event.stopPropagation()}
                            type="text"
                          />
                        </Dropdown>
                      </span>
                      <span className="video-remake-session-meta">
                        <small className={`video-workbench-status ${status.tone}`}>{status.label}</small>
                        <time className="video-remake-session-time" dateTime={session.updatedAt}>
                          {formatRelativeCalendarDateTime(session.updatedAt)}
                        </time>
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        footer={activeSession && !showStartPanel ? (
          <FloatingComposer
            after={(
              <Button
                className="video-remake-floating-send"
                disabled={!chatInput.trim()}
                icon={<ArrowUp size={18} />}
                loading={activeSessionWorking}
                onClick={() => void handleSend()}
                type="primary"
              />
            )}
            before={activeSession.status === 'waiting_credit' ? (
              <Button
                icon={<RotateCcw size={16} />}
                loading={activeSessionWorking}
                onClick={() => void handleResumeBlockedSession()}
              >
                充值后继续
              </Button>
            ) : null}
            className="video-remake-floating-composer"
            input={(
              <Input
                className="video-remake-floating-input"
                disabled={activeSessionWorking}
                onChange={(event) => setChatInput(event.target.value)}
                onPressEnter={() => void handleSend()}
                placeholder="输入要修改的内容，例如：我要改画中画"
                value={chatInput}
              />
            )}
            wrapClassName="video-remake-floating-composer-wrap"
          />
        ) : null}
        startContent={(
          <div className="viral-workbench-start-shell">
            <ViralWorkbenchStartPanel
              activeMode={startMode}
              description="上传爆款视频，AI智能解析视频结构，一键复刻生成同款爆款视频"
              featureItems={[
                <><Link2 size={15} />智能解析视频结构</>,
                <><Users size={15} />AI角色专家团队协作</>,
                <><Repeat2 size={15} />素材灵活替换</>,
                <><Clapperboard size={15} />一键生成同款视频</>,
              ]}
              heroIcon={<Bot size={54} />}
              modeOptions={[
                { key: 'upload', label: '上传解析', icon: <UploadCloud size={18} /> },
                { key: 'link', label: '一键复刻', icon: <Link2 size={18} /> },
              ]}
              onModeChange={setStartMode}
              showModeTabs={false}
              title="爆款复刻"
            >
              {startMode === 'link' ? (
                <div className="viral-workbench-panel" role="tabpanel">
                  <div className="viral-workbench-input-row">
                    <Input
                      disabled={startWorking}
                      onChange={(event) => setSourceUrl(event.target.value)}
                      onPressEnter={() => void handleParseUrl()}
                      placeholder="请输入抖音、快手、小红书等平台的视频链接..."
                      value={sourceUrl}
                    />
                    <Button disabled={!sourceUrl.trim()} loading={startWorking} onClick={handleParseUrl} type="primary">
                      解析
                    </Button>
                  </div>
                  <p className="viral-workbench-platforms">支持平台：抖音、快手、小红书、B站、视频号等主流短视频平台</p>
                </div>
              ) : (
                <div className="viral-workbench-panel viral-workbench-upload-panel" role="tabpanel">
                  <div
                    onClick={(event) => {
                      if (!canStartMoreSessions) {
                        event.preventDefault();
                        showConcurrentLimitWarning();
                      }
                    }}
                  >
                    <Upload.Dragger
                      {...uploadProps}
                      openFileDialogOnClick={!startWorking && canStartMoreSessions}
                    >
                    <div className="viral-workbench-upload-drop">
                      {selectedVideoFile ? (
                        <div className="viral-workbench-selected-file viral-workbench-selected-file-inline">
                          <Paperclip size={17} />
                          <span>{selectedVideoFile.name}</span>
                          <button
                            aria-label="清除已选文件"
                            className="viral-workbench-selected-file-clear"
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              setSelectedVideoFile(null);
                            }}
                            type="button"
                          >
                            <X size={12} />
                          </button>
                        </div>
                      ) : (
                        <>
                          <UploadCloud size={34} />
                          <strong>点击或拖拽上传视频</strong>
                          <span>支持 MP4、MOV、WebM 等常见格式</span>
                        </>
                      )}
                      {selectedVideoFile ? (
                        <Button
                          loading={startWorking}
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            void handleStartUploadParse();
                          }}
                          type="primary"
                        >
                          开始解析
                        </Button>
                      ) : null}
                    </div>
                    </Upload.Dragger>
                  </div>
                </div>
              )}
            </ViralWorkbenchStartPanel>
          </div>
        )}
        showStartContent={shouldShowStartContent}
      >
        <main className={`video-remake-main ${!showStartPanel && activeSession ? 'has-session' : 'is-start'}`}>
          {sessionOverlayLoading && activeSession && !showStartPanel ? (
            <div className="video-remake-session-overlay" aria-live="polite" aria-busy="true">
              <Spin />
            </div>
          ) : null}
          <section className={`video-remake-workspace${showStartPanel ? ' is-start' : ''}`} ref={scrollRef}>
            <div className="video-remake-thread" ref={threadRef}>
            {shouldShowWorkspaceLoading ? (
              <div className="video-remake-empty"><Spin /></div>
            ) : activeMessages.length ? (
              <>
                {activeSession?.status === 'waiting_credit' ? (
                  <Alert
                    action={(
                      <Button size="small" type="primary" onClick={() => void handleResumeBlockedSession()}>
                        充值后继续
                      </Button>
                    )}
                    message="当前积分不足，系统已暂停在下一步执行前。充值后点击“充值后继续”即可从当前步骤恢复。"
                    showIcon
                    type="warning"
                  />
                ) : null}
                {activeMessages.map((item) => (
                  <MessageItem
                    active={item.type === 'card' && item.cardId === highlightCardId}
                    assets={assets}
                    cardDrafts={cardDrafts}
                    disabled={activeSessionWorking}
                    groups={groups}
                    item={item}
                    key={item.id}
                    messages={activeMessages}
                    onCardDraftChange={handleCardDraftChange}
                    onCancelCard={handleCancelCard}
                    onConfirmCard={handleConfirmCard}
                    onEditCard={handleEditCard}
                    onEnsureAssets={ensureAssetsLoaded}
                    onRecoverCard={handleRecoverCard}
                    onRegenerateCard={handleRegenerateCard}
                    onRegenerateFinalSegment={handleRegenerateFinalSegment}
                    onRegenerateFinalSegments={handleRegenerateFinalSegments}
                    onSyncSession={handleSyncSession}
                    syncing={activeSessionSyncing}
                    onRetryExpert={handleRetryExpert}
                    onUploadPipImage={handleUploadPipImage}
                    onUploadReferenceImage={handleUploadReferenceImage}
                    videoAspectRatio={currentVideoAspectRatio}
                    videoDurationSeconds={currentVideoDurationSeconds}
                  />
                ))}
              </>
            ) : (
              <div className="video-remake-empty" />
            )}
            <div ref={bottomAnchorRef} aria-hidden="true" />
            </div>
          </section>
        </main>
      </VideoWorkbenchLayout>
    </div>
  );
}
