import { Image, Spin, message } from 'antd';
import { ArrowLeft, Layers3, Play, RefreshCw, Sparkles } from 'lucide-react';
import { resolveAssetUrl } from '../../../../api/request';
import type { MarketingVideoStoryboard } from '../../../../types';
import type { VideoTaskCloneState } from '../useVideoTaskCloneState';

type StoryboardHistoryPanelProps = {
  state: VideoTaskCloneState;
};

const statusLabels: Record<MarketingVideoStoryboard['status'], string> = {
  generating: '分镜生成中',
  ready: '待生成视频',
  failed: '生成失败',
};

function dateGroupLabel(value: string) {
  const date = new Date(value);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return '今天';
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

export function StoryboardHistoryPanel({ state }: StoryboardHistoryPanelProps) {
  const selectedTask = state.marketingStoryboards.find(
    (task) => task.id === state.selectedMarketingStoryboardId,
  );

  return (
    <section className="video-task-storyboard-history" aria-label="分镜历史">
      {selectedTask ? (
        <StoryboardDetail
          model={state.model}
          onBack={() => state.setSelectedMarketingStoryboardId('')}
          onRetry={() => void state.retryMarketingStoryboard(selectedTask.id)}
          quality={state.quality}
          retrying={state.retryingMarketingStoryboardId === selectedTask.id}
          task={selectedTask}
        />
      ) : (
        <StoryboardList
          loading={state.isLoadingMarketingStoryboards}
          onSelect={state.setSelectedMarketingStoryboardId}
          tasks={state.marketingStoryboards}
        />
      )}
    </section>
  );
}

function StoryboardList({
  loading,
  onSelect,
  tasks,
}: {
  loading: boolean;
  onSelect: (id: string) => void;
  tasks: MarketingVideoStoryboard[];
}) {
  const groups = tasks.reduce<Array<{ label: string; tasks: MarketingVideoStoryboard[] }>>((result, task) => {
    const label = dateGroupLabel(task.createdAt);
    const current = result[result.length - 1];
    if (current?.label === label) current.tasks.push(task);
    else result.push({ label, tasks: [task] });
    return result;
  }, []);

  return (
    <>
      <header className="video-task-result-header video-task-storyboard-header">
        <div className="video-task-result-header-copy">
          <h1>分镜历史</h1>
          <p>{tasks.length} 个任务</p>
        </div>
      </header>

      {loading && tasks.length === 0 ? (
        <div className="video-task-storyboard-empty"><Spin /></div>
      ) : tasks.length === 0 ? (
        <div className="video-task-storyboard-empty">
          <strong>暂无分镜历史</strong>
          <p>提交营销视频任务后，可在这里查看生成的分镜。</p>
        </div>
      ) : (
        <div className="video-task-storyboard-list">
          {groups.map((group) => (
            <section className="video-task-storyboard-group" key={group.label}>
              <h2>{group.label}</h2>
              {group.tasks.map((task) => (
                <button
                  className="video-task-storyboard-card"
                  key={task.id}
                  onClick={() => onSelect(task.id)}
                  type="button"
                >
                  <StoryboardPreview task={task} />
                  <strong>{task.title}</strong>
                </button>
              ))}
            </section>
          ))}
        </div>
      )}
    </>
  );
}

function StoryboardPreview({ task }: { task: MarketingVideoStoryboard }) {
  return (
    <div className={`video-task-storyboard-preview is-${task.status}`}>
      {task.imageUrl ? (
        <img alt={`${task.title} 分镜`} src={resolveAssetUrl(task.imageUrl)} />
      ) : (
        <div className="video-task-storyboard-mini-grid" aria-hidden="true">
          {Array.from({ length: 6 }, (_, index) => <span key={index} />)}
        </div>
      )}
      <span className="video-task-storyboard-status">{statusLabels[task.status]}</span>
    </div>
  );
}

function StoryboardDetail({
  model,
  onBack,
  onRetry,
  quality,
  retrying,
  task,
}: {
  model: string;
  onBack: () => void;
  onRetry: () => void;
  quality: string;
  retrying: boolean;
  task: MarketingVideoStoryboard;
}) {
  return (
    <>
      <header className="video-task-result-header video-task-storyboard-detail-header">
        <button aria-label="返回分镜历史" onClick={onBack} type="button">
          <ArrowLeft size={18} />
        </button>
        <div className="video-task-result-header-copy">
          <h1>分镜详情</h1>
          <p>{statusLabels[task.status]}</p>
        </div>
      </header>

      <div className="video-task-storyboard-detail">
        <div className="video-task-storyboard-detail-title">
          <h2>{task.title}</h2>
          <span className={`is-${task.status}`}>{statusLabels[task.status]}</span>
        </div>

        {task.status === 'generating' ? (
          <div className="video-task-storyboard-generating">
            <div className="video-task-storyboard-skeleton-grid">
              {Array.from({ length: 6 }, (_, index) => <span key={index} />)}
            </div>
            <strong><Sparkles size={16} />正在铺排六宫格镜头...</strong>
          </div>
        ) : task.status === 'failed' ? (
          <div className="video-task-storyboard-failed">
            <strong>分镜生成失败</strong>
            <p>{task.errorMessage || '图片模型暂时不可用，请重新生成。'}</p>
          </div>
        ) : (
          <div className="video-task-storyboard-image">
            <Image
              alt={`${task.title} 六宫格分镜`}
              preview={{ mask: '查看大图' }}
              src={resolveAssetUrl(task.imageUrl || '')}
            />
          </div>
        )}

        {task.status === 'generating' ? (
          <p className="video-task-storyboard-progress-copy">分镜生成中，请稍候</p>
        ) : (
          <>
            <div className="video-task-storyboard-video-options">
              <div><Layers3 size={18} /><span>模型<strong>{model}</strong></span></div>
              <div><span className="video-task-storyboard-quality-icon">Q</span><span>清晰度<strong>{quality}</strong></span></div>
            </div>
            <div className="video-task-storyboard-actions">
              <button
                className="is-primary"
                disabled={task.status !== 'ready'}
                onClick={() => message.info('营销视频生成将在下一步接入')}
                type="button"
              >
                <Play fill="currentColor" size={16} />生成视频
              </button>
              <button disabled={retrying} onClick={onRetry} type="button">
                <RefreshCw className={retrying ? 'is-spinning' : ''} size={16} />
                {retrying ? '提交中' : '重试分镜'}
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
