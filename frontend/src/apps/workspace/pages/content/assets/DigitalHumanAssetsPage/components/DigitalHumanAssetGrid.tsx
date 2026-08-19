import { Button, Input, Pagination } from 'antd'
import { Plus, RefreshCw, Search } from 'lucide-react'
import { AppButton } from '@shared/components/AppButton'
import {
  AssetLibraryCard,
  AssetLibraryCreateCard,
  AssetLibraryPlaceholderCard,
  AssetLibrarySkeletonCards,
} from '../../../../../components/AssetLibraryCard'
import {
  formatDate,
  isThreeViewFailure,
  isThreeViewResult,
  isThreeViewRunning,
  photoPreview,
} from '../digitalHumanHelpers'
import type { DigitalHumanAssetsController } from '../useDigitalHumanAssetsController'
import './DigitalHumanAssetGrid.scss'

export function DigitalHumanAssetGrid({
  controller,
}: {
  controller: DigitalHumanAssetsController
}) {
  const hasKeyword = controller.searchKeyword.trim().length > 0
  return (
    <section className="material-page digital-human-page voice-board-page">
      <div className="voice-board-toolbar">
        <Input
          allowClear
          className="voice-board-search"
          onChange={(event) => controller.setSearchKeyword(event.target.value)}
          placeholder="搜索素材名称..."
          prefix={<Search size={17} />}
          size="large"
          value={controller.searchKeyword}
        />
        <div className="voice-board-toolbar-spacer" />
        {controller.isVirtualPortrait &&
          controller.currentUser.role === 'admin' && (
            <Button
              icon={<RefreshCw size={16} />}
              loading={controller.isSyncingRemoteLibrary}
              onClick={() => void controller.handleSyncRemoteLibrary()}
            >
              从云端同步
            </Button>
          )}
        <AppButton
          icon={<Plus size={16} />}
          onClick={() => controller.openCreateModal('local')}
          tone="brand"
          type="primary"
        >
          本地上传
        </AppButton>
      </div>
      <div className="voice-board-content">
        <div
          className="digital-human-grid voice-board-grid"
          ref={controller.gridRef}
        >
          {!controller.library.isLoadingGroups && (
            <AssetLibraryCreateCard
              description={
                controller.isVirtualPortrait ? '本地上传' : '本地上传或AI生成'
              }
              icon={<Plus size={30} />}
              onClick={
                controller.isVirtualPortrait
                  ? () => controller.openCreateModal('local')
                  : controller.openCreateChoice
              }
              title={`添加${controller.label}素材`}
            />
          )}
          {controller.library.isLoadingGroups ? (
            <AssetLibrarySkeletonCards count={1} />
          ) : (
            controller.filteredGroups.map((group) => {
              const assets = controller.library.groupAssets(group.id)
              const result = assets.find(isThreeViewResult)
              const failure = assets.find(isThreeViewFailure)
              const running = assets.find(isThreeViewRunning)
              const photos = assets.filter(
                (asset) =>
                  !isThreeViewResult(asset) &&
                  !isThreeViewFailure(asset) &&
                  !isThreeViewRunning(asset),
              )
              const isGenerating =
                controller.generatingThreeViewGroupIds.has(group.id) ||
                Boolean(running)
              const assetCount = group.assetCount ?? assets.length
              const isLocalUpload = group.metadata?.source === 'local_upload'
              return (
                <AssetLibraryCard
                  key={group.id}
                  meta={`${!isLocalUpload && assetCount ? `${assetCount} 个素材 · ` : ''}更新于 ${formatDate(group.updatedAt)}`}
                  onClick={() => void controller.openDetail(group.id)}
                  preview={photoPreview(result || photos[0])}
                  previewClassName="digital-human-cover"
                  status={
                    isLocalUpload
                      ? '本地上传'
                      : isGenerating
                        ? '三视图生成中'
                        : failure
                          ? '三视图生成失败'
                          : result
                            ? 'AI生成'
                            : assetCount
                              ? '待训练合成三视图'
                              : '待上传本人照片'
                  }
                  title={group.name}
                />
              )
            })
          )}
          {!controller.library.isLoadingGroups &&
            !controller.filteredGroups.length && (
              <AssetLibraryPlaceholderCard
                description={
                  hasKeyword
                    ? `调整搜索条件，或新增一个${controller.label}。`
                    : `上传${controller.label}图片后，会展示在这里。`
                }
                icon={<Search size={30} />}
                title={
                  hasKeyword
                    ? `暂无匹配${controller.label}素材`
                    : `暂无${controller.label}素材`
                }
              />
            )}
        </div>
      </div>
      <div className="voice-board-pagination">
        <span>共 {controller.library.groupTotal} 条</span>
        <Pagination
          current={controller.library.groupPage}
          onChange={controller.library.setGroupPage}
          pageSize={controller.library.groupPageSize}
          showSizeChanger={false}
          total={controller.library.groupTotal}
        />
      </div>
    </section>
  )
}
