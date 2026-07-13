import { SlidersHorizontal } from 'lucide-react';
import { useMemo, useState } from 'react';
import type {
  SelectedMaterials,
  SubtitleRemovalConfig,
  SubtitleRemovalMode,
} from '../types';
import { SubtitleRemovalEditor } from './SubtitleRemovalEditor';
import { WorkspaceSection } from './WorkspaceSection';
import './SubtitleRemovalPanel.scss';

type SubtitleRemovalPanelProps = {
  config: SubtitleRemovalConfig;
  onChange: (config: SubtitleRemovalConfig) => void;
  selectedMaterials: SelectedMaterials;
};

const modeOptions: Array<{ key: SubtitleRemovalMode; title: string; description: string }> = [
  {
    key: 'auto',
    title: '智能识别字幕',
    description: '默认自动检测并擦除画面下方居中的白色字幕。',
  },
  {
    key: 'auto_region',
    title: 'Auto + 指定区域',
    description: '先 OCR 识别文本，只擦除完全落入所选区域内的字幕。',
  },
  {
    key: 'manual',
    title: 'Manual 框选擦除',
    description: '强制处理区域内符合特征的文本，适合小语种或漏擦。',
  },
];

const defaultLocation = {
  topLeftX: 0.1,
  topLeftY: 0.85,
  bottomRightX: 0.9,
  bottomRightY: 0.95,
};

export function SubtitleRemovalPanel({ config, onChange, selectedMaterials }: SubtitleRemovalPanelProps) {
  const [editorOpen, setEditorOpen] = useState(false);
  const summary = useMemo(() => {
    const content = config.contentType === 'text' ? '所有渲染文字' : '仅字幕';
    const area = config.mode === 'auto'
      ? '自动识别'
      : `${config.locations.length} 个区域`;
    const time = config.clipFilter.mode === 'all'
      ? '处理全时段'
      : `${config.clipFilter.mode === 'selected' ? '仅处理' : '跳过'} 1 段`;
    return `${content} · ${area} · ${time}`;
  }, [config]);

  const chooseMode = (mode: SubtitleRemovalMode) => {
    onChange({
      ...config,
      mode,
      locations: mode === 'auto'
        ? config.locations
        : (config.locations.length ? config.locations : [defaultLocation]),
    });
  };

  return (
    <WorkspaceSection className="subtitle-removal-card" title="擦除方式" variant="plain">
      <div className="subtitle-removal-modes" role="radiogroup" aria-label="字幕擦除方式">
        {modeOptions.map((option) => (
          <button
            aria-checked={config.mode === option.key}
            className={config.mode === option.key ? 'is-active' : ''}
            key={option.key}
            onClick={() => chooseMode(option.key)}
            role="radio"
            type="button"
          >
            <strong>{option.title}</strong>
            <span>{option.description}</span>
          </button>
        ))}
      </div>

      <button className="subtitle-removal-editor-entry" onClick={() => setEditorOpen(true)} type="button">
        <span>
          <strong>打开视频编辑器</strong>
          <small>{summary}</small>
        </span>
        <span className="subtitle-removal-editor-badge">
          <SlidersHorizontal size={14} />
          精细配置
        </span>
      </button>

      {editorOpen && (
        <SubtitleRemovalEditor
          config={config}
          onCancel={() => setEditorOpen(false)}
          onConfirm={(nextConfig) => {
            onChange(nextConfig);
            setEditorOpen(false);
          }}
          selectedMaterials={selectedMaterials}
        />
      )}
    </WorkspaceSection>
  );
}
