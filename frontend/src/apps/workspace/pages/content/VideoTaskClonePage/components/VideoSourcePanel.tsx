import { Button, Col, Input, Row, Space } from 'antd';
import { Link2 } from 'lucide-react';
import { useState } from 'react';
import { AppForm } from '../../../../components/AppForm';
import type { LocalMaterialFile, MaterialKind, SelectedMaterialValue } from '../types';
import { MaterialSlot } from './MaterialSlot';
import { WorkspaceSection } from './WorkspaceSection';
import { t } from '@shared/i18n';

type VideoSourcePanelProps = {
  description?: string;
  localUploadLabel?: string;
  material: MaterialKind;
  onMaterialClear: (kind: MaterialKind) => void;
  onMaterialLocalFiles: (kind: MaterialKind, files: FileList | File[]) => void;
  onMaterialRemoveOne: (kind: MaterialKind, materialId?: string) => void;
  onMaterialReplaceFiles: (kind: MaterialKind, files: LocalMaterialFile[]) => void;
  onUrlSubmit?: (input: string) => Promise<boolean>;
  selected: SelectedMaterialValue;
  stackUrlInput?: boolean;
  showUrlInput?: boolean;
  title?: string;
};

export function VideoSourcePanel({
  description = '若视频镜头较多，部分镜头编辑效果不佳，建议分镜后单独编辑',
  localUploadLabel,
  material,
  onMaterialClear,
  onMaterialLocalFiles,
  onMaterialRemoveOne,
  onMaterialReplaceFiles,
  onUrlSubmit,
  selected,
  stackUrlInput = false,
  showUrlInput = true,
  title = '视频来源',
}: VideoSourcePanelProps) {
  const [videoUrl, setVideoUrl] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const normalizedVideoUrl = videoUrl.trim();

  const confirmVideoUrl = async () => {
    if (!onUrlSubmit || !normalizedVideoUrl || isSubmitting) return;
    setIsSubmitting(true);
    try {
      if (await onUrlSubmit(normalizedVideoUrl)) {
        setVideoUrl('');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const materialSlot = (
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
  );
  const urlInput = showUrlInput ? (
    <AppForm>
      <AppForm.Item>
        <Space.Compact block>
          <Input
            allowClear
            onChange={(event) => setVideoUrl(event.target.value)}
            disabled={isSubmitting}
            onPressEnter={() => void confirmVideoUrl()}
            placeholder={t("也可以粘贴抖音 / 小红书 / 快手视频链接")}
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
            {t("确认")}
          </Button>
        </Space.Compact>
      </AppForm.Item>
    </AppForm>
  ) : null;
  const localUploadLabelNode = localUploadLabel ? (
    <strong className="video-source-local-upload-label">{localUploadLabel}</strong>
  ) : null;

  return (
    <WorkspaceSection
      className={stackUrlInput ? 'video-source-panel is-stacked' : 'video-source-panel'}
      description={description}
      title={title}
    >
      {stackUrlInput ? (
        <div className="video-source-choice">
          <strong className="video-source-choice-title">{t("选择方式")}</strong>
          <Row align="middle" className="video-source-choice-row" gutter={[12, 12]} wrap>
            {materialSlot}
            <Col flex="auto">{localUploadLabelNode}</Col>
          </Row>
          {urlInput ? <div className="video-source-url-input">{urlInput}</div> : null}
        </div>
      ) : (
        <Row align="middle" gutter={[12, 12]} wrap>
          {materialSlot}
          {urlInput ? <Col flex="auto">{urlInput}</Col> : <Col flex="auto">{localUploadLabelNode}</Col>}
        </Row>
      )}
    </WorkspaceSection>
  );
}
