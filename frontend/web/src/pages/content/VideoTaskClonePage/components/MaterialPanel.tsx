import { ChevronLeft, Image, Music2, Play, Plus, Trash2, UserRound } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { audioOptions } from '../constants';
import { MaterialSlot } from './MaterialSlot';
import { MaterialUploadPopover } from './MaterialUploadPopover';
import type { MaterialKind, MaterialMode, SelectedMaterials, ToolOption, UploadAnchor } from '../types';

type MaterialPanelProps = {
  activeUpload: MaterialKind | null;
  materialMode: MaterialMode;
  onAudioChoose: (name: string) => void;
  onClosePopovers: () => void;
  onMaterialClear: (kind: MaterialKind) => void;
  onMaterialRemoveOne: (kind: MaterialKind) => void;
  onMaterialsClearAll: () => void;
  onMaterialFill: (kind: MaterialKind, value: string) => void;
  onTabChange: (mode: MaterialMode) => void;
  onUploadClose: () => void;
  onUploadOpen: (kind: MaterialKind, anchor: UploadAnchor) => void;
  onVoiceChange: (enabled: boolean) => void;
  selectedMaterials: SelectedMaterials;
  tool: ToolOption;
  uploadAnchor: UploadAnchor | null;
  voiceEnabled: boolean;
};

export function MaterialPanel({
  activeUpload,
  materialMode,
  onAudioChoose,
  onClosePopovers,
  onMaterialClear,
  onMaterialRemoveOne,
  onMaterialsClearAll,
  onMaterialFill,
  onTabChange,
  onUploadClose,
  onUploadOpen,
  onVoiceChange,
  selectedMaterials,
  tool,
  uploadAnchor,
  voiceEnabled,
}: MaterialPanelProps) {
  const panelRef = useRef<HTMLElement | null>(null);
  const popoverRef = useRef<HTMLElement | null>(null);
  const hasOpenPopover = Boolean(materialMode || activeUpload);

  useEffect(() => {
    if (!hasOpenPopover) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (popoverRef.current?.contains(target)) return;
      if (activeUpload && panelRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest('.video-task-tabs')) return;
      onClosePopovers();
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [hasOpenPopover, onClosePopovers]);

  return (
    <section className="video-task-card video-task-material-card" ref={panelRef}>
      <div className="video-task-material-title">
        <span className="video-task-material-title-text">
          <strong>素材</strong>
          <small>{tool.materialHint}</small>
        </span>
        <div className="video-task-tabs" aria-label="素材类型">
          {Object.keys(selectedMaterials).length > 0 && (
            <button className="is-danger" onClick={onMaterialsClearAll} title="清空全部素材" type="button">
              <Trash2 size={12} />
              清空
            </button>
          )}
          <button
            aria-expanded={materialMode === 'works'}
            className={materialMode === 'works' ? 'is-active' : ''}
            onClick={() => onTabChange(materialMode === 'works' ? null : 'works')}
            type="button"
          >
            <Image size={12} />
            作品
          </button>
          <button
            aria-expanded={materialMode === 'audio'}
            className={materialMode === 'audio' ? 'is-active' : ''}
            onClick={() => onTabChange(materialMode === 'audio' ? null : 'audio')}
            type="button"
          >
            <Music2 size={12} />
            音频
          </button>
          <button
            aria-expanded={materialMode === 'model'}
            className={materialMode === 'model' ? 'is-active' : ''}
            onClick={() => onTabChange(materialMode === 'model' ? null : 'model')}
            type="button"
          >
            <UserRound size={12} />
            模特
          </button>
          {tool.label === '视频' && (
            <label className="video-task-voice-toggle" title="生成视频声音">
              <span>声音</span>
              <input
                checked={voiceEnabled}
                onChange={(event) => onVoiceChange(event.target.checked)}
                type="checkbox"
              />
              <i aria-hidden="true" />
            </label>
          )}
        </div>
      </div>

      <div className="video-task-material-grid">
        {tool.materials.map((item) => {
          const selected = selectedMaterials[item.key];
          return (
            <MaterialSlot
              item={item}
              key={item.label}
              onClear={onMaterialClear}
              onOpen={onUploadOpen}
              onRemoveOne={onMaterialRemoveOne}
              selected={selected}
            />
          );
        })}
      </div>

      {materialMode === 'audio' && (
        <aside className="video-task-library-popover is-audio" ref={popoverRef}>
          <header>
            <span className="video-task-library-heading">
              <i aria-hidden="true"><Music2 size={15} /></i>
              <strong>素材库 · 音频</strong>
            </span>
            <button aria-label="收起音频素材库" className="video-task-popover-collapse" onClick={onClosePopovers} type="button">
              <ChevronLeft size={20} />
            </button>
          </header>
          <p>点击「填入」或拖动卡片到左侧参考音频槽位 ↙</p>
          <div className="video-task-audio-scroll">
            <ul className="video-task-audio-list">
              {audioOptions.map((name) => (
                <li className="video-task-audio-card" key={name}>
                  <button className="video-task-audio-main" onClick={() => onAudioChoose(name)} type="button">
                    <i aria-hidden="true"><Play size={13} fill="currentColor" /></i>
                    <span>{name}</span>
                  </button>
                  <button aria-label={`填入${name}`} className="video-task-audio-add" onClick={() => onAudioChoose(name)} type="button">
                    <Plus size={15} />
                  </button>
                </li>
              ))}
            </ul>
            <em>— 没有更多 —</em>
          </div>
        </aside>
      )}

      {materialMode === 'works' && (
        <aside className="video-task-library-popover is-works" ref={popoverRef}>
          <header>
            <span className="video-task-library-heading">
              <i aria-hidden="true"><Image size={15} /></i>
              <strong>我的作品</strong>
            </span>
            <button aria-label="收起作品素材库" className="video-task-popover-collapse" onClick={onClosePopovers} type="button">
              <ChevronLeft size={20} />
            </button>
          </header>
          <p>点击或拖动卡片填入参考图 / 视频 ↙</p>
          <div className="video-task-assets-tabs">
            <button className="is-active" type="button">全部</button>
            <button type="button">图片</button>
            <button type="button">视频</button>
          </div>
          <div className="video-task-assets-empty">暂无作品</div>
        </aside>
      )}

      {activeUpload && (
        <MaterialUploadPopover
          anchor={uploadAnchor}
          item={activeUpload}
          onClose={onUploadClose}
          onLibraryChoose={(item) => onMaterialFill(item, getDemoMaterialValue(item))}
          onLocalUpload={(item) => onMaterialFill(item, `${item.label} 01`)}
        />
      )}
    </section>
  );
}

function getDemoMaterialValue(item: MaterialKind) {
  if (item.key === 'audio') {
    return 'voice-clone-preview-04e614e6-89c7-4f03-a35f-32f29afc458b-1778754088555.wav';
  }
  if (item.key === 'image') return '参考图 8 张';
  return `素材库 ${item.label}`;
}
