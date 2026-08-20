import { Button, Image, Input, Modal } from 'antd'
import { AppButton } from '@shared/components/AppButton'
import { DetailImageUpload } from '../../AssetImageUpload'
import { DigitalHumanResultPreview, previewUrl } from '../digitalHumanHelpers'
import type { DigitalHumanAssetsController } from '../useDigitalHumanAssetsController'
import './DigitalHumanDetailModal.scss'
import { t } from '@shared/i18n';

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
      title={controller.library.activeGroup?.name || t("数字人项目")}
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
        {t("保存名称")}
      </AppButton>
      <Button
        danger
        loading={controller.library.isDeletingGroup}
        onClick={() => void controller.handleDeleteProject()}
      >
        {t("删除")}{controller.label}
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
            {t("因为是")}<strong>{t("本地上传素材")}</strong>
            {t("，该图片会直接作为视频出镜素材使用。")}
          </span>
          {controller.isVirtualPortrait ? (
            <small>{t("素材会同步入库到火山私域人物素材资产库。")}</small>
          ) : null}
        </div>
        <div className="digital-human-local-actions">
          <AppButton
            loading={controller.library.isUploading}
            onClick={() => controller.localReplaceInputRef.current?.click()}
            tone="brand"
            type="primary"
          >
            {t("替换图片")}
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
              {t("下载结果")}
            </Button>
          )}
          <Button
            danger
            loading={controller.library.isDeletingGroup}
            onClick={() => void controller.handleDeleteProject()}
          >
            {t("删除")}{controller.label}
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
            <span>{t("等待上传素材")}</span>
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
            <strong>{t("三视图合成结果")}</strong>
            <span>
              {t("由训练照片合并生成一张标准多视图图，包含全身正/侧/背和头部多角度。")}
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
              {t("重新生成三视图")}
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
                  {t("下载结果")}
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
            {controller.hasTrainingPhotos ? t("训练照片已准备") : t("等待训练照片")}
          </strong>
          <span>
            {t("请尽量提供全身、半身、脸部近景和不同角度照片，三视图结果会由模型训练合成，不是简单拼接上传图片。")}
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
