import './ImageOutputSizePicker.scss';

export type ImageAspectRatio = 'auto' | '21:9' | '16:9' | '3:2' | '4:3' | '1:1' | '3:4' | '2:3' | '9:16';
export type ImageResolution = '1K' | '2K' | '4K';

export type ImageOutputModel = {
  model?: string;
  provider?: string;
  settings?: Record<string, unknown>;
  supportsCustomResolution?: boolean;
};

type ImageOutputSizePickerProps = {
  allowedResolutions?: ImageResolution[];
  aspectRatio: ImageAspectRatio;
  model?: ImageOutputModel;
  onAspectRatioChange: (aspectRatio: ImageAspectRatio) => void;
  onResolutionChange: (resolution: ImageResolution) => void;
  resolution: ImageResolution;
};

export const imageAspectRatioOptions: ImageAspectRatio[] = ['auto', '21:9', '16:9', '3:2', '4:3', '1:1', '3:4', '2:3', '9:16'];
export const defaultImageResolutions: ImageResolution[] = ['2K', '4K'];

const outputSizeMap: Record<ImageResolution, Record<ImageAspectRatio, string>> = {
  '1K': { auto: '1024 x 1024', '21:9': '1024 x 439', '16:9': '1024 x 576', '3:2': '1024 x 683', '4:3': '1024 x 768', '1:1': '1024 x 1024', '3:4': '768 x 1024', '2:3': '683 x 1024', '9:16': '576 x 1024' },
  '2K': { auto: '2048 x 2048', '21:9': '2048 x 878', '16:9': '2048 x 1152', '3:2': '2048 x 1365', '4:3': '2048 x 1536', '1:1': '2048 x 2048', '3:4': '1536 x 2048', '2:3': '1365 x 2048', '9:16': '1152 x 2048' },
  '4K': { auto: '4096 x 4096', '21:9': '4096 x 1755', '16:9': '4096 x 2304', '3:2': '4096 x 2731', '4:3': '4096 x 3072', '1:1': '4096 x 4096', '3:4': '3072 x 4096', '2:3': '2731 x 4096', '9:16': '2304 x 4096' },
};

const seedreamOutputSizeMap: Record<ImageResolution, Record<ImageAspectRatio, string>> = {
  '1K': { auto: '1024 x 1024', '21:9': '1568 x 672', '16:9': '1312 x 736', '3:2': '1248 x 832', '4:3': '1152 x 864', '1:1': '1024 x 1024', '3:4': '864 x 1152', '2:3': '832 x 1248', '9:16': '736 x 1312' },
  '2K': { auto: '2048 x 2048', '21:9': '3136 x 1344', '16:9': '2848 x 1600', '3:2': '2496 x 1664', '4:3': '2304 x 1728', '1:1': '2048 x 2048', '3:4': '1728 x 2304', '2:3': '1664 x 2496', '9:16': '1600 x 2848' },
  '4K': { auto: '4096 x 4096', '21:9': '6240 x 2656', '16:9': '5504 x 3040', '3:2': '4992 x 3328', '4:3': '4704 x 3520', '1:1': '4096 x 4096', '3:4': '3520 x 4704', '2:3': '3328 x 4992', '9:16': '3040 x 5504' },
};

const geminiFlashOutputSizeMap: Record<ImageResolution, Record<ImageAspectRatio, string>> = {
  '1K': { auto: '1024 x 1024', '21:9': '1584 x 672', '16:9': '1376 x 768', '3:2': '1264 x 848', '4:3': '1200 x 896', '1:1': '1024 x 1024', '3:4': '896 x 1200', '2:3': '848 x 1264', '9:16': '768 x 1376' },
  '2K': { auto: '2048 x 2048', '21:9': '3168 x 1344', '16:9': '2752 x 1536', '3:2': '2528 x 1696', '4:3': '2400 x 1792', '1:1': '2048 x 2048', '3:4': '1792 x 2400', '2:3': '1696 x 2528', '9:16': '1536 x 2752' },
  '4K': { auto: '4096 x 4096', '21:9': '6336 x 2688', '16:9': '5504 x 3072', '3:2': '5056 x 3392', '4:3': '4800 x 3584', '1:1': '4096 x 4096', '3:4': '3584 x 4800', '2:3': '3392 x 5056', '9:16': '3072 x 5504' },
};

