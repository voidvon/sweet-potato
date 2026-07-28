import { Alert, Button, Modal, Popover, Tooltip, message } from 'antd';
import { ChevronDown, ListPlus, PencilLine, RefreshCw, RotateCcw, X } from 'lucide-react';
import { useState } from 'react';
import { MentionRichTextarea } from '../../../../components/MentionRichTextarea';
import { asItems, asRecord, fieldText, mediaUrl } from '../videoRemakeCardUtils';
import { EditableCard } from './cardShell';
import { isSegmentGenerating, segmentStatusMeta, segmentTime, segmentVideo, type SegmentStatusOptions } from './finalVideoHelpers';
import { SeedancePromptPreview, promptTextValue, seedanceMentionOptions, seedanceReferenceMentions, type CardRendererProps, type FinalSegmentQueueItem, type SeedanceReferenceMention } from './shared';

export function FinalVideoCard(props: CardRendererProps) {
  const [segmentsOpen, setSegmentsOpen] = useState(false);
  const [regeneratingIndex, setRegeneratingIndex] = useState(0);
  const [promptEditor, setPromptEditor] = useState<{ mentions: SeedanceReferenceMention[]; mode: 'regenerate' | 'queue'; segmentIndex: number; prompt: string } | null>(null);
  const [promptPreview, setPromptPreview] = useState<{ mentions: SeedanceReferenceMention[]; segmentIndex: number; prompt: string } | null>(null);
  const [segmentQueue, setSegmentQueue] = useState<FinalSegmentQueueItem[]>([]);
  const [openSegmentActionIndex, setOpenSegmentActionIndex] = useState<number | null>(null);
  const [queueSubmitting, setQueueSubmitting] = useState(false);
  const requestSegmentRegeneration = async (segmentIndex: number, prompt?: string) => {
    if (!props.onRegenerateFinalSegments && !props.onRegenerateFinalSegment) {
      return;
    }
    setRegeneratingIndex(segmentIndex);
    try {
      if (props.onRegenerateFinalSegments) {
        await props.onRegenerateFinalSegments([{ segmentIndex, prompt }]);
      } else {
        await props.onRegenerateFinalSegment?.(segmentIndex, prompt);
      }
      setPromptEditor(null);
      setPromptPreview(null);
      setSegmentsOpen(false);
      setOpenSegmentActionIndex(null);
    } finally {
      setRegeneratingIndex(0);
    }
  };
  const upsertSegmentQueue = (item: FinalSegmentQueueItem) => {
    setSegmentQueue((current) => {
      const next = current.filter((queueItem) => queueItem.segmentIndex !== item.segmentIndex);
      return [...next, item].sort((left, right) => left.segmentIndex - right.segmentIndex);
    });
  };
  const removeSegmentQueueItem = (segmentIndex: number) => {
    setSegmentQueue((current) => current.filter((item) => item.segmentIndex !== segmentIndex));
  };
  const submitSegmentQueue = async () => {
    if ((!props.onRegenerateFinalSegments && !props.onRegenerateFinalSegment) || !segmentQueue.length) {
      return;
    }
    const queue = [...segmentQueue].sort((left, right) => left.segmentIndex - right.segmentIndex);
    setQueueSubmitting(true);
    try {
      setRegeneratingIndex(queue[0]?.segmentIndex || 0);
      const segments = queue.map((item) => ({
        segmentIndex: item.segmentIndex,
        prompt: item.mode === 'prompt' ? item.prompt : undefined,
      }));
      if (props.onRegenerateFinalSegments) {
        await props.onRegenerateFinalSegments(segments);
      } else {
        for (const item of segments) {
          setRegeneratingIndex(item.segmentIndex);
          await props.onRegenerateFinalSegment?.(item.segmentIndex, item.prompt);
        }
      }
      setSegmentQueue([]);
      setPromptEditor(null);
      setPromptPreview(null);
      setSegmentsOpen(false);
      setOpenSegmentActionIndex(null);
    } finally {
      setRegeneratingIndex(0);
      setQueueSubmitting(false);
    }
  };
  return (
    <EditableCard {...props}>
      {({ draft }) => {
        const data = asRecord(draft);
        const video = fieldText(data.videoUrl);
        const status = fieldText(data.status);
        const generationMode = fieldText(data.generationMode) === 'queued_extend' ? 'queued_extend' : 'parallel';
        const regenerationMode = fieldText(data.regenerationMode);
        const isSegmentRegenerationCard = regenerationMode === 'segment';
        const regeneratedSegmentIndexes = Array.isArray(data.regeneratedSegmentIndexes)
          ? data.regeneratedSegmentIndexes.map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0)
          : [];
        const regeneratedSegmentIndex = Number(data.regeneratedSegmentIndex || 0);
        const regeneratedSegmentLabel = regeneratedSegmentIndexes.length
          ? `分段 ${regeneratedSegmentIndexes.join('、')}`
          : regeneratedSegmentIndex > 0
            ? `分段 ${regeneratedSegmentIndex}`
            : '分段';
        const versionLabel = fieldText(data.versionLabel || data.version) || (fieldText(data.versionNumber) ? `v${fieldText(data.versionNumber)}` : '');
        const isPendingSegmentRegeneration = isSegmentRegenerationCard
          && (props.card.status === 'pending' || status === 'generating');

        const videoHistory = asItems(data.videos);
        const currentVideo = videoHistory.find((item) => {
          const itemVersionNumber = Number(item.versionNumber || 0);
          const dataVersionNumber = Number(data.versionNumber || 0);
          return (video && fieldText(item.videoUrl) === video)
            || (versionLabel && fieldText(item.versionLabel || item.version) === versionLabel)
            || (dataVersionNumber > 0 && itemVersionNumber === dataVersionNumber);
        }) || videoHistory[videoHistory.length - 1] || {};
        const segments = asItems(data.segments);
        const generatedSegments = asItems(data.generatedSegments);
        const historySegments = asItems(currentVideo.segments);
        const seedancePrompts = asItems(data.seedancePrompts);
        const displaySegments = segments.length
          ? segments
          : generatedSegments.length
            ? generatedSegments
            : historySegments.length
              ? historySegments
              : seedancePrompts;
        const hasCompletedFinalVideo = Boolean(video) || status === 'completed';
        const rawSegmentRows = displaySegments.map((segment, index) => {
          const seedancePromptSegment = seedancePrompts[index] || {};
          const generatedSegment = generatedSegments[index] || {};
          const row = {
            ...seedancePromptSegment,
            ...segment,
            ...generatedSegment,
          };
          if (!promptTextValue(row.prompt)) {
            row.prompt = promptTextValue(generatedSegment.prompt)
              ? generatedSegment.prompt
              : promptTextValue(segment.prompt)
                ? segment.prompt
                : seedancePromptSegment.prompt;
          }
          if (!promptTextValue(row.seedancePrompt)) {
            row.seedancePrompt = promptTextValue(generatedSegment.seedancePrompt)
              ? generatedSegment.seedancePrompt
              : promptTextValue(segment.seedancePrompt)
                ? segment.seedancePrompt
                : seedancePromptSegment.seedancePrompt;
          }
          return row;
        });
        const segmentRows = rawSegmentRows;
        const segmentStatusOptions: SegmentStatusOptions = { generationMode, hasCompletedFinalVideo, isSegmentRegenerationCard, regeneratedSegmentIndex };
        const completedSegmentCount = segmentRows.filter((segment, index) => segmentStatusMeta(segment, index + 1, segmentStatusOptions).tone === "done").length;
        const failedSegmentCount = segmentRows.filter((segment, index) => segmentStatusMeta(segment, index + 1, segmentStatusOptions).tone === "failed").length;
        const runningSegmentCount = segmentRows.filter((segment, index) => isSegmentGenerating(segment, index + 1, segmentStatusOptions)).length;
        const segmentProgressPercent = segmentRows.length ? Math.round((completedSegmentCount / segmentRows.length) * 100) : 0;
        const canInspectSegments = !isPendingSegmentRegeneration
          && segmentRows.length > 0
          && (hasCompletedFinalVideo || isSegmentRegenerationCard || status === "generating" || status === "failed" || props.card.status === "failed");
        const segmentPromptText = (segment: Record<string, unknown>) => {
          return promptTextValue(segment.prompt)
            || promptTextValue(segment.seedancePrompt);
        };
        const openPromptEditor = (segmentIndex: number, segment: Record<string, unknown>, mode: 'regenerate' | 'queue') => {
          setOpenSegmentActionIndex(null);
          setPromptEditor({
            mentions: seedanceReferenceMentions(asRecord(segment.prompt), props.assets),
            mode,
            segmentIndex,
            prompt: segmentPromptText(segment),
          });
        };
        const openPromptPreview = (segmentIndex: number, segment: Record<string, unknown>) => {
          setPromptPreview({
            mentions: seedanceReferenceMentions(asRecord(segment.prompt), props.assets),
            segmentIndex,
            prompt: segmentPromptText(segment),
          });
        };
        const queueSegment = (segmentIndex: number) => {
          setOpenSegmentActionIndex(null);
          upsertSegmentQueue({ mode: 'direct', segmentIndex });
          message.success(`分段 ${segmentIndex} 已加入待生成队列`);
        };
        const regenerateSegmentFromMenu = (segmentIndex: number) => {
          setOpenSegmentActionIndex(null);
          void requestSegmentRegeneration(segmentIndex);
        };
        const confirmPromptEditor = async () => {
          if (!promptEditor) {
            return;
          }
          if (promptEditor.mode === 'queue') {
            upsertSegmentQueue({
              mode: 'prompt',
              prompt: promptEditor.prompt,
              segmentIndex: promptEditor.segmentIndex,
            });
            message.success(`分段 ${promptEditor.segmentIndex} 已加入待生成队列`);
            setPromptEditor(null);
            return;
          }
          await requestSegmentRegeneration(promptEditor.segmentIndex, promptEditor.prompt);
        };
        const renderPromptPreviewModal = () => (
          <Modal
            footer={null}
            onCancel={() => setPromptPreview(null)}
            open={Boolean(promptPreview)}
            title={`分段 ${promptPreview?.segmentIndex || ''} 提示词`}
            width={820}
          >
            <div className="remake-segment-prompt-preview-modal">
              <SeedancePromptPreview mentions={promptPreview?.mentions || []} text={promptPreview?.prompt || ''} />
            </div>
          </Modal>
        );
        const renderPromptEditorModal = () => (
          <Modal
            okButtonProps={{ loading: regeneratingIndex === promptEditor?.segmentIndex }}
            okText={promptEditor?.mode === 'queue' ? '加入待生成队列' : '重新生成'}
            onCancel={() => setPromptEditor(null)}
            onOk={() => void confirmPromptEditor()}
            open={Boolean(promptEditor)}
            title={`调整分段 ${promptEditor?.segmentIndex || ''} 提示词`}
            width={820}
          >
            <div className="remake-prompt-editor remake-segment-prompt-editor">
              <label>提示词</label>
              <MentionRichTextarea
                fallbackMentionMenu
                minRows={10}
                onChange={(value) => setPromptEditor((current) => current ? { ...current, prompt: value } : current)}
                options={seedanceMentionOptions(promptEditor?.mentions || [])}
                placeholder="输入分段生成提示词，可通过 @ 引用素材"
                suggestionContainer=".ant-modal-root"
                value={promptEditor?.prompt || ''}
              />
            </div>
          </Modal>
        );
        const renderSegmentsModal = () => (
          <Modal
            footer={segmentRows.length ? (
              <div className="remake-final-segment-queue-footer">
                <div>
                  <strong>待生成队列</strong>
                  <span>{segmentQueue.length ? `已选择 ${segmentQueue.map((item) => `分段 ${item.segmentIndex}`).join('、')}` : '可先调整多个分段，再统一提交生成'}</span>
                </div>
                <Button disabled={!segmentQueue.length || queueSubmitting || regeneratingIndex > 0} onClick={() => setSegmentQueue([])}>
                  清空队列
                </Button>
                <Button
                  disabled={!segmentQueue.length || (!props.onRegenerateFinalSegments && !props.onRegenerateFinalSegment)}
                  loading={queueSubmitting}
                  onClick={() => void submitSegmentQueue()}
                  type="primary"
                >
                  统一生成
                </Button>
              </div>
            ) : null}
            onCancel={() => setSegmentsOpen(false)}
            open={segmentsOpen}
            title={`${versionLabel ? `${versionLabel} ` : ''}生成分段`}
            width={960}
          >
            <div className="remake-final-segments-modal">
              {segmentRows.length ? (
                <>
                  <div className="remake-final-segments-summary">
                    <div>
                      <strong>{`${completedSegmentCount}/${segmentRows.length}`}</strong>
                      <span>已完成</span>
                    </div>
                    <div>
                      <strong>{runningSegmentCount}</strong>
                      <span>生成中</span>
                    </div>
                    <div>
                      <strong>{failedSegmentCount}</strong>
                      <span>失败</span>
                    </div>
                    <div>
                      <strong>{`${segmentProgressPercent}%`}</strong>
                      <span>整体进度</span>
                    </div>
                  </div>
                  {segmentQueue.length ? (
                    <div className="remake-final-segment-queue">
                      <span>待生成</span>
                      {segmentQueue.map((item) => (
                        <button key={item.segmentIndex} onClick={() => removeSegmentQueueItem(item.segmentIndex)} type="button">
                          {`分段 ${item.segmentIndex}${item.mode === 'prompt' ? ' · 已调词' : ' · 直接'}`}
                          <X size={12} />
                        </button>
                      ))}
                    </div>
                  ) : null}
                  <div className="remake-final-segment-grid">
                    {segmentRows.map((segment, index) => {
                      const source = segmentVideo(segment);
                      const segmentGenerating = isSegmentGenerating(segment, index + 1, segmentStatusOptions);
                      const segmentActionDisabled = (!props.onRegenerateFinalSegments && !props.onRegenerateFinalSegment) || regeneratingIndex > 0 || segmentGenerating;
                      const statusMeta = segmentStatusMeta(segment, index + 1, segmentStatusOptions);
                      const queuedItem = segmentQueue.find((item) => item.segmentIndex === index + 1);
                      const actionContent = (
                        <div className="remake-final-segment-action-menu">
                          <button disabled={segmentActionDisabled} onClick={() => openPromptEditor(index + 1, segment, 'regenerate')} type="button">
                            <PencilLine size={16} />
                            <span>
                              <strong>调整提示词后重新生成</strong>
                              <small>编辑当前分段提示词，并立即提交这一段</small>
                            </span>
                          </button>
                          <button disabled={segmentActionDisabled} onClick={() => regenerateSegmentFromMenu(index + 1)} type="button">
                            <RotateCcw size={16} />
                            <span>
                              <strong>直接重新生成</strong>
                              <small>使用当前分段提示词立即提交</small>
                            </span>
                          </button>
                          <button disabled={segmentActionDisabled} onClick={() => queueSegment(index + 1)} type="button">
                            <ListPlus size={16} />
                            <span>
                              <strong>放入待生成队列</strong>
                              <small>先收集多个分段，稍后统一生成</small>
                            </span>
                          </button>
                          <button disabled={segmentActionDisabled} onClick={() => openPromptEditor(index + 1, segment, 'queue')} type="button">
                            <PencilLine size={16} />
                            <span>
                              <strong>调整后放入队列</strong>
                              <small>适合多个分段分别调词后统一生成</small>
                            </span>
                          </button>
                        </div>
                      );
                      return (
                        <div
                          key={`${fieldText(segment.segmentId || segment.segmentIndex) || index}`}
                          className={`remake-final-segment-item ${isSegmentRegenerationCard && regeneratedSegmentIndex === index + 1 ? 'is-regenerating' : ''}`}
                        >
                          <header>
                            <strong>{`分段 ${index + 1}`}</strong>
                            <span>{segmentTime(segment)}</span>
                            <em className={`remake-segment-status-pill is-${statusMeta.tone}`}>
                              <span aria-hidden="true" />
                              {statusMeta.label}
                            </em>
                          </header>
                          {source ? <video controls src={mediaUrl(source)} /> : <div className="remake-final-segment-placeholder">暂无分段视频</div>}
                          {segmentPromptText(segment) ? (
                            <button className="remake-final-segment-prompt-button" onClick={() => openPromptPreview(index + 1, segment)} type="button">
                              查看提示词
                            </button>
                          ) : null}
                          <div className="remake-final-segment-actions">
                            {queuedItem ? (
                              <span className="remake-final-segment-queued">
                                {queuedItem.mode === 'prompt' ? '已加入队列 · 调整提示词' : '已加入队列 · 直接生成'}
                              </span>
                            ) : null}
                            <Popover
                              content={actionContent}
                              onOpenChange={(open) => setOpenSegmentActionIndex(open ? index + 1 : null)}
                              open={openSegmentActionIndex === index + 1}
                              placement="bottomRight"
                              trigger="click"
                            >
                              <Button
                                disabled={segmentActionDisabled}
                                loading={regeneratingIndex === index + 1}
                                type="primary"
                              >
                                重生成
                                <ChevronDown size={14} />
                              </Button>
                            </Popover>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : <Alert message="暂无可查看的生成分段。" type="info" showIcon />}
            </div>
          </Modal>
        );
        if (props.card.status === 'pending' || status === 'generating' || props.card.status === 'failed' || status === 'failed') {
          const showPendingSegments = canInspectSegments && segmentRows.length > 0;
          const canManualSync = typeof props.onSyncProgress === 'function';
          const pendingHint = isSegmentRegenerationCard
            ? `正在基于 ${versionLabel || '当前版本'} 重新生成${regeneratedSegmentLabel}`
            : '';
          const pendingMessage = isPendingSegmentRegeneration
            ? `${regeneratedSegmentLabel}重新生成中，请稍候。`
            : fieldText(data.message) || (props.card.status === 'failed' || status === 'failed' ? '视频生成失败。' : '视频生成中，请稍候。');
          return (
            <>
                <div className="remake-video-generation-card">
                  <div className="remake-final-card-head">
                    {showPendingSegments ? <Button onClick={() => setSegmentsOpen(true)}>查看分段</Button> : null}
                  </div>
                {showPendingSegments ? (
                  <div className="remake-video-generation-segments">
                    <div className="remake-video-generation-summary">
                      <div>
                        <strong>分段生成进度</strong>
                        <span>{`${completedSegmentCount}/${segmentRows.length} 已完成${runningSegmentCount ? ` · ${runningSegmentCount} 生成中` : ''}${failedSegmentCount ? ` · ${failedSegmentCount} 失败` : ''}`}</span>
                      </div>
                      <span>{`${segmentProgressPercent}%`}</span>
                    </div>
                    <div className="remake-video-generation-progress" aria-hidden="true">
                      <span style={{ width: `${segmentProgressPercent}%` }} />
                    </div>
                    <div className="remake-video-generation-list">
                      {segmentRows.map((segment, index) => {
                        const statusMeta = segmentStatusMeta(segment, index + 1, segmentStatusOptions);
                        return (
                          <div
                            key={`${fieldText(segment.segmentId || segment.segmentIndex) || index}`}
                            className={`remake-video-generation-row is-${statusMeta.tone}`}
                          >
                            <span className="remake-video-generation-index">{`分段 ${index + 1}`}</span>
                            <span className="remake-video-generation-time">{segmentTime(segment)}</span>
                            <span className={`remake-segment-status-pill is-${statusMeta.tone}`}>
                              <span aria-hidden="true" />
                              {statusMeta.label}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
                {fieldText(data.errorMessage) ? <p className="remake-video-generation-error">错误原因：{fieldText(data.errorMessage)}</p> : null}
                {pendingHint ? <p className="remake-video-generation-hint">{pendingHint}</p> : null}
                {/* <p className="remake-video-generation-hint">
                  {generationMode === 'queued_extend' ? '生成方式：排队生成（视频延长）' : '生成方式：批量分段生成'}
                </p> */}
                <div className="remake-video-generation-status-line">
                  <p aria-live="polite">
                    {props.card.status === 'failed' || status === 'failed' ? null : <span className="remake-generating-indicator" aria-hidden="true"><span /><span /><span /></span>}
                    {pendingMessage}
                  </p>
                  {canManualSync ? (
                    <Tooltip title="手动同步">
                      <button
                        aria-label="手动同步视频生成状态"
                        className="remake-message-icon-action"
                        disabled={props.disabled || props.syncing}
                        onClick={() => void props.onSyncProgress?.()}
                        type="button"
                      >
                        <RefreshCw className={props.syncing ? 'is-spinning' : undefined} size={14} />
                      </button>
                    </Tooltip>
                  ) : null}
                </div>
              </div>
              {showPendingSegments ? renderSegmentsModal() : null}
              {renderPromptPreviewModal()}
              {renderPromptEditorModal()}
            </>
          );
        }
        return (
          <>
            <div className="remake-final-card">
              <div className="remake-final-card-head">
                {canInspectSegments && segmentRows.length ? <Button onClick={() => setSegmentsOpen(true)}>查看分段</Button> : null}
              </div>
              <p>{fieldText(data.message) || '确认后将使用你确认的卡片内容组织生成提示词产出视频。'}</p>
              {/* {hasCompletedFinalVideo ? (
                <p className="remake-video-generation-hint">
                  {generationMode === 'queued_extend' ? '生成方式：排队生成（视频延长）' : '生成方式：批量分段生成'}
                </p>
              ) : null} */}
              {video ? <video controls src={mediaUrl(video)} /> : null}
            </div>
            {renderSegmentsModal()}
            {renderPromptPreviewModal()}
            {renderPromptEditorModal()}
          </>
        );
      }}
    </EditableCard>
  );
}
