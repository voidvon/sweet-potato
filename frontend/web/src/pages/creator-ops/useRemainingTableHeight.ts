import { useEffect, useState, type RefObject } from 'react';

type UseRemainingTableHeightOptions = {
  footerRef?: RefObject<HTMLElement | null>;
  gap?: number;
  minHeight?: number;
};

export function useRemainingTableHeight(
  panelRef: RefObject<HTMLElement | null>,
  headerRef: RefObject<HTMLElement | null>,
  deps: ReadonlyArray<unknown>,
  options?: UseRemainingTableHeightOptions,
) {
  const [height, setHeight] = useState(options?.minHeight || 240);

  useEffect(() => {
    const panelElement = panelRef.current;
    const headerElement = headerRef.current;
    if (!panelElement || !headerElement || typeof ResizeObserver === 'undefined') {
      return undefined;
    }

    const minHeight = options?.minHeight || 240;
    const gap = options?.gap || 0;

    const measure = () => {
      const footerHeight = options?.footerRef?.current?.offsetHeight || 0;
      const panelHeight = panelElement.clientHeight;
      const headerHeight = headerElement.offsetHeight;
      setHeight(Math.max(minHeight, panelHeight - headerHeight - footerHeight - gap));
    };

    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(panelElement);
    observer.observe(headerElement);
    if (options?.footerRef?.current) {
      observer.observe(options.footerRef.current);
    }
    window.addEventListener('resize', measure);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, deps);

  return height;
}
