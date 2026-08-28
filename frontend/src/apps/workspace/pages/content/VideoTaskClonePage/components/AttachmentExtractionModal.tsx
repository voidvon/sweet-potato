import { Image, Modal } from 'antd';
import { FileImage, FileText, Presentation, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { resolveAssetUrl } from '../../../../api/request';
import type { AssetExtraction } from '../../../../api/content';
import type { ContentAsset } from '../../../../types';
import { t } from '@shared/i18n';
import './AttachmentExtractionModal.scss';

export type DocumentExtractionView = {
  attachmentId: string;
  assetId: string;
  extraction: AssetExtraction;
  assets: Record<string, ContentAsset>;
};

type ExtractionArtifact = NonNullable<AssetExtraction['result']['artifacts']>[number];

type AttachmentExtractionModalProps = {
  items: DocumentExtractionView[];
  onClose: () => void;
  open: boolean;
};

export function AttachmentExtractionModal({ items, onClose, open }: AttachmentExtractionModalProps) {
  const [activeAssetId, setActiveAssetId] = useState(items[0]?.assetId || '');

  useEffect(() => {
    if (!items.some((item) => item.assetId === activeAssetId)) {
      setActiveAssetId(items[0]?.assetId || '');
    }
  }, [activeAssetId, items]);

  const active = items.find((item) => item.assetId === activeAssetId) || items[0];
  const units = active?.extraction.result.units || [];
  const artifacts = active?.extraction.result.artifacts || [];
  const filteredArtifacts = active?.extraction.result.filteredArtifacts || [];
  return (
    <Modal
      centered
      className="attachment-extraction-modal"
      closable={false}
      footer={null}
      mask={{ closable: true }}
      onCancel={onClose}
      open={open}
      styles={{ body: { padding: 0 } }}
      title={null}
      width={1040}
    >
      <section className="attachment-extraction-panel">
        <header className="attachment-extraction-head">
          <div>
            <strong>{t('附件解析结果')}</strong>
            <span>{t('左侧查看逐页文案，右侧查看解析后保留的图片素材。')}</span>
          </div>
          <button aria-label={t('关闭')} onClick={onClose} type="button"><X size={18} /></button>
        </header>

        {items.length > 1 ? (
          <nav aria-label={t('选择已解析文档')} className="attachment-extraction-tabs">
            {items.map((item) => {
              const result = item.extraction.result;
              const Icon = result.kind === 'presentation' ? Presentation : FileText;
              return (
                <button
                  className={item.assetId === active?.assetId ? 'is-active' : ''}
                  key={item.assetId}
                  onClick={() => setActiveAssetId(item.assetId)}
                  type="button"
                >
                  <Icon size={14} />
                  <span>{result.fileName}</span>
                </button>
              );
            })}
          </nav>
        ) : null}

        {active ? (
          <>
            <div className="attachment-extraction-summary">
              <div>
                {active.extraction.result.kind === 'presentation' ? <Presentation size={17} /> : <FileText size={17} />}
                <strong>{active.extraction.result.fileName}</strong>
              </div>
              <span>{t('{{0}} 页', { '0': units.length })}</span>
              <span>{t('保留 {{0}} 张图片', { '0': artifacts.length })}</span>
              {filteredArtifacts.length > 0 ? (
                <span>{t('过滤 {{0}} 张图片', { '0': filteredArtifacts.length })}</span>
              ) : null}
            </div>

            <div className="attachment-extraction-body">
              <section className="attachment-extraction-copy">
                <div className="attachment-extraction-column-head">
                  <strong>{t('文档文案')}</strong>
                  <span>{t('按页面顺序展示')}</span>
                </div>
                <div className="attachment-extraction-copy-list">
                  {units.map((unit, index) => (
                    <article key={`${unit.locator.kind}-${unit.locator.index}-${index}`}>
                      <span>{locatorLabel(unit.locator.kind, unit.locator.index)}</span>
                      <p>{unit.text?.trim() || t('本页没有可提取的文案')}</p>
                    </article>
                  ))}
                  {units.length === 0 && (
                    <div className="attachment-extraction-empty">
                      <FileText size={20} />
                      <span>{t('未提取到分页文案')}</span>
                    </div>
                  )}
                </div>
              </section>

              <section className="attachment-extraction-images">
                <div className="attachment-extraction-column-head">
                  <strong>{t('文档图片')}</strong>
                  <span>{t('保留和过滤的图片均可查看')}</span>
                </div>
                <div className="attachment-extraction-image-lists">
                  <ExtractionArtifactGroup
                    artifacts={artifacts}
                    assets={active.assets}
                    emptyText={t('未发现可用图片')}
                    title={t('保留图片')}
                  />
                  {filteredArtifacts.length > 0 ? (
                    <ExtractionArtifactGroup
                      artifacts={filteredArtifacts}
                      assets={active.assets}
                      filtered
                      title={t('已过滤图片')}
                    />
                  ) : null}
                </div>
              </section>
            </div>
          </>
        ) : null}
      </section>
    </Modal>
  );
}

function ExtractionArtifactGroup({
  artifacts,
  assets,
  emptyText,
  filtered = false,
  title,
}: {
  artifacts: ExtractionArtifact[];
  assets: Record<string, ContentAsset>;
  emptyText?: string;
  filtered?: boolean;
  title: string;
}) {
  return (
    <section className="attachment-extraction-image-group">
      <div className="attachment-extraction-image-group-head">
        <strong>{title}</strong>
        <span>{artifacts.length}</span>
      </div>
      <div className="attachment-extraction-image-grid">
        {artifacts.map((artifact) => {
          const asset = assets[artifact.id];
          const src = asset?.fileUrl ? resolveAssetUrl(asset.fileUrl) : '';
          const previewOmitted = artifact.metadata?.previewOmitted === true;
          return (
            <figure className={filtered ? 'is-filtered' : ''} key={artifact.id}>
              {src && !previewOmitted ? (
                <Image alt={artifact.fileName} preview={{ mask: t('查看') }} src={src} />
              ) : (
                <div className="attachment-extraction-image-placeholder"><FileImage size={22} /></div>
              )}
              <figcaption>
                <strong title={artifact.fileName}>{artifact.fileName}</strong>
                <span>
                  {filtered
                    ? t('已被过滤')
                    : artifact.locator
                      ? locatorLabel(artifact.locator.kind, artifact.locator.index)
                      : t('文档素材')}
                </span>
              </figcaption>
            </figure>
          );
        })}
        {artifacts.length === 0 && emptyText ? (
          <div className="attachment-extraction-empty is-images">
            <FileImage size={20} />
            <span>{emptyText}</span>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function locatorLabel(kind: string, index: number) {
  return kind === 'slide'
    ? t('第 {{0}} 页', { '0': index })
    : t('第 {{0}} 页', { '0': index });
}
