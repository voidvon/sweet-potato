import { Button } from 'antd';
import {
  AlertCircle,
  LoaderCircle,
  Minus,
  Plus,
  RefreshCcw,
  Trash2,
  Zap,
} from 'lucide-react';
import type { PromptPlanningController } from './usePromptPlanningController';

type PromptPlanningFooterProps = {
  actionLabel: string;
  controller: PromptPlanningController;
  onClose: () => void;
};

export function PromptPlanningFooter({
  actionLabel,
  controller,
  onClose,
}: PromptPlanningFooterProps) {
  const {
    activeStep,
    analysisCreditLabel,
    analysisCredits,
    analysisDirty,
    clearAll,
    footerPoints,
    generationCreditLabel,
    generationCredits,
    handleAnalyze,
    handleApply,
    handleConfirmAnalysis,
    handleGenerate,
    imageFiles,
    isAnalyzing,
    isBusy,
    isGenerating,
    isManualPresetMissing,
    canApply,
    session,
    setSettingsDraft,
    setViewStep,
    settingsDraft,
  } = controller;

  return (
    <footer className="video-task-epa-footer">
      <div className="video-task-epa-footer-left">
        <Button danger disabled={isBusy} onClick={clearAll}>
          <Trash2 size={15} />
          清除
        </Button>
        {footerPoints !== null ? (
          <span className="video-task-epa-points">
            <Zap size={14} />
            {footerPoints}
          </span>
        ) : null}
      </div>

      <div className="video-task-epa-footer-right">
        {activeStep === 'step1' ? (
          <>
            <Button className="video-task-epa-btn-text" onClick={onClose} type="text">
              取消
            </Button>
            <button
              className="video-task-epa-btn video-task-epa-btn-accent"
              disabled={analysisCredits === null || isAnalyzing || isBusy || imageFiles.length === 0}
              onClick={() => void handleAnalyze()}
              type="button"
            >
              {isAnalyzing || isGenerating ? <LoaderCircle className="is-spinning" size={16} /> : null}
              {isGenerating ? '生成中...' : isAnalyzing ? '分析中...' : `${actionLabel}${analysisCreditLabel}`}
            </button>
          </>
        ) : null}

        {activeStep === 'step2' ? (
          <>
            <button
              className="video-task-epa-btn video-task-epa-btn-secondary"
              disabled={analysisCredits === null || isBusy}
              onClick={() => void handleAnalyze()}
              type="button"
            >
              {controller.activeStep === 'step2' && controller.isAnalyzing ? <LoaderCircle className="is-spinning" size={16} /> : <RefreshCcw size={15} />}
              {`重新识别${analysisCreditLabel}`}
            </button>
            <button
              className="video-task-epa-btn video-task-epa-btn-accent"
              disabled={isBusy}
              onClick={() => {
                if (session?.status === 'confirming' || analysisDirty) {
                  void handleConfirmAnalysis();
                  return;
                }
                setViewStep('step3');
              }}
              type="button"
            >
              {isGenerating ? <LoaderCircle className="is-spinning" size={16} /> : null}
              {isGenerating ? '生成中...' : '下一步'}
            </button>
          </>
        ) : null}

        {activeStep === 'step3' ? (
          <>
            <Button className="video-task-epa-btn-text" onClick={() => setViewStep('step2')} type="text">
              返回上一步
            </Button>
            {isManualPresetMissing ? (
              <span className="video-task-epa-footer-warning">
                <AlertCircle aria-hidden="true" size={14} />
                请先选择内容类型、拍摄方式
              </span>
            ) : null}
            <div className="video-task-epa-stepper">
              <button
                aria-label="减少候选数量"
                className="video-task-epa-stepper-btn"
                disabled={isBusy || settingsDraft.candidateCount <= 1}
                onClick={() => setSettingsDraft((current) => ({
                  ...current,
                  candidateCount: Math.max(1, current.candidateCount - 1),
                }))}
                type="button"
              >
                <Minus size={12} />
              </button>
              <span>{settingsDraft.candidateCount} 条</span>
              <button
                aria-label="增加候选数量"
                className="video-task-epa-stepper-btn"
                disabled={isBusy || settingsDraft.candidateCount >= 3}
                onClick={() => setSettingsDraft((current) => ({
                  ...current,
                  candidateCount: Math.min(3, current.candidateCount + 1),
                }))}
                type="button"
              >
                <Plus size={12} />
              </button>
            </div>
            <button
              className="video-task-epa-btn video-task-epa-btn-accent"
              disabled={generationCredits === null || isBusy || isManualPresetMissing}
              onClick={() => void handleGenerate()}
              type="button"
            >
              {isGenerating ? <LoaderCircle className="is-spinning" size={16} /> : null}
              {isGenerating ? '生成中...' : `生成脚本${generationCreditLabel}`}
            </button>
          </>
        ) : null}

        {activeStep === 'step4' ? (
          <>
            <Button className="video-task-epa-btn-text" onClick={() => setViewStep('step3')} type="text">
              返回上一步
            </Button>
            <button
              className="video-task-epa-btn video-task-epa-btn-secondary"
              disabled={generationCredits === null || isBusy || !session || session.status === 'generating'}
              onClick={() => void handleGenerate(true)}
              type="button"
            >
              {isGenerating ? <LoaderCircle className="is-spinning" size={16} /> : <RefreshCcw size={15} />}
              {isGenerating ? '生成中...' : `重新生成${generationCreditLabel}`}
            </button>
            <button
              className="video-task-epa-btn video-task-epa-btn-accent"
              disabled={isBusy || !canApply}
              onClick={() => void handleApply()}
              type="button"
            >
              {controller.isBusy && controller.activeStep === 'step4' && controller.session?.status !== 'generating' ? <LoaderCircle className="is-spinning" size={16} /> : null}
              应用到视频 →
            </button>
          </>
        ) : null}
      </div>
    </footer>
  );
}
