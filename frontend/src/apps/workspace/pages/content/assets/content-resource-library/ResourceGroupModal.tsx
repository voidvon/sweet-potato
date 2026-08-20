import { Button, Input, Modal } from 'antd';
import { DetailImageUpload } from '../AssetImageUpload';
import { PendingAssetGrid } from './PendingAssetGrid';
import { formatDate, previewFor } from './resourceLibraryHelpers';
import type { ContentResourceLibraryController } from './useContentResourceLibraryController';
import './ResourceGroupModal.scss';
import { t } from '@shared/i18n';

export function ResourceGroupModal({ controller }: { controller: ContentResourceLibraryController }) {
  const groupReady = controller.singleDefaultGroup || controller.activeGroup;

  return (
    <Modal
      className="asset-library-themed-modal"
      footer={null}
      onCancel={() => controller.setGroupModalOpen(false)}
      open={controller.groupModalOpen}
      title={controller.singleDefaultGroup ? controller.copy.pageTitle : controller.activeGroup?.name || t("素材分组")}
      width={980}
    >
      {groupReady && (
        <div className="material-group-detail">
          {!controller.singleDefaultGroup ? (
            <div className="material-group-editor">
              <Input onChange={(event) => controller.setEditingGroupName(event.target.value)} value={controller.editingGroupName} />
              <Button onClick={() => void controller.handleRenameGroup()} type="primary">{t("保存名称")}</Button>
              {controller.resourceType !== 'product' && (
                <>
                  <Button onClick={() => controller.groupFilesRef.current?.click()}>{controller.copy.detailUploadText}</Button>
                  <Button
                    disabled={!controller.pendingGroupFiles.length}
                    loading={controller.isUploading}
                    onClick={() => void controller.handleUploadToActiveGroup()}
                    type="primary"
                  >
                    {controller.copy.detailAddText} {controller.pendingGroupFiles.length || ''}
                  </Button>
                </>
              )}
              <Button danger loading={controller.isDeletingGroup} onClick={() => void controller.handleDeleteGroup()}>
                {t("删除")}{controller.copy.defaultGroup}
              </Button>
              {controller.resourceType !== 'product' && <GroupFileInput controller={controller} />}
            </div>
          ) : controller.resourceType !== 'product' ? (
            <div className="material-group-editor">
              <Button onClick={() => controller.groupFilesRef.current?.click()}>{controller.copy.detailUploadText}</Button>
              <Button
                disabled={!controller.pendingGroupFiles.length}
                loading={controller.isUploading}
                onClick={() => void controller.handleUploadToSingleLibrary()}
                type="primary"
              >
                {controller.copy.detailAddText} {controller.pendingGroupFiles.length || ''}
              </Button>
              <GroupFileInput controller={controller} />
            </div>
          ) : null}

          {controller.resourceType === 'product' ? (
            <DetailImageUpload
              assets={controller.singleLibraryDetailAssets}
              isUploading={controller.isUploading}
              onPreviewImage={controller.openImagePreview}
              onRemoveAsset={(asset) => void controller.handleDeleteAsset(asset.id)}
              onUploadFiles={(files) => void (controller.singleDefaultGroup
                ? controller.handleUploadFilesToSingleLibrary(files)
                : controller.handleUploadFilesToActiveGroup(files))}
            />
          ) : controller.pendingGroupFiles.length ? (
            <PendingAssetGrid
              files={controller.pendingGroupFiles}
              onAdd={() => controller.groupFilesRef.current?.click()}
              onRemove={(file) => controller.setPendingGroupFiles((files) => files.filter((item) => item !== file))}
            />
          ) : null}

          {controller.resourceType !== 'product' && (
            <div className="material-grid material-grid-compact">
              {controller.singleDefaultGroup && (
                <div className="scene-management-summary">
                  <strong>{controller.singleLibraryDetailAssets.length} {controller.copy.assetUnit}</strong>
                  <span>{controller.copy.pageDescription}</span>
                </div>
              )}
              {controller.singleLibraryDetailAssets.length ? controller.singleLibraryDetailAssets.map((asset) => (
                <article className="material-card" key={asset.id}>
                  <button className="material-preview" onClick={() => controller.openAssetPreview(asset)} type="button">
                    {previewFor(asset, controller.copy.icon)}
                  </button>
                  <div className="material-info">
                    <div className="material-name">{asset.name}</div>
                    <div className="material-meta">{t("上传于")} {formatDate(asset.createdAt)}</div>
                    <Button danger onClick={() => void controller.handleDeleteAsset(asset.id)} size="small">{t("删除素材")}</Button>
                  </div>
                </article>
              )) : <div className="material-empty-inline">{controller.copy.emptyAssets}</div>}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function GroupFileInput({ controller }: { controller: ContentResourceLibraryController }) {
  return (
    <input
      accept={controller.copy.accept}
      hidden
      multiple
      onChange={(event) => controller.setPendingGroupFiles(Array.from(event.target.files || []))}
      ref={controller.groupFilesRef}
      type="file"
    />
  );
}
