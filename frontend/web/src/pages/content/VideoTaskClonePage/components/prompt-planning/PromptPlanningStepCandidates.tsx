import { ChevronDown, ChevronUp } from 'lucide-react';
import { WideLoadingCard } from './PromptPlanningPresentational';
import { stageItems } from './promptPlanningConfig';
import type { PromptPlanningController } from './usePromptPlanningController';
import './PromptPlanningChoiceAndBreakdownFields.scss';
import './PromptPlanningSharedFields.scss';
import './PromptPlanningStepCandidatesCards.scss';
import './PromptPlanningStepCandidatesThinking.scss';
import './PromptPlanningStepCandidates.scss';

type PromptPlanningStepCandidatesProps = {
  controller: PromptPlanningController;
};

export function PromptPlanningStepCandidates({ controller }: PromptPlanningStepCandidatesProps) {
  const {
    generateCopy,
    handleSelectCandidate,
    isEditingScript,
    isGenerating,
    isThinkingCollapsed,
    isWaitingForThinkingDelta,
    scriptEditorValue,
    selectedCandidate,
    session,
    setIsEditingScript,
    setIsScriptEdited,
    setScriptEditorValue,
    showGenerationStages,
    showReadyCandidates,
    showStep4Loading,
    showThinkingPanel,
    stageRatio,
    thinkingAutoScrollRef,
    thinkingBodyRef,
    thinkingText,
    toggleThinkingCollapsed,
  } = controller;

  if (!session) {
    return null;
  }

  return (
    <>
      {showStep4Loading ? (
        <WideLoadingCard
          description={generateCopy.description}
          progress={stageRatio}
          showStages={showGenerationStages}
          stageItems={stageItems}
          stages={session.generation.stages}
          title={generateCopy.title}
        />
      ) : null}

      {showThinkingPanel ? (
        <section className="video-task-epa-thinking-panel">
          <button
            className="video-task-epa-thinking-head"
            onClick={toggleThinkingCollapsed}
            type="button"
          >
            <div>
              <span className={`video-task-epa-thinking-dot${isGenerating ? ' is-running' : ''}`} />
              <strong>深度思考过程</strong>
            </div>
            <span>{isThinkingCollapsed ? '展开' : '收起'} {isThinkingCollapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}</span>
          </button>
          {!isThinkingCollapsed ? (
            <pre
              aria-busy={isWaitingForThinkingDelta}
              aria-live="polite"
              className="video-task-epa-thinking-body"
              onScroll={(event) => {
                const body = event.currentTarget;
                const distanceFromBottom = body.scrollHeight - body.scrollTop - body.clientHeight;
                thinkingAutoScrollRef.current = distanceFromBottom <= 24;
              }}
              ref={thinkingBodyRef}
            >
              {thinkingText}
              {isWaitingForThinkingDelta ? (
                <>
                  {'\n'}
                  <span className="video-task-epa-thinking-placeholder">
                    思考中
                    <span aria-hidden="true" className="video-task-epa-thinking-dots">
                      <i />
                      <i />
                      <i />
                    </span>
                  </span>
                </>
              ) : null}
            </pre>
          ) : null}
        </section>
      ) : null}

      {showReadyCandidates ? (
        <>
          <div className="video-task-epa-candidate-row">
            {session.generation.candidates.map((candidate, index) => {
              const isActive = candidate.id === selectedCandidate?.id;
              return (
                <button
                  className={`video-task-epa-candidate-card${isActive ? ' is-active' : ''}`}
                  key={candidate.id}
                  onClick={() => void handleSelectCandidate(candidate)}
                  type="button"
                >
                  <span className="video-task-epa-candidate-pill">脚本{index + 1}</span>
                  <strong>{candidate.title}</strong>
                  <p>{candidate.summary}</p>
                </button>
              );
            })}
          </div>

          <section className="video-task-epa-script-card">
            <div className="video-task-epa-script-head">
              <div className="video-task-epa-script-title">
                <strong>选中脚本（逐秒分镜）</strong>
                <span>点「编辑」可微调，确认后回填</span>
              </div>
              <button
                className="video-task-epa-edit-btn"
                onClick={() => setIsEditingScript((current) => !current)}
                type="button"
              >
                {isEditingScript ? '完成' : '编辑'}
              </button>
            </div>
            <textarea
              className="video-task-epa-script-editor"
              onChange={(event) => {
                setScriptEditorValue(event.currentTarget.value);
                setIsScriptEdited(true);
              }}
              readOnly={!isEditingScript}
              rows={18}
              value={scriptEditorValue}
            />
          </section>
        </>
      ) : !showStep4Loading ? (
        <div className="video-task-epa-empty-hint">脚本生成完成后，这里会展示候选脚本与逐秒分镜。</div>
      ) : null}
    </>
  );
}
