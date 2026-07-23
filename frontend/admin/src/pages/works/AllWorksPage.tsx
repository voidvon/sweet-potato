import { EyeOutlined, PlusOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons'
import { Button, Image, Input, Modal, Select, Space, Table, Tag, Typography, message } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { type CSSProperties, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { resolveAssetUrl } from '@shared/api/core/request'
import { listAdminWorks, type AdminWork } from '../../api/admin-works'
import { createDiscoverItem, listDiscoverCategories, type DiscoverCategory } from '../../api/discover'
import { ContentStudioLayout } from '../../layouts/ContentStudioLayout'
import './AllWorksPage.scss'

const dateTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
})

function formatDateTime(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '-' : dateTimeFormatter.format(date)
}

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

function WorkThumbnail({ work, onPreview }: { work: AdminWork; onPreview: () => void }) {
  const url = resolveAssetUrl(work.fileUrl)
  return (
    <button
      aria-label={`预览作品：${work.name}`}
      className="all-works-thumbnail-button"
      onClick={onPreview}
      type="button"
    >
      {work.mediaType === 'image'
        ? <Image alt={work.name} height={56} preview={false} src={url} width={56} />
        : <video className="all-works-thumbnail" muted preload="metadata" src={url} />}
    </button>
  )
}

