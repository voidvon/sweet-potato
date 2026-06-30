import { useCallback, useRef } from 'react';
import type { ReactNode, UIEvent } from 'react';
import { Button, Table, Tag } from 'antd';
import type { TableProps } from 'antd';
import type { CreatorOpsPlatform } from './creatorOpsPlatforms';

export type CreatorSearchResult = {
  name: string;
  summary: string;
  href?: string;
  avatarUrl?: string;
  creatorBadgeIconUrl?: string;
  gender?: string;
  location?: string;
  badges?: string[];
  creatorInfo?: string;
  creatorType?: string;
  contentTopic?: string;
  contentTopics?: string[];
  connectedUsers?: string;
  quote21To60s?: string;
  operationText?: string;
  operationLabel?: string;
  operationHint?: string;
  profileName?: string;
  douyinId?: string;
  likeCount?: string;
  followerCount?: string;
  intro?: string;
};

type CreatorResultsTableProps = {
  className?: string;
  columns?: TableProps<CreatorSearchResult>['columns'];
  dataSource?: CreatorSearchResult[];
  emptyText?: string;
  loading: boolean;
  locale?: {
    emptyText?: ReactNode;
  };
  onOpenProfile?: (record: CreatorSearchResult) => void;
  pagination?: TableProps<CreatorSearchResult>['pagination'];
  platform?: CreatorOpsPlatform | 'douyin';
  resultsMode?: {
    type: 'static' | 'pagination' | 'infinite';
    infiniteScroll?: {
      disabled?: boolean;
      loading?: boolean;
      onLoadMore: () => void;
      threshold?: number;
    };
  };
  results?: CreatorSearchResult[];
  rowKey?: TableProps<CreatorSearchResult>['rowKey'];
  scroll?: TableProps<CreatorSearchResult>['scroll'];
  size?: TableProps<CreatorSearchResult>['size'];
  tableLayout?: TableProps<CreatorSearchResult>['tableLayout'];
};

function formatDouyinId(value: string | undefined) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return '-';
  }

  const match = normalized.match(/抖音号[：:]\s*(\S+)/);
  return match ? match[1] : normalized;
}

function renderCreatorName(record: CreatorSearchResult, onOpenProfile?: (record: CreatorSearchResult) => void) {
  if (record.href && onOpenProfile) {
    return (
      <button
        className="douyin-cell-link-button"
        onClick={() => {
          onOpenProfile(record);
        }}
        type="button"
      >
        {record.name}
      </button>
    );
  }

  if (record.href) {
    return <a href={record.href} rel="noreferrer" target="_blank">{record.name}</a>;
  }

  return <span>{record.name}</span>;
}

function renderAvatar(record: CreatorSearchResult, onOpenProfile?: (record: CreatorSearchResult) => void) {
  const avatarContent = record.avatarUrl ? (
    <img
      alt={record.name}
      referrerPolicy="no-referrer"
      src={record.avatarUrl}
    />
  ) : (
    <span>{record.name.slice(0, 1)}</span>
  );

  if (record.href && onOpenProfile) {
    return (
      <button
        className="douyin-cell-avatar-button"
        onClick={() => {
          onOpenProfile(record);
        }}
        type="button"
      >
        {avatarContent}
      </button>
    );
  }

  return avatarContent;
}

function createGeneralCreatorColumns(
  platform: CreatorOpsPlatform,
  onOpenProfile?: (record: CreatorSearchResult) => void,
): TableProps<CreatorSearchResult>['columns'] {
  return [
    {
      dataIndex: 'creatorInfo',
      key: 'creatorInfo',
      title: '达人信息',
      minWidth: 280,
      render: (_value: string | undefined, record) => (
        <div className="xingtu-cell-creator">
          <div className="xingtu-cell-avatar">
            {renderAvatar(record, onOpenProfile)}
          </div>
          <div className="xingtu-cell-creator-main">
            <div className="xingtu-cell-creator-title">
              {renderCreatorName(record, onOpenProfile)}
            </div>
            <div className="xingtu-cell-creator-badges">
              {record.creatorBadgeIconUrl ? (
                <span className="xingtu-cell-creator-icon-tag">
                  <img
                    alt=""
                    className="xingtu-cell-creator-icon"
                    referrerPolicy="no-referrer"
                    src={record.creatorBadgeIconUrl}
                  />
                </span>
              ) : null}
              {record.gender ? <Tag bordered={false}>{record.gender}</Tag> : null}
              {record.location ? <Tag bordered={false}>{record.location}</Tag> : null}
              {record.badges?.slice(0, 3).map((badge) => (
                <Tag bordered={false} key={badge}>{badge}</Tag>
              ))}
            </div>
          </div>
        </div>
      ),
    },
    {
      dataIndex: 'creatorType',
      key: 'creatorType',
      title: '达人类型',
      width: 120,
      render: (value: string | undefined) => value || '-',
    },
    {
      dataIndex: 'contentTopic',
      key: 'contentTopic',
      title: '内容主题',
      width: 120,
      render: (_value: string | undefined, record) => (
        record.contentTopics?.length ? (
          <div className="xingtu-cell-topics">
            {record.contentTopics.slice(0, 3).map((topic) => (
              <Tag bordered={false} key={topic}>{topic}</Tag>
            ))}
          </div>
        ) : '-'
      ),
    },
    {
      dataIndex: 'connectedUsers',
      key: 'connectedUsers',
      title: '连接用户数',
      width: 120,
      render: (value: string | undefined) => value || '-',
    },
    {
      dataIndex: 'quote21To60s',
      key: 'quote21To60s',
      title: platform === 'buyin' ? '报价/佣金' : '21-60s报价',
      width: 120,
      render: (value: string | undefined) => <span className="xingtu-cell-price">{value || '-'}</span>,
    },
    {
      dataIndex: 'operationText',
      key: 'operationText',
      title: '操作',
      width: 150,
      render: (_value: string | undefined, record) => {
        const action = record.href ? (
          <Button
            className="xingtu-cell-action-button"
            danger
            href={!onOpenProfile ? record.href : undefined}
            onClick={onOpenProfile ? () => onOpenProfile(record) : undefined}
            rel="noreferrer"
            size="small"
            target={!onOpenProfile ? '_blank' : undefined}
            type="primary"
          >
            {record.operationLabel || '查看'}
          </Button>
        ) : (
          <Button className="xingtu-cell-action-button" danger size="small" type="primary">
            {record.operationLabel || '查看'}
          </Button>
        );

        return (
          <div className="xingtu-cell-operation">
            {action}
            {record.operationHint ? <div className="xingtu-cell-operation-hint">{record.operationHint}</div> : null}
          </div>
        );
      },
    },
  ];
}

