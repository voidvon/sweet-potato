import { CircleAlert, Clapperboard, Filter, LoaderCircle, Play, RefreshCcw, Search, Zap } from 'lucide-react';
import { message } from 'antd';
import { useState } from 'react';
import { resolveAssetUrl } from '../../../../api/request';
import { formatRelativeCalendarDateTime } from '../../../../utils/dateTime';
import { filterGroups } from '../constants';
import type { FilterValues } from '../types';
import type { VideoGenerationResult, VideoGenerationTask } from '../../../../types';
import { ReferenceVideoPreviewModal } from './ReferenceVideoPreviewModal';
import type { ConfirmedReferenceVideo } from './ReferenceVideoCard';

type ResultPanelProps = {
  filters: FilterValues;
  isFilterOpen: boolean;
  isLoading: boolean;
  onClearFilters: () => void;
  onFilterChange: (filters: FilterValues) => void;
  onFilterToggle: () => void;
  onRetry: (task: VideoGenerationTask) => Promise<void>;
  records: VideoGenerationTask[];
  retryingTaskId: string;
};

export function ResultPanel({
  filters,
  isFilterOpen,
  isLoading,
  onClearFilters,
  onFilterChange,
  onFilterToggle,
  onRetry,
  records,
  retryingTaskId,
}: ResultPanelProps) {
  const [previewVideo, setPreviewVideo] = useState<ConfirmedReferenceVideo | null>(null);
  const sortedRecords = [...records].sort(
    (left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
  );
  const dailyGroups = groupRecordsByDay(sortedRecords);
  const handleCopyId = async (value: string) => {
    const normalized = String(value || '').trim();
    if (!normalized) {
      message.warning('暂无可复制的ID');
      return;
    }
    try {
      await navigator.clipboard.writeText(normalized);
      message.success('已复制ID');
    } catch {
      message.error('复制失败，请稍后重试');
    }
  };

  return (
    <section className="video-task-result" aria-label="视频结果">
      <header className="video-task-result-header">
        <div className="video-task-result-header-copy">
          <h1>视频结果</h1>
          <p>{sortedRecords.length > 0 ? '按时间倒序展示生成记录' : '生成完成后会显示在这里'}</p>
        </div>
        <button className="video-task-filter" onClick={onFilterToggle} type="button">
          <Filter size={18} />
          筛选
        </button>
      </header>

      {isFilterOpen && (
        <aside className="video-task-filter-panel">
          <div className="video-task-popover-head">
            <strong>筛选生成记录</strong>
            <button onClick={onClearFilters} type="button">清空</button>
          </div>
          <label className="video-task-search">
            <Search size={16} />
            <input
              onChange={(event) => onFilterChange({ ...filters, 搜索: event.target.value })}
              placeholder="搜索"
              value={filters.搜索 || ''}
            />
          </label>
          {filterGroups.map((group) => (
            <div className="video-task-filter-group" key={group.label}>
              <span>{group.label}</span>
              <div>
                {group.options.map((option) => (
                  <button
                    className={filters[group.label] === option ? 'is-active' : ''}
                    key={option}
                    onClick={() => onFilterChange({ ...filters, [group.label]: option })}
                    type="button"
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </aside>
      )}

      {isLoading && sortedRecords.length === 0 ? (
        <div className="video-task-empty-state">
          <div className="video-task-empty-icon">
            <LoaderCircle className="is-spinning" size={27} />
          </div>
          <strong>正在加载生成记录</strong>
          <p>请稍候，系统正在同步视频生成状态。</p>
        </div>
      ) : sortedRecords.length === 0 ? (
        <div className="video-task-empty-state">
          <div className="video-task-empty-icon">
            <Clapperboard size={27} />
          </div>
          <strong>暂无视频结果</strong>
          <p>左侧提交任务后，结果会显示在这里。</p>
        </div>
      ) : (
        <div className="video-task-result-flow">
          <div className="video-task-result-timeline">
            {dailyGroups.map((group) => (
              <section className="video-task-result-track" key={group.key}>
                <div className="video-task-result-track-head">
                  <span className="video-task-result-pill">{group.label}</span>
                  <span className="video-task-result-track-count">{group.records.length}个</span>
                </div>

                <div className="video-task-result-grid">
                  {group.records.map((task) => {
                    const state = viewState(task);
                    const isRetrying = retryingTaskId === task.id;
                    return (
                      <article className={`video-task-result-card is-${state.kind}`} key={task.id}>
                        <div className="video-task-result-preview">
                          {state.videoUrl ? (
                            <button
                              className="video-task-result-thumb"
                              onClick={() => state.previewVideo && setPreviewVideo(state.previewVideo)}
                              type="button"
                            >
                              <video muted playsInline poster={state.coverUrl || undefined} preload="metadata" src={state.videoUrl} />
                              <span className="video-task-result-play">
                                <Play size={20} fill="currentColor" />
                              </span>
                            </button>
                          ) : state.kind === 'failed' || state.kind === 'running' ? (
                            <div className={`video-task-result-placeholder is-${state.kind}`} title={state.note || state.posterText}>
                              {state.kind === 'failed' ? <CircleAlert size={26} /> : <LoaderCircle className="is-spinning" size={24} />}
                              <strong>{state.posterText}</strong>
                              {state.note ? <p>{previewNote(state.note, state.kind)}</p> : null}
                            </div>
                          ) : state.coverUrl ? (
                            <img alt={task.title} src={state.coverUrl} />
                          ) : (
                            <div className={`video-task-result-placeholder is-${state.kind}`} title={state.note || state.posterText}>
                              <Clapperboard size={24} />
                              <strong>{state.posterText}</strong>
                              {state.note ? <p>{previewNote(state.note, state.kind)}</p> : null}
                            </div>
                          )}
                        </div>

                        <div className="video-task-result-copy">
                          <div className="video-task-result-copy-meta">
                            <button
                              className="video-task-result-chip is-copy"
                              onClick={() => void handleCopyId(state.copyId)}
                              type="button"
                            >
                              复制ID
                            </button>
                            <span className="video-task-result-copy-dot">·</span>
                            <span className="video-task-result-chip is-metric">
                              <Zap size={11} />
                              {state.metric}
                            </span>
                          </div>

                          <time className="video-task-result-time" dateTime={task.updatedAt}>
                            {formatRelativeCalendarDateTime(task.updatedAt)}
                          </time>

                          <div className="video-task-result-actions">
                            {state.canRetry ? (
                              <button
                                className="video-task-result-retry"
                                disabled={isRetrying}
                                onClick={() => void onRetry(task)}
                                type="button"
                              >
                                {isRetrying ? <LoaderCircle className="is-spinning" size={14} /> : <RefreshCcw size={14} />}
                                {isRetrying ? '提交中' : '再次生成'}
                              </button>
                            ) : (
                              <div className={`video-task-result-footnote is-${state.kind}`}>{state.footnote}</div>
                            )}
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        </div>
      )}

      {previewVideo ? (
        <ReferenceVideoPreviewModal
          onClose={() => setPreviewVideo(null)}
          video={previewVideo}
        />
      ) : null}
    </section>
  );
}

function taskVideoGenerationResult(task: VideoGenerationTask) {
  const result = task.editableParseResult.videoGenerationResult;
  if (result) {
    return result;
  }
  const contextResult = task.expertContext?.videoGenerationResult;
  if (contextResult && typeof contextResult === 'object' && !Array.isArray(contextResult)) {
    return contextResult as VideoGenerationResult;
  }
  return undefined;
}

function viewState(task: VideoGenerationTask) {
  const result = taskVideoGenerationResult(task);
  const videoUrl = resolveTaskMediaUrl(task.generatedVideoUrl || result?.videoUrl);
  const coverUrl = resolveTaskMediaUrl(result?.coverUrl);
  const copyId = String(result?.jobId || task.id || '').trim();
  const isOrphanPending = task.status !== 'generating'
    && !videoUrl
    && !String(result?.jobId || '').trim()
    && (result?.status === 'pending' || result?.renderStatus === 'queued');

  if (videoUrl) {
    return {
      kind: 'success' as const,
      label: '已完成',
      posterText: '成片已生成',
      note: '',
      footnote: '成片已落盘，可继续筛选和复用。',
      metric: formatMetric(result),
      copyId,
      videoUrl,
      coverUrl,
      canRetry: true,
      previewVideo: {
        duration: parseDurationSeconds(result?.duration),
        end: parseDurationSeconds(result?.duration),
        fileUrl: videoUrl,
        name: task.title,
        start: 0,
        storedFileName: task.title,
        videoUrl,
      },
    };
  }
  if (task.status === 'failed' || result?.status === 'failed' || result?.renderStatus === 'failed') {
    return {
      kind: 'failed' as const,
      label: '失败',
      posterText: '生成失败',
      note: result?.errorMessage || task.failureReason || '内容可能不符合平台要求，请调整参考素材后重试。',
      footnote: '当前任务失败，可直接重试。',
      metric: formatMetric(result),
      copyId,
      videoUrl: '',
      coverUrl,
      canRetry: true,
      previewVideo: null,
    };
  }
  if (isOrphanPending) {
    return {
      kind: 'failed' as const,
      label: '失败',
      posterText: '提交失败',
      note: '任务未成功提交到生成队列，可直接再次生成。',
      footnote: '当前任务未真正开始生成，可直接重试。',
      metric: formatMetric(result),
      copyId,
      videoUrl: '',
      coverUrl,
      canRetry: true,
      previewVideo: null,
    };
  }
  return {
    kind: 'running' as const,
    label: result?.renderStatus === 'queued' || result?.status === 'pending' ? '排队中' : '生成中',
    posterText: '正在生成视频',
    note: result?.jobId ? `任务号 ${String(result.jobId).slice(0, 12)}` : '模型处理中，完成后会自动刷新。',
    footnote: '系统会自动刷新当前生成状态。',
    metric: formatMetric(result),
    copyId,
    videoUrl: '',
    coverUrl,
    canRetry: false,
    previewVideo: null,
  };
}

function resolveTaskMediaUrl(value?: string | null) {
  if (!value) {
    return '';
  }
  return resolveAssetUrl(value);
}

function formatMetric(result?: VideoGenerationResult) {
  if (!result) {
    return '等待参数';
  }
  return [result.ratio, result.duration].filter(Boolean).join(' · ') || '等待参数';
}

function parseDurationSeconds(duration?: string | null) {
  const matched = String(duration || '').match(/(\d+)/);
  return matched ? Number(matched[1]) : 0;
}

function groupRecordsByDay(records: VideoGenerationTask[]) {
  const groups = new Map<string, { key: string; label: string; records: VideoGenerationTask[] }>();
  records.forEach((record) => {
    const date = new Date(record.updatedAt);
    const key = Number.isNaN(date.getTime()) ? 'unknown' : formatDayKey(date);
    const current = groups.get(key);
    if (current) {
      current.records.push(record);
      return;
    }
    groups.set(key, {
      key,
      label: formatDayLabel(date),
      records: [record],
    });
  });
  return Array.from(groups.values());
}

function formatDayKey(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDayLabel(date: Date) {
  if (Number.isNaN(date.getTime())) {
    return '未知时间';
  }
  const now = new Date();
  const currentDayKey = formatDayKey(now);
  const previousDay = new Date(now);
  previousDay.setDate(now.getDate() - 1);
  const targetKey = formatDayKey(date);
  if (targetKey === currentDayKey) {
    return '今天';
  }
  if (targetKey === formatDayKey(previousDay)) {
    return '昨天';
  }
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function previewNote(note: string, kind: 'success' | 'failed' | 'running') {
  const normalized = String(note || '').trim();
  if (!normalized) {
    return '';
  }
  if (kind === 'failed') {
    if (/real person|真人|人物/i.test(normalized)) {
      return '内容可能涉及真人素材，请调整后重试。';
    }
    return '内容审查未通过，请调整素材后重试。';
  }
  if (kind === 'running') {
    return '生成完成后会自动刷新。';
  }
  return normalized;
}
