import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Modal } from 'antd';
import { ModelPicker } from './components/ModelPicker';
import { PromptModal } from './components/PromptModal';
import { ToolSwitcher } from './components/ToolSwitcher';
import { ToolResultWorkspace, ToolWorkspace } from './components/ToolWorkspace';
import { toolOptions } from './constants';
import { useVideoTaskCloneState } from './useVideoTaskCloneState';
import type { ToolOption } from './types';
import type { User, VideoGenerationTask } from '../../../types';
import './VideoTaskClonePage.scss';

type VideoTaskClonePageProps = {
  currentUser: User;
};

export function VideoTaskClonePage({ currentUser }: VideoTaskClonePageProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlTool = toolOptions.find((option) => option.key === searchParams.get('tool')) ?? toolOptions[0];
  const state = useVideoTaskCloneState(currentUser, urlTool);

  useEffect(() => {
    if (state.tool.key !== urlTool.key) {
      state.chooseTool(urlTool);
    }
  }, [state.chooseTool, state.tool.key, urlTool]);

  const handleToolSelect = (tool: ToolOption) => {
    state.chooseTool(tool);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set('tool', tool.key);
      return next;
    });
  };

  const handleEditProduction = async (task: VideoGenerationTask) => {
    const applyRecordToForm = async () => {
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        next.set('tool', 'video');
        return next;
      });
      await state.editVideoProduction(task);
    };

    if (!state.hasCreationFormContent) {
      await applyRecordToForm();
      return;
    }

    Modal.confirm({
      cancelText: '取消',
      content: '当前视频创作已有内容，继续编辑将使用这条生成记录的配置覆盖现有内容。',
      okText: '覆盖并编辑',
      onOk: applyRecordToForm,
      title: '确定覆盖内容？',
    });
  };

  return (
    <div className="video-task-clone-page">
      <section className="video-task-left" aria-label="视频生成功能">
        <ToolSwitcher
          currentTool={state.tool}
          isOpen={state.showToolMenu}
          onOpenChange={state.setShowToolMenu}
          onSelect={handleToolSelect}
        />

        <ToolWorkspace state={state} />
      </section>

      <ToolResultWorkspace onEdit={handleEditProduction} state={state} />

      {state.showModelPicker && (
        <ModelPicker
          onClose={() => state.setShowModelPicker(false)}
          onSelect={state.chooseModelAsset}
          selectedModelAvatar={state.selectedModelAvatar}
          user={currentUser}
        />
      )}

      {state.expandedPrompt && (
        <PromptModal
          onClose={() => state.setExpandedPrompt(false)}
          onPromptChange={state.setPrompt}
          prompt={state.prompt}
          selectedMaterials={state.selectedMaterials}
        />
      )}
    </div>
  );
}
