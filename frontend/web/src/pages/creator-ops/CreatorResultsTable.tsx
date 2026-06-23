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
};

type CreatorResultsTableProps = {
  loading: boolean;
  platform: CreatorOpsPlatform;
  results: CreatorSearchResult[];
};

function createCreatorResultColumns(platform: CreatorOpsPlatform): TableProps<CreatorSearchResult>['columns'] {
  return [
    {
      dataIndex: 'creatorInfo',
      key: 'creatorInfo',
      title: '达人信息',
      minWidth: 280,
      render: (_value: string | undefined, record) => {
        const titleNode = record.href
          ? <a href={record.href} rel="noreferrer" target="_blank">{record.name}</a>
          : <span>{record.name}</span>;
        return (
          <div className="xingtu-cell-creator">
            <div className="xingtu-cell-avatar">
              {record.avatarUrl ? (
                <img
                  alt={record.name}
                  referrerPolicy="no-referrer"
                  src={record.avatarUrl}
                />
              ) : (
                <span>{record.name.slice(0, 1)}</span>
              )}
            </div>
            <div className="xingtu-cell-creator-main">
              <div className="xingtu-cell-creator-title">
                {titleNode}
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
        );
      },
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
          <Button className="xingtu-cell-action-button" danger href={record.href} rel="noreferrer" size="small" target="_blank" type="primary">
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

export function CreatorResultsTable({ loading, platform, results }: CreatorResultsTableProps) {
  return (
    <Table
      className="xingtu-search-results-table"
      columns={createCreatorResultColumns(platform)}
      dataSource={results}
      loading={loading}
      locale={{ emptyText: loading ? '正在搜索达人' : '暂无搜索结果' }}
      pagination={false}
      rowKey={(record, index) => `${record.name}-${index || 0}`}
      scroll={{ x: 910 }}
      tableLayout="auto"
      size="middle"
    />
  );
}
