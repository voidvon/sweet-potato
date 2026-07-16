import { CopyOutlined, DeleteOutlined, DownloadOutlined, EditOutlined, MoreOutlined } from '@ant-design/icons';
import { CircleAlert, Clapperboard, Filter, LoaderCircle, RefreshCcw } from 'lucide-react';
import { Button, Dropdown, Modal, message } from 'antd';
import { useState } from 'react';
import { resolveAssetUrl } from '../../../../api/request';
import { InfiniteScroll } from '../../../../components/InfiniteScroll';
import { formatRelativeCalendarDateTime } from '../../../../utils/dateTime';
import { downloadUrlAsFile } from '@shared/utils/download';
import { filterGroups } from '../constants';
import type { FilterValues } from '../types';
import type { VideoGenerationResult, VideoGenerationTask } from '../../../../types';
import { VideoAssetCover } from '../../shared/VideoAssetCover';
import { ResultVideoPreviewModal, type ResultVideoPreview } from './ResultVideoPreviewModal';

type ResultPanelProps = {
  filters: FilterValues;
  hasMore: boolean;
  isFilterOpen: boolean;
  isLoading: boolean;
  isLoadingMore: boolean;
  onClearFilters: () => void;
  onDelete: (task: VideoGenerationTask) => Promise<boolean>;
  onEdit: (task: VideoGenerationTask) => Promise<void>;
  onFilterChange: (filters: FilterValues) => void;
  onFilterOpenChange: (open: boolean) => void;
  onLoadMore: () => Promise<void>;
  onRetry: (task: VideoGenerationTask) => Promise<void>;
  records: VideoGenerationTask[];
  deletingTaskId: string;
  retryingTaskId: string;
};

