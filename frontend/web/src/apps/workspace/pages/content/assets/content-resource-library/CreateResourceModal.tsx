import { Input, Modal } from 'antd';
import { PendingImageUpload } from '../AssetImageUpload';
import { PendingAssetGrid } from './PendingAssetGrid';
import type { ContentResourceLibraryController } from './useContentResourceLibraryController';

export function CreateResourceModal({ controller }: { controller: ContentResourceLibraryController }) {
  return (
    <Modal
      className="asset-library-themed-modal"
      confirmLoading={controller.isUploading}
      okText={controller.copy.createOkText}
      onCancel={() => controller.setCreateModalOpen(false)}
      onOk={() => void controller.handleCreateGroupWithAssets()}
      open={controller.createModalOpen}
      title={controller.copy.addTitle}
    >
      <div className="material-modal-form">
        {!controller.singleDefaultGroup && (
          <label>
            <span>{controller.copy.nameLabel}</span>
            <Input
              onChange={(event) => controller.setGroupName(event.target.value)}
              onPressEnter={() => void controller.handleCreateGroupWithAssets()}
              placeholder={controller.copy.namePlaceholder}
              value={controller.groupName}
            />
          </label>
        )}
        {controller.resourceType === 'product' || controller.singleDefaultGroup ? (
          <PendingImageUpload
            files={controller.pendingCreateFiles}
            onChange={controller.setPendingCreateFiles}
            onPreviewFile={controller.openImagePreview}
          />
        ) : (
          <>
            <PendingAssetGrid
              files={controller.pendingCreateFiles}
              onAdd={() => controller.createFilesRef.current?.click()}
              onRemove={(file) => controller.setPendingCreateFiles((files) => files.filter((item) => item !== file))}
            />
            <input
              accept={controller.copy.accept}
              hidden
              multiple
              onChange={(event) => controller.setPendingCreateFiles(Array.from(event.target.files || []))}
              ref={controller.createFilesRef}
              type="file"
            />
          </>
        )}
      </div>
    </Modal>
  );
}
