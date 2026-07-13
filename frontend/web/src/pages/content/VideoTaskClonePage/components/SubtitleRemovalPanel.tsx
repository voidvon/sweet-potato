import { InputNumber, Modal, Segmented } from 'antd';
import { SlidersHorizontal } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type {
  SelectedMaterials,
  SubtitleRemovalConfig,
  SubtitleRemovalLocation,
  SubtitleRemovalMode,
} from '../types';
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

const defaultLocation: SubtitleRemovalLocation = {
  topLeftX: 0.05,
  topLeftY: 0.72,
  bottomRightX: 0.95,
  bottomRightY: 0.96,
};

export function SubtitleRemovalPanel({ config, onChange, selectedMaterials }: SubtitleRemovalPanelProps) {
  const [editorOpen, setEditorOpen] = useState(false);
  const [videoRatio, setVideoRatio] = useState(16 / 9);
  const drawStartRef = useRef<{ x: number; y: number } | null>(null);
  const video = Array.isArray(selectedMaterials.video) ? selectedMaterials.video[0] : undefined;
  const videoUrl = video?.url || '';
  const duration = Math.max(0, Number(video?.trimDuration || 0));
  const activeLocation = config.locations[0] || defaultLocation;
  const summary = useMemo(() => {
    const content = config.contentType === 'text' ? '全画面文字' : '字幕';
    const area = config.mode === 'auto' ? '自动识别全画面字幕' : '指定 1 个擦除区域';
    const time = config.clipFilter.mode === 'all'
      ? '全时段'
      : `${config.clipFilter.mode === 'selected' ? '仅擦除' : '跳过'} ${formatSeconds(config.clipFilter.start)}-${formatSeconds(config.clipFilter.end)}`;
    return `${content} · ${area} · ${time}`;
  }, [config]);

  const chooseMode = (mode: SubtitleRemovalMode) => {
    onChange({
      ...config,
      mode,
      locations: mode === 'auto' ? config.locations : (config.locations.length ? config.locations : [defaultLocation]),
    });
  };

  const updateLocation = (patch: Partial<SubtitleRemovalLocation>) => {
    const next = normalizeLocation({ ...activeLocation, ...patch });
    onChange({ ...config, locations: [next] });
  };

  const drawRegion = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (config.mode === 'auto') return;
    const rect = event.currentTarget.getBoundingClientRect();
    const start = {
      x: clamp01((event.clientX - rect.left) / rect.width),
      y: clamp01((event.clientY - rect.top) / rect.height),
    };
    drawStartRef.current = start;
    event.currentTarget.setPointerCapture(event.pointerId);
    updateLocation({
      topLeftX: start.x,
      topLeftY: start.y,
      bottomRightX: Math.min(1, start.x + 0.02),
      bottomRightY: Math.min(1, start.y + 0.02),
    });
  };

  const resizeRegion = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = drawStartRef.current;
    if (!start || config.mode === 'auto') return;
    const rect = event.currentTarget.getBoundingClientRect();
    const current = {
      x: clamp01((event.clientX - rect.left) / rect.width),
      y: clamp01((event.clientY - rect.top) / rect.height),
    };
    onChange({
      ...config,
      locations: [normalizeLocation({
        topLeftX: Math.min(start.x, current.x),
        topLeftY: Math.min(start.y, current.y),
        bottomRightX: Math.max(start.x, current.x),
        bottomRightY: Math.max(start.y, current.y),
      })],
    });
  };

  return (
    <section className="video-task-card subtitle-removal-card">
      <div className="subtitle-removal-heading">
        <h2>擦除方式</h2>
      </div>
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

      <Modal
        className="subtitle-removal-editor-modal"
        destroyOnHidden
        footer={null}
        onCancel={() => setEditorOpen(false)}
        open={editorOpen}
        title="字幕擦除精细配置"
        width={860}
      >
        <div className="subtitle-removal-editor-layout">
          <div className="subtitle-removal-preview-column">
            <div
              className={`subtitle-removal-video-stage${config.mode === 'auto' ? ' is-readonly' : ''}`}
              onPointerDown={drawRegion}
              onPointerMove={resizeRegion}
              onPointerUp={() => { drawStartRef.current = null; }}
              style={{ aspectRatio: String(videoRatio) }}
            >
              {videoUrl ? (
                <video
                  controls
                  onLoadedMetadata={(event) => {
                    const element = event.currentTarget;
                    if (element.videoWidth && element.videoHeight) {
                      setVideoRatio(element.videoWidth / element.videoHeight);
                    }
                  }}
                  src={videoUrl}
                />
              ) : <span className="subtitle-removal-empty-preview">请先上传源视频</span>}
              {config.mode !== 'auto' && (
                <span
                  className="subtitle-removal-region"
                  style={{
                    left: `${activeLocation.topLeftX * 100}%`,
                    top: `${activeLocation.topLeftY * 100}%`,
                    width: `${(activeLocation.bottomRightX - activeLocation.topLeftX) * 100}%`,
                    height: `${(activeLocation.bottomRightY - activeLocation.topLeftY) * 100}%`,
                  }}
                >
                  擦除区域
                </span>
              )}
            </div>
            <p>{config.mode === 'auto' ? '智能模式会自动检测字幕，无需框选。' : '在视频画面上按住并拖动，框选需要擦除的完整字幕区域。'}</p>
          </div>
          <div className="subtitle-removal-controls">
            <label>
              <span>识别内容</span>
              <Segmented
                block
                onChange={(value) => onChange({ ...config, contentType: value as 'subtitle' | 'text' })}
                options={[{ label: '仅字幕', value: 'subtitle' }, { label: '所有文字', value: 'text' }]}
                value={config.contentType}
              />
            </label>
            {config.mode !== 'auto' && (
              <div className="subtitle-removal-coordinate-grid">
                <CoordinateInput label="左" value={activeLocation.topLeftX} onChange={(value) => updateLocation({ topLeftX: value })} />
                <CoordinateInput label="上" value={activeLocation.topLeftY} onChange={(value) => updateLocation({ topLeftY: value })} />
                <CoordinateInput label="右" value={activeLocation.bottomRightX} onChange={(value) => updateLocation({ bottomRightX: value })} />
                <CoordinateInput label="下" value={activeLocation.bottomRightY} onChange={(value) => updateLocation({ bottomRightY: value })} />
              </div>
            )}
            <label>
              <span>时间范围</span>
              <Segmented
                block
                onChange={(value) => onChange({ ...config, clipFilter: { ...config.clipFilter, mode: value as 'all' | 'selected' | 'skip' } })}
                options={[{ label: '全时段', value: 'all' }, { label: '仅选中', value: 'selected' }, { label: '跳过选中', value: 'skip' }]}
                value={config.clipFilter.mode}
              />
            </label>
            {config.clipFilter.mode !== 'all' && (
              <div className="subtitle-removal-time-grid">
                <label>
                  <span>开始（秒）</span>
                  <InputNumber
                    max={duration || undefined}
                    min={0}
                    onChange={(value) => onChange({ ...config, clipFilter: { ...config.clipFilter, start: Number(value || 0) } })}
                    precision={1}
                    value={config.clipFilter.start}
                  />
                </label>
                <label>
                  <span>结束（秒）</span>
                  <InputNumber
                    max={duration || undefined}
                    min={0}
                    onChange={(value) => onChange({ ...config, clipFilter: { ...config.clipFilter, end: Number(value || 0) } })}
                    precision={1}
                    value={config.clipFilter.end}
                  />
                </label>
              </div>
            )}
            <button className="subtitle-removal-editor-done" onClick={() => setEditorOpen(false)} type="button">完成配置</button>
          </div>
        </div>
      </Modal>
    </section>
  );
}

function CoordinateInput({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label>
      <span>{label}（%）</span>
      <InputNumber
        max={100}
        min={0}
        onChange={(next) => onChange(Number(next || 0) / 100)}
        precision={1}
        value={Number((value * 100).toFixed(1))}
      />
    </label>
  );
}

function normalizeLocation(location: SubtitleRemovalLocation): SubtitleRemovalLocation {
  const topLeftX = clamp01(Math.min(location.topLeftX, location.bottomRightX - 0.01));
  const topLeftY = clamp01(Math.min(location.topLeftY, location.bottomRightY - 0.01));
  return {
    topLeftX,
    topLeftY,
    bottomRightX: clamp01(Math.max(location.bottomRightX, topLeftX + 0.01)),
    bottomRightY: clamp01(Math.max(location.bottomRightY, topLeftY + 0.01)),
  };
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function formatSeconds(value: number) {
  return `${Number(value || 0).toFixed(1).replace(/\.0$/, '')}s`;
}
