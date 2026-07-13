import { Clock3 } from 'lucide-react';
import type { VideoTaskCloneState } from '../useVideoTaskCloneState';
import { MaterialPanel } from './MaterialPanel';
import { ParameterPanel } from './ParameterPanel';
import { PromptPanel } from './PromptPanel';
import { ResultPanel } from './ResultPanel';
import { SubtitleRemovalPanel } from './SubtitleRemovalPanel';
import { toolIcons } from './ToolSwitcher';

type ToolWorkspaceProps = {
  state: VideoTaskCloneState;
};

export function ToolWorkspace({ state }: ToolWorkspaceProps) {
  const { workspace } = state.tool;
  const hasWorkspaceContent = Boolean(workspace.material || workspace.prompt || workspace.parameters);

  return (
    <>
      {hasWorkspaceContent ? (
        <div className="video-task-left-scroll">
          {workspace.material && (
            <ToolMaterialPanel
              showVoiceToggle={workspace.material.showVoiceToggle === true}
              state={state}
            />
          )}

          {workspace.subtitleRemoval && (
            <SubtitleRemovalPanel
              config={state.subtitleRemovalConfig}
              onChange={state.setSubtitleRemovalConfig}
              selectedMaterials={state.selectedMaterials}
            />
          )}

          {workspace.prompt && (
            <PromptPanel
              onExampleFill={state.fillExamplePrompt}
              onExpand={() => state.setExpandedPrompt(true)}
              onPanelChange={state.setPromptPanel}
              onPromptChange={state.setPrompt}
              panel={state.promptPanel}
              prompt={state.prompt}
              selectedMaterials={state.selectedMaterials}
            />
          )}

          {workspace.parameters && (
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
          )}
        </div>
      ) : (
        <PendingToolWorkspace state={state} />
      )}

      <div className="video-task-generate-bar">
        <button
          className="video-task-generate"
          disabled={!state.canGenerate || state.isGenerating}
          onClick={() => void state.handleGenerate()}
          type="button"
        >
          {state.tool.submitText}
        </button>
      </div>
    </>
  );
}

export function ToolResultWorkspace({ state }: Pick<ToolWorkspaceProps, 'state'>) {
  return (
    <ResultPanel
      filters={state.filters}
      isFilterOpen={state.filterOpen}
      isLoading={state.isLoadingProductions}
      onClearFilters={state.clearFilters}
      onDelete={state.deleteVideoProduction}
      onFilterChange={state.setFilters}
      onFilterToggle={() => state.setFilterOpen(!state.filterOpen)}
      onRetry={state.retryVideoProduction}
      records={state.videoProductions}
      deletingTaskId={state.deletingTaskId}
      retryingTaskId={state.retryingTaskId}
    />
  );
}

function ToolMaterialPanel({ showVoiceToggle, state }: ToolWorkspaceProps & { showVoiceToggle: boolean }) {
  return (
    <MaterialPanel
      activeUpload={state.activeUpload}
      materialMode={state.materialMode}
      onLibraryAssetChoose={state.chooseLibraryAsset}
      onClosePopovers={state.closeMaterialPopovers}
      onMaterialClear={state.clearMaterial}
      onMaterialLocalFiles={state.fillMaterialFiles}
      onMaterialRemoveOne={state.removeOneMaterial}
      onMaterialReplaceFiles={state.replaceMaterialFiles}
      onModelPickerOpen={state.openModelPicker}
      onMaterialsClearAll={state.clearAllMaterials}
      onMaterialFill={state.fillMaterial}
      onTabChange={state.chooseMaterialTab}
      onUploadClose={() => state.setActiveUpload(null)}
      onUploadOpen={state.setActiveUploadWithAnchor}
      onVoiceChange={state.setVoiceEnabled}
      onWorksTabChange={state.setWorksTab}
      selectedMaterials={state.selectedMaterials}
      voiceAssets={state.voiceAssets}
      voiceGroupNameById={state.voiceGroupNameById}
      isLoadingLibraryAssets={state.isLoadingLibraryAssets}
      tool={state.tool}
      uploadAnchor={state.uploadAnchor}
      voiceEnabled={state.voiceEnabled}
      showVoiceToggle={showVoiceToggle}
      worksAssets={state.worksAssets}
      worksTab={state.worksTab}
    />
  );
}

function PendingToolWorkspace({ state }: Pick<ToolWorkspaceProps, 'state'>) {
  const ToolIcon = toolIcons[state.tool.key];

  return (
    <div className="video-task-tool-workspace">
      <section className="video-task-tool-pending">
        <span className="video-task-tool-pending-icon">
          <ToolIcon size={26} />
        </span>
        <strong>{state.tool.label}</strong>
        <p>{state.tool.description}</p>
        <span className="video-task-tool-pending-status">
          <Clock3 size={13} />
          功能模块待接入
        </span>
      </section>
    </div>
  );
}
