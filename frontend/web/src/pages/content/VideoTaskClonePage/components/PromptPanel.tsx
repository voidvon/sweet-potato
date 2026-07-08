import { Maximize } from 'lucide-react';
import { MentionRichTextarea } from '../../../../components/MentionRichTextarea';
import { promptPlaceholder } from '../constants';
import { promptMentionOptions } from '../promptMentionOptions';
import type { PromptPanel as PromptPanelKind, SelectedMaterials } from '../types';
import { PromptPlanningModal } from './PromptPlanningModal';

type PromptPanelProps = {
  onExampleFill: () => void;
  onExpand: () => void;
  onPanelChange: (panel: PromptPanelKind | null) => void;
  onPromptChange: (prompt: string) => void;
  panel: PromptPanelKind | null;
  prompt: string;
  selectedMaterials: SelectedMaterials;
};

export function PromptPanel({
  onExampleFill,
  onExpand,
  onPanelChange,
  onPromptChange,
  panel,
  prompt,
  selectedMaterials,
}: PromptPanelProps) {
  const openPanel = (nextPanel: PromptPanelKind) => {
    onPanelChange(panel === nextPanel ? null : nextPanel);
  };

  return (
    <section className="video-task-prompt-section">
      <div className="video-task-prompt-title">
        <h2>提示词 / 需求</h2>
      </div>

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
          kind={panel}
          onClose={() => onPanelChange(null)}
          onExampleFill={onExampleFill}
        />
      )}
    </section>
  );
}