export function AllWorksPage() {
  const [works, setWorks] = useState<AdminWork[]>([])
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [usernameInput, setUsernameInput] = useState('')
  const [username, setUsername] = useState('')
  const [previewWork, setPreviewWork] = useState<AdminWork | null>(null)
  const [discoverCategories, setDiscoverCategories] = useState<DiscoverCategory[]>([])
  const [discoverWork, setDiscoverWork] = useState<AdminWork | null>(null)
  const [discoverCategoryId, setDiscoverCategoryId] = useState<string>()
  const [addingToDiscover, setAddingToDiscover] = useState(false)
  const previewVideoRef = useRef<HTMLVideoElement | null>(null)
  const workTable = useTableBodyHeight()

  const loadWorks = useCallback(async (nextPage = page, nextUsername = username) => {
    setLoading(true)
    try {
      const result = await listAdminWorks(nextPage, 20, nextUsername)
      setWorks(result.items)
      setPage(result.page)
      setTotal(result.total)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '作品列表加载失败')
    } finally {
      setLoading(false)
    }
  }, [page, username])

  useEffect(() => {
    void loadWorks(1, '')
    void listDiscoverCategories()
      .then((result) => setDiscoverCategories(result.items.filter((category) => category.status === 'active')))
      .catch((error) => message.error(error instanceof Error ? error.message : '发现分类加载失败'))
  }, [])

  function applyUsernameFilter() {
    const nextUsername = usernameInput.trim()
    setUsernameInput(nextUsername)
    setUsername(nextUsername)
    void loadWorks(1, nextUsername)
  }

  function resetUsernameFilter() {
    setUsernameInput('')
    setUsername('')
    void loadWorks(1, '')
  }

  function closePreview() {
    const video = previewVideoRef.current
    if (video) {
      video.pause()
      video.currentTime = 0
    }
    setPreviewWork(null)
  }

  function openDiscoverModal(work: AdminWork) {
    setDiscoverWork(work)
    setDiscoverCategoryId(undefined)
  }

  function closeDiscoverModal() {
    if (addingToDiscover) return
    setDiscoverWork(null)
    setDiscoverCategoryId(undefined)
  }

  async function addToDiscover() {
    if (!discoverWork || !discoverCategoryId) return
    setAddingToDiscover(true)
    try {
      await createDiscoverItem({
        sourceAssetId: discoverWork.id,
        categoryId: discoverCategoryId,
        title: discoverWork.name,
        description: discoverWork.description,
        status: 'published',
      })
      message.success('已添加到发现')
      setDiscoverWork(null)
      setDiscoverCategoryId(undefined)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '添加到发现失败')
    } finally {
      setAddingToDiscover(false)
    }
  }

  const columns = useMemo<ColumnsType<AdminWork>>(() => [
    {
      title: '作品结果',
      key: 'preview',
      width: 96,
      render: (_, work) => <WorkThumbnail onPreview={() => setPreviewWork(work)} work={work} />,
    },
    {
      title: '类型',
      dataIndex: 'mediaType',
      width: 90,
      render: (value: AdminWork['mediaType']) => (
        <Tag color={value === 'image' ? 'blue' : 'purple'}>{value === 'image' ? '图片' : '视频'}</Tag>
      ),
    },
    {
      title: '作品名称',
      dataIndex: 'name',
      width: 280,
      ellipsis: true,
      render: (value: string) => (
        <Typography.Text ellipsis={{ tooltip: value }} style={{ display: 'block' }}>
          {value || '-'}
        </Typography.Text>
      ),
    },
    {
      title: '用户名',
      key: 'username',
      width: 180,
      render: (_, work) => (
        <div className="all-works-user">
          <Typography.Text>{work.username || '-'}</Typography.Text>
          {work.displayName && work.displayName !== work.username
            ? <Typography.Text type="secondary">{work.displayName}</Typography.Text>
            : null}
        </div>
      ),
    },
    {
      title: '生成功能',
      key: 'mode',
      width: 150,
      ellipsis: true,
      render: (_, work) => work.modeTitle || work.mode || '-',
    },
    {
      title: '模型',
      dataIndex: 'model',
      width: 160,
      ellipsis: true,
      render: (value: string) => value || '-',
    },
    {
      title: '生成时间',
      dataIndex: 'generatedAt',
      width: 190,
      render: (value: string) => formatDateTime(value),
    },
    {
      title: '操作',
      key: 'actions',
      fixed: 'right',
      width: 220,
      render: (_, work) => (
        <Space size={0}>
          <Button icon={<EyeOutlined />} onClick={() => setPreviewWork(work)} type="link">预览</Button>
          <Button icon={<PlusOutlined />} onClick={() => openDiscoverModal(work)} type="link">添加到发现</Button>
        </Space>
      ),
    },
  ], [])

  const previewUrl = previewWork ? resolveAssetUrl(previewWork.fileUrl) : ''

  return (
    <ContentStudioLayout>
      <section className="settings-page all-works-page">
        <div className="all-works-toolbar">
          <Space wrap>
            <Input
              allowClear
              className="all-works-username-filter"
              onChange={(event) => setUsernameInput(event.target.value)}
              onPressEnter={applyUsernameFilter}
              placeholder="输入用户名搜索"
              value={usernameInput}
            />
            <Button icon={<SearchOutlined />} loading={loading} onClick={applyUsernameFilter}>查询</Button>
            <Button disabled={!usernameInput && !username} onClick={resetUsernameFilter}>重置</Button>
            <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void loadWorks(page, username)}>刷新</Button>
          </Space>
          <Typography.Text type="secondary">全部用户生成的图片和视频作品</Typography.Text>
        </div>

        <div
          className="all-works-table-viewport"
          ref={workTable.viewportRef}
          style={{ '--all-works-table-body-height': `${workTable.bodyHeight}px` } as CSSProperties}
        >
          <Table<AdminWork>
            className="all-works-table"
            columns={columns}
            dataSource={works}
            loading={loading}
            locale={{ emptyText: username ? '没有找到该用户的作品' : '暂无作品' }}
            pagination={{
              current: page,
              pageSize: 20,
              total,
              showSizeChanger: false,
              showTotal: (count) => `共 ${count} 条`,
              onChange: (nextPage) => void loadWorks(nextPage, username),
            }}
            rowKey="id"
            scroll={{ x: 1310, y: workTable.bodyHeight }}
          />
        </div>
      </section>

      <Modal
        centered
        destroyOnHidden
        footer={null}
        onCancel={closePreview}
        open={Boolean(previewWork)}
        title={previewWork?.name || '作品预览'}
        width={820}
      >
        {previewWork?.mediaType === 'image'
          ? <Image alt={previewWork.name} className="all-works-preview-image" src={previewUrl} />
          : <video className="all-works-preview-video" controls ref={previewVideoRef} src={previewUrl} />}
      </Modal>

      <Modal
        centered
        confirmLoading={addingToDiscover}
        destroyOnHidden
        okButtonProps={{ disabled: !discoverCategoryId || discoverCategories.length === 0 }}
        okText="确认添加"
        onCancel={closeDiscoverModal}
        onOk={() => void addToDiscover()}
        open={Boolean(discoverWork)}
        title="添加到发现"
      >
        <div className="all-works-discover-form">
          <Typography.Text type="secondary">{discoverWork?.name || '-'}</Typography.Text>
          <Select
            notFoundContent="暂无可用分类，请先在发现管理中创建分类"
            onChange={setDiscoverCategoryId}
            options={discoverCategories.map((category) => ({ label: category.name, value: category.id }))}
            placeholder="请选择分类"
            value={discoverCategoryId}
          />
        </div>
      </Modal>
    </ContentStudioLayout>
  )
}
