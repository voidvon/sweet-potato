import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Modal } from 'antd';
import { ModelPicker } from './components/ModelPicker';
import { PromptModal } from './components/PromptModal';
import { ToolSwitcher } from './components/ToolSwitcher';
import { StoryboardHistoryPanel } from './components/StoryboardHistoryPanel';
import { TalkingVideoGenerationModal } from './components/TalkingVideoGenerationModal';
import { TalkingVideoInputRail, TalkingVideoPromptWorkspace } from './components/TalkingVideoPromptWorkspace';
import { ToolResultWorkspace, ToolWorkspace } from './components/ToolWorkspace';
import { toolOptions } from './constants';
import { useVideoTaskCloneState } from './useVideoTaskCloneState';
import type { ToolOption } from './types';
import type { User, VideoGenerationTask } from '../../../types';
import './VideoTaskClonePage.scss';
import { t } from '@shared/i18n';

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
      cancelText: t("取消"),
      content: t("当前视频创作已有内容，继续编辑将使用这条生成记录的配置覆盖现有内容。"),
      okText: t("覆盖并编辑"),
      onOk: applyRecordToForm,
      title: t("确定覆盖内容？"),
    });
  };

  const pageClassName = [
    'video-task-clone-page',
    state.tool.key === 'lightweight-marketing-video' ? 'is-lightweight-marketing-video' : '',
    state.tool.key === 'talking-video' ? 'is-talking-video' : '',
    state.tool.key === 'marketing-video' ? 'has-storyboard-history' : '',
    state.tool.key === 'talking-video' && state.talkingVideoPromptTask ? 'has-talking-video-prompt' : '',
    state.tool.key === 'talking-video' && state.talkingVideoPromptTask && state.talkingVideoInputExpanded
      ? 'has-talking-video-input-expanded'
      : '',
  ].filter(Boolean).join(' ');
  const showTalkingVideoHistory = state.tool.key === 'talking-video' && Boolean(state.talkingVideoPromptTask);

  return (
    <div className={pageClassName}>
      <section className="video-task-left" aria-label={t("视频生成功能")}>
        <ToolSwitcher
          currentTool={state.tool}
          isOpen={state.showToolMenu}
          onOpenChange={state.setShowToolMenu}
          onSelect={handleToolSelect}
        />

        {showTalkingVideoHistory ? <TalkingVideoInputRail state={state} /> : <ToolWorkspace state={state} />}
      </section>

      {state.tool.key === 'marketing-video' ? <StoryboardHistoryPanel state={state} /> : null}
      {showTalkingVideoHistory ? <TalkingVideoPromptWorkspace state={state} /> : null}

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
          description={state.tool.key === 'marketing-video'
            ? t("补充生成或解析方向，输入 @ 引用商品素材")
            : undefined}
          onClose={() => state.setExpandedPrompt(false)}
          onPlaceholderFiles={state.fillMentionPlaceholderFiles}
          onPromptChange={state.setPrompt}
          placeholder={state.tool.key === 'marketing-video'
            ? t("补充你希望生成或解析的方向，输入 @ 引用素材")
            : undefined}
          prompt={state.prompt}
          selectedMaterials={state.selectedMaterials}
          title={state.tool.key === 'marketing-video' ? t("提示词 / 要求") : undefined}
        />
      )}

      {state.talkingVideoPromptTask ? (
        <TalkingVideoGenerationModal key={state.talkingVideoPromptTask.id} state={state} />
      ) : null}
    </div>
  );
}
