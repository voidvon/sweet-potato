import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { CaretDownOutlined } from '@ant-design/icons';
import './CollapsibleFilterRow.scss';

const HIDDEN_ITEM_CLASS = 'collapsible-filter-row__item-hidden';

type CollapsibleFilterRowProps = {
  label: string;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  collapsedHeight?: number;
  singleLineCollapsed?: boolean;
};

function joinClassNames(...names: Array<string | false | null | undefined>) {
  return names.filter(Boolean).join(' ');
}

export function CollapsibleFilterRow({
  label,
  children,
  className,
  contentClassName,
  collapsedHeight = 26,
  singleLineCollapsed = false,
}: CollapsibleFilterRowProps) {
  const contentRef = useRef<HTMLDivElement | null>(null);
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const [toggleWidth, setToggleWidth] = useState(0);

  const clearHiddenItems = () => {
    const element = contentRef.current;
    if (!element) {
      return;
    }

    Array.from(element.children).forEach((child) => {
      child.classList.remove(HIDDEN_ITEM_CLASS);
    });
  };

  useEffect(() => {
    const element = contentRef.current;
    if (!element) {
      return undefined;
    }

    const measure = () => {
      clearHiddenItems();

      if (singleLineCollapsed && !expanded) {
        setOverflowing(element.scrollWidth > element.clientWidth + 2);
        return;
      }

      setOverflowing(element.scrollHeight > collapsedHeight + 2);
    };

    measure();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => {
        window.removeEventListener('resize', measure);
      };
    }

    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [children, collapsedHeight, expanded, singleLineCollapsed]);

  useLayoutEffect(() => {
    const element = contentRef.current;
    if (!element) {
      return;
    }

    clearHiddenItems();

    if (!singleLineCollapsed || expanded || !overflowing) {
      return;
    }

    const items = Array.from(element.children) as HTMLElement[];
    const contentRect = element.getBoundingClientRect();
    const computedStyle = window.getComputedStyle(element);
    const paddingRight = Number.parseFloat(computedStyle.paddingRight || '0') || 0;
    const visibleRight = contentRect.right - paddingRight - 4;
    let cutoffIndex = items.length;

    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      const itemRect = item.getBoundingClientRect();
      if (itemRect.right > visibleRight) {
        cutoffIndex = index;
        break;
      }
    }

    if (cutoffIndex >= items.length) {
      return;
    }

    for (let index = cutoffIndex; index < items.length; index += 1) {
      items[index].classList.add(HIDDEN_ITEM_CLASS);
    }

    for (let index = cutoffIndex - 1; index >= 0; index -= 1) {
      const item = items[index];
      if (
        item.classList.contains('xingtu-filter-subgroup-label')
      ) {
        item.classList.add(HIDDEN_ITEM_CLASS);
        continue;
      }
      break;
    }
  }, [children, expanded, overflowing, singleLineCollapsed, toggleWidth]);

  useEffect(() => {
    const element = toggleRef.current;
    if (!element || !overflowing) {
      setToggleWidth(0);
      return undefined;
    }

    const measure = () => {
      setToggleWidth(element.getBoundingClientRect().width);
    };

    measure();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => {
        window.removeEventListener('resize', measure);
      };
    }

    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [overflowing, expanded]);

  const collapsedStyle = expanded
    ? undefined
    : {
      maxHeight: `${collapsedHeight}px`,
      paddingRight: overflowing && singleLineCollapsed && toggleWidth > 0 ? `${toggleWidth + 12}px` : undefined,
    };

  return (
    <div
      className={joinClassNames(
        'collapsible-filter-row',
        expanded && 'is-expanded',
        singleLineCollapsed && 'is-single-line-collapsed',
        className,
      )}
    >
      <div className="collapsible-filter-row__label xingtu-filter-line-label">{label}</div>
      <div className="collapsible-filter-row__main">
        <div
          className={joinClassNames('collapsible-filter-row__content', contentClassName)}
          ref={contentRef}
          style={collapsedStyle}
        >
          {children}
        </div>
        {overflowing ? (
          <button
            className="collapsible-filter-row__toggle"
            onClick={() => setExpanded((value) => !value)}
            ref={toggleRef}
            type="button"
          >
            <span>{expanded ? '收起' : '更多'}</span>
            <CaretDownOutlined />
          </button>
        ) : null}
      </div>
    </div>
  );
}
