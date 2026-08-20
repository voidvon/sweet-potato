import { Modal } from 'antd';
import { AlertCircle, Check, X } from 'lucide-react';
import { useState } from 'react';
import type { PlanningApplyPayload } from '../../../../api/content-planning';
import type { User } from '../../../../types';
import type { PromptPanel as PromptPanelKind, SelectedMaterials } from '../types';
import { ReferenceVideoPreviewModal } from './ReferenceVideoPreviewModal';
import { TrimReferenceVideoModal } from './TrimReferenceVideoModal';
import { PromptPlanningFooter } from './prompt-planning/PromptPlanningFooter';
import { PromptPlanningStepAnalysis } from './prompt-planning/PromptPlanningStepAnalysis';
import { PromptPlanningStepCandidates } from './prompt-planning/PromptPlanningStepCandidates';
import { PromptPlanningStepMaterials } from './prompt-planning/PromptPlanningStepMaterials';
import { PromptPlanningStepSettings } from './prompt-planning/PromptPlanningStepSettings';
import { modalCopy, railSteps, videoMaterial } from './prompt-planning/promptPlanningConfig';
import { CenteredLoadingCard } from './prompt-planning/PromptPlanningPresentational';
import { usePromptPlanningController } from './prompt-planning/usePromptPlanningController';
import './PromptPlanningModalShell.scss';
import './PromptPlanningModalRail.scss';
import './PromptPlanningModalResponsive.scss';
import './PromptPlanningModalDensity.scss';
import './PromptPlanningModal.scss';
import { t } from '@shared/i18n';

type PromptPlanningModalProps = {
  currentUser: User;
  initialPrompt: string;
  initialSelectedMaterials: SelectedMaterials;
  kind: PromptPanelKind;
  onApplyPlanningResult: (payload: PlanningApplyPayload) => void;
  onClose: () => void;
};

export function PromptPlanningModal({
  currentUser,
  initialPrompt,
  initialSelectedMaterials,
  kind,
  onApplyPlanningResult,
  onClose,
}: PromptPlanningModalProps) {
  const [open, setOpen] = useState(true);
  const controller = usePromptPlanningController({
    currentUser,
    initialPrompt,
    initialSelectedMaterials,
    onApplyPlanningResult,
  });
  const copy = modalCopy[kind];

  return (
    <Modal
      afterOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onClose();
        }
      }}
      centered
      className="video-task-epa-modal"
      closable={false}
      footer={null}
      maskClosable
      onCancel={() => setOpen(false)}
      open={open}
      rootClassName="video-task-epa-modal-root"
      style={{ padding: 0 }}
      styles={{ body: { padding: 0 } }}
      title={null}
      width={980}
    >
      <section aria-labelledby="video-task-epa-title" className="video-task-epa-panel" role="dialog">
        <input
          accept="video/*"
          className="video-task-epa-native-input"
          onChange={controller.handleVideoInput}
          ref={controller.videoInputRef}
          type="file"
        />
        <input
          accept=".mp3,.wav,audio/mpeg,audio/mp3,audio/wav,audio/x-wav"
          className="video-task-epa-native-input"
          onChange={controller.handleAudioInput}
          ref={controller.audioInputRef}
          type="file"
        />

        <header className="video-task-epa-head">
          <div className="video-task-epa-head-text">
            <strong id="video-task-epa-title">{copy.title}</strong>
            <span>{copy.subtitle}</span>
          </div>
          <button aria-label={t("关闭")} className="video-task-epa-close" onClick={() => setOpen(false)} type="button">
            <X size={18} />
          </button>
        </header>

        <div className="video-task-epa-body">
          <nav aria-label={t("策划步骤")} className="video-task-epa-rail">
            {controller.railState.map((item) => (
              <button
                aria-current={item.isCurrent ? 'step' : undefined}
                className={[
                  item.isCurrent ? 'is-active' : '',
                  item.isCompleted ? 'is-completed' : '',
                ].filter(Boolean).join(' ')}
                disabled={item.isDisabled}
                key={item.step}
                onClick={() => {
                  if (!controller.session || item.isDisabled) {
                    return;
                  }
                  controller.setViewStep(item.step);
                }}
                type="button"
              >
                <span aria-hidden="true">
                  {item.isCompleted ? <Check size={18} strokeWidth={2.8} /> : item.index + 1}
                </span>
                {railSteps[item.step]}
              </button>
            ))}
          </nav>

          <main className={`video-task-epa-main video-task-epa-step-shell-${controller.activeStep}`}>
            {controller.errorMessage ? (
              <div className="video-task-epa-alert is-error">
                <AlertCircle size={16} />
                <span>{controller.errorMessage}</span>
              </div>
            ) : null}

            {controller.activeStep === 'step1' ? (
              controller.showStep1Loading ? (
                <CenteredLoadingCard
                  description={controller.analyzeCopy.description}
                  progress={controller.stageRatio}
                  title={controller.analyzeCopy.title}
                />
              ) : (
                <PromptPlanningStepMaterials controller={controller} />
              )
            ) : null}

            {controller.activeStep === 'step2' && controller.session ? (
              <PromptPlanningStepAnalysis controller={controller} />
            ) : null}

            {controller.activeStep === 'step3' && controller.session ? (
              <PromptPlanningStepSettings controller={controller} />
            ) : null}

            {controller.activeStep === 'step4' && controller.session ? (
              <PromptPlanningStepCandidates controller={controller} />
            ) : null}
          </main>

          <PromptPlanningFooter
            actionLabel={copy.action}
            controller={controller}
            onClose={() => setOpen(false)}
          />
        </div>
      </section>

      {controller.pendingTrimFile ? (
        <TrimReferenceVideoModal
          file={controller.pendingTrimFile}
          onCancel={() => {
            controller.setPendingTrimFile(null);
            controller.clearMaterial(videoMaterial);
          }}
          onConfirm={controller.handleTrimConfirmed}
        />
      ) : null}

      {controller.previewVideo ? (
        <ReferenceVideoPreviewModal
          onClose={() => controller.setPreviewVideo(null)}
          video={controller.previewVideo}
        />
      ) : null}
    </Modal>
  );
}
