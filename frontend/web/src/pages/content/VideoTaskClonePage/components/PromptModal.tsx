import { X } from 'lucide-react';
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { MaterialKey, SelectedMaterials } from '../types';
import { PromptMentionEditor } from './PromptMentionEditor';

type PromptModalProps = {
  onClose: () => void;
  onPromptChange: (prompt: string) => void;
  onPlaceholderFiles: (kind: MaterialKey, files: File[]) => void;
  prompt: string;
  selectedMaterials: SelectedMaterials;
};

export function PromptModal({ onClose, onPlaceholderFiles, onPromptChange, prompt, selectedMaterials }: PromptModalProps) {
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
        <PromptMentionEditor
          minRows={10}
          onChange={onPromptChange}
          onPlaceholderFiles={onPlaceholderFiles}
          placeholder="输入提示词，可通过 @ 引用素材"
          prompt={prompt}
          selectedMaterials={selectedMaterials}
          suggestionContainer=".video-task-prompt-modal"
        />
      </section>
    </div>,
    document.body,
  );
}
