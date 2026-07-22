import { Check, ChevronDown, Clock3, LoaderCircle, RefreshCw, Square, Video } from 'lucide-react';
import { Tooltip } from 'antd';
import { useEffect, useRef, useState } from 'react';
import type { VideoTaskCloneState } from '../useVideoTaskCloneState';
import type { TalkingVideoPromptTask } from '../types';
import { resolveLocalMaterialUrl } from '../materialUrl';
import { TalkingVideoPanel } from './TalkingVideoPanel';
import './TalkingVideoPromptWorkspace.scss';

export function TalkingVideoInputRail({ state }: { state: VideoTaskCloneState }) {
  if (!state.talkingVideoInputExpanded) {
    return (
      <button
        className="talking-video-input-collapsed"
        onClick={() => state.setTalkingVideoInputExpanded(true)}
        type="button"
      >
        <span>口播输入已收起</span>
        <strong>展开输入区</strong>
      </button>
    );
  }

  return (
    <div className="talking-video-input-expanded">
      <div className="talking-video-input-scroll">
        <TalkingVideoPanel
          deepThink={state.talkingVideoDeepThink}
          onDeepThinkChange={state.setTalkingVideoDeepThink}
          onImageFiles={state.fillTalkingVideoImageFiles}
          onImageRemove={state.removeTalkingVideoImage}
          onMaterialClear={state.clearMaterial}
          onMaterialLocalFiles={state.fillMaterialFiles}
          onMaterialRemoveOne={state.removeOneMaterial}
          onMaterialReplaceFiles={state.replaceMaterialFiles}
          onVideoUrlSubmit={state.resolveVideoSource}
          selectedMaterials={state.selectedMaterials}
          tool={state.tool}
        />
      </div>
      <button
        className="video-task-generate talking-video-input-generate"
        disabled={!state.canGenerate || state.isGenerating}
        onClick={() => void state.handleGenerate()}
        type="button"
      >
        {state.isGenerating ? '生成中…' : state.tool.submitText}
      </button>
    </div>
  );
}

export function TalkingVideoPromptWorkspace({ state }: { state: VideoTaskCloneState }) {
  return (
    <section className="talking-video-history" aria-label="口播提示词历史">
      <header className="talking-video-history-header">
        <span><Clock3 size={14} />最近 10 条</span>
        <small>共 {state.talkingVideoPromptTasks.length} 条</small>
      </header>
      <div className="talking-video-history-scroll">
        {state.talkingVideoPromptTasks.map((task) => (
          <TalkingVideoTaskCard
            active={task.id === state.talkingVideoPromptTask?.id}
            key={task.id}
            state={state}
            task={task}
          />
        ))}
      </div>
    </section>
  );
}

