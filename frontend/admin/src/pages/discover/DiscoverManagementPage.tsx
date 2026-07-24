import { ArrowDownOutlined, ArrowUpOutlined, DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined, SearchOutlined, TagsOutlined } from '@ant-design/icons'
import { Button, Input, Modal, Popconfirm, Select, Space, Table, Tag, Tooltip, message } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { type CSSProperties, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { listAdminWorks, type AdminWork } from '../../api/admin-works'
import {
  createDiscoverCategory,
  createDiscoverItem,
  deleteDiscoverCategory,
  deleteDiscoverItem,
  listDiscoverCategories,
  listDiscoverItems,
  updateDiscoverCategory,
  updateDiscoverItem,
  type DiscoverCategory,
  type DiscoverItem,
} from '../../api/discover'
import { WorkPreviewThumbnail } from '../../components/WorkPreviewThumbnail'
import { ContentStudioLayout } from '../../layouts/ContentStudioLayout'
import './DiscoverManagementPage.scss'

function useTableBodyHeight() {
  const viewportElementRef = useRef<HTMLDivElement | null>(null)
  const observerRef = useRef<ResizeObserver | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const [bodyHeight, setBodyHeight] = useState(1)

  const measure = useCallback(() => {
    const viewport = viewportElementRef.current
    if (!viewport || viewport.clientHeight <= 0) return

    const headerHeight = viewport.querySelector<HTMLElement>('.ant-table-header')?.offsetHeight || 0
    const pagination = viewport.querySelector<HTMLElement>('.ant-table-pagination')
    let paginationHeight = 0
    if (pagination) {
      const style = window.getComputedStyle(pagination)
      paginationHeight = pagination.offsetHeight
        + Number.parseFloat(style.marginTop || '0')
        + Number.parseFloat(style.marginBottom || '0')
    }

    const nextHeight = Math.max(1, Math.floor(viewport.clientHeight - headerHeight - paginationHeight))
    setBodyHeight((currentHeight) => currentHeight === nextHeight ? currentHeight : nextHeight)
  }, [])

  const scheduleMeasure = useCallback(() => {
    if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current)
    animationFrameRef.current = requestAnimationFrame(() => {
      animationFrameRef.current = null
      measure()
    })
  }, [measure])

  const viewportRef = useCallback((viewport: HTMLDivElement | null) => {
    observerRef.current?.disconnect()
    observerRef.current = null
    viewportElementRef.current = viewport

    if (!viewport) return
    observerRef.current = new ResizeObserver(scheduleMeasure)
    observerRef.current.observe(viewport)
    scheduleMeasure()
  }, [scheduleMeasure])

  useLayoutEffect(() => {
    scheduleMeasure()
  })

  useEffect(() => () => {
    observerRef.current?.disconnect()
    if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current)
  }, [])

  return { bodyHeight, viewportRef }
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
  const [categorySorting, setCategorySorting] = useState(false)
  const [candidateModalOpen, setCandidateModalOpen] = useState(false)
  const [candidateWorks, setCandidateWorks] = useState<AdminWork[]>([])
  const [candidateLoading, setCandidateLoading] = useState(false)
  const [candidatePage, setCandidatePage] = useState(1)
  const [candidateTotal, setCandidateTotal] = useState(0)
  const [candidateSearchInput, setCandidateSearchInput] = useState('')
  const [candidateSearch, setCandidateSearch] = useState('')
  const [candidateCategoryId, setCandidateCategoryId] = useState<string>()
  const [addingWorkId, setAddingWorkId] = useState<string>()
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

  const changeItemCategory = useCallback(async (item: DiscoverItem, nextCategoryId: string) => {
    if (item.categoryId === nextCategoryId) return
    setUpdatingItemId(item.id)
    try {
      const updatedItem = await updateDiscoverItem(item.id, { categoryId: nextCategoryId })
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

  const moveCategory = useCallback(async (categoryId: string, direction: -1 | 1) => {
    const currentIndex = categories.findIndex((category) => category.id === categoryId)
    const targetIndex = currentIndex + direction
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= categories.length) return

    const reordered = [...categories]
    ;[reordered[currentIndex], reordered[targetIndex]] = [reordered[targetIndex]!, reordered[currentIndex]!]
    const normalized = reordered.map((category, index) => ({ ...category, sortOrder: index * 10 }))
    setCategorySorting(true)
    try {
      await Promise.all(normalized.map((category) => updateDiscoverCategory(category.id, { sortOrder: category.sortOrder })))
      setCategories(normalized)
      message.success('分类顺序已更新')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '分类排序失败')
      await loadDiscover()
    } finally {
      setCategorySorting(false)
    }
  }, [categories, loadDiscover])

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
      title: '排序',
      width: 100,
      render: (_, category, index) => (
        <Space size={0}>
          <Tooltip title="上移">
            <Button
              aria-label="上移分类"
              disabled={categorySorting || index === 0}
              icon={<ArrowUpOutlined />}
              onClick={() => void moveCategory(category.id, -1)}
              type="text"
            />
          </Tooltip>
          <Tooltip title="下移">
            <Button
              aria-label="下移分类"
              disabled={categorySorting || index === categories.length - 1}
              icon={<ArrowDownOutlined />}
              onClick={() => void moveCategory(category.id, 1)}
              type="text"
            />
          </Tooltip>
        </Space>
      ),
    },
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
  ], [categories.length, categorySaving, categorySorting, editingCategoryId, editingCategoryName, moveCategory])

  const itemColumns = useMemo<ColumnsType<DiscoverItem>>(() => [
    {
      title: '预览',
      width: 90,
      render: (_, item) => (
        <WorkPreviewThumbnail
          coverUrl={item.coverUrl}
          fileUrl={item.fileUrl}
          mediaType={item.mediaType}
          title={item.title}
        />
      ),
    },
    { title: '标题', dataIndex: 'title', ellipsis: true },
    {
      title: '分类',
      width: 180,
      render: (_, item) => (
        <Select
          disabled={Boolean(updatingItemId)}
          loading={updatingItemId === item.id}
          onChange={(categoryId) => void changeItemCategory(item, categoryId)}
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
    { title: '浏览量', dataIndex: 'viewCount', align: 'right', width: 100, render: (value: number) => value.toLocaleString() },
    { title: '点赞量', dataIndex: 'likeCount', align: 'right', width: 100, render: (value: number) => value.toLocaleString() },
    { title: '状态', dataIndex: 'status', width: 110, render: (value: DiscoverItem['status']) => <Tag color={value === 'published' ? 'green' : 'default'}>{value === 'published' ? '已发布' : value === 'hidden' ? '已隐藏' : '草稿'}</Tag> },
    {
      title: '操作',
      width: 100,
      render: (_, item) => <Popconfirm onConfirm={async () => { await deleteDiscoverItem(item.id); await loadDiscover() }} title="确认从发现移除？"><Button danger icon={<DeleteOutlined />} type="link">移除</Button></Popconfirm>,
    },
  ], [categories, changeItemCategory, loadDiscover, updatingItemId])

  const candidateColumns = useMemo<ColumnsType<AdminWork>>(() => [
    {
      title: '预览',
      width: 90,
      render: (_, work) => (
        <WorkPreviewThumbnail
          coverUrl={work.coverUrl}
          fileUrl={work.fileUrl}
          mediaType={work.mediaType}
          title={work.name}
        />
      ),
    },
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
        <div
          className="discover-management-table-viewport"
          ref={discoverTable.viewportRef}
          style={{ '--discover-management-table-body-height': `${discoverTable.bodyHeight}px` } as CSSProperties}
        >
          <Table
            className="discover-management-table"
            columns={itemColumns}
            dataSource={items}
            loading={loading}
            pagination={{ pageSize: 20, showSizeChanger: false }}
            rowKey="id"
            scroll={{ x: 900, y: discoverTable.bodyHeight }}
          />
        </div>
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
