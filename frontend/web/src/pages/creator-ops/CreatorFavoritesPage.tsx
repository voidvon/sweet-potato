import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Empty, Tag, Tooltip, Typography } from 'antd';
import { StarFilled } from '@ant-design/icons';
import { CreatorResultsTable, type CreatorSearchResult } from './CreatorResultsTable';
import {
  type DouyinFavoriteCreatorRecord,
  formatDouyinFavoriteId,
  readFavoriteCreatorRecords,
  writeFavoriteCreatorRecords,
} from './douyinFavoriteCreatorsStorage';
import { useRemainingTableHeight } from './useRemainingTableHeight';
import './CreatorFavoritesPage.scss';

export function CreatorFavoritesPage() {
  const [favorites, setFavorites] = useState<DouyinFavoriteCreatorRecord[]>(() => readFavoriteCreatorRecords());
  const resultsPanelRef = useRef<HTMLElement | null>(null);
  const resultsHeaderRef = useRef<HTMLDivElement | null>(null);
  const resultsTableScrollY = useRemainingTableHeight(
    resultsPanelRef,
    resultsHeaderRef,
    [favorites.length],
    { gap: 22, minHeight: 240 },
  );

  useEffect(() => {
    const syncFavorites = () => {
      setFavorites(readFavoriteCreatorRecords());
    };

    window.addEventListener('storage', syncFavorites);
    return () => {
      window.removeEventListener('storage', syncFavorites);
    };
  }, []);

  const columns = useMemo(() => ([
    {
      dataIndex: 'name',
      key: 'creatorInfo',
      title: '达人信息',
      minWidth: 280,
      render: (_value: string, record: CreatorSearchResult) => {
        const href = String(record.href || '').trim();
        const avatarContent = record.avatarUrl
          ? <img alt={record.name} referrerPolicy="no-referrer" src={record.avatarUrl} />
          : <span>{record.name.slice(0, 1)}</span>;

        return (
          <div className="creator-favorites-cell-creator">
            <div className="creator-favorites-cell-avatar">
              {href ? (
                <a className="creator-favorites-cell-avatar-link" href={href} rel="noreferrer" target="_blank">
                  {avatarContent}
                </a>
              ) : avatarContent}
            </div>
            <div className="creator-favorites-cell-main">
              <div className="creator-favorites-cell-title">
                {href ? (
                  <a className="creator-favorites-cell-title-link" href={href} rel="noreferrer" target="_blank">
                    {record.name || '-'}
                  </a>
                ) : (record.name || '-')}
              </div>
              <div className="creator-favorites-cell-meta">
                {record.profileName ? <Tag bordered={false}>{record.profileName}</Tag> : null}
                {record.creatorType ? <Tag bordered={false}>{record.creatorType}</Tag> : null}
              </div>
            </div>
          </div>
        );
      },
    },
    {
      dataIndex: 'douyinId',
      key: 'douyinId',
      title: '抖音号',
      width: 180,
      render: (value: string | undefined) => formatDouyinFavoriteId(value) || '-',
    },
    {
      dataIndex: 'likeCount',
      key: 'likeCount',
      title: '获赞',
      width: 140,
      render: (value: string | undefined) => value || '-',
    },
    {
      dataIndex: 'followerCount',
      key: 'followerCount',
      title: '粉丝',
      width: 140,
      render: (value: string | undefined) => value || '-',
    },
    {
      dataIndex: 'intro',
      key: 'intro',
      title: '简介',
      width: 320,
      render: (value: string | undefined, record: CreatorSearchResult) => value || record.summary || '-',
    },
    {
      dataIndex: 'favoritedAt',
      key: 'favoritedAt',
      title: '收藏时间',
      width: 180,
      render: (value: string | undefined) => value ? new Date(value).toLocaleString() : '-',
    },
    {
      key: 'action',
      title: '操作',
      width: 88,
      render: (_value: unknown, record: CreatorSearchResult) => (
        <div className="creator-favorites-cell-action">
          <Tooltip title="取消收藏">
            <Button
              aria-label="取消收藏"
              className="creator-favorites-remove-button"
              icon={<StarFilled />}
              onClick={() => {
                const favoriteKey = (record as DouyinFavoriteCreatorRecord).favoriteKey;
                const nextFavorites = favorites.filter((item) => item.favoriteKey !== favoriteKey);
                setFavorites(nextFavorites);
                writeFavoriteCreatorRecords(nextFavorites);
              }}
              shape="circle"
              type="text"
            />
          </Tooltip>
        </div>
      ),
    },
  ]), [favorites]);

  return (
    <div className="creator-favorites-page">
      <section className="creator-favorites-panel" ref={resultsPanelRef}>
        <div className="creator-favorites-panel-header" ref={resultsHeaderRef}>
          <div>
            <Typography.Title level={4}>达人收藏</Typography.Title>
            <Typography.Paragraph type="secondary">
              当前展示已收藏的抖音达人，可在抖音达人页面继续新增收藏。
            </Typography.Paragraph>
          </div>
          <Tag color="gold">{favorites.length} 个</Tag>
        </div>
        <div className="creator-favorites-panel-body">
          {favorites.length ? (
            <CreatorResultsTable
              className="creator-favorites-table"
              columns={columns}
              dataSource={favorites}
              loading={false}
              pagination={false}
              platform="douyin"
              rowKey={(record) => (record as DouyinFavoriteCreatorRecord).favoriteKey}
              scroll={{ x: 1180, y: resultsTableScrollY }}
              size="middle"
              tableLayout="auto"
            />
          ) : (
            <Empty description="暂无收藏达人" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          )}
        </div>
      </section>
    </div>
  );
}
