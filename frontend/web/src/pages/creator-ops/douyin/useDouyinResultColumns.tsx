import { useMemo } from 'react'
import { Button, Tag, Tooltip, type TableProps } from 'antd'
import { StarFilled, StarOutlined } from '@ant-design/icons'
import { CreatorInfoCell } from '../CreatorInfoCell'
import { getDouyinFavoriteKey } from '../douyinFavoriteCreatorsStorage'
import type { DouyinSearchRecord, OpenDouyinProfileOptions } from './pageTypes'
import './useDouyinResultColumns.scss'

type UseDouyinResultColumnsOptions = {
  favoriteCreatorKeySet: Set<string>
  onOpenCreatorProfile: (options: OpenDouyinProfileOptions) => void
  onToggleFavoriteCreator: (record: DouyinSearchRecord) => void
}

function renderDouyinId(value: string | undefined) {
  const normalized = String(value || '').trim()
  if (!normalized) {
    return '-'
  }

  const match = normalized.match(/\u6296\u97f3\u53f7[\uFF1A:]\s*(\S+)/)
  return match ? match[1] : normalized
}

export function useDouyinResultColumns({
  favoriteCreatorKeySet,
  onOpenCreatorProfile,
  onToggleFavoriteCreator,
}: UseDouyinResultColumnsOptions): TableProps<DouyinSearchRecord>['columns'] {
  return useMemo(() => [
    {
      dataIndex: 'name',
      key: 'creatorInfo',
      title: '达人信息',
      minWidth: 280,
      render: (_value: string, record: DouyinSearchRecord) => (
        <CreatorInfoCell
          onOpenProfile={(creatorRecord) => {
            onOpenCreatorProfile({
              creatorName: creatorRecord.name,
              href: creatorRecord.href,
            })
          }}
          record={record}
          variant="douyin"
        />
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
      render: (value: string | undefined) => renderDouyinId(value),
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
      render: (value: string | undefined, record: DouyinSearchRecord) => value || record.summary || '-',
    },
    {
      dataIndex: 'operationLabel',
      key: 'action',
      title: '操作',
      width: 88,
      render: (_value: string | undefined, record: DouyinSearchRecord) => {
        const favorite = favoriteCreatorKeySet.has(getDouyinFavoriteKey(record))
        return (
          <div className="douyin-cell-operation">
            <Tooltip title={favorite ? '取消收藏' : '收藏'}>
              <Button
                aria-label={favorite ? '取消收藏' : '收藏'}
                className={`douyin-favorite-button${favorite ? ' is-active' : ''}`}
                icon={favorite ? <StarFilled /> : <StarOutlined />}
                onClick={() => {
                  onToggleFavoriteCreator(record)
                }}
                shape="circle"
                type="text"
              />
            </Tooltip>
          </div>
        )
      },
    },
  ], [favoriteCreatorKeySet, onOpenCreatorProfile, onToggleFavoriteCreator])
}
