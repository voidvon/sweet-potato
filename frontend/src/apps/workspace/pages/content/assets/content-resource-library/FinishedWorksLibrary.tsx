import { Button, Dropdown } from 'antd';
import type { MenuProps } from 'antd';
import { ListFilter } from 'lucide-react';
import { AppSegmentedTabs } from '../../../../components/AppSegmentedTabs';
import { InfiniteScroll } from '../../../../components/InfiniteScroll';
import { WorksAssetCard, WorksAssetEmptyCard, WorksAssetSkeletonCard } from '../WorksAssetCard';
import { allWorksFunctionOption, showWorksBatchButton } from './resourceLibraryConfig';
import type { ContentResourceLibraryController } from './useContentResourceLibraryController';
import './FinishedWorksLibrary.scss';

type FinishedWorksLibraryProps = {
  controller: ContentResourceLibraryController;
};

export function FinishedWorksLibrary({ controller }: FinishedWorksLibraryProps) {
  const menuItems: MenuProps['items'] = controller.worksFunctionOptions.map((option) => ({
    key: option.key,
    label: option.label,
  }));
  const selectedFunctionLabel = controller.worksFunctionOptions
    .find((option) => option.key === controller.worksFunctionKey)?.label || allWorksFunctionOption.label;
  const emptyTitle = controller.worksAssetTab === 'image'
    ? '暂无图片作品'
    : controller.worksAssetTab === 'video' ? '暂无视频作品' : '暂无作品';
  const emptyDescription = controller.worksAssetTab === 'all' ? '作品生成后自动同步。' : '生成后自动同步。';
  const hasKeyword = controller.searchKeyword.trim().length > 0;

  return (
    <section className="material-page voice-board-page works-assets-page">
      <div className="works-assets-shell">
        <header className="works-assets-header">
          <div className="works-assets-title-row">
            <h1>作品</h1>
            <span>已加载 {controller.visibleWorksAssets.length} / {controller.filteredAssets.length} 个结果</span>
          </div>
          <div className="works-assets-control-row">
            <AppSegmentedTabs
              ariaLabel="作品类型"
              itemMinWidth={60}
              onChange={controller.handleWorksAssetTabChange}
              options={[
                { value: 'all', label: '全部' },
                { value: 'image', label: '图片' },
                { value: 'video', label: '视频' },
              ]}
              size="large"
              value={controller.worksAssetTab}
            />
            <Dropdown
              menu={{
                items: menuItems,
                onClick: ({ key }) => controller.setWorksFunctionKey(String(key)),
                selectable: true,
                selectedKeys: [controller.worksFunctionKey],
              }}
              overlayClassName="works-function-menu"
              placement="bottomLeft"
              trigger={['click']}
            >
              <Button className="works-function-button" icon={<ListFilter size={14} />} size="large">
                {selectedFunctionLabel}
              </Button>
            </Dropdown>
            <Button className="works-reset-button" onClick={controller.resetWorksHeaderFilters} size="large" type="text">重置</Button>
            <div className="works-assets-toolbar-spacer" />
            {showWorksBatchButton && <Button className="works-batch-button" size="large">批量管理</Button>}
          </div>
        </header>
        <InfiniteScroll
          className="voice-board-content"
          dataLength={controller.visibleWorksAssets.length}
          disabled={controller.isLoadingLibrary}
          endText="已加载全部作品"
          hasMore={controller.hasMoreWorksAssets}
          onLoadMore={controller.loadMoreWorksAssets}
        >
          {controller.isLoadingLibrary ? (
            <div className="material-grid voice-board-grid"><WorksAssetSkeletonCard /></div>
          ) : controller.visibleWorksAssetGroups.map((group) => (
            <section className="works-assets-date-group" key={group.key}>
              <div className="works-assets-date-heading"><h2>{group.label}</h2><span>{group.assets.length} 个作品</span></div>
              <div className="material-grid voice-board-grid">
                {group.assets.map((asset) => (
                  <WorksAssetCard
                    asset={asset}
                    key={asset.id}
                    onDelete={() => void controller.handleDeleteFinishedAsset(asset)}
                    onOpen={controller.finishedVideoStatus(asset) === 'completed' && asset.fileUrl
                      ? () => controller.openAssetPreview(asset)
                      : undefined}
                  />
                ))}
              </div>
            </section>
          ))}
          {!controller.isLoadingLibrary && !controller.filteredAssets.length && (
            <div className="material-grid voice-board-grid">
              <WorksAssetEmptyCard
                description={hasKeyword ? '调整搜索条件，或先生成一个作品。' : emptyDescription}
                title={hasKeyword ? '暂无匹配作品' : emptyTitle}
              />
            </div>
          )}
        </InfiniteScroll>
      </div>
    </section>
  );
}
