import { Button, Image, Input, Modal } from 'antd'
import { AppButton } from '@shared/components/AppButton'
import { DetailImageUpload } from '../../AssetImageUpload'
import { DigitalHumanResultPreview, previewUrl } from '../digitalHumanHelpers'
import type { DigitalHumanAssetsController } from '../useDigitalHumanAssetsController'
import './DigitalHumanDetailModal.scss'

export function DigitalHumanDetailModal({
  controller,
}: {
  controller: DigitalHumanAssetsController
}) {
  return (
    <Modal
      className="asset-library-themed-modal digital-human-detail-modal"
      footer={null}
      onCancel={() => controller.setDetailOpen(false)}
      open={controller.detailOpen}
      title={controller.library.activeGroup?.name || '数字人项目'}
      width={1020}
    >
      {controller.library.activeGroup && (
        <div className="digital-human-detail-workspace">
          {!controller.isLocalUploadGroup && (
            <ProjectNameEditor controller={controller} />
          )}
          {controller.isLocalUploadGroup ? (
            <LocalAssetDetail controller={controller} />
          ) : (
            <GeneratedAssetDetail controller={controller} />
          )}
        </div>
      )}
    </Modal>
  )
}

function ProjectNameEditor({
  controller,
}: {
  controller: DigitalHumanAssetsController
}) {
  return (
    <div className="material-group-editor">
      <Input
        onChange={(event) => controller.setEditingName(event.target.value)}
        value={controller.editingName}
      />
      <AppButton
        onClick={() =>
          void controller.library.renameGroup(
            controller.library.activeGroup!.id,
            controller.editingName,
          )
        }
        tone="brand"
        type="primary"
      >
        保存名称
      </AppButton>
      <Button
        danger
        loading={controller.library.isDeletingGroup}
        onClick={() => void controller.handleDeleteProject()}
      >
        删除{controller.label}
      </Button>
    </div>
  )
}

function LocalAssetDetail({
  controller,
}: {
  controller: DigitalHumanAssetsController
}) {
  return (
    <div className="digital-human-local-detail">
      <div className="digital-human-local-header">
        <div>
          <span>
            因为是<strong>本地上传素材</strong>
            ，该图片会直接作为视频出镜素材使用。
          </span>
          {controller.isVirtualPortrait ? (
            <small>素材会同步入库到火山私域人物素材资产库。</small>
          ) : null}
        </div>
        <div className="digital-human-local-actions">
          <AppButton
            loading={controller.library.isUploading}
            onClick={() => controller.localReplaceInputRef.current?.click()}
            tone="brand"
            type="primary"
          >
            替换图片
          </AppButton>
          {controller.activeThreeViewResult && (
            <Button
              className="asset-detail-secondary-button"
              onClick={() =>
                void controller.handleDownloadThreeView(
                  controller.activeThreeViewResult!,
                )
              }
            >
              下载结果
            </Button>
          )}
          <Button
            danger
            loading={controller.library.isDeletingGroup}
            onClick={() => void controller.handleDeleteProject()}
          >
            删除{controller.label}
          </Button>
        </div>
      </div>
      <div className="digital-human-local-preview">
        {controller.activeThreeViewResult ? (
          <Image
            alt={controller.activeThreeViewResult.name}
            preview={{
              mask: false,
              rootClassName: 'digital-human-preview-root',
              src: previewUrl(controller.activeThreeViewResult),
            }}
            src={previewUrl(controller.activeThreeViewResult)}
          />
        ) : (
          <div className="digital-human-result-placeholder">
            <span>等待上传素材</span>
          </div>
        )}
      </div>
      <input
        accept="image/*"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void controller.handleReplaceLocalDigitalHuman(file)
          event.target.value = ''
        }}
        ref={controller.localReplaceInputRef}
        type="file"
      />
    </div>
  )
}

function GeneratedAssetDetail({
  controller,
}: {
  controller: DigitalHumanAssetsController
}) {
  return (
    <>
      <div className="digital-human-result-panel">
        <div className="digital-human-result-header">
          <div className="digital-human-result-heading">
            <strong>三视图合成结果</strong>
            <span>
              由训练照片合并生成一张标准多视图图，包含全身正/侧/背和头部多角度。
            </span>
          </div>
          <div className="digital-human-result-header-actions">
            <AppButton
              disabled={
                !controller.hasTrainingPhotos ||
                controller.isActiveGroupGenerating
              }
              loading={controller.isActiveGroupGenerating}
              onClick={() => void controller.handleGenerateThreeView()}
              tone="brand"
              type="primary"
            >
              重新生成三视图
            </AppButton>
            {controller.activeThreeViewResult &&
              !controller.isActiveGroupGenerating &&
              !controller.activeGroupFailureReason && (
                <Button
                  className="asset-detail-secondary-button"
                  onClick={() =>
                    void controller.handleDownloadThreeView(
                      controller.activeThreeViewResult!,
                    )
                  }
                >
                  下载结果
                </Button>
              )}
          </div>
        </div>
        <div className="digital-human-result-canvas">
          <DigitalHumanResultPreview
            asset={controller.activeThreeViewResult}
            failureReason={controller.activeGroupFailureReason}
            isGenerating={controller.isActiveGroupGenerating}
          />
        </div>
      </div>
      <div className="digital-human-workflow-action">
        <div>
          <strong>
            {controller.hasTrainingPhotos ? '训练照片已准备' : '等待训练照片'}
          </strong>
          <span>
            请尽量提供全身、半身、脸部近景和不同角度照片，三视图结果会由模型训练合成，不是简单拼接上传图片。
          </span>
        </div>
      </div>
      <DetailImageUpload
        assets={controller.editableAssets}
        isUploading={controller.library.isUploading}
        onPreviewImage={controller.setPreviewImage}
        onRemoveAsset={(asset) => void controller.library.removeAsset(asset.id)}
        onUploadFiles={(files) =>
          void controller.library.uploadToActiveGroup(files, {
            source: 'ai_generate',
            kind: 'training_photo',
          })
        }
      />
    </>
  )
}