function createDouyinCreatorColumns(
  onOpenProfile?: (record: CreatorSearchResult) => void,
): TableProps<CreatorSearchResult>['columns'] {
  return [
    {
      dataIndex: 'name',
      key: 'creatorInfo',
      title: '达人信息',
      minWidth: 280,
      render: (_value: string, record) => (
        <div className="douyin-cell-creator">
          <div className="douyin-cell-avatar">
            {renderAvatar(record, onOpenProfile)}
          </div>
          <div className="douyin-cell-creator-main">
            <div className="douyin-cell-creator-title">
              {renderCreatorName(record, onOpenProfile)}
            </div>
            <div className="douyin-cell-creator-meta">
              {record.profileName ? <Tag bordered={false}>{record.profileName}</Tag> : null}
            </div>
          </div>
        </div>
      ),
    },
    {
      dataIndex: 'creatorType',
      key: 'creatorType',
      title: '类型',
      width: 120,
      render: (value: string | undefined) => value ? <Tag bordered={false}>{value}</Tag> : '-',
    },
    {
      dataIndex: 'douyinId',
      key: 'douyinId',
      title: '抖音号',
      width: 180,
      render: (value: string | undefined) => formatDouyinId(value),
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
      title: '个人介绍',
      width: 320,
      render: (value: string | undefined, record) => value || record.summary || '-',
    },
    {
      dataIndex: 'operationLabel',
      key: 'action',
      title: '操作',
      width: 150,
      render: (_value: string | undefined, record) => (
        <div className="douyin-cell-operation">
          {record.href ? (
            <Button
              danger
              onClick={() => {
                onOpenProfile?.(record);
              }}
              size="small"
              type="primary"
            >
              {record.operationLabel || '查看主页'}
            </Button>
          ) : (
            <Button danger size="small" type="primary">
              {record.operationLabel || '查看主页'}
            </Button>
          )}
        </div>
      ),
    },
  ];
}

function createCreatorResultColumns(
  platform: CreatorOpsPlatform | 'douyin',
  onOpenProfile?: (record: CreatorSearchResult) => void,
): TableProps<CreatorSearchResult>['columns'] {
  if (platform === 'douyin') {
    return createDouyinCreatorColumns(onOpenProfile);
  }

  return createGeneralCreatorColumns(platform, onOpenProfile);
}

export function CreatorResultsTable({
  className,
  columns,
  dataSource,
  emptyText,
  loading,
  locale,
  onOpenProfile,
  pagination,
  platform = 'douyin',
  resultsMode,
  results,
  rowKey,
  scroll,
  size,
  tableLayout,
}: CreatorResultsTableProps) {
  const resolvedResults = results || dataSource || [];
  const resolvedEmptyText = emptyText || locale?.emptyText || (loading ? '正在搜索达人' : '暂无搜索结果');
  const infiniteScrollLockRef = useRef(false);
  const infiniteScroll = resultsMode?.type === 'infinite' ? resultsMode.infiniteScroll : undefined;
  const resolvedScroll = scroll || { x: platform === 'douyin' ? 1180 : 910 };

  const handleScroll = useCallback((event: UIEvent<HTMLElement>) => {
    if (!infiniteScroll) {
      return;
    }

    const target = event.currentTarget;
    const threshold = Math.max(0, Number(infiniteScroll.threshold || 96));
    const distanceToBottom = target.scrollHeight - target.scrollTop - target.clientHeight;
    if (distanceToBottom > threshold) {
      return;
    }

    if (infiniteScroll.disabled || infiniteScroll.loading || infiniteScrollLockRef.current) {
      return;
    }

    infiniteScrollLockRef.current = true;
    infiniteScroll.onLoadMore();
    window.setTimeout(() => {
      infiniteScrollLockRef.current = false;
    }, 500);
  }, [infiniteScroll]);

  return (
    <div
      style={{
        display: 'flex',
        flex: '1 1 auto',
        flexDirection: 'column',
        height: '100%',
        maxWidth: '100%',
        minHeight: 0,
        minWidth: 0,
        width: '100%',
      }}
    >
      <Table
        className={className || (platform === 'douyin' ? 'douyin-search-results-table' : 'xingtu-search-results-table')}
        columns={columns || createCreatorResultColumns(platform, onOpenProfile)}
        dataSource={resolvedResults}
        loading={loading}
        locale={{ emptyText: resolvedEmptyText }}
        onScroll={handleScroll}
        pagination={pagination === undefined ? false : pagination}
        rowKey={rowKey || ((record, index) => `${record.name}-${index || 0}`)}
        scroll={resolvedScroll}
        tableLayout={tableLayout || 'auto'}
        size={size || 'middle'}
      />
    </div>
  );
}
