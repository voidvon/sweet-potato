import { X } from 'lucide-react';
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { MentionRichTextarea } from '../../../../components/MentionRichTextarea';
import { promptMentionOptions } from '../promptMentionOptions';
import type { SelectedMaterials } from '../types';

type PromptModalProps = {
  onClose: () => void;
  onPromptChange: (prompt: string) => void;
  prompt: string;
  selectedMaterials: SelectedMaterials;
};

export function PromptModal({ onClose, onPromptChange, prompt, selectedMaterials }: PromptModalProps) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return createPortal(
    <div className="video-task-prompt-modal">
      <section>
        <div className="video-task-model-head">
          <div>
            <strong>提示词 / 需求</strong>
            <p>描述镜头、主体动作、风格和节奏，输入 @ 引用素材</p>
          </div>
          <button onClick={onClose} type="button"><X size={18} /></button>
        </div>
        <MentionRichTextarea
          minRows={10}
          onChange={onPromptChange}
          options={promptMentionOptions(selectedMaterials)}
          placeholder="输入提示词，可通过 @ 引用素材"
          suggestionContainer=".video-task-prompt-modal"
          value={prompt}
        />
      </section>
    </div>,
    document.body,
  );
}