const seedreamProOutputSizeMap: Record<ImageAspectRatio, string> = {
  auto: '2048 x 2048', '21:9': '3108 x 1332', '16:9': '2720 x 1530', '3:2': '2496 x 1664', '4:3': '2304 x 1728', '1:1': '2048 x 2048', '3:4': '1728 x 2304', '2:3': '1664 x 2496', '9:16': '1530 x 2720',
};

function normalizedModel(model: ImageOutputModel | undefined) {
  return model?.model?.replace(/^models\//, '') || '';
}

export function imageModelSupportsCustomResolution(model: ImageOutputModel | undefined) {
  const imageGeneration = model?.settings?.imageGeneration && typeof model.settings.imageGeneration === 'object'
    ? model.settings.imageGeneration as Record<string, unknown>
    : {};
  return model?.supportsCustomResolution === true
    || imageGeneration.supportsCustomResolution === true
    || model?.settings?.supportsCustomResolution === true
    || (model?.provider === 'google-gemini-images'
      && ['gemini-3.1-flash-image', 'gemini-3.1-flash-lite-image'].includes(normalizedModel(model)));
}

export function getImageResolutionOptions(
  model: ImageOutputModel | undefined,
  allowedResolutions = defaultImageResolutions,
) {
  if (!imageModelSupportsCustomResolution(model)) return [];
  if (model?.provider === 'google-gemini-images' && normalizedModel(model) === 'gemini-3.1-flash-lite-image') return ['1K'] as ImageResolution[];
  if (model?.provider === 'google-gemini-images' && normalizedModel(model) === 'gemini-3.1-flash-image') return ['1K', '2K', '4K'] as ImageResolution[];
  if (model?.provider === 'volcengine-seedream' && /^doubao-seedream-5-0-pro-/i.test(model.model || '')) {
    return allowedResolutions.filter((resolution) => resolution === '2K');
  }
  return allowedResolutions;
}

export function getImageOutputSize(model: ImageOutputModel | undefined, resolution: ImageResolution, aspectRatio: ImageAspectRatio) {
  const isSeedream = model?.provider === 'volcengine-seedream';
  if (isSeedream && /^doubao-seedream-5-0-pro-/i.test(model.model || '')) return seedreamProOutputSizeMap[aspectRatio];
  if (model?.provider === 'google-gemini-images' && ['gemini-3.1-flash-image', 'gemini-3.1-flash-lite-image'].includes(normalizedModel(model))) {
    return geminiFlashOutputSizeMap[resolution][aspectRatio];
  }
  return (isSeedream ? seedreamOutputSizeMap : outputSizeMap)[resolution][aspectRatio];
}

export function ImageOutputSizePicker({
  allowedResolutions = defaultImageResolutions,
  aspectRatio,
  model,
  onAspectRatioChange,
  onResolutionChange,
  resolution,
}: ImageOutputSizePickerProps) {
  const resolutions = getImageResolutionOptions(model, allowedResolutions);
  const effectiveResolution = resolutions.includes(resolution) ? resolution : resolutions[0] || allowedResolutions[0] || '2K';

  return (
    <div className="image-output-size-picker">
      <section className="image-output-size-picker__section">
        <h3>选择比例</h3>
        <div className="image-output-size-picker__aspect-grid">
          {imageAspectRatioOptions.map((ratio) => (
            <button className={`image-output-size-picker__aspect${ratio === aspectRatio ? ' is-selected' : ''}`} key={ratio} onClick={() => onAspectRatioChange(ratio)} type="button">
              <span className={`image-output-size-picker__aspect-icon ratio-${ratio.replace(':', '-')}`} />
              <span>{ratio}</span>
            </button>
          ))}
        </div>
      </section>
      {resolutions.length ? (
        <>
          <section className="image-output-size-picker__section">
            <h3>选择分辨率</h3>
            <div className="image-output-size-picker__resolution-grid">
              {resolutions.map((item) => (
                <button className={`image-output-size-picker__resolution${item === effectiveResolution ? ' is-selected' : ''}`} key={item} onClick={() => onResolutionChange(item)} type="button">{item}</button>
              ))}
            </div>
          </section>
          <div className="image-output-size-picker__canvas-size">
            <span>画布尺寸</span>
            <strong>{getImageOutputSize(model, effectiveResolution, aspectRatio)}</strong>
          </div>
        </>
      ) : null}
    </div>
  );
}
