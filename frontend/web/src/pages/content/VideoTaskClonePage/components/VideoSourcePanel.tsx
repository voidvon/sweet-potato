import { Button, Col, Input, Row, Space } from 'antd';
import { Link2 } from 'lucide-react';
import { useState } from 'react';
import { AppForm } from '../../../../components/AppForm';
import type { LocalMaterialFile, MaterialKind, SelectedMaterialValue } from '../types';
import { MaterialSlot } from './MaterialSlot';
import { WorkspaceSection } from './WorkspaceSection';

type VideoSourcePanelProps = {
  description?: string;
  material: MaterialKind;
  onMaterialClear: (kind: MaterialKind) => void;
  onMaterialLocalFiles: (kind: MaterialKind, files: FileList | File[]) => void;
  onMaterialRemoveOne: (kind: MaterialKind, materialId?: string) => void;
  onMaterialReplaceFiles: (kind: MaterialKind, files: LocalMaterialFile[]) => void;
  onUrlSubmit: (input: string) => Promise<boolean>;
  selected: SelectedMaterialValue;
  title?: string;
};

export function VideoSourcePanel({
  description = '若视频镜头较多，部分镜头编辑效果不佳，建议分镜后单独编辑',
  material,
  onMaterialClear,
  onMaterialLocalFiles,
  onMaterialRemoveOne,
  onMaterialReplaceFiles,
  onUrlSubmit,
  selected,
  title = '视频来源',
}: VideoSourcePanelProps) {
  const [videoUrl, setVideoUrl] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const normalizedVideoUrl = videoUrl.trim();

  const confirmVideoUrl = async () => {
    if (!normalizedVideoUrl || isSubmitting) return;
    setIsSubmitting(true);
    try {
      if (await onUrlSubmit(normalizedVideoUrl)) {
        setVideoUrl('');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <WorkspaceSection description={description} title={title}>
      <Row align="middle" gutter={[12, 12]} wrap>
        <Col flex="104px">
          <MaterialSlot
            item={material}
            onClear={onMaterialClear}
            onLocalFiles={onMaterialLocalFiles}
            onOpen={() => undefined}
            onRemoveOne={onMaterialRemoveOne}
            onReplaceFiles={onMaterialReplaceFiles}
            openMode="local"
            selected={selected}
          />
        </Col>
        <Col flex="auto">
          <AppForm>
            <AppForm.Item>
              <Space.Compact block>
                <Input
                  allowClear
                  onChange={(event) => setVideoUrl(event.target.value)}
                  disabled={isSubmitting}
                  onPressEnter={() => void confirmVideoUrl()}
                  placeholder="粘贴公开视频链接"
                  prefix={<Link2 aria-hidden="true" size={16} />}
                  size="large"
                  value={videoUrl}
                />
                <Button
                  disabled={!normalizedVideoUrl || isSubmitting}
                  loading={isSubmitting}
                  onClick={() => void confirmVideoUrl()}
                  size="large"
                  style={{ borderRadius: '0 16px 16px 0', height: 40 }}
                  type="primary"
                >
                  确认
                </Button>
              </Space.Compact>
            </AppForm.Item>
          </AppForm>
        </Col>
      </Row>
    </WorkspaceSection>
  );
}
