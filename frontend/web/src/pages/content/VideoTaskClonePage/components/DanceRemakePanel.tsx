import { Checkbox, Flex } from 'antd';
import { danceRemakeModeOptions } from '../../shared/videoGenerationOptions';
import type { DanceRemakeMode, LocalMaterialFile, MaterialKind, SelectedMaterials, ToolOption } from '../types';
import { SelectionCardGroup } from './SelectionCardGroup';
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
        title="生成模型"
      >
        <Flex gap={12} vertical>
          <SelectionCardGroup
            ariaLabel="视频复刻模式"
            columns={2}
            options={danceRemakeModeOptions.map((option) => ({
              description: option.description,
              key: option.value,
              onSelect: () => onModeChange(option.value),
              selected: mode === option.value,
              title: option.label,
            }))}
          />

          {mode === 'enhanced' && (
            <Checkbox checked={voiceEnabled} onChange={(event) => onVoiceChange(event.target.checked)}>
              保留参考视频里的音乐和节奏，适合舞蹈、卡点、BGM 视频。
            </Checkbox>
          )}
        </Flex>
      </WorkspaceSection>
    </>
  );
}
