import { PlusOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons'
import { Button, Input, Modal, Select, Space, Table, Typography, message } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { type CSSProperties, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { listAdminWorks, type AdminWork } from '../../api/admin-works'
import { createDiscoverItem, listDiscoverCategories, type DiscoverCategory } from '../../api/discover'
import { WorkPreviewThumbnail } from '../../components/WorkPreviewThumbnail'
import { ContentStudioLayout } from '../../layouts/ContentStudioLayout'
import './AllWorksPage.scss'
import { t } from '@shared/i18n';

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

export function AllWorksPage() {
  const [works, setWorks] = useState<AdminWork[]>([])
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [usernameInput, setUsernameInput] = useState('')
  const [username, setUsername] = useState('')
  const [discoverCategories, setDiscoverCategories] = useState<DiscoverCategory[]>([])
  const [discoverWork, setDiscoverWork] = useState<AdminWork | null>(null)
  const [discoverCategoryId, setDiscoverCategoryId] = useState<string>()
  const [addingToDiscover, setAddingToDiscover] = useState(false)
  const workTable = useTableBodyHeight()

  const loadWorks = useCallback(async (nextPage = page, nextUsername = username) => {
    setLoading(true)
    try {
      const result = await listAdminWorks(nextPage, 20, nextUsername)
      setWorks(result.items)
      setPage(result.page)
      setTotal(result.total)
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("作品列表加载失败"))
    } finally {
      setLoading(false)
    }
  }, [page, username])

  useEffect(() => {
    void loadWorks(1, '')
    void listDiscoverCategories()
      .then((result) => setDiscoverCategories(result.items.filter((category) => category.status === 'active')))
      .catch((error) => message.error(error instanceof Error ? error.message : t("发现分类加载失败")))
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
      })
      message.success(t("已添加到发现"))
      setDiscoverWork(null)
      setDiscoverCategoryId(undefined)
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("添加到发现失败"))
    } finally {
      setAddingToDiscover(false)
    }
  }

  const columns = useMemo<ColumnsType<AdminWork>>(() => [
    {
      title: t("作品结果"),
      key: 'preview',
      width: 96,
      render: (_, work) => (
        <WorkPreviewThumbnail
          coverUrl={work.coverUrl}
          fileUrl={work.fileUrl}
          mediaType={work.mediaType}
          title={work.name}
        />
      ),
    },
    {
      title: t("作品名称"),
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
      title: t("用户名"),
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
      title: t("生成功能"),
      key: 'mode',
      width: 150,
      ellipsis: true,
      render: (_, work) => work.modeTitle || work.mode || '-',
    },
    {
      title: t("模型"),
      dataIndex: 'model',
      width: 160,
      ellipsis: true,
      render: (value: string) => value || '-',
    },
    {
      title: t("生成时间"),
      dataIndex: 'generatedAt',
      width: 190,
      render: (value: string) => formatDateTime(value),
    },
    {
      title: t("操作"),
      key: 'actions',
      fixed: 'right',
      width: 130,
      render: (_, work) => (
        <Space size={0}>
          <Button icon={<PlusOutlined />} onClick={() => openDiscoverModal(work)} type="link">{t("添加到发现")}</Button>
        </Space>
      ),
    },
  ], [])

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
              placeholder={t("输入用户名搜索")}
              value={usernameInput}
            />
            <Button icon={<SearchOutlined />} loading={loading} onClick={applyUsernameFilter}>{t("查询")}</Button>
            <Button disabled={!usernameInput && !username} onClick={resetUsernameFilter}>{t("重置")}</Button>
            <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void loadWorks(page, username)}>{t("刷新")}</Button>
          </Space>
          <Typography.Text type="secondary">{t("全部用户生成的图片和视频作品")}</Typography.Text>
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
            locale={{ emptyText: username ? t("没有找到该用户的作品") : t("暂无作品") }}
            pagination={{
              current: page,
              pageSize: 20,
              total,
              showSizeChanger: false,
              showTotal: (count) => t("共 {{0}} 条", { "0": count }),
              onChange: (nextPage) => void loadWorks(nextPage, username),
            }}
            rowKey="id"
            scroll={{ x: 1220, y: workTable.bodyHeight }}
          />
        </div>
      </section>

      <Modal
        centered
        confirmLoading={addingToDiscover}
        destroyOnHidden
        okButtonProps={{ disabled: !discoverCategoryId || discoverCategories.length === 0 }}
        okText={t("确认添加")}
        onCancel={closeDiscoverModal}
        onOk={() => void addToDiscover()}
        open={Boolean(discoverWork)}
        title={t("添加到发现")}
      >
        <div className="all-works-discover-form">
          <Typography.Text type="secondary">{discoverWork?.name || '-'}</Typography.Text>
          <Select
            notFoundContent={t("暂无可用分类，请先在发现管理中创建分类")}
            onChange={setDiscoverCategoryId}
            options={discoverCategories.map((category) => ({ label: category.name, value: category.id }))}
            placeholder={t("请选择分类")}
            value={discoverCategoryId}
          />
        </div>
      </Modal>
    </ContentStudioLayout>
  )
}
