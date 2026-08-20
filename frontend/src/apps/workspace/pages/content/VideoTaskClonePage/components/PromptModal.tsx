import { X } from 'lucide-react';
import { Button } from 'antd';
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { MaterialKey, SelectedMaterials } from '../types';
import { PromptMentionEditor } from './PromptMentionEditor';
import { t } from '@shared/i18n';

type PromptModalProps = {
  description?: string;
  onClose: () => void;
  onPromptChange: (prompt: string) => void;
  onPlaceholderFiles: (kind: MaterialKey, files: File[]) => void;
  placeholder?: string;
  prompt: string;
  selectedMaterials: SelectedMaterials;
  title?: string;
};

export function PromptModal({
  description = t('描述镜头、主体动作、风格和节奏，输入 @ 引用素材'),
  onClose,
  onPlaceholderFiles,
  onPromptChange,
  placeholder = t('输入提示词，可通过 @ 引用素材'),
  prompt,
  selectedMaterials,
  title = t('提示词 / 需求'),
}: PromptModalProps) {
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
            <strong>{title}</strong>
            <p>{description}</p>
          </div>
          <Button aria-label={t("关闭全屏提示词编辑器")} icon={<X size={18} />} onClick={onClose} shape="circle" type="text" />
        </div>
        <PromptMentionEditor
          minRows={10}
          onChange={onPromptChange}
          onPlaceholderFiles={onPlaceholderFiles}
          placeholder={placeholder}
          prompt={prompt}
          selectedMaterials={selectedMaterials}
          suggestionContainer=".video-task-prompt-modal"
        />
      </section>
    </div>,
    document.body,
  );
}
