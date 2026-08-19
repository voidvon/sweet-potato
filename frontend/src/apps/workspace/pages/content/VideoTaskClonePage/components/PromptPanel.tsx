import { Maximize } from 'lucide-react';
import { Button } from 'antd';
import { promptPlaceholder } from '../constants';
import type { MaterialKey, PromptPanel as PromptPanelKind, SelectedMaterials } from '../types';
import type { User } from '../../../../types';
import type { PlanningApplyPayload } from '../../../../api/content-planning';
import { PromptPlanningModal } from './PromptPlanningModal';
import { PromptMentionEditor } from './PromptMentionEditor';
import { WorkspaceSection } from './WorkspaceSection';

type PromptPanelProps = {
  currentUser: User;
  onExpand: () => void;
  onPlanningApply: (payload: PlanningApplyPayload) => void;
  onPanelChange: (panel: PromptPanelKind | null) => void;
  onPlaceholderFiles: (kind: MaterialKey, files: File[]) => void;
  onPromptChange: (prompt: string) => void;
  panel: PromptPanelKind | null;
  placeholder?: string;
  prompt: string;
  selectedMaterials: SelectedMaterials;
  showPlanning?: boolean;
  title?: string;
};

export function PromptPanel({
  currentUser,
  onExpand,
  onPlanningApply,
  onPanelChange,
  onPlaceholderFiles,
  onPromptChange,
  panel,
  placeholder = promptPlaceholder,
  prompt,
  selectedMaterials,
  showPlanning = true,
  title = '提示词 / 需求',
}: PromptPanelProps) {
  const openPanel = (nextPanel: PromptPanelKind) => {
    onPanelChange(panel === nextPanel ? null : nextPanel);
  };

  return (
    <WorkspaceSection className="video-task-prompt-section" title={title} variant="plain">
      <div className="video-task-prompt-box">
        <PromptMentionEditor
          minRows={4}
          onChange={onPromptChange}
          onPlaceholderFiles={onPlaceholderFiles}
          placeholder={placeholder}
          prompt={prompt}
          selectedMaterials={selectedMaterials}
          suggestionContainer="body"
        />
        <Button
          aria-label="展开提示词编辑器"
          className="video-task-expand"
          icon={<Maximize size={18} />}
          onClick={onExpand}
          shape="circle"
          title="展开提示词编辑器"
          type="text"
        />
        {showPlanning ? (
          <button className="video-task-one-click" onClick={() => openPanel('write')} type="button">
            <span className="video-task-one-click-spark">✨</span>
            一键策划
          </button>
        ) : null}
      </div>

      {showPlanning && panel && (
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