export function ResultPanel({
  filters,
  hasMore,
  isFilterOpen,
  isLoading,
  isLoadingMore,
  onClearFilters,
  onDelete,
  onEdit,
  onFilterChange,
  onFilterOpenChange,
  onLoadMore,
  onRetry,
  records,
  deletingTaskId,
  retryingTaskId,
}: ResultPanelProps) {
  const [previewVideo, setPreviewVideo] = useState<ResultVideoPreview | null>(null);
  const sortedRecords = [...records].sort(
    (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
  );
  const resultGroups = groupRecordsByMetric(sortedRecords);
  const activeFilterCount = activeResultFilterCount(filters);

  const handleClearFilters = () => {
    onClearFilters();
  };

  const confirmDeleteVideo = (task: VideoGenerationTask) => {
    Modal.confirm({
      cancelText: '取消',
      centered: true,
      content: '删除后会同时移除该任务关联的成片素材，确定继续？',
      okButtonProps: { danger: true },
      okText: '删除',
      onOk: () => onDelete(task),
      title: '删除生成记录',
    });
  };

  const handleDownloadVideo = async (task: VideoGenerationTask, videoUrl: string) => {
    const normalizedUrl = String(videoUrl || '').trim();
    if (!normalizedUrl) {
      message.warning('暂无可下载的视频');
      return;
    }
    const fileName = downloadFileName(task);
    try {
      await downloadUrlAsFile(normalizedUrl, fileName);
      message.success('已开始下载');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '视频下载失败');
    }
  };

  const handleCopyTaskId = async (taskId: string) => {
    try {
      await copyText(taskId);
      message.success('ID 已复制');
    } catch {
      message.error('复制 ID 失败');
    }
  };

  const filterDropdownContent = (
    <aside className="video-task-filter-panel">
      <div className="video-task-popover-head">
        <strong>筛选生成记录</strong>
        <button onClick={handleClearFilters} type="button">清空</button>
      </div>
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
  );

  return (
    <section className="video-task-result" aria-label="视频结果">
      <header className="video-task-result-header">
        <div className="video-task-result-header-copy">
          <h1>视频结果</h1>
          <p>{sortedRecords.length > 0 ? '按时间倒序展示生成记录' : '生成完成后会显示在这里'}</p>
        </div>
        <Dropdown
          classNames={{ root: 'video-task-filter-dropdown' }}
          destroyOnHidden
          menu={{ items: [] }}
          onOpenChange={onFilterOpenChange}
          open={isFilterOpen}
          placement="bottomRight"
          popupRender={() => filterDropdownContent}
          trigger={['click']}
        >
          <button
            className={activeFilterCount > 0 ? 'video-task-filter has-filters' : 'video-task-filter'}
            type="button"
          >
            <Filter size={18} />
            筛选
            {activeFilterCount > 0 ? <span className="video-task-filter-count">{activeFilterCount}</span> : null}
          </button>
        </Dropdown>
      </header>

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
        <InfiniteScroll
          className="video-task-result-flow"
          dataLength={records.length}
          hasMore={hasMore}
          loading={isLoadingMore}
          onLoadMore={onLoadMore}
        >
          <div className="video-task-result-timeline">
            {resultGroups.map((group) => (
              <section className="video-task-result-track" key={group.key}>
                <div className="video-task-result-track-head">
                  <span className="video-task-result-chip is-metric">
                    <span className="video-task-result-metric-dot" aria-hidden="true" />
                    {viewState(group.records[0]).metric}
                  </span>
                  <span className="video-task-result-track-count">{group.records.length}个</span>
                  {group.records.length === 1 ? <span className="video-task-result-pill">{group.label}</span> : null}
                </div>

                <div className={group.records.length > 1 ? 'video-task-result-grid has-multiple' : 'video-task-result-grid'}>
                  {group.records.map((task) => {
                    const state = viewState(task);
                    const isRetrying = retryingTaskId === task.id;
                    const isDeleting = deletingTaskId === task.id;
                    return (
                      <article className={`video-task-result-card is-${state.kind}`} key={task.id}>
                        <div className="video-task-result-preview">
                          {state.videoUrl ? (
                            <button
                              className="video-task-result-thumb video-asset-cover-host"
                              onClick={() => state.previewVideo && setPreviewVideo(state.previewVideo)}
                              onMouseEnter={(event) => playMutedCardVideo(event.currentTarget)}
                              onMouseLeave={(event) => resetCardVideo(event.currentTarget)}
                              type="button"
                            >
                              <VideoAssetCover
                                fit="contain"
                                playIconSize={20}
                                poster={state.coverUrl}
                                source={null}
                                src={state.videoUrl}
                              />
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

                        {state.kind !== 'running' || group.records.length > 1 ? (
                          <div className="video-task-result-copy">
                            <div className="video-task-result-actions">
                              {group.records.length > 1 ? (
                                <div className="video-task-result-card-time">
                                  {formatRelativeCalendarDateTime(task.updatedAt)}
                                </div>
                              ) : null}
                              {state.kind !== 'running' ? (
                                <div className="video-task-result-action-row">
                                  <Button
                                    className="video-task-result-retry"
                                    color="default"
                                    disabled={isRetrying || isDeleting}
                                    icon={isRetrying ? <LoaderCircle className="is-spinning" size={14} /> : <RefreshCcw size={14} />}
                                    onClick={() => void onRetry(task)}
                                    size="small"
                                    variant="filled"
                                  >
                                    {isRetrying ? '提交中' : '再次生成'}
                                  </Button>

                                  <Dropdown
                                    overlayClassName="video-task-result-more-menu"
                                    disabled={isDeleting || isRetrying}
                                    menu={{
                                      items: [
                                        {
                                          key: 'copy-id',
                                          icon: <CopyOutlined />,
                                          label: '复制 ID',
                                          onClick: () => void handleCopyTaskId(task.id),
                                        },
                                        {
                                          key: 'edit',
                                          icon: <EditOutlined />,
                                          label: '编辑',
                                          disabled: !isEditableVideoTask(task),
                                          onClick: () => void onEdit(task),
                                        },
                                        {
                                          key: 'download',
                                          icon: <DownloadOutlined />,
                                          label: '下载',
                                          disabled: state.kind !== 'success' || !state.videoUrl,
                                          onClick: () => void handleDownloadVideo(task, state.videoUrl),
                                        },
                                        {
                                          danger: true,
                                          key: 'delete',
                                          icon: <DeleteOutlined />,
                                          label: '删除',
                                          onClick: () => confirmDeleteVideo(task),
                                        },
                                      ],
                                    }}
                                    trigger={['click']}
                                  >
                                    <Button
                                      aria-label="更多操作"
                                      className="video-task-result-more"
                                      color="default"
                                      icon={isDeleting ? <LoaderCircle className="is-spinning" size={14} /> : <MoreOutlined />}
                                      size="small"
                                      variant="filled"
                                    />
                                  </Dropdown>
                                </div>
                              ) : null}
                            </div>
                          </div>
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        </InfiniteScroll>
      )}

      {previewVideo ? (
        <ResultVideoPreviewModal
          onClose={() => setPreviewVideo(null)}
          onDelete={previewVideo.task ? () => onDelete(previewVideo.task!) : undefined}
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
  const isUpscale = task.expertContext?.mode === 'video_upscale';
  const isSubtitleRemoval = task.expertContext?.mode === 'subtitle_removal';
  const isVideoTranslation = task.expertContext?.mode === 'video_translation';
  const videoUrl = resolveTaskMediaUrl(task.generatedVideoUrl || result?.videoUrl);
  const coverUrl = resolveTaskMediaUrl(result?.coverUrl);
  const isOrphanPending = task.status !== 'generating'
    && !videoUrl
    && !String(result?.jobId || '').trim()
    && (result?.status === 'pending' || result?.renderStatus === 'queued');

  if (videoUrl) {
    return {
      kind: 'success' as const,
      label: '已完成',
      posterText: isUpscale ? '高清放大已完成' : isSubtitleRemoval ? '字幕擦除已完成' : isVideoTranslation ? '视频翻译已完成' : '成片已生成',
      note: '',
      metric: formatMetric(result, task),
      videoUrl,
      coverUrl,
      previewVideo: {
        duration: parseDurationSeconds(result?.duration),
        name: task.title,
        task,
        taskId: task.id,
        videoUrl,
      },
    };
  }
  if (task.status === 'failed' || result?.status === 'failed' || result?.renderStatus === 'failed') {
    return {
      kind: 'failed' as const,
      label: '失败',
      posterText: isUpscale ? '高清放大失败' : isSubtitleRemoval ? '字幕擦除失败' : isVideoTranslation ? '视频翻译失败' : '生成失败',
      note: result?.errorMessage || task.failureReason || '内容可能不符合平台要求，请调整参考素材后重试。',
      metric: formatMetric(result, task),
      videoUrl: '',
      coverUrl,
      previewVideo: null,
    };
  }
  if (isOrphanPending) {
    return {
      kind: 'failed' as const,
      label: '失败',
      posterText: '提交失败',
      note: '任务未成功提交到生成队列，可直接再次生成。',
      metric: formatMetric(result, task),
      videoUrl: '',
      coverUrl,
      previewVideo: null,
    };
  }
  return {
    kind: 'running' as const,
    label: result?.renderStatus === 'queued' || result?.status === 'pending' ? '排队中' : isUpscale ? '放大中' : isSubtitleRemoval ? '擦除中' : isVideoTranslation ? '翻译中' : '生成中',
    posterText: isUpscale ? '正在进行高清放大' : isSubtitleRemoval ? '正在擦除字幕' : isVideoTranslation ? '正在翻译视频' : '正在生成视频',
    note: result?.jobId ? `任务号 ${String(result.jobId).slice(0, 12)}` : '模型处理中，完成后会自动刷新。',
    metric: formatMetric(result, task),
    videoUrl: '',
    coverUrl,
    previewVideo: null,
  };
}

function resolveTaskMediaUrl(value?: string | null) {
  if (!value) {
    return '';
  }
  return resolveAssetUrl(value);
}

function formatMetric(result?: VideoGenerationResult, task?: VideoGenerationTask) {
  if (task?.expertContext?.mode === 'video_upscale') {
    const resolution = String(task.expertContext.enhancementResolution || '1080p').toUpperCase();
    return `高清放大 · ${resolution}`;
  }
  if (task?.expertContext?.mode === 'subtitle_removal') {
    const mode = String(task.expertContext.subtitleRemovalMode || 'auto');
    const label = mode === 'manual' ? 'Manual 框选' : mode === 'auto_region' ? 'Auto 指定区域' : '智能识别';
    return `字幕擦除 · ${label}`;
  }
  if (task?.expertContext?.mode === 'video_translation') {
    const source = String(task.expertContext.videoTranslationSourceLanguage || 'zh').toUpperCase();
    const target = String(task.expertContext.videoTranslationTargetLanguage || 'en').toUpperCase();
    const types = Array.isArray(task.expertContext.videoTranslationTypes)
      ? task.expertContext.videoTranslationTypes.map(String)
      : ['subtitle'];
    const level = types.includes('face') ? '面容翻译' : types.includes('voice') ? '语音翻译' : '字幕翻译';
    return `视频翻译 · ${source} → ${target} · ${level}`;
  }
  if (!result) {
    return '视频创作 · 等待参数';
  }
  const metric = [result.ratio, result.duration].filter(Boolean).join(' · ');
  return metric ? `视频创作 · ${metric}` : '视频创作 · 等待参数';
}

function parseDurationSeconds(duration?: string | null) {
  const matched = String(duration || '').match(/(\d+)/);
  return matched ? Number(matched[1]) : 0;
}

function groupRecordsByMetric(records: VideoGenerationTask[]) {
  const groups: Array<{ key: string; label: string; records: VideoGenerationTask[] }> = [];
  let previousMetricKey = '';
  records.forEach((record) => {
    const date = new Date(record.createdAt);
    const metric = formatMetric(taskVideoGenerationResult(record), record);
    const metricKey = JSON.stringify([resultModuleKey(record), metric]);
    const current = groups[groups.length - 1];
    if (current && metricKey === previousMetricKey) {
      current.records.push(record);
      return;
    }
    groups.push({
      key: record.id,
      label: formatRelativeCalendarDateTime(date),
      records: [record],
    });
    previousMetricKey = metricKey;
  });
  return groups;
}

function resultModuleKey(task: VideoGenerationTask) {
  const mode = String(task.expertContext?.mode || '').trim();
  if (!mode || mode === 'video_generation') {
    return 'video_create';
  }
  return mode;
}

function isEditableVideoTask(task: VideoGenerationTask) {
  const mode = String(task.expertContext?.mode || '').trim();
  return !mode || mode === 'video_create' || mode === 'video_generation';
}

function activeResultFilterCount(filters: FilterValues) {
  let count = 0;
  filterGroups.forEach((group) => {
    const value = String(filters[group.label] || '').trim();
    const defaultValue = group.options[0] || '';
    if (value && value !== defaultValue) {
      count += 1;
    }
  });
  return count;
}

function previewNote(note: string, kind: 'success' | 'failed' | 'running') {
  const normalized = String(note || '').trim();
  if (kind === 'failed') {
    if (/real person|真人|人物/i.test(normalized)) {
      return '内容可能涉及真人素材，请调整后重试。';
    }
    return normalized || '内容可能不符合平台要求，请调整参考素材后重试。';
  }
  if (kind === 'running') {
    return '生成完成后会自动刷新。';
  }
  return normalized;
}

function playMutedCardVideo(card: HTMLElement) {
  const video = card.querySelector('video');
  if (!video) {
    return;
  }
  video.muted = true;
  void video.play().catch(() => undefined);
}

function resetCardVideo(card: HTMLElement) {
  const video = card.querySelector('video');
  if (!video) {
    return;
  }
  video.pause();
  video.currentTime = 0;
}

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // Fall through to the DOM copy path for restricted browser contexts.
    }
  }
  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) {
    throw new Error('copy failed');
  }
}

function downloadFileName(task: VideoGenerationTask) {
  const date = new Date(task.updatedAt);
  const timestamp = Number.isNaN(date.getTime())
    ? ''
    : `${date.getFullYear()}${`${date.getMonth() + 1}`.padStart(2, '0')}${`${date.getDate()}`.padStart(2, '0')}-${`${date.getHours()}`.padStart(2, '0')}${`${date.getMinutes()}`.padStart(2, '0')}`;
  const title = String(task.title || '生成视频')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, '-')
    .slice(0, 40);
  return `${title || '生成视频'}${timestamp ? `-${timestamp}` : ''}.mp4`;
}
