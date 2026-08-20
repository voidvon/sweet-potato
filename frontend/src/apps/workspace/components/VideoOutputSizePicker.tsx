import './VideoOutputSizePicker.scss';
import { t } from '@shared/i18n';

export type VideoAspectRatio = '9:16' | '16:9' | '1:1' | '4:3' | '3:4' | '21:9';
export type VideoResolution = '480P' | '720P';

type VideoOutputSizePickerProps = {
  aspectRatio: VideoAspectRatio;
  onAspectRatioChange: (aspectRatio: VideoAspectRatio) => void;
  onResolutionChange: (resolution: VideoResolution) => void;
  resolution: VideoResolution;
};

export const videoAspectRatioOptions: VideoAspectRatio[] = ['9:16', '16:9', '1:1', '4:3', '3:4', '21:9'];
export const videoResolutionOptions: VideoResolution[] = ['480P', '720P'];

export function VideoOutputSizePicker({
  aspectRatio,
  onAspectRatioChange,
  onResolutionChange,
  resolution,
}: VideoOutputSizePickerProps) {
  return (
    <div className="video-output-size-picker">
      <section className="video-output-size-picker__section">
        <h3>{t("选择比例")}</h3>
        <div className="video-output-size-picker__aspect-grid">
          {videoAspectRatioOptions.map((ratio) => (
            <button
              className={`video-output-size-picker__aspect${ratio === aspectRatio ? ' is-selected' : ''}`}
              key={ratio}
              onClick={() => onAspectRatioChange(ratio)}
              type="button"
            >
              <span className={`video-output-size-picker__aspect-icon ratio-${ratio.replace(':', '-')}`} />
              <span>{ratio}</span>
            </button>
          ))}
        </div>
      </section>
      <section className="video-output-size-picker__section">
        <h3>{t("选择分辨率")}</h3>
        <div className="video-output-size-picker__resolution-grid">
          {videoResolutionOptions.map((item) => (
            <button
              className={`video-output-size-picker__resolution${item === resolution ? ' is-selected' : ''}`}
              key={item}
              onClick={() => onResolutionChange(item)}
              type="button"
            >
              {item}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
