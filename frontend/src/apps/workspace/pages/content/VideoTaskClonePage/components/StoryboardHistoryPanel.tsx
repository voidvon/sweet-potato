import { Button, Image, Input, Modal, Popconfirm, Popover, Spin } from 'antd';
import { ArrowLeft, Play, RefreshCw, Sparkles, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { resolveAssetUrl } from '../../../../api/request';
import type { MarketingVideoStoryboard } from '../../../../types';
import type { VideoTaskCloneState } from '../useVideoTaskCloneState';
import { ParameterPanel } from './ParameterPanel';
import { t } from '@shared/i18n';

type StoryboardHistoryPanelProps = {
  state: VideoTaskCloneState;
};

type StoryboardDisplayStatus = MarketingVideoStoryboard['status']
  | 'video-generating'
  | 'video-ready'
  | 'video-failed';

const statusLabels: Record<StoryboardDisplayStatus, string> = {
  generating: t("分镜生成中"),
  ready: t("待生成视频"),
  failed: t("生成失败"),
  'video-generating': t("视频生成中"),
  'video-ready': t("视频已生成"),
  'video-failed': t("视频生成失败"),
};

function displayStatus(task: MarketingVideoStoryboard): StoryboardDisplayStatus {
  if (!task.videoTaskId) return task.status;
  if (task.videoStatus === 'success') return 'video-ready';
  if (task.videoStatus === 'failed') return 'video-failed';
  return 'video-generating';
}

function dateGroupLabel(value: string) {
  const date = new Date(value);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return t("今天");
  return t("{{0}}月{{1}}日", { "0": date.getMonth() + 1, "1": date.getDate() });
}

export function StoryboardHistoryPanel({ state }: StoryboardHistoryPanelProps) {
  const selectedTask = state.marketingStoryboards.find(
    (task) => task.id === state.selectedMarketingStoryboardId,
  );

  return (
    <section className="video-task-storyboard-history" aria-label={t("分镜历史")}>
      {selectedTask ? (
        <StoryboardDetail
          deleting={state.deletingMarketingStoryboardId === selectedTask.id}
          onBack={() => state.setSelectedMarketingStoryboardId('')}
          onDelete={() => void state.deleteMarketingStoryboard(selectedTask.id)}
          onGenerateVideo={() => state.generateMarketingVideo(selectedTask)}
          onRetry={(optimizationInstruction) => state.retryMarketingStoryboard(selectedTask.id, optimizationInstruction)}
          generatingVideo={state.generatingMarketingVideoId === selectedTask.id}
          retrying={state.retryingMarketingStoryboardId === selectedTask.id}
          state={state}
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
          <h1>{t("分镜历史")}</h1>
          <p>{tasks.length} {t("个任务")}</p>
        </div>
      </header>

      {loading && tasks.length === 0 ? (
        <div className="video-task-storyboard-empty"><Spin /></div>
      ) : tasks.length === 0 ? (
        <div className="video-task-storyboard-empty">
          <strong>{t("暂无分镜历史")}</strong>
          <p>{t("提交营销视频任务后，可在这里查看生成的分镜。")}</p>
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
  const currentStatus = displayStatus(task);
  return (
    <div className={`video-task-storyboard-preview is-${currentStatus}`}>
      {task.imageUrl ? (
        <img alt={t("{{0}} 分镜", { "0": task.title })} src={resolveAssetUrl(task.imageUrl)} />
      ) : (
        <div className="video-task-storyboard-mini-grid" aria-hidden="true">
          {Array.from({ length: 6 }, (_, index) => <span key={index} />)}
        </div>
      )}
      <span className="video-task-storyboard-status">{statusLabels[currentStatus]}</span>
    </div>
  );
}

function StoryboardDetail({
  deleting,
  generatingVideo,
  onBack,
  onDelete,
  onGenerateVideo,
  onRetry,
  retrying,
  state,
  task,
}: {
  deleting: boolean;
  generatingVideo: boolean;
  onBack: () => void;
  onDelete: () => void;
  onGenerateVideo: () => Promise<void>;
  onRetry: (optimizationInstruction: string) => Promise<boolean>;
  retrying: boolean;
  state: VideoTaskCloneState;
  task: MarketingVideoStoryboard;
}) {
  const currentStatus = displayStatus(task);
  const videoIsActive = currentStatus === 'video-generating';
  const [retryPopoverOpen, setRetryPopoverOpen] = useState(false);
  const [optimizationInstruction, setOptimizationInstruction] = useState('');
  const confirmGenerateVideo = () => {
    Modal.confirm({
      cancelText: t("取消"),
      centered: true,
      content: (
        <p>
          {t("预计消耗")} {state.marketingVideoGenerationPriceLabel || '--'} {t("积分，当前操作不包含在本次营销视频分镜生成内。确认继续吗？")}
        </p>
      ),
      okText: t("确认生成"),
      onOk: onGenerateVideo,
      title: t("生成视频"),
    });
  };
  const submitRetry = async () => {
    const instruction = optimizationInstruction.trim();
    if (retrying) return;
    const submitted = await onRetry(instruction);
    if (!submitted) return;
    setOptimizationInstruction('');
    setRetryPopoverOpen(false);
  };
  const retryPopoverContent = (
    <form
      className="video-task-storyboard-retry-popover"
      onSubmit={(event) => {
        event.preventDefault();
        void submitRetry();
      }}
    >
      <div className="video-task-storyboard-retry-copy">
        <strong>{t("优化分镜")}</strong>
        <p>{t("可补充不满意的地方；留空则结合原商品信息、产品图和当前分镜结果直接重试。")}</p>
      </div>
      <Input.TextArea
        autoFocus
        maxLength={2000}
        onChange={(event) => setOptimizationInstruction(event.target.value)}
        placeholder={t("例如：加强产品特写，减少空镜，让画面节奏更紧凑")}
        rows={4}
        value={optimizationInstruction}
      />
      <div className="video-task-storyboard-retry-actions">
        <Button
          disabled={retrying}
          onClick={() => setRetryPopoverOpen(false)}
          type="text"
        >
          {t("取消")}
        </Button>
        <Button
          htmlType="submit"
          loading={retrying}
          type="primary"
        >
          {t("提交重试")}
        </Button>
      </div>
    </form>
  );
  return (
    <>
      <header className="video-task-result-header video-task-storyboard-detail-header">
        <Button
          aria-label={t("返回分镜历史")}
          icon={<ArrowLeft size={18} />}
          onClick={onBack}
          shape="circle"
          type="text"
        />
        <h1>{t("分镜详情")}</h1>
      </header>

      <div className="video-task-storyboard-detail">
        <div className="video-task-storyboard-detail-title">
          <h2>{task.title}</h2>
          <span className={`is-${currentStatus}`}>{statusLabels[currentStatus]}</span>
        </div>

        {task.status === 'generating' ? (
          <div className="video-task-storyboard-generating">
            <div className="video-task-storyboard-skeleton-grid">
              {Array.from({ length: 6 }, (_, index) => <span key={index} />)}
            </div>
            <strong><Sparkles size={16} />{t("正在铺排六宫格镜头...")}</strong>
          </div>
        ) : task.status === 'failed' ? (
          <div className="video-task-storyboard-failed">
            <strong>{t("分镜生成失败")}</strong>
            <p>{task.errorMessage || t("图片模型暂时不可用，请重新生成。")}</p>
          </div>
        ) : (
          <div className="video-task-storyboard-image">
            <Image
              alt={t("{{0}} 六宫格分镜", { "0": task.title })}
              preview={{ mask: t("查看大图") }}
              src={resolveAssetUrl(task.imageUrl || '')}
              style={{ display: 'block', height: '100%', objectFit: 'contain', width: '100%' }}
            />
          </div>
        )}

        {task.status === 'generating' ? (
          <p className="video-task-storyboard-progress-copy">{t("分镜生成中，请稍候")}</p>
        ) : (
          <>
            <ParameterPanel
              activeParam={state.activeParam}
              canvas={state.canvas}
              duration={state.duration}
              model={state.model}
              onCanvasQualityChoose={state.chooseCanvasQuality}
              onCanvasRatioChoose={state.chooseCanvasRatio}
              onParamChoose={state.chooseParam}
              onParamToggle={state.setActiveParam}
              quality={state.quality}
              ratio={state.ratio}
              showDuration={false}
              showHeader={false}
              showRatio={false}
              summary={state.paramSummary}
            />
            <div className="video-task-storyboard-actions">
              <Button
                disabled={task.status !== 'ready' || generatingVideo || (Boolean(task.videoTaskId) && task.videoStatus !== 'failed')}
                icon={<Play fill="currentColor" size={14} />}
                onClick={confirmGenerateVideo}
                type="primary"
              >
                {generatingVideo
                  ? t("提交中")
                  : task.videoStatus === 'failed'
                    ? t("重新生成视频")
                    : task.videoStatus === 'success'
                      ? t("视频已生成")
                      : t("生成视频")}
              </Button>
              <Popover
                arrow
                content={retryPopoverContent}
                onOpenChange={(open) => {
                  if (!retrying) setRetryPopoverOpen(open);
                }}
                open={retryPopoverOpen}
                placement="topRight"
                trigger="click"
              >
                <Button
                  color="default"
                  disabled={retrying || videoIsActive}
                  icon={<RefreshCw className={retrying ? 'is-spinning' : ''} size={14} />}
                  variant="filled"
                >
                  {retrying ? t("提交中") : t("重试分镜")}
                </Button>
              </Popover>
              <Popconfirm
                cancelText={t("取消")}
                description={t("删除后将无法恢复，已生成的视频结果不会被删除。")}
                okButtonProps={{ danger: true, loading: deleting }}
                okText={t("确认删除")}
                onConfirm={onDelete}
                title={t("确定删除这条分镜任务？")}
              >
                <Button
                  aria-label={t("删除分镜任务")}
                  danger
                  disabled={deleting}
                  icon={<Trash2 size={14} />}
                  type="text"
                />
              </Popconfirm>
            </div>
          </>
        )}
      </div>
    </>
  );
}
