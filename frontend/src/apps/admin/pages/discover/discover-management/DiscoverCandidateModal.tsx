import { SearchOutlined } from '@ant-design/icons'
import { Button, Input, Modal, Select, Table, message } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { listAdminWorks, type AdminWork } from '../../../api/admin-works'
import { createDiscoverItem, type DiscoverCategory } from '../../../api/discover'
import { WorkPreviewThumbnail } from '../../../components/WorkPreviewThumbnail'
import { t } from '@shared/i18n';

type DiscoverCandidateModalProps = {
  addedAssetIds: Set<string>
  categories: DiscoverCategory[]
  open: boolean
  onAdded: () => Promise<void>
  onClose: () => void
}

export function DiscoverCandidateModal({ addedAssetIds, categories, open, onAdded, onClose }: DiscoverCandidateModalProps) {
  const [works, setWorks] = useState<AdminWork[]>([])
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [categoryId, setCategoryId] = useState<string>()
  const [addingWorkId, setAddingWorkId] = useState<string>()

  const loadCandidates = useCallback(async (nextPage = 1, nextSearch = search) => {
    setLoading(true)
    try {
      const result = await listAdminWorks(nextPage, 10, '', nextSearch)
      setWorks(result.items)
      setPage(result.page)
      setTotal(result.total)
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("全部作品加载失败"))
    } finally {
      setLoading(false)
    }
  }, [search])

  useEffect(() => {
    if (!open) return
    setSearchInput('')
    setSearch('')
    setCategoryId(undefined)
    void loadCandidates(1, '')
  }, [open])

  async function addWork(work: AdminWork) {
    if (!categoryId) {
      message.warning(t("请先选择分类"))
      return
    }
    setAddingWorkId(work.id)
    try {
      await createDiscoverItem({
        sourceAssetId: work.id,
        categoryId,
        title: work.name,
        description: work.description,
      })
      message.success(t("已加入发现"))
      await onAdded()
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("加入失败"))
    } finally {
      setAddingWorkId(undefined)
    }
  }

  const columns = useMemo<ColumnsType<AdminWork>>(() => [
    {
      title: t("预览"),
      width: 90,
      render: (_, work) => (
        <WorkPreviewThumbnail coverUrl={work.coverUrl} fileUrl={work.fileUrl} mediaType={work.mediaType} title={work.name} />
      ),
    },
    { title: t("作品名称"), dataIndex: 'name', ellipsis: true },
    { title: t("类型"), dataIndex: 'mediaType', width: 90, render: (value: AdminWork['mediaType']) => value === 'image' ? t("图片") : t("视频") },
    { title: t("用户"), dataIndex: 'username', width: 150, ellipsis: true },
    {
      title: t("操作"),
      width: 110,
      render: (_, work) => {
        const added = addedAssetIds.has(work.id)
        return <Button disabled={added} loading={addingWorkId === work.id} onClick={() => void addWork(work)} type="link">{added ? t("已添加") : t("添加")}</Button>
      },
    },
  ], [addedAssetIds, addingWorkId, categoryId])

  return (
    <Modal footer={null} onCancel={onClose} open={open} title={t("新增发现作品")} width={900}>
      <div className="discover-candidate-toolbar">
        <Select
          onChange={setCategoryId}
          options={categories.filter((category) => category.status === 'active').map((category) => ({ label: category.name, value: category.id }))}
          placeholder={t("选择分类")}
          value={categoryId}
        />
        <Input.Search
          allowClear
          enterButton={<SearchOutlined />}
          onChange={(event) => setSearchInput(event.target.value)}
          onSearch={() => {
            const nextSearch = searchInput.trim()
            setSearch(nextSearch)
            void loadCandidates(1, nextSearch)
          }}
          placeholder={t("搜索作品名称或用户")}
          value={searchInput}
        />
      </div>
      <Table
        columns={columns}
        dataSource={works}
        loading={loading}
        pagination={{ current: page, pageSize: 10, total, showSizeChanger: false, onChange: (nextPage) => void loadCandidates(nextPage) }}
        rowKey="id"
        size="small"
      />
    </Modal>
  )
}
