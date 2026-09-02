import { Clock3 } from 'lucide-react';
import { Button } from 'antd';
import { Fragment } from 'react';
import type { ReactNode } from 'react';
import { CreditIcon } from '@shared/components/CreditIcon';
import type { VideoTaskCloneState } from '../useVideoTaskCloneState';
import type { WorkspaceBlock, WorkspaceBlockType } from '../types';
import type { VideoGenerationTask } from '../../../../types';
import { MaterialPanel } from './MaterialPanel';
import { DanceRemakePanel } from './DanceRemakePanel';
import { MarketingVideoPanel } from './MarketingVideoPanel';
import { LightweightMarketingVideoPanel } from './LightweightMarketingVideoPanel';
import type { LightweightMarketingVideoController } from './LightweightMarketingVideoPanel';
import { ParameterPanel } from './ParameterPanel';
import { PromptPanel } from './PromptPanel';
import { ResultPanel } from './ResultPanel';
import { SubtitleRemovalPanel } from './SubtitleRemovalPanel';
import { TalkingVideoPanel } from './TalkingVideoPanel';
import { SubjectReplacePanel } from './SubjectReplacePanel';
import { toolIcons } from './ToolSwitcher';
import { VideoTranslationPanel } from './VideoTranslationPanel';
import { t } from '@shared/i18n';

type ToolWorkspaceProps = {
  lightweightMarketing: LightweightMarketingVideoController;
  state: VideoTaskCloneState;
};

export function ToolWorkspace({ lightweightMarketing, state }: ToolWorkspaceProps) {
  const { workspace } = state.tool;
  const hasWorkspaceContent = workspace.blocks.length > 0;
  const hasLocalWorkflow = state.tool.key === 'lightweight-marketing-video';
  return (
    <>
      {hasWorkspaceContent ? (
        <div className="video-task-left-scroll">
          {workspace.blocks.map((block) => (
            <Fragment key={block.id}>{workspaceBlockRenderers[block.type](block, state, lightweightMarketing)}</Fragment>
          ))}
        </div>
      ) : (
        <PendingToolWorkspace state={state} />
      )}

      {hasLocalWorkflow ? (
        <div className="video-task-generate-bar lightweight-video-generate-bar">
          {lightweightMarketing.createError ? (
            <p className="lightweight-video-generate-error">{lightweightMarketing.createError}</p>
          ) : null}
          <Button
            className="video-task-generate"
            disabled={!lightweightMarketing.canCreateRecord}
            loading={Boolean(lightweightMarketing.creatingRecordId)}
            onClick={() => void lightweightMarketing.createRecord()}
            type="primary"
          >
            {lightweightMarketing.creatingRecordId ? t('解析中…') : t('开始解析')}
          </Button>
        </div>
      ) : <div className="video-task-generate-bar">
        <Button
          className="video-task-generate"
          disabled={!state.canGenerate || state.isGenerating}
          loading={state.isGenerating}
          onClick={() => void state.handleGenerate()}
          type="primary"
        >
          {state.isGenerating ? t("生成中…") : state.tool.submitText}
          {state.canGenerate && !state.isGenerating && state.videoPriceLabel ? (
            <span className="video-task-generate-price">
              <CreditIcon />
              {state.videoPriceLabel}
            </span>
          ) : null}
        </Button>
      </div>}
    </>
  );
}

type WorkspaceBlockRenderer = (
  block: WorkspaceBlock,
  state: VideoTaskCloneState,
  lightweightMarketing: LightweightMarketingVideoController,
) => ReactNode;

