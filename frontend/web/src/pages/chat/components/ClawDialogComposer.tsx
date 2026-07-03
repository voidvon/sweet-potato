import { Button, Dropdown, Image, Input, Popover, Upload } from 'antd';
import type { UploadProps } from 'antd';
import {
  ArrowRight,
  Brush,
  Check,
  ChevronDown,
  Expand,
  ImagePlus,
  Images,
  Layers,
  List,
  Maximize2,
  MessageCircle,
  Plus,
  Scan,
  Shirt,
  Square,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { listModelConfigs } from '../../../api/model-config';
import type { ChatAttachment, ModelConfig } from '../../../types';
import './ClawDialogComposer.scss';

const { TextArea } = Input;

type ClawDialogComposerProps = {
  attachments: ChatAttachment[];
  input: string;
  onAddFiles: (files: File[]) => void;
  onInputChange: (value: string) => void;
  onRemoveAttachment: (attachmentId: string) => void;
  onSend: (options?: { imageModelConfigId?: string | null }) => void;
  onStop: () => void;
  sending: boolean;
};

type ClawModeKey =
  | 'dialog'
  | 'detail'
  | 'outfit'
  | 'model-views'
  | 'pose-reference'
  | 'upscale'
  | 'cutout'
  | 'background'
  | 'scene-extract'
  | 'model-face-swap'
  | 'head-swap'
  | 'face-swap'
  | 'redraw'
  | 'detail-enhance'
  | 'print-extract'
  | 'face-enhance';

type ClawModeConfig = {
  description: string;
  Icon: LucideIcon;
  key: ClawModeKey;
  title: string;
  toolbarControls?: ClawToolbarControl[];
};

type ClawToolbarControl = 'model' | 'outputSize' | 'outputCount';
type ClawAspectRatioKey = 'auto' | '21:9' | '16:9' | '3:2' | '4:3' | '1:1' | '3:4' | '2:3' | '9:16';
type ClawResolutionKey = '2K' | '4K';

const defaultToolbarControls: ClawToolbarControl[] = ['model', 'outputSize', 'outputCount'];
const noGenerationToolbarControls: ClawToolbarControl[] = [];

const clawModeConfigs: ClawModeConfig[] = [
  { key: 'dialog', title: '对话生图', description: '多图对话', Icon: MessageCircle },
  { key: 'detail', title: '详情图生成', description: '商品详情', Icon: Images },
  { key: 'outfit', title: '换装', description: '一键试穿', Icon: Shirt },
  { key: 'model-views', title: '模特三视图', description: '多角度展示', Icon: Layers },
  { key: 'pose-reference', title: '姿势参考', description: '参考姿态', Icon: Scan },
  { key: 'upscale', title: '高清放大', description: '提分辨率', Icon: Maximize2 },
  { key: 'cutout', title: '图片抠图', description: '主体分离', Icon: Scan, toolbarControls: noGenerationToolbarControls },
  { key: 'background', title: '换背景', description: '环境焕新', Icon: Images, toolbarControls: noGenerationToolbarControls },
  { key: 'scene-extract', title: '场景提取', description: '提取环境', Icon: ImagePlus, toolbarControls: noGenerationToolbarControls },
  { key: 'model-face-swap', title: '模特换脸', description: '替换模特脸', Icon: Shirt, toolbarControls: noGenerationToolbarControls },
  { key: 'head-swap', title: '智能换头', description: '头部替换', Icon: Scan, toolbarControls: noGenerationToolbarControls },
  { key: 'face-swap', title: '智能换脸', description: '脸部替换', Icon: Scan, toolbarControls: noGenerationToolbarControls },
  { key: 'redraw', title: '智能重绘', description: '读图后重绘', Icon: Brush, toolbarControls: noGenerationToolbarControls },
  { key: 'detail-enhance', title: '细节增强', description: '优化细节', Icon: Zap },
  { key: 'print-extract', title: '印花提取', description: '提取图案', Icon: Images, toolbarControls: noGenerationToolbarControls },
  { key: 'face-enhance', title: '脸部增强', description: '优化脸部', Icon: Scan, toolbarControls: noGenerationToolbarControls },
];

const featuredModeKeys: ClawModeKey[] = ['outfit', 'dialog', 'upscale', 'background', 'redraw'];
const aspectRatioOptions: ClawAspectRatioKey[] = ['auto', '21:9', '16:9', '3:2', '4:3', '1:1', '3:4', '2:3', '9:16'];
const resolutionOptions: ClawResolutionKey[] = ['2K', '4K'];
const outputSizeMap: Record<ClawResolutionKey, Record<ClawAspectRatioKey, string>> = {
  '2K': {
    auto: '2048 x 2048',
    '21:9': '2048 x 878',
    '16:9': '2048 x 1152',
    '3:2': '2048 x 1365',
    '4:3': '2048 x 1536',
    '1:1': '2048 x 2048',
    '3:4': '1536 x 2048',
    '2:3': '1365 x 2048',
    '9:16': '1152 x 2048',
  },
  '4K': {
    auto: '4096 x 4096',
    '21:9': '4096 x 1755',
    '16:9': '4096 x 2304',
    '3:2': '4096 x 2731',
    '4:3': '4096 x 3072',
    '1:1': '4096 x 4096',
    '3:4': '3072 x 4096',
    '2:3': '2731 x 4096',
    '9:16': '2304 x 4096',
  },
};
const visibleModeCards = featuredModeKeys
  .map((key) => clawModeConfigs.find((mode) => mode.key === key))
  .filter((mode): mode is ClawModeConfig => Boolean(mode));
const modeMenuItems = clawModeConfigs.map((mode) => {
  const ModeIcon = mode.Icon;

  return {
    key: mode.key,
    label: (
      <span className="claw-mode-menu-item">
        <span className="claw-mode-menu-icon">
          <ModeIcon size={14} />
        </span>
        <span className="claw-mode-menu-copy">
          <span>{mode.title}</span>
        </span>
      </span>
    ),
  };
});

type SelectableImageModel = {
  config: ModelConfig;
  value: string;
};

function imageModelValue(config: ModelConfig) {
  return config.id || `${config.provider}::${config.model}`;
}

function firstImageAttachment(attachments: ChatAttachment[]) {
  return attachments.find((attachment) => attachment.kind === 'image');
}

export function ClawDialogComposer({
  attachments,
  input,
  onAddFiles,
  onInputChange,
  onRemoveAttachment,
  onSend,
  onStop,
  sending,
}: ClawDialogComposerProps) {
  const [selectedModeKey, setSelectedModeKey] = useState<ClawModeKey>('dialog');
  const [imageConfigs, setImageConfigs] = useState<ModelConfig[]>([]);
  const [selectedImageModelValue, setSelectedImageModelValue] = useState('');
  const [selectedAspectRatio, setSelectedAspectRatio] = useState<ClawAspectRatioKey>('auto');
  const [selectedResolution, setSelectedResolution] = useState<ClawResolutionKey>('2K');
  const hasPrompt = Boolean(input.trim());
  const hasContent = hasPrompt || attachments.length > 0;
  const selectedImage = firstImageAttachment(attachments);
  const selectedMode = clawModeConfigs.find((mode) => mode.key === selectedModeKey) ?? clawModeConfigs[0];
  const SelectedModeIcon = selectedMode.Icon;
  const selectedToolbarControls = selectedMode.toolbarControls ?? defaultToolbarControls;
  const showImageModelControl = selectedToolbarControls.includes('model');
  const showOutputSizeControl = selectedToolbarControls.includes('outputSize');
  const showOutputCountControl = selectedToolbarControls.includes('outputCount');
  const uploadProps: UploadProps = {
    accept: 'image/*',
    beforeUpload: (file) => {
      onAddFiles([file]);
      return false;
    },
    multiple: true,
    showUploadList: false,
  };

  useEffect(() => {
    let ignore = false;

    async function loadImageModels() {
      try {
        const configs = await listModelConfigs('image');
        if (!ignore) {
          setImageConfigs(configs);
        }
      } catch {
        if (!ignore) {
          setImageConfigs([]);
        }
      }
    }

    void loadImageModels();
    return () => {
      ignore = true;
    };
  }, []);

  const selectableImageModels = useMemo<SelectableImageModel[]>(() => {
    return imageConfigs
      .filter((config) => config.id && config.apiKey)
      .map((config) => ({
        config,
        value: imageModelValue(config),
      }));
  }, [imageConfigs]);

  const defaultImageModelValue = useMemo(() => {
    const defaultConfig = imageConfigs.find((item) => item.isDefault && item.apiKey)
      || imageConfigs.find((item) => item.apiKey);
    if (defaultConfig) {
      return imageModelValue(defaultConfig);
    }
    return selectableImageModels[0]?.value || '';
  }, [imageConfigs, selectableImageModels]);

  useEffect(() => {
    if (!selectedImageModelValue && defaultImageModelValue) {
      setSelectedImageModelValue(defaultImageModelValue);
    }
  }, [defaultImageModelValue, selectedImageModelValue]);

  const selectedImageModel = useMemo(
    () => selectableImageModels.find((item) => item.value === selectedImageModelValue) || selectableImageModels[0],
    [selectableImageModels, selectedImageModelValue],
  );

  const imageModelMenuItems = selectableImageModels.length
    ? selectableImageModels.map((item) => ({
      key: item.value,
      label: item.config.name || item.config.model,
      disabled: false,
    }))
    : [{ key: 'empty', label: '请先配置图片模型', disabled: true }];
  const outputSizeLabel = outputSizeMap[selectedResolution][selectedAspectRatio];
  const outputSizePanel = (
    <div className="claw-size-panel">
      <section className="claw-size-panel-section">
        <h3>选择比例</h3>
        <div className="claw-aspect-grid">
          {aspectRatioOptions.map((ratio) => (
            <button
              className={`claw-aspect-option${ratio === selectedAspectRatio ? ' selected' : ''}`}
              key={ratio}
              onClick={() => setSelectedAspectRatio(ratio)}
              type="button"
            >
              <span className={`claw-aspect-icon ratio-${ratio.replace(':', '-')}`} />
              <span>{ratio}</span>
            </button>
          ))}
        </div>
      </section>
      <section className="claw-size-panel-section">
        <h3>选择分辨率</h3>
        <div className="claw-resolution-grid">
          {resolutionOptions.map((resolution) => (
            <button
              className={`claw-resolution-option${resolution === selectedResolution ? ' selected' : ''}`}
              key={resolution}
              onClick={() => setSelectedResolution(resolution)}
              type="button"
            >
              {resolution}
            </button>
          ))}
        </div>
      </section>
      <div className="claw-canvas-size-row">
        <span>画布尺寸</span>
        <strong>{outputSizeLabel}</strong>
      </div>
    </div>
  );

  function handlePrimaryAction() {
    if (sending) {
      onStop();
      return;
    }
    if (hasContent) {
      onSend({ imageModelConfigId: selectedImageModel?.config.id || null });
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }
    event.preventDefault();
    handlePrimaryAction();
  }

  return (
    <section className="claw-dialog-composer" aria-label="对话生图输入框">
      <div className="claw-dialog-card">
        <header className="claw-dialog-heading">
          上传商品图，快速生成模特试穿、商品主图、详情图和营销视频，让每一次上新更快进入投放。
        </header>

        <div className="claw-dialog-input-zone">
          <Upload {...uploadProps}>
            <button className={`claw-reference-tile${selectedImage ? ' has-image' : ''}`} type="button">
              {selectedImage ? (
                <>
                  <Image
                    alt={selectedImage.name}
                    className="claw-reference-image"
                    preview={false}
                    src={selectedImage.url}
                  />
                  <span className="claw-reference-remove" onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onRemoveAttachment(selectedImage.id);
                  }}>
                    删除
                  </span>
                </>
              ) : (
                <>
                  <span className="claw-reference-badge">可选</span>
                  <Plus size={30} strokeWidth={1.7} />
                  <span className="claw-reference-label">参考图</span>
                </>
              )}
            </button>
          </Upload>

          <div className="claw-dialog-textarea-wrap">
            <TextArea
              autoSize={{ minRows: 3, maxRows: 8 }}
              bordered={false}
              className="claw-dialog-textarea"
              onChange={(event) => onInputChange(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="描述你要的画面，可上传参考图，输入 @ 引用图片。"
              value={input}
            />
          </div>

          <Button aria-label="放大输入框" className="claw-expand-button" icon={<Expand size={20} />} type="text" />
        </div>

        {attachments.length > 1 ? (
          <div className="claw-attachment-row">
            {attachments.slice(1).map((attachment) => (
              <span className="claw-attachment-pill" key={attachment.id}>
                {attachment.kind === 'image' ? <ImagePlus size={14} /> : <Layers size={14} />}
                <span>{attachment.name}</span>
                <button aria-label={`移除 ${attachment.name}`} onClick={() => onRemoveAttachment(attachment.id)} type="button">
                  <X size={14} />
                </button>
              </span>
            ))}
          </div>
        ) : null}

        <footer className="claw-dialog-toolbar">
          <div className="claw-dialog-options">
            <Dropdown
              menu={{
                items: modeMenuItems,
                onClick: ({ key }) => setSelectedModeKey(key as ClawModeKey),
                selectedKeys: [selectedModeKey],
              }}
              overlayClassName="claw-mode-dropdown"
              trigger={['click']}
            >
              <Button className="claw-option-button is-active" icon={<SelectedModeIcon size={18} />}>
                {selectedMode.title}
                <ChevronDown size={17} />
              </Button>
            </Dropdown>
            {showImageModelControl ? (
              <Dropdown
                menu={{
                  items: imageModelMenuItems,
                  onClick: ({ key }) => setSelectedImageModelValue(key),
                  selectedKeys: selectedImageModelValue ? [selectedImageModelValue] : [],
                }}
                overlayClassName="claw-image-model-dropdown"
                trigger={['click']}
              >
                <Button className="claw-option-button" icon={<Layers size={18} />}>
                  {selectedImageModel?.config.name || selectedImageModel?.config.model || '图片模型'}
                  <ChevronDown size={17} />
                </Button>
              </Dropdown>
            ) : null}
            {showOutputSizeControl ? (
              <Popover
                arrow={false}
                content={outputSizePanel}
                overlayClassName="claw-size-popover"
                placement="bottomLeft"
                trigger="click"
              >
                <Button className="claw-option-button" icon={<Scan size={18} />}>
                  {selectedAspectRatio}
                  <span className="claw-option-divider" />
                  {selectedResolution}
                  <ChevronDown size={17} />
                </Button>
              </Popover>
            ) : null}
            {showOutputCountControl ? (
              <Dropdown menu={{ items: [{ key: '1', label: '1 张' }, { key: '2', label: '2 张' }, { key: '3', label: '3 张' }, { key: '4', label: '4 张' }] }} trigger={['click']}>
                <Button className="claw-option-button" icon={<List size={18} />}>
                  1 张
                  <ChevronDown size={17} />
                </Button>
              </Dropdown>
            ) : null}
          </div>

          <div className="claw-dialog-submit">
            <span className={`claw-prompt-status${hasPrompt ? ' ready' : ''}`}>
              {hasPrompt ? '准备生成' : '还需输入提示词'}
            </span>
            <span className="claw-credit">
              <Zap size={18} fill="currentColor" />
              15
            </span>
            <Button
              aria-label={sending ? '停止生成' : '发送消息'}
              className="claw-send-button"
              disabled={!sending && !hasContent}
              icon={sending ? <Square size={18} fill="currentColor" /> : <ArrowRight size={24} />}
              onClick={handlePrimaryAction}
              type="primary"
            />
          </div>
        </footer>
      </div>

      <div className="claw-feature-grid">
        {visibleModeCards.map((item) => {
          const FeatureIcon = item.Icon;

          return (
            <button
              className={`claw-feature-card${item.key === selectedModeKey ? ' selected' : ''}`}
              key={item.key}
              onClick={() => setSelectedModeKey(item.key)}
              type="button"
            >
              <span className="claw-feature-icon">
                <FeatureIcon size={24} />
              </span>
              <span className="claw-feature-copy">
                <strong>{item.title}</strong>
                <small>{item.description}</small>
              </span>
              {item.key === selectedModeKey ? (
                <span className="claw-feature-check">
                  <Check size={18} strokeWidth={3} />
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </section>
  );
}