function TalkingVideoTaskCard({
  active,
  state,
  task,
}: {
  active: boolean;
  state: VideoTaskCloneState;
  task: TalkingVideoPromptTask;
}) {
  const [reasoningOpen, setReasoningOpen] = useState(task.status !== 'completed');
  const [resultOpen, setResultOpen] = useState(task.status === 'completed');
  const reasoningRef = useRef<HTMLDivElement | null>(null);
  const running = task.status === 'preparing' || task.status === 'thinking';
  const completed = task.status === 'completed';
  const retrying = state.retryingTalkingVideoTaskId === task.id;

  useEffect(() => {
    if (task.status === 'completed') {
      setReasoningOpen(false);
      setResultOpen(true);
    }
    if (running) setReasoningOpen(true);
  }, [running, task.status]);

  useEffect(() => {
    if (!reasoningOpen || !reasoningRef.current) return;
    reasoningRef.current.scrollTop = reasoningRef.current.scrollHeight;
  }, [reasoningOpen, task.reasoning]);

  return (
    <article className={`talking-video-prompt-task${active ? ' is-active' : ''}`}>
      <div className="talking-video-source-preview">
        <video controls playsInline preload="metadata" src={resolveLocalMaterialUrl(task.sourceVideo)} />
        <span className={`talking-video-task-status is-${task.status}`}>
          {running ? <LoaderCircle className="is-spinning" size={14} /> : completed ? <Check size={14} /> : null}
          {statusLabel(task.status)}
        </span>
      </div>

      <header className="talking-video-task-meta">
        <span className="talking-video-task-icon"><Video size={17} /></span>
        <div>
          <strong>{task.sourceVideo.name}</strong>
          <time>{formatTaskTime(task.createdAt)}</time>
          {/* {task.phase !== 'completed' ? (
            <small>{phaseLabel(task.phase)}{timingSummary(task)}</small>
          ) : null} */}
        </div>
        {retrying ? (
          <Tooltip title="已手动停止生成，点击重新思考">
            <span className="talking-video-task-action">
              <button className="is-continue" disabled type="button">
                <LoaderCircle className="is-spinning" size={12} />继续
              </button>
            </span>
          </Tooltip>
        ) : running ? (
          <button className="is-stop" onClick={() => void state.stopTalkingVideoPrompt(task.id)} type="button">
            <Square fill="currentColor" size={12} />停止
          </button>
        ) : task.status === 'stopped' ? (
          <Tooltip title="已手动停止生成，点击重新思考">
            <span className="talking-video-task-action">
              <button
                className="is-continue"
                disabled={state.isGenerating || !task.referenceImages.length}
                onClick={() => void state.retryTalkingVideoPromptTask(task.id)}
                type="button"
              >
                <RefreshCw size={12} />继续
              </button>
            </span>
          </Tooltip>
        ) : null}
      </header>

      {task.deepThink ? (
        <section className={`talking-video-reasoning${running ? ' is-running' : ''}`}>
          <button onClick={() => setReasoningOpen((open) => !open)} type="button">
            <span>{running ? <i /> : null}深度思考</span>
            <span>{reasoningOpen ? '收起' : '展开'}<ChevronDown className={reasoningOpen ? 'is-open' : ''} size={16} /></span>
          </button>
          {reasoningOpen ? (
            <div className="talking-video-reasoning-content" ref={reasoningRef}>
              <ReasoningContent
                content={task.reasoning || (running ? '思考中…' : '暂无思考内容')}
              />
            </div>
          ) : null}
        </section>
      ) : null}

      {completed ? (
        <section className="talking-video-final-result">
          <header>
            <button
              className="talking-video-final-result-toggle"
              onClick={() => setResultOpen((open) => !open)}
              type="button"
            >
              <strong>最终结果</strong>
              <span>{resultOpen ? '收起' : '展开'}<ChevronDown className={resultOpen ? 'is-open' : ''} size={16} /></span>
            </button>
          </header>
          {resultOpen ? <div>{task.prompt}</div> : null}
        </section>
      ) : null}

      {task.status === 'failed' ? (
        <div className="talking-video-task-error">
          <span>{task.errorMessage}</span>
          <button
            disabled={state.isGenerating || !task.referenceImages.length}
            onClick={() => void state.retryTalkingVideoPromptTask(task.id)}
            type="button"
          >
            <RefreshCw size={14} />重新生成
          </button>
        </div>
      ) : null}

      {completed ? (
        <button
          className="talking-video-open-generate"
          onClick={() => state.openTalkingVideoGeneration(task.id)}
          type="button"
        >
          生成视频
        </button>
      ) : null}
    </article>
  );
}

const reasoningSectionTitles = new Set([
  '视频内容分析：',
  '需要提取的关键信息：',
  '台词提取：',
  '分镜组织分析：',
  '素材替换与生成约束：',
  '规则复核与镜号规划：',
  '关键信息提取：',
  '台词提取与时长检查：',
  '分段与镜头规则复核：',
  '主体与素材替换判断：',
  '逐镜头方案推演：',
  '最终检查：',
  '结构化检查表：',
]);

function ReasoningContent({ content }: { content: string }) {
  return content.split('\n').map((line, index) => {
    const trimmed = line.trim();
    const markdownHeading = trimmed.match(/^\*\*(.+)\*\*$/u)?.[1];
    const heading = markdownHeading || (reasoningSectionTitles.has(trimmed) ? trimmed : '');
    return heading
      ? <strong className="talking-video-reasoning-heading" key={`${line}-${index}`}>{heading}</strong>
      : <span key={`${line}-${index}`}>{line || '\u00a0'}</span>;
  });
}

function statusLabel(status: TalkingVideoPromptTask['status']) {
  return {
    preparing: '准备素材',
    thinking: '生成中',
    completed: '已完成',
    failed: '生成失败',
    stopped: '已停止',
  }[status];
}

function phaseLabel(phase: TalkingVideoPromptTask['phase']) {
  return {
    uploading_assets: '素材上传中',
    understanding_video: '理解参考视频',
    validating_analysis: '校验结构化结果',
    generating_prompt: '整理最终提示词',
    validating_prompt: '校验最终提示词',
    repairing_prompt: '修复最终提示词',
    completed: '任务完成',
    failed: '任务失败',
    stopped: '已停止',
  }[phase];
}

function timingSummary(task: TalkingVideoPromptTask) {
  const firstPhase = task.clientTimings.firstVisiblePhaseMs ?? task.serverTimings.t_first_phase_ms;
  const firstReasoning = task.clientTimings.firstReasoningMs ?? task.serverTimings.t_first_reasoning_ms;
  const result = task.serverTimings.t_result_ms;
  const parts = [
    firstPhase !== undefined ? `首阶段 ${formatMs(firstPhase)}` : '',
    firstReasoning !== undefined ? `首思考 ${formatMs(firstReasoning)}` : '',
    result !== undefined ? `完成 ${formatMs(result)}` : '',
  ].filter(Boolean);
  return parts.length ? ` · ${parts.join(' / ')}` : '';
}

function formatMs(value: number) {
  return value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${Math.round(value)}ms`;
}

function formatTaskTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}
