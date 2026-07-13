import { InputNumber, Modal, Segmented, Slider } from 'antd';
import { Pause, Play, Plus, Trash2, X } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import type {
  SelectedMaterials,
  SubtitleRemovalConfig,
  SubtitleRemovalLocation,
} from '../types';

type SubtitleRemovalEditorProps = {
  config: SubtitleRemovalConfig;
  onCancel: () => void;
  onConfirm: (config: SubtitleRemovalConfig) => void;
  selectedMaterials: SelectedMaterials;
};

type RegionPreset = {
  description: string;
  label: string;
  location: SubtitleRemovalLocation;
};

type DragAction = {
  handle: ResizeHandle | 'draw' | 'move';
  index: number;
  origin: SubtitleRemovalLocation;
  pointerId: number;
  startX: number;
  startY: number;
};

type ResizeHandle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

const MIN_REGION_SIZE = 0.02;

const regionPresets: RegionPreset[] = [
  {
    label: '下半屏',
    description: 'Y 0.50-1.00',
    location: { topLeftX: 0, topLeftY: 0.5, bottomRightX: 1, bottomRightY: 1 },
  },
  {
    label: '底部字幕区',
    description: '左右留 10%，底部 15%',
    location: { topLeftX: 0.1, topLeftY: 0.85, bottomRightX: 0.9, bottomRightY: 1 },
  },
  {
    label: '中下字幕区',
    description: '覆盖中下部常见双语字幕',
    location: { topLeftX: 0.08, topLeftY: 0.65, bottomRightX: 0.92, bottomRightY: 0.84 },
  },
];

const resizeHandles: ResizeHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

