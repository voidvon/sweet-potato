import { Modal } from 'antd';
import { AppImage } from '../../../../components/AppImage';
import { ResultVideoPreviewModal } from '../../VideoTaskClonePage/components/ResultVideoPreviewModal';
import { fileUrl, toResultVideoPreview } from './resourceLibraryHelpers';
import type { ContentResourceLibraryController } from './useContentResourceLibraryController';

export function ResourcePreviewLayer({ controller }: { controller: ContentResourceLibraryController }) {
  if (controller.resourceType === 'finished_video') {
    return (
      <>
        {controller.previewAsset?.mimeType.startsWith('video/') && (
          <ResultVideoPreviewModal
            onClose={controller.closePreviewAsset}
            onDelete={() => controller.handleDeleteFinishedAsset(controller.previewAsset!)}
            video={toResultVideoPreview(controller.previewAsset)}
          />
        )}
        <ImagePreview controller={controller} />
      </>
    );
  }

  return (
    <>
      <Modal
        className="asset-library-themed-modal"
        footer={null}
        onCancel={controller.closePreviewAsset}
        open={Boolean(controller.previewAsset)}
        title={controller.previewAsset?.name || '素材预览'}
        width={760}
      >
        {controller.previewAsset && (
          <div className="asset-detail">
            {controller.previewAsset.mimeType.startsWith('video/') && (
              <video controls ref={controller.previewVideoRef} src={fileUrl(controller.previewAsset)} />
            )}
            {controller.previewAsset.mimeType.startsWith('audio/') && <audio controls src={fileUrl(controller.previewAsset)} />}
            <p><strong>文件名：</strong>{controller.previewAsset.originalFileName}</p>
            <p><strong>类型：</strong>{controller.previewAsset.mimeType}</p>
          </div>
        )}
      </Modal>
      <ImagePreview controller={controller} />
    </>
  );
}

function ImagePreview({ controller }: { controller: ContentResourceLibraryController }) {
  return (
    <AppImage
      alt={controller.previewImage?.name || '图片预览'}
      preview={{
        open: controller.previewImageOpen,
        onOpenChange: controller.setPreviewImageOpen,
        afterOpenChange: (open) => { if (!open) controller.setPreviewImage(null); },
      }}
      src={controller.previewImage?.src}
      style={{ display: 'none' }}
    />
  );
}
