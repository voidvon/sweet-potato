import { Button, Tooltip } from 'antd';
import { CheckCircle2, CircleAlert, Info, RefreshCw } from 'lucide-react';
import { asRecord, fieldText, mediaUrl } from '../videoRemakeCardUtils';
import { ReadonlyCard } from './cardShell';
import { isProgressExecutionCompleted, type CardRendererProps } from './shared';

export function GenerationProgressCard(props: CardRendererProps) {
  const data = asRecord(props.card.data);
  const isVideoGeneration = fieldText(data.kind) === 'video_generation';
  const status = fieldText(data.status) || '排队中';
  const result = asRecord(data.result);
  const videoUrl = fieldText(data.videoUrl) || fieldText(result.videoUrl);
  const rawCompletedExperts = Number(data.completedExperts ?? 0);
  const rawTotalExperts = Number(data.totalExperts ?? 0);
  const isCompleted = props.card.status === 'confirmed' || status === 'completed';
  const isFailed = props.card.status === 'failed' || status === 'failed';
  const retriedExpertName = fieldText(data.retriedExpertName);
  const executionItems = Array.isArray(data.executions)
    ? data.executions.map(asRecord).filter((item) => Object.keys(item).length > 0)
    : [];
  const fallbackExpertLabels = retriedExpertName ? [retriedExpertName] : ['音频理解专家', '视频理解专家', '画中画理解专家'];
  const totalExperts = rawTotalExperts || executionItems.length || fallbackExpertLabels.length;
  const completedFromExecutions = executionItems.filter(isProgressExecutionCompleted).length;
  const derivedCompletedExperts = Math.min(totalExperts, Math.max(rawCompletedExperts, completedFromExecutions));
  const allExpertsCompleted = !isFailed && totalExperts > 0 && derivedCompletedExperts >= totalExperts;
  const displayCompleted = isCompleted || allExpertsCompleted;
  const completedExperts = displayCompleted ? totalExperts : derivedCompletedExperts;
  const expertItems = executionItems.length
    ? executionItems.map((item, index) => ({
      label: fieldText(item.roleName) || fallbackExpertLabels[index] || `专家 ${index + 1}`,
      completed: displayCompleted || isProgressExecutionCompleted(item) || index < completedExperts,
    }))
    : fallbackExpertLabels.slice(0, totalExperts || 3).map((label, index) => ({
      label,
      completed: displayCompleted || index < completedExperts,
    }));
  const percent = displayCompleted
    ? 100
    : totalExperts > 0
    ? Math.max(0, Math.min(100, Math.round((completedExperts / totalExperts) * 100)))
    : Number(data.percent || 0);
  const allowManualSync = !displayCompleted && !isFailed && typeof props.onSyncProgress === 'function';
  const visibleExpertItems = expertItems.slice(0, totalExperts || expertItems.length || 3);
  return (
    <ReadonlyCard>
      <div className={`remake-status-bubble remake-progress-bubble ${displayCompleted ? 'is-completed' : isFailed ? 'is-failed' : 'is-running'}`}>
        {!isVideoGeneration && totalExperts > 0 ? (
          <div className="remake-expert-progress-list">
            {visibleExpertItems.map((item) => {
              const itemRunning = !item.completed && !displayCompleted && !isFailed;
              const itemFailed = !item.completed && isFailed;
              const stateClass = item.completed ? 'is-done' : itemFailed ? 'is-failed' : itemRunning ? 'is-running' : 'is-muted';
              const stateText = item.completed ? '已完成' : itemRunning ? '解析中' : itemFailed ? '未完成' : '等待中';
              return (
                <div className={`remake-expert-progress-item ${stateClass}`} key={item.label}>
                  <span className="remake-expert-progress-dot" aria-hidden="true" />
                  <b>{item.label}</b>
                  <em>{stateText}</em>
                </div>
              );
            })}
          </div>
        ) : null}
        {!isVideoGeneration && !isFailed && totalExperts > 0 ? (
          <div className="remake-progress-detail">
            <div className="remake-progress-track"><i className={!displayCompleted ? 'is-running' : undefined} style={{ width: `${percent}%` }} /></div>
            <div className="remake-progress-meta">
              <small>
                {displayCompleted ? `全部完成 ${totalExperts}/${totalExperts}` : `已完成 ${completedExperts}/${totalExperts}`}
              </small>
              {allowManualSync ? (
                <Tooltip title="手动同步">
                  <button
                    aria-label="手动同步解析进度"
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
        ) : null}
        {videoUrl ? <a href={mediaUrl(videoUrl)} rel="noreferrer" target="_blank">查看视频</a> : null}
      </div>
    </ReadonlyCard>
  );
}

export function DirectorNormalizeCard(props: CardRendererProps) {
  const data = asRecord(props.card.data);
  const status = fieldText(data.status);
  const isCompleted = props.card.status === 'confirmed' || status === 'completed';
  return (
    <ReadonlyCard>
      <div className="remake-status-bubble">
        <p>{fieldText(data.message) || (isCompleted ? '视频导演已整理完成。' : '视频导演正在整理可确认设定，请稍候。')}</p>
      </div>
    </ReadonlyCard>
  );
}

export function LlmThinkingCard(props: CardRendererProps) {
  const data = asRecord(props.card.data);
  const status = fieldText(data.status);
  const message = fieldText(data.message) || fieldText(data.answer);
  const description = fieldText(data.description);
  const isIntentConfirmation = fieldText(data.kind) === 'intent_confirmation' && props.card.status === 'editing';
  const visualStatus = props.card.status === 'failed'
    ? 'failed'
    : isIntentConfirmation || props.card.status === 'pending'
      ? 'info'
      : 'success';
  const Icon = visualStatus === 'failed' ? CircleAlert : visualStatus === 'success' ? CheckCircle2 : Info;
  return (
    <ReadonlyCard>
      <div className={`remake-ai-note remake-ai-note-${visualStatus}`}>
        <span className="remake-ai-note-icon" aria-hidden="true">
          <Icon size={18} strokeWidth={2.4} />
        </span>
        <div className="remake-ai-note-copy">
          <p>{message || (status === 'thinking' || props.card.status === 'pending' ? '大模型正在理解你的需求，请稍候。' : '需要你补充更多信息。')}</p>
          {description ? <p className="remake-ai-note-description">{description}</p> : null}
        </div>
      </div>
      {isIntentConfirmation ? (
        <div className="remake-card-actions remake-intent-card-actions">
          <Button disabled={props.disabled} onClick={() => void props.onCancel()}>
            {fieldText(data.cancelText) || '取消'}
          </Button>
          <Button disabled={props.disabled} onClick={() => void props.onConfirm(data)} type="primary">
            {fieldText(data.confirmText) || '确认'}
          </Button>
        </div>
      ) : null}
    </ReadonlyCard>
  );
}