export function SubtitleRemovalEditor({
  config,
  onCancel,
  onConfirm,
  selectedMaterials,
}: SubtitleRemovalEditorProps) {
  const [draft, setDraft] = useState<SubtitleRemovalConfig>(() => createEditorDraft(config));
  const [activeRegionIndex, setActiveRegionIndex] = useState(() => (
    config.mode === 'auto' ? 0 : Math.max(0, config.locations.length - 1)
  ));
  const [videoRatio, setVideoRatio] = useState(9 / 16);
  const [videoDuration, setVideoDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const dragActionRef = useRef<DragAction | null>(null);
  const video = Array.isArray(selectedMaterials.video) ? selectedMaterials.video[0] : undefined;
  const videoUrl = video?.url || '';
  const duration = videoDuration || Math.max(0, Number(video?.trimDuration || 0));
  const safeDuration = Math.max(duration, 1);
  const activeLocation = draft.locations[activeRegionIndex];

  const editorSummary = useMemo(() => {
    const content = draft.contentType === 'text' ? '所有渲染文字' : '仅字幕';
    const area = draft.mode === 'auto' ? '自动识别' : `${draft.locations.length} 个区域`;
    const time = draft.clipFilter.mode === 'all'
      ? '处理全时段'
      : `${draft.clipFilter.mode === 'selected' ? '仅处理' : '跳过'} 1 段`;
    return `${content} · ${area} · ${time}`;
  }, [draft]);

  const updateLocations = (locations: SubtitleRemovalLocation[], activeIndex = activeRegionIndex) => {
    const normalized = locations.map(normalizeLocation);
    setDraft((current) => ({
      ...current,
      mode: normalized.length === 0
        ? 'auto'
        : (current.mode === 'auto' ? 'auto_region' : current.mode),
      locations: normalized,
    }));
    setActiveRegionIndex(Math.max(0, Math.min(activeIndex, normalized.length - 1)));
  };

  const updateLocation = (index: number, location: SubtitleRemovalLocation) => {
    updateLocations(draft.locations.map((current, currentIndex) => (
      currentIndex === index ? normalizeLocation(location) : current
    )), index);
  };

  const addRegion = (location = nextDefaultLocation(draft.locations.length)) => {
    updateLocations([...draft.locations, location], draft.locations.length);
  };

  const applyPreset = (preset: RegionPreset) => {
    if (activeLocation) {
      updateLocation(activeRegionIndex, preset.location);
      return;
    }
    addRegion(preset.location);
  };

  const removeRegion = (index: number) => {
    const nextLocations = draft.locations.filter((_, currentIndex) => currentIndex !== index);
    updateLocations(nextLocations, Math.min(index, nextLocations.length - 1));
  };

  const beginCanvasAction = (
    event: ReactPointerEvent<HTMLElement>,
    handle: ResizeHandle | 'draw' | 'move',
    index: number,
  ) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const canvas = event.currentTarget.closest<HTMLDivElement>('.subtitle-editor-canvas');
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const point = pointerRatio(event, rect);
    const origin = handle === 'draw'
      ? { topLeftX: point.x, topLeftY: point.y, bottomRightX: point.x + MIN_REGION_SIZE, bottomRightY: point.y + MIN_REGION_SIZE }
      : draft.locations[index];
    if (!origin) return;

    const nextIndex = handle === 'draw' ? draft.locations.length : index;
    if (handle === 'draw') {
      updateLocations([...draft.locations, normalizeLocation(origin)], nextIndex);
    } else {
      setActiveRegionIndex(index);
    }
    dragActionRef.current = {
      handle,
      index: nextIndex,
      origin: normalizeLocation(origin),
      pointerId: event.pointerId,
      startX: point.x,
      startY: point.y,
    };
    canvas.setPointerCapture(event.pointerId);
  };

  const continueCanvasAction = (event: ReactPointerEvent<HTMLDivElement>) => {
    const action = dragActionRef.current;
    if (!action || action.pointerId !== event.pointerId) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const point = pointerRatio(event, rect);
    const deltaX = point.x - action.startX;
    const deltaY = point.y - action.startY;
    const nextLocation = transformLocation(action, point, deltaX, deltaY);
    setDraft((current) => ({
      ...current,
      mode: current.mode === 'auto' ? 'auto_region' : current.mode,
      locations: current.locations.map((location, index) => (
        index === action.index ? nextLocation : location
      )),
    }));
  };

  const finishCanvasAction = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragActionRef.current?.pointerId !== event.pointerId) return;
    dragActionRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const togglePlayback = async () => {
    const element = videoRef.current;
    if (!element) return;
    if (element.paused) {
      await element.play();
    } else {
      element.pause();
    }
  };

  const chooseClipMode = (mode: SubtitleRemovalConfig['clipFilter']['mode']) => {
    setDraft((current) => ({
      ...current,
      clipFilter: {
        ...current.clipFilter,
        mode,
        start: mode === 'all' ? 0 : Math.min(current.clipFilter.start, Math.max(0, duration - 0.1)),
        end: mode === 'all'
          ? 0
          : (current.clipFilter.end > current.clipFilter.start
            ? Math.min(current.clipFilter.end, duration || current.clipFilter.end)
            : (duration || Math.max(1, current.clipFilter.start + 1))),
      },
    }));
  };

  return (
    <Modal
      centered
      className="subtitle-editor-modal"
      closable={false}
      footer={null}
      mask={{ closable: true }}
      onCancel={onCancel}
      open
      rootClassName="subtitle-editor-modal-root"
      title={null}
      width={1280}
    >
      <section aria-labelledby="subtitle-editor-title" className="subtitle-editor" role="dialog">
        <header className="subtitle-editor-header">
          <div>
            <h2 id="subtitle-editor-title">字幕擦除视频编辑器</h2>
            <p>{editorSummary}</p>
          </div>
          <button aria-label="关闭视频编辑器" className="subtitle-editor-close" onClick={onCancel} type="button">
            <X size={16} />
          </button>
        </header>

        <div className="subtitle-editor-body">
          <main className="subtitle-editor-preview">
            <div className="subtitle-editor-stage">
              <div
                className={`subtitle-editor-canvas${videoUrl ? '' : ' is-empty'}`}
                onPointerCancel={finishCanvasAction}
                onPointerDown={(event) => beginCanvasAction(event, 'draw', -1)}
                onPointerMove={continueCanvasAction}
                onPointerUp={finishCanvasAction}
                style={{ aspectRatio: String(videoRatio) }}
              >
                {videoUrl ? (
                  <video
                    disablePictureInPicture
                    disableRemotePlayback
                    onEnded={() => setIsPlaying(false)}
                    onLoadedMetadata={(event) => {
                      const element = event.currentTarget;
                      if (element.videoWidth > 0 && element.videoHeight > 0) {
                        setVideoRatio(element.videoWidth / element.videoHeight);
                      }
                      const nextDuration = Number.isFinite(element.duration) ? element.duration : 0;
                      setVideoDuration(nextDuration);
                    }}
                    onPause={() => setIsPlaying(false)}
                    onPlay={() => setIsPlaying(true)}
                    onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
                    playsInline
                    preload="metadata"
                    ref={videoRef}
                    src={videoUrl}
                  />
                ) : (
                  <div className="subtitle-editor-empty-state">
                    <span>请先上传源视频</span>
                    <small>上传后可在画面中拖动框选擦除区域</small>
                  </div>
                )}

                {draft.locations.map((location, index) => {
                  const isActive = index === activeRegionIndex;
                  return (
                    <div
                      aria-label={`擦除区域 ${index + 1}`}
                      className={`subtitle-editor-region${isActive ? ' is-active' : ''}`}
                      key={`region-${index}`}
                      onPointerDown={(event) => beginCanvasAction(event, 'move', index)}
                      role="button"
                      style={locationStyle(location)}
                      tabIndex={0}
                    >
                      <span className="subtitle-editor-region-label">区域 {index + 1}</span>
                      {isActive && resizeHandles.map((handle) => (
                        <span
                          aria-hidden="true"
                          className={`subtitle-editor-resize-handle is-${handle}`}
                          key={handle}
                          onPointerDown={(event) => beginCanvasAction(event, handle, index)}
                        />
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="subtitle-editor-player">
              <button
                aria-label={isPlaying ? '暂停' : '播放'}
                className="subtitle-editor-play"
                disabled={!videoUrl}
                onClick={() => void togglePlayback()}
                type="button"
              >
                {isPlaying ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}
              </button>
              <Slider
                aria-label="视频播放进度"
                disabled={!videoUrl}
                max={safeDuration}
                min={0}
                onChange={(value) => {
                  const nextTime = Number(value);
                  setCurrentTime(nextTime);
                  if (videoRef.current) videoRef.current.currentTime = nextTime;
                }}
                step={0.01}
                tooltip={{ formatter: null }}
                value={Math.min(currentTime, safeDuration)}
              />
              <span>{formatTime(currentTime)} / {formatTime(duration)}</span>
            </div>
            <p className="subtitle-editor-canvas-hint">拖拽视频画面创建框选区域。区域和时间段可叠加生效，最终只处理同时满足条件的画面。</p>
          </main>

          <aside className="subtitle-editor-sidebar">
            <section className="subtitle-editor-control-section">
              <h3>擦除内容</h3>
              <div className="subtitle-editor-content-options" role="radiogroup" aria-label="擦除内容">
                <ContentOption
                  active={draft.contentType === 'subtitle'}
                  description="保护剧情提示、场景文字和贴纸等非字幕文本。"
                  label="仅字幕"
                  onClick={() => setDraft((current) => ({ ...current, contentType: 'subtitle' }))}
                />
                <ContentOption
                  active={draft.contentType === 'text'}
                  description="连同文字水印、标题等渲染文本一起擦除。"
                  label="所有渲染文字"
                  onClick={() => setDraft((current) => ({ ...current, contentType: 'text' }))}
                />
              </div>
            </section>

            <section className="subtitle-editor-control-section">
              <div className="subtitle-editor-section-heading">
                <h3>擦除区域</h3>
                <button onClick={() => addRegion()} type="button"><Plus size={16} />新增区域</button>
              </div>
              <div className="subtitle-editor-presets">
                {regionPresets.map((preset) => (
                  <button key={preset.label} onClick={() => applyPreset(preset)} type="button">
                    <strong>{preset.label}</strong>
                    <span>{preset.description}</span>
                  </button>
                ))}
              </div>

              <div className="subtitle-editor-region-list">
                {draft.locations.length === 0 && (
                  <button className="subtitle-editor-add-empty" onClick={() => addRegion()} type="button">
                    <Plus size={18} />
                    添加第一个擦除区域
                  </button>
                )}
                {draft.locations.map((location, index) => (
                  <article
                    className={`subtitle-editor-region-card${index === activeRegionIndex ? ' is-active' : ''}`}
                    key={`region-card-${index}`}
                    onClick={() => setActiveRegionIndex(index)}
                  >
                    <header>
                      <strong>区域 {index + 1}</strong>
                      <button
                        aria-label={`删除区域 ${index + 1}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          removeRegion(index);
                        }}
                        type="button"
                      >
                        <Trash2 size={15} />
                        删除
                      </button>
                    </header>
                    <div className="subtitle-editor-coordinate-grid">
                      <CoordinateInput label="左上角 X" onChange={(value) => updateLocation(index, { ...location, topLeftX: value })} value={location.topLeftX} />
                      <CoordinateInput label="左上角 Y" onChange={(value) => updateLocation(index, { ...location, topLeftY: value })} value={location.topLeftY} />
                      <CoordinateInput label="右下角 X" onChange={(value) => updateLocation(index, { ...location, bottomRightX: value })} value={location.bottomRightX} />
                      <CoordinateInput label="右下角 Y" onChange={(value) => updateLocation(index, { ...location, bottomRightY: value })} value={location.bottomRightY} />
                    </div>
                  </article>
                ))}
              </div>
              <p className="subtitle-editor-help">Auto 区域模式只擦除完整落入区域的 OCR 字幕；Manual 会强制处理区域内符合特征的文本。</p>
            </section>

            <section className="subtitle-editor-control-section subtitle-editor-time-section">
              <h3>处理时段</h3>
              <Segmented
                block
                onChange={(value) => chooseClipMode(value as SubtitleRemovalConfig['clipFilter']['mode'])}
                options={[
                  { label: '全时段', value: 'all' },
                  { label: '仅选中', value: 'selected' },
                  { label: '跳过选中', value: 'skip' },
                ]}
                value={draft.clipFilter.mode}
              />
              {draft.clipFilter.mode !== 'all' && (
                <div className="subtitle-editor-time-grid">
                  <TimeInput
                    duration={duration}
                    label="开始（秒）"
                    onChange={(value) => setDraft((current) => ({
                      ...current,
                      clipFilter: { ...current.clipFilter, start: value },
                    }))}
                    value={draft.clipFilter.start}
                  />
                  <TimeInput
                    duration={duration}
                    label="结束（秒）"
                    onChange={(value) => setDraft((current) => ({
                      ...current,
                      clipFilter: { ...current.clipFilter, end: value },
                    }))}
                    value={draft.clipFilter.end}
                  />
                </div>
              )}
            </section>
          </aside>
        </div>

        <footer className="subtitle-editor-footer">
          <button
            disabled={!isDraftValid(draft, duration)}
            onClick={() => onConfirm(cloneConfig(draft))}
            type="button"
          >
            完成
          </button>
        </footer>
      </section>
    </Modal>
  );
}

function ContentOption({
  active,
  description,
  label,
  onClick,
}: {
  active: boolean;
  description: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-checked={active}
      className={active ? 'is-active' : ''}
      onClick={onClick}
      role="radio"
      type="button"
    >
      <strong>{label}</strong>
      <span>{description}</span>
    </button>
  );
}

function CoordinateInput({ label, onChange, value }: { label: string; onChange: (value: number) => void; value: number }) {
  return (
    <label onClick={(event) => event.stopPropagation()}>
      <span>{label}</span>
      <InputNumber
        controls={false}
        max={1}
        min={0}
        onChange={(nextValue) => onChange(clamp01(Number(nextValue ?? 0)))}
        precision={2}
        step={0.01}
        value={Number(value.toFixed(2))}
      />
    </label>
  );
}

function TimeInput({
  duration,
  label,
  onChange,
  value,
}: {
  duration: number;
  label: string;
  onChange: (value: number) => void;
  value: number;
}) {
  return (
    <label>
      <span>{label}</span>
      <InputNumber
        controls={false}
        max={duration || undefined}
        min={0}
        onChange={(nextValue) => onChange(Math.max(0, Number(nextValue ?? 0)))}
        precision={1}
        step={0.1}
        value={value}
      />
    </label>
  );
}

function transformLocation(
  action: DragAction,
  point: { x: number; y: number },
  deltaX: number,
  deltaY: number,
) {
  const next = { ...action.origin };
  if (action.handle === 'draw') {
    next.topLeftX = Math.min(action.startX, point.x);
    next.topLeftY = Math.min(action.startY, point.y);
    next.bottomRightX = Math.max(action.startX, point.x);
    next.bottomRightY = Math.max(action.startY, point.y);
    return normalizeLocation(next);
  }
  if (action.handle === 'move') {
    const width = action.origin.bottomRightX - action.origin.topLeftX;
    const height = action.origin.bottomRightY - action.origin.topLeftY;
    next.topLeftX = clamp(action.origin.topLeftX + deltaX, 0, 1 - width);
    next.topLeftY = clamp(action.origin.topLeftY + deltaY, 0, 1 - height);
    next.bottomRightX = next.topLeftX + width;
    next.bottomRightY = next.topLeftY + height;
    return normalizeLocation(next);
  }

  if (action.handle.includes('n')) next.topLeftY = Math.min(point.y, action.origin.bottomRightY - MIN_REGION_SIZE);
  if (action.handle.includes('s')) next.bottomRightY = Math.max(point.y, action.origin.topLeftY + MIN_REGION_SIZE);
  if (action.handle.includes('w')) next.topLeftX = Math.min(point.x, action.origin.bottomRightX - MIN_REGION_SIZE);
  if (action.handle.includes('e')) next.bottomRightX = Math.max(point.x, action.origin.topLeftX + MIN_REGION_SIZE);
  return normalizeLocation(next);
}

function pointerRatio(event: ReactPointerEvent, rect: DOMRect) {
  return {
    x: clamp01((event.clientX - rect.left) / rect.width),
    y: clamp01((event.clientY - rect.top) / rect.height),
  };
}

function nextDefaultLocation(index: number): SubtitleRemovalLocation {
  const offset = (index % 4) * 0.04;
  return normalizeLocation({
    topLeftX: 0.1,
    topLeftY: 0.72 - offset,
    bottomRightX: 0.9,
    bottomRightY: 0.84 - offset,
  });
}

function normalizeLocation(location: SubtitleRemovalLocation): SubtitleRemovalLocation {
  let topLeftX = clamp01(location.topLeftX);
  let topLeftY = clamp01(location.topLeftY);
  let bottomRightX = clamp01(location.bottomRightX);
  let bottomRightY = clamp01(location.bottomRightY);

  if (bottomRightX - topLeftX < MIN_REGION_SIZE) {
    if (topLeftX + MIN_REGION_SIZE <= 1) bottomRightX = topLeftX + MIN_REGION_SIZE;
    else topLeftX = bottomRightX - MIN_REGION_SIZE;
  }
  if (bottomRightY - topLeftY < MIN_REGION_SIZE) {
    if (topLeftY + MIN_REGION_SIZE <= 1) bottomRightY = topLeftY + MIN_REGION_SIZE;
    else topLeftY = bottomRightY - MIN_REGION_SIZE;
  }
  return { topLeftX, topLeftY, bottomRightX, bottomRightY };
}

function locationStyle(location: SubtitleRemovalLocation): CSSProperties {
  return {
    left: `${location.topLeftX * 100}%`,
    top: `${location.topLeftY * 100}%`,
    width: `${(location.bottomRightX - location.topLeftX) * 100}%`,
    height: `${(location.bottomRightY - location.topLeftY) * 100}%`,
  };
}

function isDraftValid(config: SubtitleRemovalConfig, duration: number) {
  if (config.mode !== 'auto' && config.locations.length === 0) return false;
  if (config.clipFilter.mode === 'all') return true;
  return config.clipFilter.start >= 0
    && config.clipFilter.end > config.clipFilter.start
    && (!duration || config.clipFilter.end <= duration);
}

function cloneConfig(config: SubtitleRemovalConfig): SubtitleRemovalConfig {
  return {
    ...config,
    locations: config.locations.map((location) => ({ ...location })),
    clipFilter: { ...config.clipFilter },
  };
}

function createEditorDraft(config: SubtitleRemovalConfig): SubtitleRemovalConfig {
  const cloned = cloneConfig(config);
  return cloned.mode === 'auto' ? { ...cloned, locations: [] } : cloned;
}

function formatTime(value: number) {
  const safeValue = Math.max(0, Number.isFinite(value) ? value : 0);
  const minutes = Math.floor(safeValue / 60);
  const seconds = safeValue - minutes * 60;
  return `${minutes}:${seconds.toFixed(1).padStart(4, '0')}`;
}

function clamp01(value: number) {
  return clamp(value, 0, 1);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
