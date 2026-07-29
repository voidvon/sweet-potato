import type { RefObject } from 'react'
import { Typography, type TableProps } from 'antd'
import { CreatorResultsSection } from '../CreatorResultsSection'
import { CreatorResultsTable } from '../CreatorResultsTable'
import { getDouyinResultRowKey, getLastSearchKeyword } from './pageHelpers'
import type { DouyinSearchRecord } from './pageTypes'
import type { AutomationTask } from '../../../ipc'
import './DouyinSearchResults.scss'

type DouyinSearchResultsProps = {
  columns: TableProps<DouyinSearchRecord>['columns']
  hasMoreResults: boolean
  isLoadingMore: boolean
  onConnectSelected: () => void
  onLoadMore: () => void
  results: DouyinSearchRecord[]
  resultsHeaderRef: RefObject<HTMLDivElement | null>
  resultsPanelRef: RefObject<HTMLElement | null>
  resultsTableScrollY: number
  rowSelection: TableProps<DouyinSearchRecord>['rowSelection']
  running: boolean
  searchTask: AutomationTask | null
  selectedCount: number
}

export function DouyinSearchResults({
  columns,
  hasMoreResults,
  isLoadingMore,
  onConnectSelected,
  onLoadMore,
  results,
  resultsHeaderRef,
  resultsPanelRef,
  resultsTableScrollY,
  rowSelection,
  running,
  searchTask,
  selectedCount,
}: DouyinSearchResultsProps) {
  const lastSearchKeyword = getLastSearchKeyword(searchTask)

  return (
    <section className="douyin-results-panel" ref={resultsPanelRef}>
      <div className="douyin-results-panel-header" ref={resultsHeaderRef}>
        <div>
          <Typography.Title level={4}>达人搜索结果</Typography.Title>
          <Typography.Paragraph type="secondary">
            {lastSearchKeyword
              ? `当前展示 “${lastSearchKeyword}” 的抖音达人搜索结果。`
              : '当前搜索会绑定到选中的 Profile，并在下方展示抖音达人搜索结果。'}
          </Typography.Paragraph>
        </div>
      </div>

      <div className="douyin-results-panel-body">
        <CreatorResultsSection
          actionDisabled={!selectedCount}
          emptyDescription={running ? '正在搜索抖音达人' : '暂无达人搜索结果'}
          hasResults={results.length > 0}
          onAction={onConnectSelected}
          selectedCount={selectedCount}
          table={(
            <CreatorResultsTable
              className="douyin-search-results-table"
              columns={columns}
              dataSource={results}
              loading={running || isLoadingMore}
              locale={{ emptyText: running ? '正在搜索抖音达人' : '暂无达人搜索结果' }}
              pagination={false}
              platform="douyin"
              rowKey={getDouyinResultRowKey}
              rowSelection={rowSelection}
              resultsMode={{
                type: 'infinite',
                infiniteScroll: {
                  disabled: running || !hasMoreResults,
                  loading: isLoadingMore,
                  onLoadMore,
                },
              }}
              scroll={{ x: 1180, y: resultsTableScrollY }}
              size="middle"
              tableLayout="auto"
            />
          )}
        />
      </div>
    </section>
  )
}
