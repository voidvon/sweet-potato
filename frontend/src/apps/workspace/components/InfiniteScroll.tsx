import { Button, Spin } from 'antd';
import { useCallback, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import './InfiniteScroll.scss';
import { t } from '@shared/i18n';

export type InfiniteScrollProps = {
  children: ReactNode;
  className?: string;
  dataLength: number;
  disabled?: boolean;
  endText?: ReactNode;
  hasMore: boolean;
  loading?: boolean;
  loadingText?: ReactNode;
  onLoadMore: () => Promise<void> | void;
  rootMargin?: string;
};

function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

export function InfiniteScroll({
  children,
  className,
  dataLength,
  disabled = false,
  endText = t('已加载全部记录'),
  hasMore,
  loading = false,
  loadingText = t('正在加载更多'),
  onLoadMore,
  rootMargin = '0px 0px 160px',
}: InfiniteScrollProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const loadingRequestRef = useRef(false);
  const supportsIntersectionObserver = typeof IntersectionObserver !== 'undefined';

  const triggerLoadMore = useCallback(() => {
    if (disabled || loading || !hasMore || loadingRequestRef.current) {
      return;
    }
    loadingRequestRef.current = true;
    Promise.resolve()
      .then(onLoadMore)
      .catch(() => undefined)
      .finally(() => {
        loadingRequestRef.current = false;
      });
  }, [disabled, hasMore, loading, onLoadMore]);

  useEffect(() => {
    const container = containerRef.current;
    const sentinel = sentinelRef.current;
    if (!supportsIntersectionObserver || !container || !sentinel || disabled || loading || !hasMore) {
      return undefined;
    }

    let observer: IntersectionObserver | null = null;
    const observeSentinel = () => {
      observer?.disconnect();
      const overflowY = window.getComputedStyle(container).overflowY;
      const hasOwnScroll = (overflowY === 'auto' || overflowY === 'scroll')
        && container.scrollHeight > container.clientHeight + 1;
      const scrollRoot = hasOwnScroll ? container : null;
      observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          triggerLoadMore();
        }
      }, {
        root: scrollRoot,
        rootMargin,
        threshold: 0.01,
      });
      observer.observe(sentinel);
    };

    observeSentinel();
    window.addEventListener('resize', observeSentinel);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', observeSentinel);
    };
  }, [dataLength, disabled, hasMore, loading, rootMargin, supportsIntersectionObserver, triggerLoadMore]);

  return (
    <div className={classNames('app-infinite-scroll', className)} ref={containerRef}>
      {children}
      <div aria-live="polite" className="app-infinite-scroll-footer" ref={sentinelRef}>
        {!disabled && loading ? <><Spin size="small" /><span>{loadingText}</span></> : null}
        {!disabled && !loading && !hasMore && dataLength > 0 ? <span>{endText}</span> : null}
        {!disabled && !supportsIntersectionObserver && hasMore && !loading ? (
          <Button onClick={triggerLoadMore} size="small">{t("加载更多")}</Button>
        ) : null}
      </div>
    </div>
  );
}
