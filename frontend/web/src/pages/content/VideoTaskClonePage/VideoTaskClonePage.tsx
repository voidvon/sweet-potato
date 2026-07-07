import { MaterialPanel } from './components/MaterialPanel';
import { ModelPicker } from './components/ModelPicker';
import { ParameterPanel } from './components/ParameterPanel';
import { PromptModal } from './components/PromptModal';
import { PromptPanel } from './components/PromptPanel';
import { ResultPanel } from './components/ResultPanel';
import { ToolSwitcher } from './components/ToolSwitcher';
import { useVideoTaskCloneState } from './useVideoTaskCloneState';
import './VideoTaskClonePage.scss';

export function VideoTaskClonePage() {
  const state = useVideoTaskCloneState();

  return (
    <div className="video-task-clone-page">
      <section className="video-task-left" aria-label="视频生成功能">
        <ToolSwitcher
          currentTool={state.tool}
          isOpen={state.showToolMenu}
          onSelect={state.chooseTool}
          onToggle={() => state.setShowToolMenu(!state.showToolMenu)}
        />

        <div className="video-task-left-scroll">
          <MaterialPanel
            activeUpload={state.activeUpload}
            materialMode={state.materialMode}
            onAudioChoose={state.chooseAudio}
            onClosePopovers={state.closeMaterialPopovers}
            onMaterialClear={state.clearMaterial}
            onMaterialRemoveOne={state.removeOneMaterial}
            onMaterialsClearAll={state.clearAllMaterials}
            onMaterialFill={state.fillMaterial}
            onTabChange={state.chooseMaterialTab}
            onUploadClose={() => state.setActiveUpload(null)}
            onUploadOpen={state.setActiveUploadWithAnchor}
            onVoiceChange={state.setVoiceEnabled}
            selectedMaterials={state.selectedMaterials}
            tool={state.tool}
            uploadAnchor={state.uploadAnchor}
            voiceEnabled={state.voiceEnabled}
          />

          <PromptPanel
            onExampleFill={state.fillExamplePrompt}
            onExpand={() => state.setExpandedPrompt(true)}
            onPanelChange={state.setPromptPanel}
            onPromptChange={state.setPrompt}
            panel={state.promptPanel}
            prompt={state.prompt}
            selectedMaterials={state.selectedMaterials}
          />

          <ParameterPanel
            activeParam={state.activeParam}
            canvas={state.canvas}
            duration={state.duration}
            model={state.model}
            onCanvasQualityChoose={state.chooseCanvasQuality}
            onCanvasRatioChoose={state.chooseCanvasRatio}
            onParamChoose={state.chooseParam}
            onParamToggle={state.setActiveParam}
            quality={state.quality}
            ratio={state.ratio}
            summary={state.paramSummary}
          />
        </div>

        <div className="video-task-generate-bar">
          <button className="video-task-generate" disabled={!state.canGenerate} type="button">
            {state.tool.submitText}
          </button>
        </div>
      </section>

      <ResultPanel
        filters={state.filters}
        isFilterOpen={state.filterOpen}
        onClearFilters={state.clearFilters}
        onFilterChange={state.setFilters}
        onFilterToggle={() => state.setFilterOpen(!state.filterOpen)}
      />

      {state.showModelPicker && (
        <ModelPicker
          onClose={() => state.setShowModelPicker(false)}
          onSelect={state.chooseModelAvatar}
          selectedModelAvatar={state.selectedModelAvatar}
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
