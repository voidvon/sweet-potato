import { Button, Modal, Select, Spin } from 'antd';
import {
  ArrowLeft,
  BrainCircuit,
  Braces,
  Clapperboard,
  FileSearch,
  Image as ImageIcon,
  Mic2,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { t } from '@shared/i18n';
import { AppNumberInput } from '@shared/components/AppNumberInput';
import { resolveAssetUrl } from '../../../../api/request';
import { AttachmentExtractionModal } from './AttachmentExtractionModal';
import type {
  LightweightCreationRecord,
  LightweightMarketingVideoController,
} from './LightweightMarketingVideoPanel';

type WorkflowStage = {
  action: string;
  description: string;
  icon: LucideIcon;
  title: string;
};

const workflowStages: WorkflowStage[] = [
  {
    action: t('开始分析'),
    description: t('结合参考附件和营销需求，提取内容摘要、卖点、受众与视觉方向。'),
    icon: BrainCircuit,
    title: t('AI 内容分析'),
  },
  {
    action: t('生成图片'),
    description: t('根据分析结果生成宣传主视觉，并选择需要写入视频的图片。'),
    icon: ImageIcon,
    title: t('宣传图片'),
  },
  {
    action: t('生成旁白与字幕'),
    description: t('生成场景旁白、字幕和时间轴信息，并支持后续试听与调整。'),
    icon: Mic2,
    title: t('旁白与字幕'),
  },
  {
    action: t('生成 JSON'),
    description: t('汇总场景、素材、旁白和字幕，生成可交给 Remotion 的结构化 JSON。'),
    icon: Braces,
    title: t('Remotion JSON'),
  },
  {
    action: t('渲染视频'),
    description: t('将最终 JSON 提交给视频插件渲染，并在右侧查看生成结果。'),
    icon: Clapperboard,
    title: t('视频渲染'),
  },
];

const recordStatusLabels: Record<LightweightCreationRecord['status'], string> = {
  uploading: t('附件上传中'),
  parsing: t('附件解析中'),
  completed: t('解析完成'),
  failed: t('解析失败'),
};

export function LightweightCreationHistoryPanel({
  controller,
}: {
  controller: LightweightMarketingVideoController;
}) {
  const [showExtractionModal, setShowExtractionModal] = useState(false);
  const record = controller.selectedRecord;
  return (
    <section className="video-task-storyboard-history lightweight-creation-history" aria-label={t('创作记录')}>
      {record ? (
        <CreationRecordDetail
          controller={controller}
          onShowExtraction={() => setShowExtractionModal(true)}
          record={record}
        />
      ) : (
        <CreationRecordList controller={controller} />
      )}

      <AttachmentExtractionModal
        items={record?.documentExtractions || []}
        onClose={() => setShowExtractionModal(false)}
        open={showExtractionModal && Boolean(record)}
      />
    </section>
  );
}

function CreationRecordList({ controller }: { controller: LightweightMarketingVideoController }) {
  return (
    <>
      <header className="video-task-result-header video-task-storyboard-header lightweight-creation-header">
        <div className="video-task-result-header-copy">
          <h1>{t('创作记录')}</h1>
          <p>{t('{{0}} 个任务', { '0': controller.records.length })}</p>
        </div>
      </header>
      {controller.records.length === 0 ? (
        <div className="lightweight-creation-empty">
          <span><FileSearch size={22} /></span>
          <strong>{t('暂无创作记录')}</strong>
          <p>{t('上传文档并开始解析后，将在这里创建一条新的创作记录。')}</p>
        </div>
      ) : (
        <div className="lightweight-creation-list">
          {controller.records.map((record) => (
            <button key={record.id} onClick={() => controller.setSelectedRecordId(record.id)} type="button">
              <span className={`lightweight-creation-list-icon is-${record.status}`}>
                {record.status === 'uploading' || record.status === 'parsing'
                  ? <Spin size="small" />
                  : <FileSearch size={17} />}
              </span>
              <span className="lightweight-creation-list-copy">
                <strong>{record.title}</strong>
                <small>{formatRecordDate(record.createdAt)}</small>
              </span>
              <span className={`lightweight-creation-status is-${record.status}`}>{recordStatusLabels[record.status]}</span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

function CreationRecordDetail({
  controller,
  onShowExtraction,
  record,
}: {
  controller: LightweightMarketingVideoController;
  onShowExtraction: () => void;
  record: LightweightCreationRecord;
}) {
  const isParsing = record.status === 'uploading' || record.status === 'parsing';
  const [showAnalysisModal, setShowAnalysisModal] = useState(false);
  const [showCampaignImagesModal, setShowCampaignImagesModal] = useState(false);
  const [showNarrationModal, setShowNarrationModal] = useState(false);
  const [showRemotionJSONModal, setShowRemotionJSONModal] = useState(false);
  return (
    <>
      <header className="video-task-result-header video-task-storyboard-detail-header lightweight-creation-detail-header">
        <Button
          aria-label={t('返回创作记录')}
          icon={<ArrowLeft size={18} />}
          onClick={() => controller.setSelectedRecordId('')}
          shape="circle"
          type="text"
        />
        <h1>{t('创作详情')}</h1>
      </header>

      <div className="lightweight-creation-detail">
        <div className="lightweight-creation-detail-title">
          <div>
            <h2>{record.title}</h2>
            <p>{record.attachments.length} {t('个附件')}</p>
          </div>
          <span className={`lightweight-creation-status is-${record.status}`}>{recordStatusLabels[record.status]}</span>
        </div>

        {isParsing ? (
          <div className="lightweight-creation-loading">
            <Spin size="large" />
            <strong>{record.status === 'uploading' ? t('正在上传参考附件') : t('正在解析文档内容')}</strong>
            <p>{t('正在提取逐页文案和图片，完成后将自动显示后续生成流程。')}</p>
          </div>
        ) : record.status === 'failed' ? (
          <div className="lightweight-creation-failed">
            <strong>{t('附件解析失败')}</strong>
            <p>{record.extractionError || t('解析服务暂时不可用，请重新发起任务。')}</p>
          </div>
        ) : (
          <>
            <div className="lightweight-creation-extraction-summary">
              <span><FileSearch size={17} /></span>
              <div>
                <strong>{t('附件解析已完成')}</strong>
                <p>{t('已完成 {{0}} 份文档的文案与图片提取。', { '0': record.documentExtractions.length })}</p>
              </div>
              <Button onClick={onShowExtraction} size="small">{t('查看解析结果')}</Button>
            </div>
            <div className="lightweight-video-stage-list">
              {workflowStages.map((stage, index) => (
                <CreationWorkflowStage
                  controller={controller}
                  index={index + 3}
                  key={stage.title}
                  onShowAnalysis={() => setShowAnalysisModal(true)}
                  onShowCampaignImages={() => setShowCampaignImagesModal(true)}
                  onShowNarration={() => setShowNarrationModal(true)}
                  onShowRemotionJSON={() => setShowRemotionJSONModal(true)}
                  record={record}
                  stage={stage}
                />
              ))}
            </div>
            {record.analysisError ? (
              <p className="lightweight-video-analysis-error">{record.analysisError}</p>
            ) : null}
            <Modal
              centered
              className="lightweight-video-analysis-modal"
              footer={null}
              onCancel={() => setShowAnalysisModal(false)}
              open={showAnalysisModal}
              title={t('AI 内容分析结果')}
              width={900}
            >
              <AnalysisResult record={record} />
            </Modal>
            <Modal
              centered
              className="lightweight-campaign-images-modal"
              footer={null}
              onCancel={() => setShowCampaignImagesModal(false)}
              open={showCampaignImagesModal}
              title={t('宣传图片')}
              width={900}
            >
              <CampaignImageResults record={record} />
            </Modal>
            <Modal
              centered
              className="lightweight-narration-modal"
              footer={null}
              onCancel={() => setShowNarrationModal(false)}
              open={showNarrationModal}
              title={t('旁白与字幕')}
              width={980}
            >
              <NarrationResults record={record} />
            </Modal>
            <Modal
              centered
              className="lightweight-remotion-json-modal"
              footer={null}
              onCancel={() => setShowRemotionJSONModal(false)}
              open={showRemotionJSONModal}
              title={t('Remotion JSON')}
              width={1040}
            >
              <RemotionJSONResult record={record} />
            </Modal>
          </>
        )}
      </div>
    </>
  );
}

function CreationWorkflowStage({
  controller,
  index,
  onShowAnalysis,
  onShowCampaignImages,
  onShowNarration,
  onShowRemotionJSON,
  record,
  stage,
}: {
  controller: LightweightMarketingVideoController;
  index: number;
  onShowAnalysis: () => void;
  onShowCampaignImages: () => void;
  onShowNarration: () => void;
  onShowRemotionJSON: () => void;
  record: LightweightCreationRecord;
  stage: WorkflowStage;
}) {
  const StageIcon = stage.icon;
  const isAnalysis = index === 3;
  const isCampaignImages = index === 4;
  const isNarration = index === 5;
  const isRemotionJSON = index === 6;
  const isRender = index === 7;
  const analyzing = record.analysisSession?.status === 'analyzing';
  const analysisCompleted = record.analysisSession?.status === 'confirming';
  const analysisFailed = record.analysisSession?.status === 'failed';
  const campaignImageGeneration = record.analysisSession?.analysis.campaignImageGeneration;
  const campaignImagesGenerating = campaignImageGeneration?.status === 'generating';
  const campaignImagesCompleted = campaignImageGeneration?.status === 'completed';
  const campaignImagesFailed = campaignImageGeneration?.status === 'failed';
  const narrationGeneration = record.analysisSession?.analysis.narrationGeneration;
  const narrationGenerating = narrationGeneration?.status === 'generating';
  const narrationCompleted = narrationGeneration?.status === 'completed';
  const narrationFailed = narrationGeneration?.status === 'failed';
  const remotionGeneration = record.analysisSession?.analysis.remotionGeneration;
  const remotionCompleted = remotionGeneration?.status === 'completed';
  const remotionFailed = remotionGeneration?.status === 'failed';
  const remotionGenerating = controller.generatingRemotionRecordId === record.id;
  const renderGeneration = record.analysisSession?.analysis.renderGeneration;
  const renderActive = renderGeneration?.status === 'queued' || renderGeneration?.status === 'rendering';
  const renderCompleted = renderGeneration?.status === 'completed';
  const renderFailed = renderGeneration?.status === 'failed';
  const renderCancelled = renderGeneration?.status === 'cancelled';
  const renderSubmitting = controller.submittingRenderRecordId === record.id;
  const status = isAnalysis
    ? analysisCompleted
      ? t('已完成')
      : analyzing
        ? t('分析中')
        : analysisFailed
          ? t('失败')
          : t('等待开始')
    : isCampaignImages
      ? campaignImagesCompleted
        ? t('已完成')
        : campaignImagesGenerating
          ? t('生成中')
          : campaignImagesFailed
            ? t('失败')
            : analysisCompleted
              ? t('等待开始')
              : t('等待分析')
    : isNarration
      ? narrationCompleted
        ? t('已完成')
        : narrationGenerating
          ? t('生成中')
          : narrationFailed
            ? t('失败')
            : analysisCompleted
              ? t('等待开始')
              : t('等待分析')
      : isRemotionJSON
        ? remotionCompleted
          ? t('已完成')
          : remotionGenerating
            ? t('生成中')
            : remotionFailed
              ? t('失败')
              : narrationCompleted && campaignImagesCompleted
                ? t('等待开始')
                : t('等待素材')
        : isRender
          ? renderCompleted
            ? t('已完成')
            : renderGeneration?.status === 'rendering'
              ? t('渲染中 {{0}}%', { '0': Math.round((renderGeneration.progress || 0) * 100) })
              : renderGeneration?.status === 'queued'
                ? t('排队中')
                : renderFailed
                  ? t('失败')
                  : renderCancelled
                    ? t('已取消')
                    : remotionCompleted
                      ? t('等待开始')
                      : t('等待 JSON')
          : t('待接入');
  const actionable = isAnalysis || isCampaignImages || isNarration || isRemotionJSON || isRender;
  const disabled = isAnalysis
    ? analyzing || renderActive
    : isCampaignImages
      ? !analysisCompleted || campaignImagesGenerating || renderActive
      : isNarration
        ? !analysisCompleted || narrationGenerating || renderActive
        : isRemotionJSON
          ? !campaignImagesCompleted || !narrationCompleted || remotionGenerating || renderActive
          : isRender
            ? !remotionCompleted || renderSubmitting
            : true;
  const loading = (isAnalysis && analyzing)
    || (isCampaignImages && campaignImagesGenerating)
    || (isNarration && narrationGenerating)
    || (isRemotionJSON && remotionGenerating)
    || (isRender && renderSubmitting);
  return (
    <article className="lightweight-video-stage">
      <span className="lightweight-video-stage-index">{index}</span>
      <span className="lightweight-video-stage-icon"><StageIcon size={17} /></span>
      <div className="lightweight-video-stage-copy">
        <div>
          <strong>{stage.title}</strong>
          <span>{status}</span>
        </div>
        <p>{stage.description}</p>
      </div>
      <div className="lightweight-video-stage-actions">
        {isNarration && analysisCompleted ? (
          <div className="lightweight-video-stage-narration-settings">
            <Select
              aria-label={t('旁白音色')}
              onChange={controller.setNarrationVoice}
              options={controller.narrationVoices.map((voice) => ({
                label: `${voice.name} · ${voice.language}`,
                value: voice.id,
              }))}
              placeholder={t('选择音色')}
              size="small"
              value={controller.narrationVoice}
            />
            <AppNumberInput
              aria-label={t('语速')}
              max={2}
              min={0.5}
              onChange={(value) => controller.setNarrationSpeed(Number(value || 1))}
              size="small"
              step={0.1}
              value={controller.narrationSpeed}
            />
            <span>{t('倍速')}</span>
          </div>
        ) : null}
        {isRemotionJSON && campaignImagesCompleted && narrationCompleted ? (
          <div className="lightweight-video-stage-remotion-settings">
            <Select
              aria-label={t('视频风格')}
              onChange={controller.setRemotionPresetId}
              options={controller.remotionPresets.map((preset) => ({
                label: preset.name,
                title: preset.description,
                value: preset.id,
              }))}
              placeholder={t('选择视频风格')}
              size="small"
              value={controller.remotionPresetId}
            />
          </div>
        ) : null}
        <div className="lightweight-video-stage-action-buttons">
          <Button
            disabled={!actionable || disabled}
            loading={loading}
            onClick={isAnalysis
              ? () => void controller.analyzeRecord(record.id)
              : isCampaignImages
                ? () => void controller.generateCampaignImages(record.id)
                : isNarration
                  ? () => void controller.generateNarration(record.id)
                  : isRemotionJSON
                    ? () => void controller.generateRemotionJSON(record.id)
                    : isRender
                      ? () => void (renderActive
                        ? controller.cancelRender(record.id)
                        : controller.renderVideo(record.id))
                  : undefined}
            size="small"
            type={actionable ? 'primary' : 'default'}
          >
            {isAnalysis && analysisCompleted
              ? t('重新分析')
              : isCampaignImages && (campaignImagesCompleted || campaignImagesFailed)
                ? t('重新生成')
                : isNarration && (narrationCompleted || narrationFailed)
                  ? t('重新生成')
                  : isRemotionJSON && (remotionCompleted || remotionFailed)
                    ? t('重新生成')
                    : isRender && renderActive
                      ? t('取消渲染')
                      : isRender && (renderCompleted || renderFailed || renderCancelled)
                        ? t('重新渲染')
                  : stage.action}
          </Button>
          {isAnalysis && analysisCompleted ? (
            <Button onClick={onShowAnalysis} size="small">
              {t('查看分析结果')}
            </Button>
          ) : null}
          {isCampaignImages && (campaignImageGeneration?.images?.length || 0) > 0 ? (
            <Button onClick={onShowCampaignImages} size="small">
              {t('查看图片')}
            </Button>
          ) : null}
          {isNarration && narrationCompleted ? (
            <Button onClick={onShowNarration} size="small">
              {t('查看旁白字幕')}
            </Button>
          ) : null}
          {isRemotionJSON && remotionCompleted ? (
            <Button onClick={onShowRemotionJSON} size="small">
              {t('查看 JSON')}
            </Button>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function RemotionJSONResult({ record }: { record: LightweightCreationRecord }) {
  const generation = record.analysisSession?.analysis.remotionGeneration;
  if (!generation?.renderRequest) {
    return <p className="lightweight-video-analysis-empty">{t('暂无 Remotion JSON')}</p>;
  }
  return (
    <div className="lightweight-remotion-json-result">
      <div className="lightweight-remotion-json-summary">
        <div>
          <strong>{generation.preset?.name || generation.presetId}</strong>
          <span>JsonVideo {generation.validation?.schemaVersion || generation.preset?.schemaVersion || '2.0'}</span>
        </div>
        <span>{generation.validation?.valid ? t('Schema 校验通过') : t('等待 Schema 校验')}</span>
      </div>
      <pre>{JSON.stringify(generation.renderRequest, null, 2)}</pre>
    </div>
  );
}

function CampaignImageResults({ record }: { record: LightweightCreationRecord }) {
  const images = record.analysisSession?.analysis.campaignImageGeneration?.images || [];
  if (!images.length) {
    return <p className="lightweight-video-analysis-empty">{t('暂无宣传图片')}</p>;
  }
  return (
    <div className="lightweight-campaign-image-grid">
      {images.map((image) => (
        <figure key={`${image.sceneId}-${image.assetId}`}>
          <img alt={image.title || t('宣传图片')} src={resolveAssetUrl(image.fileUrl)} />
          <figcaption>
            <strong>{image.title || t('宣传图片')}</strong>
            <p>{image.prompt}</p>
          </figcaption>
        </figure>
      ))}
    </div>
  );
}

function NarrationResults({ record }: { record: LightweightCreationRecord }) {
  const generation = record.analysisSession?.analysis.narrationGeneration;
  const scenes = generation?.scenes || [];
  if (!generation || scenes.length === 0) {
    return <p className="lightweight-video-analysis-empty">{t('暂无旁白与字幕')}</p>;
  }
  return (
    <div className="lightweight-narration-results">
      <div className="lightweight-narration-summary">
        <strong>{t('已生成 {{0}} 段旁白', { '0': scenes.length })}</strong>
        <span>{formatMilliseconds(generation.durationMs)} · {t('{{0}} 条字幕', { '0': generation.captions.length })}</span>
      </div>
      <div className="lightweight-narration-scene-list">
        {scenes.map((scene, index) => (
          <article className="lightweight-narration-scene" key={`${scene.sceneId}-${scene.assetId}`}>
            <div className="lightweight-narration-scene-heading">
              <strong>{scene.sceneId || t('场景 {{0}}', { '0': index + 1 })}</strong>
              <span>{formatMilliseconds(scene.durationMs)}</span>
            </div>
            <p>{scene.text}</p>
            <audio controls preload="metadata" src={resolveAssetUrl(scene.fileUrl)} />
            <div className="lightweight-narration-caption-list">
              {scene.captions.map((caption, captionIndex) => (
                <div className="lightweight-narration-caption" key={`${scene.sceneId}-${caption.startMs}-${captionIndex}`}>
                  <span>{formatMilliseconds(caption.startMs)} - {formatMilliseconds(caption.endMs)}</span>
                  <p>{caption.text}</p>
                </div>
              ))}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function formatMilliseconds(value: number) {
  const milliseconds = Math.max(0, Math.round(value || 0));
  const seconds = Math.floor(milliseconds / 1000);
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}.${String(milliseconds % 1000).padStart(3, '0')}`;
}

function AnalysisResult({ record }: { record: LightweightCreationRecord }) {
  const insights = record.analysisSession?.analysis.productInsights;
  if (record.analysisSession?.status !== 'confirming' || !insights) {
    return null;
  }
  return (
    <div className="lightweight-video-analysis-result">
      <div className="lightweight-video-analysis-copy">
        <div className="lightweight-video-analysis-heading">
          <strong>{insights.productName || t('内容分析结果')}</strong>
          {insights.productCategory ? <span>{insights.productCategory}</span> : null}
        </div>
        <AnalysisList label={t('核心卖点')} values={insights.coreSellingPoints} />
        <AnalysisList label={t('产品特征')} values={insights.productFeatures} />
        <AnalysisList label={t('目标受众')} values={insights.targetAudience} />
        <AnalysisList label={t('使用场景')} values={insights.useScenarios} />
        {record.analysisSession.analysis.notes.length > 0 ? (
          <AnalysisList label={t('待确认')} values={record.analysisSession.analysis.notes} />
        ) : null}
      </div>
      <div className="lightweight-video-analysis-materials">
        <strong>{t('图片分析')}</strong>
        {record.analysisSession.analysis.materialCaptions.length > 0 ? (
          <div className="lightweight-video-analysis-material-list">
            {record.analysisSession.analysis.materialCaptions.map((caption) => (
              <div className="lightweight-video-analysis-material" key={caption.id}>
                {caption.previewUrl ? (
                  <img alt={caption.label || t('参考图片')} src={caption.previewUrl} />
                ) : null}
                <div>
                  <strong>{caption.label || t('参考图片')}</strong>
                  <p>{caption.description}</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="lightweight-video-analysis-empty">{t('暂无图片分析结果')}</p>
        )}
      </div>
    </div>
  );
}

function AnalysisList({ label, values }: { label: string; values: string[] }) {
  if (!values.length) return null;
  return (
    <div className="lightweight-video-analysis-row">
      <span>{label}</span>
      <p>{values.join('、')}</p>
    </div>
  );
}

function formatRecordDate(value: string) {
  const date = new Date(value);
  return `${date.getMonth() + 1}/${date.getDate()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}
