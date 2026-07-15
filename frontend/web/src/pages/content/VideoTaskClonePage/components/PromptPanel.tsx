import { Maximize } from 'lucide-react';
import { MentionRichTextarea } from '../../../../components/MentionRichTextarea';
import { promptPlaceholder } from '../constants';
import { promptMentionOptions } from '../promptMentionOptions';
import type { PromptPanel as PromptPanelKind, SelectedMaterials } from '../types';
import type { User } from '../../../../types';
import type { PlanningApplyPayload } from '../../../../api/content-planning';
import { PromptPlanningModal } from './PromptPlanningModal';
import { WorkspaceSection } from './WorkspaceSection';

type PromptPanelProps = {
  currentUser: User;
  onExpand: () => void;
  onPlanningApply: (payload: PlanningApplyPayload) => void;
  onPanelChange: (panel: PromptPanelKind | null) => void;
  onPromptChange: (prompt: string) => void;
  panel: PromptPanelKind | null;
  prompt: string;
  selectedMaterials: SelectedMaterials;
  title?: string;
};

export function PromptPanel({
  currentUser,
  onExpand,
  onPlanningApply,
  onPanelChange,
  onPromptChange,
  panel,
  prompt,
  selectedMaterials,
  title = '提示词 / 需求',
}: PromptPanelProps) {
  const openPanel = (nextPanel: PromptPanelKind) => {
    onPanelChange(panel === nextPanel ? null : nextPanel);
  };

  return (
    <WorkspaceSection className="video-task-prompt-section" title={title} variant="plain">
      <div className="video-task-prompt-box">
        <MentionRichTextarea
          minRows={4}
          onChange={onPromptChange}
          options={promptMentionOptions(selectedMaterials)}
          placeholder={promptPlaceholder}
          suggestionContainer="body"
          value={prompt}
        />
        <button aria-label="展开提示词编辑器" title='展开提示词编辑器' className="video-task-expand" onClick={onExpand} type="button">
          <Maximize size={18} />
        </button>
        <button className="video-task-one-click" onClick={() => openPanel('write')} type="button">
          <span className="video-task-one-click-spark">✨</span>
          一键策划
        </button>
      </div>

      {panel && (
        <PromptPlanningModal
          currentUser={currentUser}
          initialPrompt={prompt}
          initialSelectedMaterials={selectedMaterials}
          kind={panel}
          onApplyPlanningResult={onPlanningApply}
          onClose={() => onPanelChange(null)}
        />
      )}
    </WorkspaceSection>
  );
}
