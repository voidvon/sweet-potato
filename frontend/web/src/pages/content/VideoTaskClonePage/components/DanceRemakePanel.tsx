import { Card, Checkbox, Col, Radio, Row, Space, Typography } from 'antd';
import { AppForm } from '../../../../components/AppForm';
import type { DanceRemakeMode, LocalMaterialFile, MaterialKind, SelectedMaterials, ToolOption } from '../types';
import { VideoSourcePanel } from './VideoSourcePanel';
import { WorkspaceSection } from './WorkspaceSection';

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
        <Radio.Group onChange={(event) => onModeChange(event.target.value)} value={mode}>
          <Row gutter={[12, 12]}>
            <Col xs={24} sm={12}>
              <Card size="small">
                <Radio value="standard">
                  <Space direction="vertical" size={0}>
                    <Typography.Text strong>标准模式</Typography.Text>
                    <Typography.Text type="secondary">轻量视频复刻。</Typography.Text>
                  </Space>
                </Radio>
              </Card>
            </Col>
            <Col xs={24} sm={12}>
              <Card size="small">
                <Radio value="enhanced">
                  <Space direction="vertical" size={0}>
                    <Typography.Text strong>增强模式</Typography.Text>
                    <Typography.Text type="secondary">动作、镜头和节奏复刻更强。</Typography.Text>
                  </Space>
                </Radio>
              </Card>
            </Col>
          </Row>
        </Radio.Group>

        <AppForm>
          <AppForm.Item>
            <Checkbox checked={voiceEnabled} onChange={(event) => onVoiceChange(event.target.checked)}>
              保留参考视频里的音乐和节奏，适合舞蹈、卡点、BGM 视频。
            </Checkbox>
          </AppForm.Item>
        </AppForm>
      </WorkspaceSection>
    </>
  );
}
