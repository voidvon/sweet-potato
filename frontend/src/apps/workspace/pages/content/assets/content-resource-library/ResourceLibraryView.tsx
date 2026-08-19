import { Button, Input, Pagination, Popconfirm } from 'antd';
import { Plus, Search, Trash2 } from 'lucide-react';
import { AppButton } from '@shared/components/AppButton';
import {
  AssetLibraryCard,
  AssetLibraryCreateCard,
  AssetLibraryPlaceholderCard,
  AssetLibrarySkeletonCards,
} from '../../../../components/AssetLibraryCard';
import { assetAudioSrc, formatDate, previewFor, productGroupPreview } from './resourceLibraryHelpers';
import type { ContentResourceLibraryController } from './useContentResourceLibraryController';
import './ResourceLibraryView.scss';

type ResourceLibraryViewProps = { controller: ContentResourceLibraryController };

export function ResourceLibraryView({ controller }: ResourceLibraryViewProps) {
  const hasKeyword = controller.searchKeyword.trim().length > 0;

  return (
    <section className="material-page voice-board-page">
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
        <AppButton
          icon={<Plus size={16} />}
          loading={controller.singleDefaultGroup && controller.isUploading}
          onClick={controller.openCreateEntry}
          tone="brand"
          type="primary"
        >
          {controller.copy.addTitle}
        </AppButton>
        {controller.singleDefaultGroup && (
          <input
            accept={controller.copy.accept}
            hidden
            multiple
            onChange={(event) => {
              const files = Array.from(event.target.files || []);
              event.target.value = '';
              void controller.handleUploadFilesToSingleLibrary(files);
            }}
            ref={controller.singleLibraryFilesRef}
            type="file"
          />
        )}
      </div>

      <div className="voice-board-content">
        <div
          className={`material-grid voice-board-grid${controller.singleDefaultGroup ? ' single-library-asset-grid' : ''}`}
          ref={controller.gridRef}
        >
          {!controller.isLoadingLibrary && (
            <AssetLibraryCreateCard
              description={controller.copy.addHint}
              icon={<Plus size={30} />}
              onClick={controller.openCreateEntry}
              title={controller.copy.addTitle}
            />
          )}
          {controller.isLoadingLibrary ? <AssetLibrarySkeletonCards count={1} /> : controller.singleDefaultGroup ? (
            controller.singleLibraryPagedAssets.map((asset) => (
              <article className="material-card single-library-asset-card" key={asset.id}>
                <button className="material-preview" onClick={() => controller.openAssetPreview(asset)} type="button">
                  {previewFor(asset, controller.copy.icon)}
                </button>
                <div className="material-info">
                  <div className="material-name" title={asset.name}>{asset.name}</div>
                  <div className="material-meta">上传于 {formatDate(asset.createdAt)}</div>
                  <Popconfirm
                    cancelButtonProps={{ className: 'asset-library-popconfirm-cancel' }}
                    cancelText="取消"
                    okButtonProps={{ className: 'asset-library-popconfirm-confirm' }}
                    okText="删除"
                    onConfirm={() => void controller.handleDeleteAsset(asset.id)}
                    overlayClassName="asset-library-themed-popconfirm"
                    title="确认删除这个素材吗？"
                  >
                    <Button danger icon={<Trash2 size={14} />} size="small" type="text">删除</Button>
                  </Popconfirm>
                </div>
              </article>
            ))
          ) : controller.filteredGroups.map((group) => {
            const groupAssets = controller.assets.filter((asset) => asset.groupId === group.id);
            const cover = groupAssets[0];
            return (
              <AssetLibraryCard
                audioSrc={assetAudioSrc(cover)}
                audioTitle={group.name}
                key={group.id}
                meta={controller.groupMeta(group)}
                onClick={() => controller.openGroup(group)}
                preview={controller.resourceType === 'product'
                  ? productGroupPreview(groupAssets, controller.copy.icon)
                  : cover ? previewFor(cover, controller.copy.icon) : controller.copy.icon}
                previewClassName={controller.resourceType === 'product' ? undefined : 'material-preview'}
                status={controller.groupStatus(group)}
                title={group.name}
              />
            );
          })}
          {!controller.isLoadingLibrary
            && ((controller.singleDefaultGroup && !controller.singleLibraryCardAssets.length)
              || (!controller.singleDefaultGroup && !controller.filteredGroups.length))
            && (
              <AssetLibraryPlaceholderCard
                description={hasKeyword ? '调整搜索条件，或上传新的素材。' : controller.copy.emptyGroups}
                icon={<Search size={30} />}
                title={hasKeyword ? `暂无匹配${controller.copy.pageTitle}` : `暂无${controller.copy.pageTitle}`}
              />
            )}
        </div>
      </div>

      <div className="voice-board-pagination">
        <span>共 {controller.singleDefaultGroup ? controller.singleLibraryCardAssets.length : controller.groups.length} 条</span>
        {controller.singleDefaultGroup && (
          <Pagination
            current={controller.singleLibraryPage}
            onChange={controller.setSingleLibraryPage}
            pageSize={controller.singleLibraryPageSize}
            showSizeChanger={false}
            total={controller.singleLibraryCardAssets.length}
          />
        )}
      </div>
    </section>
  );
}
