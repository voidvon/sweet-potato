import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FireFilled, HeartOutlined, SearchOutlined } from '@ant-design/icons'
import { Empty, Input, Spin, Tabs } from 'antd'
import { Play } from 'lucide-react'
import { resolveAssetUrl } from '@shared/api/core/request'
import { AppImage } from '../../components/AppImage'
import { InfiniteScroll } from '../../components/InfiniteScroll'
import { ResultVideoPreviewModal } from '../content/VideoTaskClonePage/components/ResultVideoPreviewModal'
import { listDiscoverCategories, listDiscoverItems, type DiscoverCategory, type DiscoverItem } from '../../api/discover'
import './DiscoverPage.scss'

const DISCOVER_PAGE_SIZE = 20
const DISCOVER_RATIO_CACHE_KEY = 'discover-media-ratios'

function discoverColumnCount() {
  if (typeof window === 'undefined') return 5
  if (window.innerWidth <= 760) return 2
  if (window.innerWidth <= 1200) return 3
  return 5
}

function cssAspectRatio(value: string | undefined) {
  const normalized = String(value || '').trim().replace(':', ' / ')
  return /^\d+(?:\.\d+)?\s*\/\s*\d+(?:\.\d+)?$/.test(normalized) ? normalized : '1 / 1'
}

function readRatioCache() {
  if (typeof window === 'undefined') return {}
  try {
    const value = JSON.parse(window.localStorage.getItem(DISCOVER_RATIO_CACHE_KEY) || '{}')
    return value && typeof value === 'object' ? value as Record<string, string> : {}
  } catch {
    return {}
  }
}

