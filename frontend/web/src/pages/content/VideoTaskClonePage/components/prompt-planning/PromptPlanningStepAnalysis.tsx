import { Check } from 'lucide-react';
import { resolveAssetUrl } from '../../../../../api/request';
import { formatPlanningTimeRange } from '../../planningHelpers';
import {
  BreakdownLine,
  BreakdownTagLine,
  EditableTagField,
} from './PromptPlanningPresentational';
import type { PromptPlanningController } from './usePromptPlanningController';
import './PromptPlanningChoiceAndBreakdownFields.scss';
import './PromptPlanningEditableAnalysis.scss';
import './PromptPlanningSharedFields.scss';
import './PromptPlanningStepAnalysis.scss';

type PromptPlanningStepAnalysisProps = {
  controller: PromptPlanningController;
};

export function PromptPlanningStepAnalysis({ controller }: PromptPlanningStepAnalysisProps) {
  const {
    analysisDraft,
    captionDraftCards,
    onAnalysisDraftChange,
    session,
  } = controller;

  if (!session) {
    return null;
  }

  return (
    <>
      <section className="video-task-epa-analysis-section">
        <div className="video-task-epa-section-head">
          <div>
            <strong>参考视频爆款拆解</strong>
            <span>脚本将照这条视频的结构复刻</span>
          </div>
          {session.analysis.viralBreakdown ? (
            <button
              className={`video-task-epa-text-action${analysisDraft.useBreakdown ? '' : ' is-muted'}`}
              onClick={() => {
                onAnalysisDraftChange({
                  ...analysisDraft,
                  useBreakdown: !analysisDraft.useBreakdown,
                });
              }}
              type="button"
            >
              {analysisDraft.useBreakdown ? '不复刻这条视频' : '恢复复刻这条视频'}
            </button>
          ) : null}
        </div>
        <div className={`video-task-epa-breakdown-card ${!analysisDraft.useBreakdown ? 'video-task-epa-empty-hint' : ''}`}>
          {session.analysis.viralBreakdown ? (
            <>
              {session.analysis.viralBreakdown.tags.length ? (
                <div className="video-task-epa-pill-line is-soft">
                  {session.analysis.viralBreakdown.tags.map((tag) => (
                    <span className="video-task-epa-pill" key={tag}>{tag}</span>
                  ))}
                </div>
              ) : null}
              <BreakdownLine label="结构框架" value={session.analysis.viralBreakdown.structureFramework} />
              <BreakdownLine label="情绪曲线" value={session.analysis.viralBreakdown.emotionCurve} />
              {session.analysis.viralBreakdown.segments.map((segment) => (
                <BreakdownLine
                  key={`${segment.timeRange}-${segment.title}`}
                  label={formatPlanningTimeRange(segment.timeRange)}
                  value={`${segment.title}${segment.summary ? ` ${segment.summary}` : ''}`}
                />
              ))}
              <BreakdownTagLine label="可替换" tags={session.analysis.viralBreakdown.replaceableElements} tone="green" />
              <BreakdownTagLine label="建议保留" tags={session.analysis.viralBreakdown.keepElements} tone="gray" />
              <BreakdownLine
                label="适用品类"
                value={session.analysis.viralBreakdown.applicableCategories.join('、')}
              />
            </>
          ) : (
            '未识别到参考视频拆解结果，后续会按商品素材独立生成脚本'
          )}
        </div>
      </section>

      <section className="video-task-epa-analysis-section">
        <div className="video-task-epa-section-head">
          <div>
            <strong>素材分析</strong>
            <span>每张图的画面描述，可编辑，用于生成保持主体一致</span>
          </div>
        </div>
        <div className="video-task-epa-caption-list">
          {captionDraftCards.length ? captionDraftCards.map((caption, index) => (
            <article className="video-task-epa-caption-card" key={caption.id}>
              <img alt={caption.label} src={resolveAssetUrl(caption.previewUrl)} />
              <div className="video-task-epa-caption-edit">
                <span className="video-task-epa-caption-tag">@图片{index + 1}</span>
                <textarea
                  onChange={(event) => onAnalysisDraftChange({
                    ...analysisDraft,
                    materialCaptions: analysisDraft.materialCaptions.map((item, itemIndex) => (
                      itemIndex === index
                        ? { ...item, label: caption.label, description: event.currentTarget.value }
                        : item
                    )),
                  })}
                  rows={2}
                  value={caption.description}
                />
              </div>
            </article>
          )) : (
            <div className="video-task-epa-empty-hint">还没有商品图识别结果，请返回上一步补充图片后重新识别。</div>
          )}
        </div>
      </section>

      <section className="video-task-epa-analysis-section">
        <div className="video-task-epa-section-head">
          <div>
            <strong>商品洞察</strong>
            <span>名称、特性、卖点、目标人群和使用场景都会带入脚本生成</span>
          </div>
        </div>
        <div className="video-task-epa-grid-2">
          <label className="video-task-epa-stack-field">
            <span>商品名称</span>
            <input
              className="video-task-epa-inline-input"
              onChange={(event) => onAnalysisDraftChange({
                ...analysisDraft,
                productInsights: {
                  ...analysisDraft.productInsights,
                  productName: event.currentTarget.value,
                },
              })}
              type="text"
              value={analysisDraft.productInsights.productName}
            />
          </label>
          <label className="video-task-epa-stack-field">
            <span>商品类目</span>
            <input
              className="video-task-epa-inline-input"
              onChange={(event) => onAnalysisDraftChange({
                ...analysisDraft,
                productInsights: {
                  ...analysisDraft.productInsights,
                  productCategory: event.currentTarget.value,
                },
              })}
              type="text"
              value={analysisDraft.productInsights.productCategory}
            />
          </label>
        </div>
        <div className="video-task-epa-grid-2 is-tags">
          <EditableTagField
            label="产品特性"
            onChange={(values) => onAnalysisDraftChange({
              ...analysisDraft,
              productInsights: {
                ...analysisDraft.productInsights,
                productFeatures: values,
              },
            })}
            placeholder="如 大方领、泡泡袖，回车添加"
            values={analysisDraft.productInsights.productFeatures}
          />
          <EditableTagField
            label="核心卖点"
            onChange={(values) => onAnalysisDraftChange({
              ...analysisDraft,
              productInsights: {
                ...analysisDraft.productInsights,
                coreSellingPoints: values,
              },
            })}
            placeholder="如 显锁骨、遮手臂，回车添加"
            values={analysisDraft.productInsights.coreSellingPoints}
          />
          <EditableTagField
            label="目标人群"
            onChange={(values) => onAnalysisDraftChange({
              ...analysisDraft,
              productInsights: {
                ...analysisDraft.productInsights,
                targetAudience: values,
              },
            })}
            placeholder="如 18-30 岁年轻女性，回车添加"
            values={analysisDraft.productInsights.targetAudience}
          />
          <EditableTagField
            label="使用场景"
            onChange={(values) => onAnalysisDraftChange({
              ...analysisDraft,
              productInsights: {
                ...analysisDraft.productInsights,
                useScenarios: values,
              },
            })}
            placeholder="如 草坪野餐、海边度假，回车添加"
            values={analysisDraft.productInsights.useScenarios}
          />
        </div>
      </section>
    </>
  );
}
