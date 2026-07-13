import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ModelPicker } from './components/ModelPicker';
import { PromptModal } from './components/PromptModal';
import { ToolSwitcher } from './components/ToolSwitcher';
import { ToolResultWorkspace, ToolWorkspace } from './components/ToolWorkspace';
import { toolOptions } from './constants';
import { useVideoTaskCloneState } from './useVideoTaskCloneState';
import type { ToolOption } from './types';
import type { User } from '../../../types';
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

  return (
    <div className="video-task-clone-page">
      <section className="video-task-left" aria-label="视频生成功能">
        <ToolSwitcher
          currentTool={state.tool}
          isOpen={state.showToolMenu}
          onOpenChange={state.setShowToolMenu}
          onSelect={handleToolSelect}
        />

        <ToolWorkspace currentUser={currentUser} state={state} />
      </section>

      <ToolResultWorkspace state={state} />

      {state.tool.key === 'video' && state.showModelPicker && (
        <ModelPicker
          onClose={() => state.setShowModelPicker(false)}
          onSelect={state.chooseModelAsset}
          selectedModelAvatar={state.selectedModelAvatar}
          user={currentUser}
        />
      )}

      {state.tool.key === 'video' && state.expandedPrompt && (
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