export function DiscoverPage() {
  const [categories, setCategories] = useState<DiscoverCategory[]>([])
  const [items, setItems] = useState<DiscoverItem[]>([])
  const [mediaType, setMediaType] = useState<'all' | DiscoverItem['mediaType']>('all')
  const [categoryId, setCategoryId] = useState('')
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [previewItem, setPreviewItem] = useState<DiscoverItem | null>(null)
  const [measuredRatios, setMeasuredRatios] = useState<Record<string, string>>(readRatioCache)
  const [loadedMediaIds, setLoadedMediaIds] = useState<Set<string>>(() => new Set())
  const [columnCount, setColumnCount] = useState(discoverColumnCount)
  const listRequestIdRef = useRef(0)

  useEffect(() => {
    let active = true
    listDiscoverCategories()
      .then((result) => { if (active) setCategories(result.items) })
      .catch(() => { if (active) setCategories([]) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 250)
    return () => window.clearTimeout(timer)
  }, [query])

  useEffect(() => {
    let active = true
    const requestId = ++listRequestIdRef.current
    setItems([])
    setPage(1)
    setTotal(0)
    setLoading(true)
    setLoadingMore(false)
    setLoadFailed(false)
    listDiscoverItems({
      page: 1,
      pageSize: DISCOVER_PAGE_SIZE,
      categoryId: categoryId || undefined,
      mediaType: mediaType === 'all' ? undefined : mediaType,
      search: debouncedQuery || undefined,
    })
      .then((result) => {
        if (!active || requestId !== listRequestIdRef.current) return
        setItems(result.items)
        setPage(result.page)
        setTotal(result.total)
      })
      .catch(() => {
        if (active && requestId === listRequestIdRef.current) setLoadFailed(true)
      })
      .finally(() => {
        if (active && requestId === listRequestIdRef.current) setLoading(false)
      })
    return () => { active = false }
  }, [categoryId, debouncedQuery, mediaType])

  const loadMore = useCallback(async () => {
    if (loading || loadingMore || items.length >= total) return
    const requestId = listRequestIdRef.current
    const nextPage = page + 1
    setLoadingMore(true)
    try {
      const result = await listDiscoverItems({
        page: nextPage,
        pageSize: DISCOVER_PAGE_SIZE,
        categoryId: categoryId || undefined,
        mediaType: mediaType === 'all' ? undefined : mediaType,
        search: debouncedQuery || undefined,
      })
      if (requestId !== listRequestIdRef.current) return
      setItems((current) => {
        const knownIds = new Set(current.map((item) => item.id))
        return [...current, ...result.items.filter((item) => !knownIds.has(item.id))]
      })
      setPage(result.page)
      setTotal(result.total)
    } catch {
      // The reusable infinite-scroll component allows another attempt on re-entry.
    } finally {
      if (requestId === listRequestIdRef.current) setLoadingMore(false)
    }
  }, [categoryId, debouncedQuery, items.length, loading, loadingMore, mediaType, page, total])

  const rememberMediaSize = useCallback((itemId: string, width: number, height: number) => {
    if (!width || !height) return
    const ratio = `${width} / ${height}`
    setMeasuredRatios((current) => {
      if (current[itemId] === ratio) return current
      const next = { ...current, [itemId]: ratio }
      try {
        window.localStorage.setItem(DISCOVER_RATIO_CACHE_KEY, JSON.stringify(next))
      } catch {
        // Storage may be unavailable in private browsing; the in-memory value still works.
      }
      return next
    })
  }, [])

  const markMediaLoaded = useCallback((itemId: string) => {
    setLoadedMediaIds((current) => {
      if (current.has(itemId)) return current
      const next = new Set(current)
      next.add(itemId)
      return next
    })
  }, [])

  useEffect(() => {
    const updateColumnCount = () => setColumnCount(discoverColumnCount())
    window.addEventListener('resize', updateColumnCount)
    return () => window.removeEventListener('resize', updateColumnCount)
  }, [])

  const discoverColumns = useMemo(() => Array.from({ length: columnCount }, (_, columnIndex) => (
    items.filter((_, itemIndex) => itemIndex % columnCount === columnIndex)
  )), [columnCount, items])

  return (
    <main className="discover-page">
      <div className="discover-page-content">
        <div className="discover-toolbar">
          <Tabs
            activeKey={mediaType}
            className="discover-media-tabs"
            items={[
              { key: 'all', label: '全部' },
              { key: 'image', label: '图片' },
              { key: 'video', label: '视频' },
            ]}
            onChange={(key) => setMediaType(key as typeof mediaType)}
          />
          <Input allowClear className="discover-search" onChange={(event) => setQuery(event.target.value)} placeholder="搜索" prefix={<SearchOutlined />} value={query} />
        </div>

        <Tabs
          activeKey={categoryId || 'all'}
          className="discover-category-tabs"
          items={[
            { key: 'all', label: '全部' },
            ...categories.map((category) => ({ key: category.id, label: category.name })),
          ]}
          onChange={(key) => setCategoryId(key === 'all' ? '' : key)}
          tabBarGutter={20}
        />

        {loading ? (
          <div className="discover-state"><Spin /></div>
        ) : loadFailed ? (
          <div className="discover-empty">发现内容加载失败</div>
        ) : items.length > 0 ? (
          <InfiniteScroll
            dataLength={items.length}
            endText="已加载全部作品"
            hasMore={items.length < total}
            loading={loadingMore}
            onLoadMore={loadMore}
          >
            <section aria-label="生成作品" className="discover-grid">
              {discoverColumns.map((column, columnIndex) => (
                <div className="discover-grid-column" key={columnIndex}>
                {column.map((item) => {
                const mediaUrl = resolveAssetUrl(item.fileUrl)
                const ratio = item.aspectRatio && item.aspectRatio !== '1 / 1'
                  ? item.aspectRatio
                  : measuredRatios[item.id] || item.aspectRatio || '1 / 1'
                return (
                  <article
                    className="discover-card"
                    key={item.id}
                    onClick={() => setPreviewItem(item)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        setPreviewItem(item)
                      }
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <div className={`discover-card-media${loadedMediaIds.has(item.id) ? ' is-loaded' : ''}`} style={{ aspectRatio: cssAspectRatio(ratio) }}>
                      {item.mediaType === 'video' ? (
                        <video
                          aria-label={item.title || '生成视频'}
                          loop
                          muted
                          onError={() => markMediaLoaded(item.id)}
                          onLoadedMetadata={(event) => {
                            rememberMediaSize(item.id, event.currentTarget.videoWidth, event.currentTarget.videoHeight)
                            markMediaLoaded(item.id)
                          }}
                          onMouseEnter={(event) => { void event.currentTarget.play() }}
                          onMouseLeave={(event) => { event.currentTarget.pause(); event.currentTarget.currentTime = 0 }}
                          playsInline
                          preload="metadata"
                          src={mediaUrl}
                        />
                      ) : (
                        <img
                          alt={item.title || '生成图片'}
                          loading="lazy"
                          onError={() => markMediaLoaded(item.id)}
                          onLoad={(event) => {
                            rememberMediaSize(item.id, event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)
                            markMediaLoaded(item.id)
                          }}
                          src={mediaUrl}
                        />
                      )}
                      {item.mediaType === 'video' ? <span className="discover-play"><Play aria-hidden="true" fill="currentColor" size={12} strokeWidth={2} /></span> : null}
                      <div className="discover-card-meta">
                        <span><FireFilled /> {item.viewCount}</span>
                        <span><HeartOutlined /> {item.likeCount}</span>
                      </div>
                    </div>
                  </article>
                )
                })}
                </div>
              ))}
            </section>
          </InfiniteScroll>
        ) : (
          <div className="discover-state"><Empty description="没有找到匹配的作品" image={Empty.PRESENTED_IMAGE_SIMPLE} /></div>
        )}
      </div>

      {previewItem?.mediaType === 'video' ? (
        <ResultVideoPreviewModal
          onClose={() => setPreviewItem(null)}
          video={{
            completedAt: previewItem.sourceCompletedAt || previewItem.publishedAt || undefined,
            createdAt: previewItem.sourceCreatedAt || undefined,
            duration: previewItem.duration,
            name: previewItem.title || previewItem.originalFileName || '生成视频',
            referenceAssets: previewItem.referenceAssets,
            videoUrl: resolveAssetUrl(previewItem.fileUrl),
          }}
        />
      ) : null}

      <AppImage
        alt={previewItem?.title || previewItem?.originalFileName || '图片预览'}
        preview={{
          visible: previewItem?.mediaType === 'image',
          onVisibleChange: (visible) => {
            if (!visible) setPreviewItem(null)
          },
        }}
        src={previewItem?.mediaType === 'image' ? resolveAssetUrl(previewItem.fileUrl) : undefined}
        style={{ display: 'none' }}
      />
    </main>
  )
}
