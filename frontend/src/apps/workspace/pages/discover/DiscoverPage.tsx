import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FireFilled, HeartFilled, HeartOutlined } from '@ant-design/icons'
import { Empty, message, Spin, Tabs } from 'antd'
import { Play } from 'lucide-react'
import { resolveAssetUrl } from '@shared/api/core/request'
import { getStoredUser } from '@shared/utils/session'
import { AppImage } from '../../components/AppImage'
import { InfiniteScroll } from '../../components/InfiniteScroll'
import { ResultVideoPreviewModal } from '../content/VideoTaskClonePage/components/ResultVideoPreviewModal'
import {
  likeDiscoverItem,
  listDiscoverCategories,
  listDiscoverItems,
  type DiscoverCategory,
  type DiscoverItem,
  type DiscoverItemCounts,
  viewDiscoverItem,
} from '../../api/discover'
import './DiscoverPage.scss'
import { t } from '@shared/i18n';

const DISCOVER_PAGE_SIZE = 20
const DISCOVER_RATIO_CACHE_KEY = 'discover-media-ratios'
const DISCOVER_LIKES_CACHE_KEY = 'discover-liked-item-ids'

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

function likesCacheKey() {
  return `${DISCOVER_LIKES_CACHE_KEY}:${getStoredUser()?.id || 'current-user'}`
}

function readLikedItemIds() {
  if (typeof window === 'undefined') return new Set<string>()
  try {
    const value = JSON.parse(window.localStorage.getItem(likesCacheKey()) || '[]')
    return new Set(Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [])
  } catch {
    return new Set<string>()
  }
}

function persistLikedItemIds(itemIds: Set<string>) {
  try {
    window.localStorage.setItem(likesCacheKey(), JSON.stringify([...itemIds]))
  } catch {
    // The in-memory guard still prevents repeated clicks when storage is unavailable.
  }
}

