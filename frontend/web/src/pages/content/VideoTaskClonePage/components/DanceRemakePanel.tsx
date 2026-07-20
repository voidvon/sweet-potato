import { Checkbox } from 'antd';
import type { DanceRemakeMode, LocalMaterialFile, MaterialKind, SelectedMaterials, ToolOption } from '../types';
import { VideoSourcePanel } from './VideoSourcePanel';
import { WorkspaceSection } from './WorkspaceSection';
import './DanceRemakePanel.scss';

type DanceRemakePanelProps = {
  onMaterialClear: (kind: MaterialKind) => void;
  onMaterialLocalFiles: (kind: MaterialKind, files: FileList | File[]) => void;
  onMaterialRemoveOne: (kind: MaterialKind, materialId?: string) => void;
  onMaterialReplaceFiles: (kind: MaterialKind, files: LocalMaterialFile[]) => void;
  mode: DanceRemakeMode;
  onModeChange: (mode: DanceRemakeMode) => void;
  onVideoUrlSubmit: (input: string) => Promise<boolean>;
  onVoiceChange: (enabled: boolean) => void;
  selectedMaterials: SelectedMaterials;
  tool: ToolOption;
  voiceEnabled: boolean;
};

export function DanceRemakePanel({
  onMaterialClear,
  onMaterialLocalFiles,
  onMaterialRemoveOne,
  onMaterialReplaceFiles,
  mode,
  onModeChange,
  onVideoUrlSubmit,
  onVoiceChange,
  selectedMaterials,
  tool,
  voiceEnabled,
}: DanceRemakePanelProps) {
  const videoMaterial = tool.materials.find((item) => item.key === 'video');

  if (!videoMaterial) return null;

  return (
    <>
      <VideoSourcePanel
        material={videoMaterial}
        onMaterialClear={onMaterialClear}
        onMaterialLocalFiles={onMaterialLocalFiles}
        onMaterialRemoveOne={onMaterialRemoveOne}
        onMaterialReplaceFiles={onMaterialReplaceFiles}
        onUrlSubmit={onVideoUrlSubmit}
        selected={selectedMaterials.video}
      />

      <WorkspaceSection
        description="选择适合当前素材的视频复刻模式。"
        title="模型选择"
      >
        <div aria-label="视频复刻模式" className="dance-remake-mode-grid" role="group">
          <button
            aria-pressed={mode === 'standard'}
            className={`dance-remake-mode-option${mode === 'standard' ? ' is-active' : ''}`}
            onClick={() => onModeChange('standard')}
            type="button"
          >
            <strong>标准模式</strong>
            <span>轻量视频复刻。</span>
          </button>
          <button
            aria-pressed={mode === 'enhanced'}
            className={`dance-remake-mode-option${mode === 'enhanced' ? ' is-active' : ''}`}
            onClick={() => onModeChange('enhanced')}
            type="button"
          >
            <strong>增强模式</strong>
            <span>动作、镜头和节奏复刻更强。</span>
          </button>
        </div>

        <Checkbox
          checked={voiceEnabled}
          className="dance-remake-audio-option"
          onChange={(event) => onVoiceChange(event.target.checked)}
        >
          保留参考视频里的音乐和节奏，适合舞蹈、卡点、BGM 视频。
        </Checkbox>
      </WorkspaceSection>
    </>
  );
}
