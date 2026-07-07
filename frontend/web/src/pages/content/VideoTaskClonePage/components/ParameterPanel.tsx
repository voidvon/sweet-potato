import { ChevronDown, Clock3, Layers3 } from 'lucide-react';
import { durationOptions, modelDescriptions, modelOptions, qualityOptions, ratioOptions } from '../constants';
import type { ParamKind } from '../types';

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
  summary,
}: ParameterPanelProps) {
  return (
    <section className="video-task-card video-task-params-card">
      <div className="video-task-section-heading">
        <div>
          <h2>生成参数</h2>
          <p>{summary}</p>
        </div>
      </div>

      <div className="video-task-param-grid">
        <button className={`video-task-param-item${activeParam === 'model' ? ' is-open' : ''}`} onClick={() => onParamToggle(activeParam === 'model' ? null : 'model')} type="button">
          <span className="video-task-param-icon">
            <Layers3 size={20} />
          </span>
          <span>
            <small>模型</small>
            <strong>{model}</strong>
          </span>
          <ChevronDown size={18} />
        </button>
        <button className={`video-task-param-item${activeParam === 'canvas' ? ' is-open' : ''}`} onClick={() => onParamToggle(activeParam === 'canvas' ? null : 'canvas')} type="button">
          <span className="video-task-param-icon">
            <span className="video-task-phone-icon" />
          </span>
          <span>
            <small>画布</small>
            <strong>{canvas}</strong>
          </span>
          <ChevronDown size={18} />
        </button>
        <button className={`video-task-param-item is-wide${activeParam === 'duration' ? ' is-open' : ''}`} onClick={() => onParamToggle(activeParam === 'duration' ? null : 'duration')} type="button">
          <span className="video-task-param-icon">
            <Clock3 size={20} />
          </span>
          <span>
            <small>时长</small>
            <strong>{duration}</strong>
          </span>
          <ChevronDown size={18} />
        </button>
      </div>

      {activeParam && (
        <div className={`video-task-param-popover is-${activeParam}`}>
          <strong>{activeParam === 'model' ? '选择模型' : activeParam === 'canvas' ? '选择画布' : '选择时长'}</strong>
          {activeParam === 'canvas' ? (
            <div className="video-task-canvas-picker">
              <div className="video-task-canvas-group">
                <h3>选择比例</h3>
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
              <div className="video-task-canvas-group">
                <h3>选择清晰度</h3>
                <div className="video-task-quality-grid">
                  {qualityOptions.map((option) => (
                    <button
                      className={quality === option.label ? 'is-active' : ''}
                      key={option.label}
                      onClick={() => onCanvasQualityChoose(option.label)}
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
              {(activeParam === 'model' ? modelOptions : durationOptions).map((option) => (
                <button
                  className={(activeParam === 'model' && option === model) || (activeParam === 'duration' && option === duration) ? 'is-active' : ''}
                  key={option}
                  onClick={() => onParamChoose(activeParam, option)}
                  type="button"
                >
                  <strong>{option}</strong>
                  {activeParam === 'model' && <span>{modelDescriptions[option]}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
