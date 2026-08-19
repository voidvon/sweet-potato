import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

export function useTableBodyHeight() {
  const viewportElementRef = useRef<HTMLDivElement | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const [bodyHeight, setBodyHeight] = useState(1);

  const measure = useCallback(() => {
    const viewport = viewportElementRef.current;
    if (!viewport || viewport.clientHeight <= 0) return;

    const headerHeight = viewport.querySelector<HTMLElement>('.ant-table-header')?.offsetHeight || 0;
    const pagination = viewport.querySelector<HTMLElement>('.ant-table-pagination');
    let paginationHeight = 0;
    if (pagination) {
      const style = window.getComputedStyle(pagination);
      paginationHeight = pagination.offsetHeight
        + Number.parseFloat(style.marginTop || '0')
        + Number.parseFloat(style.marginBottom || '0');
    }

    const nextHeight = Math.max(1, Math.floor(viewport.clientHeight - headerHeight - paginationHeight));
    setBodyHeight((currentHeight) => currentHeight === nextHeight ? currentHeight : nextHeight);
  }, []);

  const scheduleMeasure = useCallback(() => {
    if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
    animationFrameRef.current = requestAnimationFrame(() => {
      animationFrameRef.current = null;
      measure();
    });
  }, [measure]);

  const viewportRef = useCallback((viewport: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    viewportElementRef.current = viewport;

    if (!viewport) return;
    observerRef.current = new ResizeObserver(scheduleMeasure);
    observerRef.current.observe(viewport);
    scheduleMeasure();
  }, [scheduleMeasure]);

  useLayoutEffect(() => {
    scheduleMeasure();
  });

  useEffect(() => () => {
    observerRef.current?.disconnect();
    if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
  }, []);

  return { bodyHeight, viewportRef };
}
