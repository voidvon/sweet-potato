import { PlusOutlined, ReloadOutlined, TagsOutlined } from '@ant-design/icons'
import { Button, Space, Table, message } from 'antd'
import type { CSSProperties } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  deleteDiscoverItem,
  listDiscoverCategories,
  listDiscoverItems,
  updateDiscoverItem,
  type DiscoverCategory,
  type DiscoverItem,
} from '../../api/discover'
import { useTableBodyHeight } from '../../hooks/useTableBodyHeight'
import { ContentStudioLayout } from '../../layouts/ContentStudioLayout'
import { DiscoverCandidateModal } from './discover-management/DiscoverCandidateModal'
import { DiscoverCategoryModal } from './discover-management/DiscoverCategoryModal'
import { useDiscoverManagementColumns } from './discover-management/discoverManagementColumns'
import './DiscoverManagementPage.scss'

export function DiscoverManagementPage() {
  const [items, setItems] = useState<DiscoverItem[]>([])
  const [categories, setCategories] = useState<DiscoverCategory[]>([])
  const [loading, setLoading] = useState(false)
  const [categoryModalOpen, setCategoryModalOpen] = useState(false)
  const [candidateModalOpen, setCandidateModalOpen] = useState(false)
  const [updatingItemId, setUpdatingItemId] = useState<string>()
  const discoverTable = useTableBodyHeight()

  const loadDiscover = useCallback(async () => {
    setLoading(true)
    try {
      const [nextItems, nextCategories] = await Promise.all([listDiscoverItems(), listDiscoverCategories()])
      setItems(nextItems.items)
      setCategories(nextCategories.items)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '发现列表加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadDiscover()
  }, [loadDiscover])

  const changeItemCategory = useCallback(async (item: DiscoverItem, categoryId: string) => {
    if (item.categoryId === categoryId) return
    setUpdatingItemId(item.id)
    try {
      const updatedItem = await updateDiscoverItem(item.id, { categoryId })
      setItems((current) => current.map((currentItem) => currentItem.id === item.id
        ? { ...currentItem, categoryId: updatedItem.categoryId }
        : currentItem))
      message.success('分类已更新')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '分类更新失败')
    } finally {
      setUpdatingItemId(undefined)
    }
  }, [])

  const removeItem = useCallback(async (item: DiscoverItem) => {
    try {
      await deleteDiscoverItem(item.id)
      await loadDiscover()
    } catch (error) {
      message.error(error instanceof Error ? error.message : '移除失败')
    }
  }, [loadDiscover])

  const columns = useDiscoverManagementColumns({
    categories,
    updatingItemId,
    onCategoryChange: (item, categoryId) => void changeItemCategory(item, categoryId),
    onRemove: (item) => void removeItem(item),
  })
  const addedAssetIds = useMemo(() => new Set(items.map((item) => item.sourceAssetId)), [items])

  return (
    <ContentStudioLayout>
      <section className="settings-page discover-management-page">
        <div className="discover-management-toolbar">
          <Space>
            <Button icon={<PlusOutlined />} onClick={() => setCandidateModalOpen(true)} type="primary">新增</Button>
            <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void loadDiscover()}>刷新</Button>
            <Button icon={<TagsOutlined />} onClick={() => setCategoryModalOpen(true)}>分类管理</Button>
          </Space>
        </div>
        <div
          className="discover-management-table-viewport"
          ref={discoverTable.viewportRef}
          style={{ '--discover-management-table-body-height': `${discoverTable.bodyHeight}px` } as CSSProperties}
        >
          <Table
            className="discover-management-table"
            columns={columns}
            dataSource={items}
            loading={loading}
            pagination={{ pageSize: 20, showSizeChanger: false }}
            rowKey="id"
            scroll={{ x: 900, y: discoverTable.bodyHeight }}
          />
        </div>
      </section>
      <DiscoverCategoryModal
        categories={categories}
        onChanged={loadDiscover}
        onClose={() => setCategoryModalOpen(false)}
        onReordered={setCategories}
        open={categoryModalOpen}
      />
      <DiscoverCandidateModal
        addedAssetIds={addedAssetIds}
        categories={categories}
        onAdded={loadDiscover}
        onClose={() => setCandidateModalOpen(false)}
        open={candidateModalOpen}
      />
    </ContentStudioLayout>
  )
}
