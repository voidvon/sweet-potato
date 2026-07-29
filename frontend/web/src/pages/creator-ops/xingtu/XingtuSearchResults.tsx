import type { RefObject } from 'react';
import { Button, Pagination, Typography } from 'antd';
import { CreatorResultsTable, type CreatorSearchResult } from '../CreatorResultsTable';
import type { CreatorOpsPlatform } from '../creatorOpsPlatforms';
import { SEARCH_MODE_LABELS, XINGTU_PAGINATION_LOCALE, type ExecutedCreatorSearch, type XingtuCreatorSearchPagination } from './pageTypes';

type XingtuSearchResultsProps = {
  isSearching: boolean;
  lastExecutedSearch: ExecutedCreatorSearch | null;
  lastSearchKeyword: string;
  onOpenProfile: (record: CreatorSearchResult) => void;
  onPageChange: (page: number) => void;
  platform: CreatorOpsPlatform;
  results: CreatorSearchResult[];
  resultsFooterRef: RefObject<HTMLDivElement | null>;
  resultsHeaderRef: RefObject<HTMLDivElement | null>;
  resultsPanelRef: RefObject<HTMLElement | null>;
  resultsTableScrollY: number;
  searchPagination: XingtuCreatorSearchPagination | null;
  supportsSearchModes: boolean;
};

export function XingtuSearchResults({
  isSearching,
  lastExecutedSearch,
  lastSearchKeyword,
  onOpenProfile,
  onPageChange,
  platform,
  results,
  resultsFooterRef,
  resultsHeaderRef,
  resultsPanelRef,
  resultsTableScrollY,
  searchPagination,
  supportsSearchModes,
}: XingtuSearchResultsProps) {
  return (
    <section className="xingtu-search-results" ref={resultsPanelRef}>
      <div className="xingtu-search-results-header" ref={resultsHeaderRef}>
        <Typography.Title level={5}>搜索结果</Typography.Title>
        <Typography.Text type="secondary">
          {supportsSearchModes && lastExecutedSearch ? `${SEARCH_MODE_LABELS[lastExecutedSearch.searchMode]}：${lastSearchKeyword}` : lastSearchKeyword}
        </Typography.Text>
      </div>
      <div className="xingtu-search-results-table-shell">
        <CreatorResultsTable
          loading={isSearching}
          onOpenProfile={onOpenProfile}
          platform={platform}
          results={results}
          resultsMode={{ type: 'pagination' }}
          scroll={{ x: 910, y: resultsTableScrollY }}
        />
      </div>
      {searchPagination ? (
        <div className="xingtu-search-results-footer" ref={resultsFooterRef}>
          <div className="xingtu-search-results-footer-meta">
            <Typography.Text type="secondary">
              第 {searchPagination.currentPage} / {searchPagination.totalPages} 页
            </Typography.Text>
            <Typography.Text type="secondary">
              每页 {searchPagination.pageSize} 条
            </Typography.Text>
          </div>
          <Pagination
            className="xingtu-search-results-pagination"
            current={searchPagination.currentPage}
            disabled={isSearching}
            locale={XINGTU_PAGINATION_LOCALE}
            onChange={onPageChange}
            pageSize={searchPagination.pageSize}
            showQuickJumper={searchPagination.showQuickJumper}
            showSizeChanger={false}
            total={Math.max(searchPagination.estimatedTotal, searchPagination.totalPages * searchPagination.pageSize)}
            itemRender={(_, type, originalElement) => {
              if (type === 'prev') {
                return (
                  <Button
                    className="xingtu-search-results-page-button"
                    disabled={isSearching || searchPagination.currentPage <= 1}
                    size="small"
                    type="text"
                  >
                    上一页
                  </Button>
                );
              }
              if (type === 'next') {
                return (
                  <Button
                    className="xingtu-search-results-page-button"
                    disabled={isSearching || searchPagination.currentPage >= searchPagination.totalPages}
                    size="small"
                    type="text"
                  >
                    下一页
                  </Button>
                );
              }
              return originalElement;
            }}
          />
        </div>
      ) : null}
    </section>
  );
}
