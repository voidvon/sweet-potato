import { DeleteOutlined } from '@ant-design/icons'
import { Button, Popconfirm, Select } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useMemo } from 'react'
import type { DiscoverCategory, DiscoverItem } from '../../../api/discover'
import { WorkPreviewThumbnail } from '../../../components/WorkPreviewThumbnail'
import { t } from '@shared/i18n';

type DiscoverManagementColumnsOptions = {
  categories: DiscoverCategory[]
  updatingItemId?: string
  onCategoryChange: (item: DiscoverItem, categoryId: string) => void
  onRemove: (item: DiscoverItem) => void
}

export function useDiscoverManagementColumns({
  categories,
  updatingItemId,
  onCategoryChange,
  onRemove,
}: DiscoverManagementColumnsOptions) {
  return useMemo<ColumnsType<DiscoverItem>>(() => [
    {
      title: t("预览"),
      width: 90,
      render: (_, item) => (
        <WorkPreviewThumbnail coverUrl={item.coverUrl} fileUrl={item.fileUrl} mediaType={item.mediaType} title={item.title} />
      ),
    },
    { title: t("标题"), dataIndex: 'title', ellipsis: true },
    {
      title: t("分类"),
      width: 180,
      render: (_, item) => (
        <Select
          disabled={Boolean(updatingItemId)}
          loading={updatingItemId === item.id}
          onChange={(categoryId) => onCategoryChange(item, categoryId)}
          options={categories.map((category) => ({
            disabled: category.status !== 'active',
            label: category.name,
            value: category.id,
          }))}
          style={{ width: '100%' }}
          value={item.categoryId}
        />
      ),
    },
    { title: t("浏览量"), dataIndex: 'viewCount', align: 'right', width: 100, render: (value: number) => value.toLocaleString() },
    { title: t("点赞量"), dataIndex: 'likeCount', align: 'right', width: 100, render: (value: number) => value.toLocaleString() },
    {
      title: t("操作"),
      width: 100,
      render: (_, item) => (
        <Popconfirm onConfirm={() => onRemove(item)} title={t("确认从发现移除？")}>
          <Button danger icon={<DeleteOutlined />} type="link">{t("移除")}</Button>
        </Popconfirm>
      ),
    },
  ], [categories, onCategoryChange, onRemove, updatingItemId])
}
