import { Dropdown } from 'antd';
import { Check, ChevronDown, Clock3, Layers3, ScanLine } from 'lucide-react';
import type { ReactElement } from 'react';
import { durationOptions, modelDescriptions, modelOptions, qualityOptions, ratioOptions } from '../constants';
import type { ParamKind } from '../types';
import { WorkspaceSection } from './WorkspaceSection';
import { t } from '@shared/i18n';

type ParameterPanelProps = {
  activeParam: ParamKind | null;
  canvas: string;
  duration: string;
  model: string;
  onCanvasQualityChoose: (quality: string) => void;
  onCanvasRatioChoose: (ratio: string) => void;
  onParamChoose: (kind: ParamKind, value: string) => void;
  onParamToggle: (kind: ParamKind | null) => void;
  quality: string;
  ratio: string;
  showDuration?: boolean;
  showHeader?: boolean;
  showRatio?: boolean;
  summary: string;
};

export function ParameterPanel({
  activeParam,
  canvas,
  duration,
  model,
  onCanvasQualityChoose,
  onCanvasRatioChoose,
  onParamChoose,
  onParamToggle,
  quality,
  ratio,
  showDuration = true,
  showHeader = true,
  showRatio = true,
  summary,
}: ParameterPanelProps) {
  const handleOpenChange = (kind: ParamKind, open: boolean) => {
    if (open) {
      onParamToggle(kind);
    } else if (activeParam === kind) {
      onParamToggle(null);
    }
  };

  const handleQualityChoose = (value: string) => {
    onCanvasQualityChoose(value);
    if (!showRatio) {
      onParamToggle(null);
    }
  };

  const renderDropdown = (kind: ParamKind) => (
    <div className={`video-task-param-popover is-${kind}`}>
      <strong>{kind === 'model' ? t("选择模型") : kind === 'canvas' ? (showRatio ? t("选择画布") : t("选择清晰度")) : t("选择时长")}</strong>
      {kind === 'canvas' ? (
        <div className="video-task-canvas-picker">
          {showRatio ? (
            <div className="video-task-canvas-group">
              <h3>{t("选择比例")}</h3>
              <div className="video-task-ratio-grid">
                {ratioOptions.map((option) => (
                  <button
                    className={ratio === option ? 'is-active' : ''}
                    key={option}
                    onClick={() => onCanvasRatioChoose(option)}
                    type="button"
                  >
                    <span className={`video-task-ratio-icon ratio-${option.replace(':', '-')}`} />
                    <strong>{option}</strong>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <div className="video-task-canvas-group">
            <h3>{t("选择清晰度")}</h3>
            <div className="video-task-quality-grid">
              {qualityOptions.map((option) => (
                <button
                  className={quality === option.label ? 'is-active' : ''}
                  key={option.label}
                  onClick={() => handleQualityChoose(option.label)}
                  type="button"
                >
                  <strong>{option.label}</strong>
                  <span>{option.description}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="video-task-param-options">
          {(kind === 'model' ? modelOptions : durationOptions).map((option) => (
            <button
              className={(kind === 'model' && option === model) || (kind === 'duration' && option === duration) ? 'is-active' : ''}
              key={option}
              onClick={() => onParamChoose(kind, option)}
              type="button"
            >
              <span className="video-task-param-option-copy">
                <strong>{option}</strong>
                {kind === 'model' && <span>{modelDescriptions[option]}</span>}
              </span>
              {kind === 'model' && option === model ? <Check className="video-task-param-option-check" size={20} /> : null}
            </button>
          ))}
        </div>
      )}
    </div>
  );

  const parameterDropdown = (kind: ParamKind, trigger: ReactElement) => (
    <Dropdown
      classNames={{ root: `video-task-param-dropdown is-${kind}` }}
      destroyOnHidden
      menu={{ items: [] }}
      onOpenChange={(open) => handleOpenChange(kind, open)}
      open={activeParam === kind}
      placement={kind === 'canvas' ? 'bottomRight' : 'bottomLeft'}
      popupRender={() => renderDropdown(kind)}
      trigger={['click']}
    >
      {trigger}
    </Dropdown>
  );

  return (
    <WorkspaceSection
      className={`video-task-params-card${!showHeader && !showDuration ? ' is-compact' : ''}`}
      description={summary}
      showHeader={showHeader}
      title={t("生成参数")}
    >
      <div className="video-task-param-grid">
        {parameterDropdown('model', (
          <button className={`video-task-param-item${activeParam === 'model' ? ' is-open' : ''}`} type="button">
            <span className="video-task-param-icon">
              <Layers3 size={20} />
            </span>
            <span>
              <small>{t("模型")}</small>
              <strong>{model}</strong>
            </span>
            <ChevronDown size={18} />
          </button>
        ))}
        {parameterDropdown('canvas', (
          <button className={`video-task-param-item${activeParam === 'canvas' ? ' is-open' : ''}`} type="button">
            <span className="video-task-param-icon">
              {showRatio ? (
                <span className={`video-task-ratio-icon video-task-ratio-icon--panel ratio-${ratio.replace(':', '-')}`} />
              ) : (
                <ScanLine size={20} />
              )}
            </span>
            <span>
              <small>{showRatio ? t("画布") : t("清晰度")}</small>
              <strong>{showRatio ? canvas : quality}</strong>
            </span>
            <ChevronDown size={18} />
          </button>
        ))}
        {showDuration ? (
          parameterDropdown('duration', (
            <button className={`video-task-param-item is-wide${activeParam === 'duration' ? ' is-open' : ''}`} type="button">
              <span className="video-task-param-icon">
                <Clock3 size={20} />
              </span>
              <span>
                <small>{t("时长")}</small>
                <strong>{duration}</strong>
              </span>
              <ChevronDown size={18} />
            </button>
          ))
        ) : null}
      </div>
    </WorkspaceSection>
  );
}
