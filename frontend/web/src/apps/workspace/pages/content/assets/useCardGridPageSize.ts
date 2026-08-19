import { useEffect, useState, type RefObject } from 'react';

type UseCardGridPageSizeInput = {
  containerRef: RefObject<HTMLElement | null>;
  cardWidth?: number;
  gap?: number;
  rows?: number;
  extraItems?: number;
  fallbackColumns?: number;
};

function measureColumns(width: number, cardWidth: number, gap: number) {
  return Math.max(1, Math.floor((width + gap) / (cardWidth + gap)));
}

export function useCardGridPageSize({
  containerRef,
  cardWidth = 220,
  gap = 16,
  rows = 4,
  extraItems = 0,
  fallbackColumns = 4,
}: UseCardGridPageSizeInput) {
  const [columns, setColumns] = useState(fallbackColumns);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return undefined;
    }

    const measure = () => {
      const nextColumns = measureColumns(element.clientWidth, cardWidth, gap);
      setColumns((current) => (current === nextColumns ? current : nextColumns));
    };

    measure();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }

    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [cardWidth, containerRef, gap]);

  const basePageSize = columns * rows;
  const pageSize = Math.max(columns, basePageSize - extraItems);

  return {
    columns,
    pageSize,
  };
}