export function DiscoverPage() {
  const [categories, setCategories] = useState<DiscoverCategory[]>([])
  const [items, setItems] = useState<DiscoverItem[]>([])
  const [mediaType, setMediaType] = useState<'all' | DiscoverItem['mediaType']>('all')
  const [categoryId, setCategoryId] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [previewItem, setPreviewItem] = useState<DiscoverItem | null>(null)
  const [previewImageOpen, setPreviewImageOpen] = useState(false)
  const [measuredRatios, setMeasuredRatios] = useState<Record<string, string>>(readRatioCache)
  const [loadedMediaIds, setLoadedMediaIds] = useState<Set<string>>(() => new Set())
  const [playingVideoIds, setPlayingVideoIds] = useState<Set<string>>(() => new Set())
  const [columnCount, setColumnCount] = useState(discoverColumnCount)
  const [likedItemIds, setLikedItemIds] = useState<Set<string>>(readLikedItemIds)
  const listRequestIdRef = useRef(0)
  const likedItemIdsRef = useRef(likedItemIds)
  const videoFrameRequestIdsRef = useRef(new Map<string, number>())

  useEffect(() => {
    let active = true
    listDiscoverCategories()
      .then((result) => {
        if (active) setCategories([...result.items].sort((left, right) => left.sortOrder - right.sortOrder))
      })
      .catch(() => { if (active) setCategories([]) })
    return () => { active = false }
  }, [])

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
    })
      .then((result) => {
        if (!active || requestId !== listRequestIdRef.current) return
        setItems(Array.isArray(result.items) ? result.items : [])
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
  }, [categoryId, mediaType])

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
      })
      if (requestId !== listRequestIdRef.current) return
      const nextItems = Array.isArray(result.items) ? result.items : []
      setItems((current) => {
        const knownIds = new Set(current.map((item) => item.id))
        return [...current, ...nextItems.filter((item) => !knownIds.has(item.id))]
      })
      setPage(result.page)
      setTotal(result.total)
    } catch {
      // The reusable infinite-scroll component allows another attempt on re-entry.
    } finally {
      if (requestId === listRequestIdRef.current) setLoadingMore(false)
    }
  }, [categoryId, items.length, loading, loadingMore, mediaType, page, total])

  const updateItemCounts = useCallback((itemId: string, counts: DiscoverItemCounts) => {
    setItems((current) => current.map((item) => item.id === itemId ? { ...item, ...counts } : item))
    setPreviewItem((current) => current?.id === itemId ? { ...current, ...counts } : current)
  }, [])

  const openPreview = useCallback((item: DiscoverItem) => {
    setPreviewItem(item)
    setPreviewImageOpen(item.mediaType === 'image')
    void viewDiscoverItem(item.id)
      .then((counts) => updateItemCounts(item.id, counts))
      .catch(() => message.error(t("浏览量更新失败")))
  }, [updateItemCounts])

  const likeItem = useCallback((item: DiscoverItem) => {
    if (likedItemIdsRef.current.has(item.id)) return

    const nextLikedItemIds = new Set(likedItemIdsRef.current)
    nextLikedItemIds.add(item.id)
    likedItemIdsRef.current = nextLikedItemIds
    setLikedItemIds(nextLikedItemIds)
    persistLikedItemIds(nextLikedItemIds)
    setItems((current) => current.map((currentItem) => currentItem.id === item.id
      ? { ...currentItem, likeCount: currentItem.likeCount + 1 }
      : currentItem))

    void likeDiscoverItem(item.id)
      .then((counts) => updateItemCounts(item.id, counts))
      .catch(() => {
        const rolledBackItemIds = new Set(likedItemIdsRef.current)
        rolledBackItemIds.delete(item.id)
        likedItemIdsRef.current = rolledBackItemIds
        setLikedItemIds(rolledBackItemIds)
        persistLikedItemIds(rolledBackItemIds)
        setItems((current) => current.map((currentItem) => currentItem.id === item.id
          ? { ...currentItem, likeCount: Math.max(0, currentItem.likeCount - 1) }
          : currentItem))
        message.error(t("点赞失败，请稍后重试"))
      })
  }, [updateItemCounts])

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

  const setVideoFrameVisible = useCallback((itemId: string, visible: boolean) => {
    setPlayingVideoIds((current) => {
      if (current.has(itemId) === visible) return current
      const next = new Set(current)
      if (visible) next.add(itemId)
      else next.delete(itemId)
      return next
    })
  }, [])

  const handleVideoPlaying = useCallback((itemId: string, video: HTMLVideoElement) => {
    const previousRequestId = videoFrameRequestIdsRef.current.get(itemId)
    if (previousRequestId !== undefined && video.cancelVideoFrameCallback) {
      video.cancelVideoFrameCallback(previousRequestId)
    }
    if (!video.requestVideoFrameCallback) return
    const requestId = video.requestVideoFrameCallback(() => {
      videoFrameRequestIdsRef.current.delete(itemId)
      if (!video.paused) setVideoFrameVisible(itemId, true)
    })
    videoFrameRequestIdsRef.current.set(itemId, requestId)
  }, [setVideoFrameVisible])

  const handleVideoLeave = useCallback((itemId: string, video: HTMLVideoElement) => {
    const requestId = videoFrameRequestIdsRef.current.get(itemId)
    if (requestId !== undefined && video.cancelVideoFrameCallback) {
      video.cancelVideoFrameCallback(requestId)
      videoFrameRequestIdsRef.current.delete(itemId)
    }
    setVideoFrameVisible(itemId, false)
    video.pause()
    video.currentTime = 0
  }, [setVideoFrameVisible])

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
              { key: 'all', label: t("全部") },
              { key: 'image', label: t("图片") },
              { key: 'video', label: t("视频") },
            ]}
            onChange={(key) => setMediaType(key as typeof mediaType)}
          />
        </div>

        <Tabs
          activeKey={categoryId || 'all'}
          className="discover-category-tabs"
          items={[
            { key: 'all', label: t("全部") },
            ...categories.map((category) => ({ key: category.id, label: category.name })),
          ]}
          onChange={(key) => setCategoryId(key === 'all' ? '' : key)}
          tabBarGutter={20}
        />

        {loading ? (
          <div className="discover-state"><Spin /></div>
        ) : loadFailed ? (
          <div className="discover-empty">{t("发现内容加载失败")}</div>
        ) : items.length > 0 ? (
          <InfiniteScroll
            dataLength={items.length}
            endText={t("已加载全部作品")}
            hasMore={items.length < total}
            loading={loadingMore}
            onLoadMore={loadMore}
          >
            <section aria-label={t("生成作品")} className="discover-grid">
              {discoverColumns.map((column, columnIndex) => (
                <div className="discover-grid-column" key={columnIndex}>
                {column.map((item) => {
                const mediaUrl = resolveAssetUrl(item.fileUrl)
                const posterUrl = item.coverUrl ? resolveAssetUrl(item.coverUrl) : undefined
                const ratio = item.aspectRatio && item.aspectRatio !== '1 / 1'
                  ? item.aspectRatio
                  : measuredRatios[item.id] || item.aspectRatio || '1 / 1'
                return (
                  <article
                    className="discover-card"
                    key={item.id}
                    onClick={() => openPreview(item)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        openPreview(item)
                      }
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <div className={`discover-card-media${loadedMediaIds.has(item.id) ? ' is-loaded' : ''}${playingVideoIds.has(item.id) ? ' is-video-playing' : ''}`} style={{ aspectRatio: cssAspectRatio(ratio) }}>
                      {item.mediaType === 'video' ? (
                        <video
                          aria-label={item.title || t("生成视频")}
                          loop
                          muted
                          onError={() => markMediaLoaded(item.id)}
                          onLoadedMetadata={(event) => {
                            rememberMediaSize(item.id, event.currentTarget.videoWidth, event.currentTarget.videoHeight)
                            markMediaLoaded(item.id)
                          }}
                          onMouseEnter={(event) => {
                            setVideoFrameVisible(item.id, false)
                            void event.currentTarget.play().catch(() => undefined)
                          }}
                          onMouseLeave={(event) => handleVideoLeave(item.id, event.currentTarget)}
                          onPlaying={(event) => handleVideoPlaying(item.id, event.currentTarget)}
                          onTimeUpdate={(event) => {
                            if (event.currentTarget.currentTime > 0) setVideoFrameVisible(item.id, true)
                          }}
                          playsInline
                          poster={posterUrl}
                          preload="metadata"
                          src={mediaUrl}
                        />
                      ) : (
                        <img
                          alt={item.title || t("生成图片")}
                          loading="lazy"
                          onError={() => markMediaLoaded(item.id)}
                          onLoad={(event) => {
                            rememberMediaSize(item.id, event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)
                            markMediaLoaded(item.id)
                          }}
                          src={mediaUrl}
                        />
                      )}
                      {item.mediaType === 'video' && posterUrl ? (
                        <img aria-hidden="true" alt="" className="discover-card-poster" src={posterUrl} />
                      ) : null}
                      {item.mediaType === 'video' ? <span className="discover-play"><Play aria-hidden="true" fill="currentColor" size={12} strokeWidth={2} /></span> : null}
                      <div className="discover-card-meta">
                        <span><FireFilled /> {item.viewCount}</span>
                        <button
                          aria-label={likedItemIds.has(item.id) ? t("已点赞") : t("点赞")}
                          aria-pressed={likedItemIds.has(item.id)}
                          className={`discover-like${likedItemIds.has(item.id) ? ' is-liked' : ''}`}
                          onClick={(event) => {
                            event.stopPropagation()
                            likeItem(item)
                          }}
                          onKeyDown={(event) => event.stopPropagation()}
                          type="button"
                        >
                          {likedItemIds.has(item.id) ? <HeartFilled /> : <HeartOutlined />}
                          <span>{item.likeCount}</span>
                        </button>
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
          <div className="discover-state"><Empty description={t("没有找到匹配的作品")} image={Empty.PRESENTED_IMAGE_SIMPLE} /></div>
        )}
      </div>

      {previewItem?.mediaType === 'video' ? (
        <ResultVideoPreviewModal
          initiallyMuted={false}
          onClose={() => setPreviewItem(null)}
          video={{
            completedAt: previewItem.sourceCompletedAt || previewItem.publishedAt || undefined,
            createdAt: previewItem.sourceCreatedAt || undefined,
            duration: previewItem.duration,
            name: previewItem.title || previewItem.originalFileName || t("生成视频"),
            posterUrl: previewItem.coverUrl ? resolveAssetUrl(previewItem.coverUrl) : undefined,
            referenceAssets: previewItem.referenceAssets,
            videoUrl: resolveAssetUrl(previewItem.fileUrl),
          }}
        />
      ) : null}

      <AppImage
        alt={previewItem?.title || previewItem?.originalFileName || t("图片预览")}
        preview={{
          open: previewImageOpen,
          onOpenChange: setPreviewImageOpen,
          afterOpenChange: (open) => {
            if (!open) {
              setPreviewItem((current) => current?.mediaType === 'image' ? null : current)
            }
          },
        }}
        src={previewItem?.mediaType === 'image' ? resolveAssetUrl(previewItem.fileUrl) : undefined}
        style={{ display: 'none' }}
      />
    </main>
  )
}