const workspaceBlockRenderers: Record<WorkspaceBlockType, WorkspaceBlockRenderer> = {
  'lightweight-marketing-video-form': (block, _state, lightweightMarketing) => block.type === 'lightweight-marketing-video-form' ? (
    <LightweightMarketingVideoPanel controller={lightweightMarketing} />
  ) : null,
  material: (block, state) => block.type === 'material' ? (
    <ToolMaterialPanel showVoiceToggle={block.showVoiceToggle === true} state={state} />
  ) : null,
  'talking-video-form': (block, state) => block.type === 'talking-video-form' ? (
    <TalkingVideoPanel
      deepThink={state.talkingVideoDeepThink}
      onDeepThinkChange={state.setTalkingVideoDeepThink}
      onImageFiles={state.fillTalkingVideoImageFiles}
      onImageRemove={state.removeTalkingVideoImage}
      onMaterialClear={state.clearMaterial}
      onMaterialLocalFiles={state.fillMaterialFiles}
      onMaterialRemoveOne={state.removeOneMaterial}
      onMaterialReplaceFiles={state.replaceMaterialFiles}
      onVideoUrlSubmit={state.resolveVideoSource}
      selectedMaterials={state.selectedMaterials}
      tool={state.tool}
    />
  ) : null,
  'dance-remake-form': (block, state) => block.type === 'dance-remake-form' ? (
    <DanceRemakePanel
      mode={state.danceRemakeMode}
      onMaterialClear={state.clearMaterial}
      onMaterialLocalFiles={state.fillMaterialFiles}
      onMaterialRemoveOne={state.removeOneMaterial}
      onMaterialReplaceFiles={state.replaceMaterialFiles}
      onModeChange={state.setDanceRemakeMode}
      onVideoUrlSubmit={state.resolveVideoSource}
      onVoiceChange={state.setVoiceEnabled}
      selectedMaterials={state.selectedMaterials}
      tool={state.tool}
      voiceEnabled={state.voiceEnabled}
    />
  ) : null,
  'subject-replace-form': (block, state) => block.type === 'subject-replace-form' ? (
    <SubjectReplacePanel state={state} />
  ) : null,
  parameters: (block, state) => block.type === 'parameters'
    && !(state.tool.key === 'dance-remake' && state.danceRemakeMode === 'standard') ? (
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
      showDuration={block.showDuration}
      showHeader={block.showHeader}
      showRatio={block.showRatio}
      summary={state.paramSummary}
    />
  ) : null,
  prompt: (block, state) => block.type === 'prompt' ? (
    <PromptPanel
      currentUser={state.currentUser}
      onPlanningApply={state.applyPlanningResult}
      onExpand={() => state.setExpandedPrompt(true)}
      onPanelChange={state.setPromptPanel}
      onPlaceholderFiles={state.fillMentionPlaceholderFiles}
      onPromptChange={state.setPrompt}
      panel={state.promptPanel}
      prompt={state.prompt}
      selectedMaterials={state.selectedMaterials}
      title={block.title}
    />
  ) : null,
  'marketing-video-form': (block, state) => block.type === 'marketing-video-form' ? (
    <MarketingVideoPanel
      config={state.marketingVideoConfig}
      currentUser={state.currentUser}
      onChange={state.setMarketingVideoConfig}
      onExpand={() => state.setExpandedPrompt(true)}
      onPlanningApply={state.applyPlanningResult}
      onPanelChange={state.setPromptPanel}
      onPlaceholderFiles={state.fillMentionPlaceholderFiles}
      onPromptChange={state.setPrompt}
      panel={state.promptPanel}
      prompt={state.prompt}
      selectedMaterials={state.selectedMaterials}
    />
  ) : null,
  'subtitle-removal': (block, state) => block.type === 'subtitle-removal' ? (
    <SubtitleRemovalPanel
      config={state.subtitleRemovalConfig}
      onChange={state.setSubtitleRemovalConfig}
      selectedMaterials={state.selectedMaterials}
    />
  ) : null,
  'video-translation': (block, state) => block.type === 'video-translation' ? (
    <VideoTranslationPanel
      config={state.videoTranslationConfig}
      onChange={state.setVideoTranslationConfig}
      selectedMaterials={state.selectedMaterials}
    />
  ) : null,
};

export function ToolResultWorkspace({
  lightweightMarketing,
  onEdit,
  state,
}: ToolWorkspaceProps & { onEdit: (task: VideoGenerationTask) => Promise<void> }) {
  const activeLightweightRenders = state.tool.key === 'lightweight-marketing-video'
    ? lightweightMarketing.records.flatMap(lightweightRenderResultTask)
    : [];
  return (
    <ResultPanel
      filters={state.filters}
      hasMore={state.hasMoreVideoProductions}
      isFilterOpen={state.filterOpen}
      isLoading={state.isLoadingProductions}
      isLoadingMore={state.isLoadingMoreProductions}
      onClearFilters={state.clearFilters}
      onDelete={state.deleteVideoProduction}
      onEdit={onEdit}
      onFilterChange={state.setFilters}
      onFilterOpenChange={state.setFilterOpen}
      onLoadMore={state.loadMoreVideoProductions}
      onRetry={state.retryVideoProduction}
      records={[...activeLightweightRenders, ...state.videoProductions]}
      deletingTaskId={state.deletingTaskId}
      retryingTaskId={state.retryingTaskId}
    />
  );
}

const emptyVideoParseResult = {
  person: '',
  scene: '',
  voice: '',
  shotLanguage: '',
  product: '',
  pip: '',
  spokenContent: '',
  extraDetails: '',
};

function lightweightRenderResultTask(
  record: LightweightMarketingVideoController['records'][number],
): VideoGenerationTask[] {
  const session = record.analysisSession;
  const render = session?.analysis.renderGeneration;
  if (!session || !render || (render.status !== 'queued' && render.status !== 'rendering')) return [];
  const taskId = `lightweight-render-${render.runId || session.id}`;
  const timestamp = render.startedAt || render.updatedAt || record.createdAt;
  return [{
    id: taskId,
    userId: session.userId,
    sourceUrl: '',
    title: record.title,
    status: 'generating',
    rawParseResult: { ...emptyVideoParseResult },
    editableParseResult: {
      ...emptyVideoParseResult,
      videoGenerationResult: {
        version: 1,
        taskId,
        status: render.status === 'queued' ? 'pending' : 'running',
        provider: 'remotion',
        jobId: render.pluginJobId,
        duration: '',
        ratio: '',
        renderStatus: render.status,
        generatedAt: timestamp,
      },
    },
    expertContext: {
      mode: 'lightweight_marketing_video',
      renderProgress: render.progress,
    },
    aspectRatio: '',
    createdAt: timestamp,
    updatedAt: render.updatedAt || timestamp,
  }];
}

function ToolMaterialPanel({ showVoiceToggle, state }: Pick<ToolWorkspaceProps, 'state'> & { showVoiceToggle: boolean }) {
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
          {t("功能模块待接入")}
        </span>
      </section>
    </div>
  );
}
