import { DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined, SearchOutlined, TagsOutlined } from '@ant-design/icons'
import { Button, Input, Modal, Popconfirm, Select, Space, Table, Tag, message } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { resolveAssetUrl } from '@shared/api/core/request'
import { listAdminWorks, type AdminWork } from '../../api/admin-works'
import {
  createDiscoverCategory,
  createDiscoverItem,
  deleteDiscoverCategory,
  deleteDiscoverItem,
  listDiscoverCategories,
  listDiscoverItems,
  updateDiscoverCategory,
  type DiscoverCategory,
  type DiscoverItem,
} from '../../api/discover'
import { ContentStudioLayout } from '../../layouts/ContentStudioLayout'
import './DiscoverManagementPage.scss'

function MediaPreview({ item }: { item: Pick<DiscoverItem, 'fileUrl' | 'mediaType' | 'title'> }) {
  const url = resolveAssetUrl(item.fileUrl)
  return item.mediaType === 'image'
    ? <img alt={item.title} className="discover-management-preview" src={url} />
    : <video className="discover-management-preview" muted preload="metadata" src={url} />
}

export function DiscoverManagementPage() {
  const [items, setItems] = useState<DiscoverItem[]>([])
  const [categories, setCategories] = useState<DiscoverCategory[]>([])
  const [loading, setLoading] = useState(false)
  const [categoryModalOpen, setCategoryModalOpen] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState('')
  const [editingCategoryId, setEditingCategoryId] = useState<string>()
  const [editingCategoryName, setEditingCategoryName] = useState('')
  const [categorySaving, setCategorySaving] = useState(false)
  const [candidateModalOpen, setCandidateModalOpen] = useState(false)
  const [candidateWorks, setCandidateWorks] = useState<AdminWork[]>([])
  const [candidateLoading, setCandidateLoading] = useState(false)
  const [candidatePage, setCandidatePage] = useState(1)
  const [candidateTotal, setCandidateTotal] = useState(0)
  const [candidateSearchInput, setCandidateSearchInput] = useState('')
  const [candidateSearch, setCandidateSearch] = useState('')
  const [candidateCategoryId, setCandidateCategoryId] = useState<string>()
  const [addingWorkId, setAddingWorkId] = useState<string>()

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

  const loadCandidates = useCallback(async (page = 1, search = candidateSearch) => {
    setCandidateLoading(true)
    try {
      const result = await listAdminWorks(page, 10, '', search)
      setCandidateWorks(result.items)
      setCandidatePage(result.page)
      setCandidateTotal(result.total)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '全部作品加载失败')
    } finally {
      setCandidateLoading(false)
    }
  }, [candidateSearch])

  useEffect(() => { void loadDiscover() }, [loadDiscover])

  async function addCategory() {
    const name = newCategoryName.trim()
    if (!name) return
    setCategorySaving(true)
    try {
      await createDiscoverCategory({ name })
      setNewCategoryName('')
      await loadDiscover()
    } catch (error) {
      message.error(error instanceof Error ? error.message : '分类创建失败')
    } finally {
      setCategorySaving(false)
    }
  }

  async function saveCategory(category: DiscoverCategory) {
    const name = editingCategoryName.trim()
    if (!name) return
    setCategorySaving(true)
    try {
      await updateDiscoverCategory(category.id, { name })
      setEditingCategoryId(undefined)
      await loadDiscover()
    } catch (error) {
      message.error(error instanceof Error ? error.message : '分类更新失败')
    } finally {
      setCategorySaving(false)
    }
  }

  async function removeCategory(id: string) {
    try {
      await deleteDiscoverCategory(id)
      await loadDiscover()
    } catch (error) {
      message.error(error instanceof Error ? error.message : '分类删除失败')
    }
  }

  function openCandidateModal() {
    setCandidateModalOpen(true)
    setCandidateSearchInput('')
    setCandidateSearch('')
    setCandidateCategoryId(undefined)
    void loadCandidates(1, '')
  }

  async function addWork(work: AdminWork) {
    if (!candidateCategoryId) {
      message.warning('请先选择分类')
      return
    }
    setAddingWorkId(work.id)
    try {
      await createDiscoverItem({ sourceAssetId: work.id, categoryId: candidateCategoryId, title: work.name, description: work.description, status: 'published' })
      message.success('已加入发现')
      await loadDiscover()
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加入失败')
    } finally {
      setAddingWorkId(undefined)
    }
  }

  const addedAssetIds = useMemo(() => new Set(items.map((item) => item.sourceAssetId)), [items])
  const categoryColumns = useMemo<ColumnsType<DiscoverCategory>>(() => [
    {
      title: '分类名称',
      dataIndex: 'name',
      render: (name: string, category) => editingCategoryId === category.id
        ? <Input autoFocus maxLength={40} onChange={(event) => setEditingCategoryName(event.target.value)} onPressEnter={() => void saveCategory(category)} value={editingCategoryName} />
        : name,
    },
    { title: '标识', dataIndex: 'slug', width: 180 },
    {
      title: '操作',
      width: 180,
      render: (_, category) => editingCategoryId === category.id ? (
        <Space size={4}>
          <Button loading={categorySaving} onClick={() => void saveCategory(category)} type="link">保存</Button>
          <Button onClick={() => setEditingCategoryId(undefined)} type="link">取消</Button>
        </Space>
      ) : (
        <Space size={4}>
          <Button icon={<EditOutlined />} onClick={() => { setEditingCategoryId(category.id); setEditingCategoryName(category.name) }} type="link">编辑</Button>
          <Popconfirm description="分类下有作品时无法删除" onConfirm={() => void removeCategory(category.id)} title="确认删除该分类？">
            <Button danger icon={<DeleteOutlined />} type="link">删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ], [categorySaving, editingCategoryId, editingCategoryName])

  const itemColumns = useMemo<ColumnsType<DiscoverItem>>(() => [
    { title: '预览', width: 90, render: (_, item) => <MediaPreview item={item} /> },
    { title: '标题', dataIndex: 'title', ellipsis: true },
    { title: '分类', width: 160, render: (_, item) => categories.find((category) => category.id === item.categoryId)?.name || '-' },
    { title: '状态', dataIndex: 'status', width: 110, render: (value: DiscoverItem['status']) => <Tag color={value === 'published' ? 'green' : 'default'}>{value === 'published' ? '已发布' : value === 'hidden' ? '已隐藏' : '草稿'}</Tag> },
    {
      title: '操作',
      width: 100,
      render: (_, item) => <Popconfirm onConfirm={async () => { await deleteDiscoverItem(item.id); await loadDiscover() }} title="确认从发现移除？"><Button danger icon={<DeleteOutlined />} type="link">移除</Button></Popconfirm>,
    },
  ], [categories, loadDiscover])

  const candidateColumns = useMemo<ColumnsType<AdminWork>>(() => [
    { title: '作品名称', dataIndex: 'name', ellipsis: true },
    { title: '类型', dataIndex: 'mediaType', width: 90, render: (value: AdminWork['mediaType']) => value === 'image' ? '图片' : '视频' },
    { title: '用户', dataIndex: 'username', width: 150, ellipsis: true },
    {
      title: '操作',
      width: 110,
      render: (_, work) => {
        const added = addedAssetIds.has(work.id)
        return <Button disabled={added} loading={addingWorkId === work.id} onClick={() => void addWork(work)} type="link">{added ? '已添加' : '添加'}</Button>
      },
    },
  ], [addedAssetIds, addingWorkId, candidateCategoryId])

  return (
    <ContentStudioLayout>
      <section className="settings-page discover-management-page">
        <div className="discover-management-toolbar">
          <Space>
            <Button icon={<PlusOutlined />} onClick={openCandidateModal} type="primary">新增</Button>
            <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void loadDiscover()}>刷新</Button>
            <Button icon={<TagsOutlined />} onClick={() => setCategoryModalOpen(true)}>分类管理</Button>
          </Space>
        </div>
        <Table columns={itemColumns} dataSource={items} loading={loading} pagination={{ pageSize: 10 }} rowKey="id" />
      </section>

      <Modal footer={null} onCancel={() => setCategoryModalOpen(false)} open={categoryModalOpen} title="分类管理" width={720}>
        <Space.Compact className="discover-category-create">
          <Input maxLength={40} onChange={(event) => setNewCategoryName(event.target.value)} onPressEnter={() => void addCategory()} placeholder="输入分类名称" value={newCategoryName} />
          <Button loading={categorySaving} onClick={() => void addCategory()} type="primary">新增分类</Button>
        </Space.Compact>
        <Table columns={categoryColumns} dataSource={categories} pagination={false} rowKey="id" size="small" />
      </Modal>

      <Modal footer={null} onCancel={() => setCandidateModalOpen(false)} open={candidateModalOpen} title="新增发现作品" width={900}>
        <div className="discover-candidate-toolbar">
          <Select onChange={setCandidateCategoryId} options={categories.filter((category) => category.status === 'active').map((category) => ({ label: category.name, value: category.id }))} placeholder="选择分类" value={candidateCategoryId} />
          <Input.Search allowClear enterButton={<SearchOutlined />} onChange={(event) => setCandidateSearchInput(event.target.value)} onSearch={() => { const search = candidateSearchInput.trim(); setCandidateSearch(search); void loadCandidates(1, search) }} placeholder="搜索作品名称或用户" value={candidateSearchInput} />
        </div>
        <Table columns={candidateColumns} dataSource={candidateWorks} loading={candidateLoading} pagination={{ current: candidatePage, pageSize: 10, total: candidateTotal, showSizeChanger: false, onChange: (page) => void loadCandidates(page) }} rowKey="id" size="small" />
      </Modal>
    </ContentStudioLayout>
  )
}
