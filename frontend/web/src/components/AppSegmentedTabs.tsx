import { Segmented } from 'antd';
import type { SegmentedProps } from 'antd';
import type { CSSProperties, ReactNode } from 'react';
import './AppSegmentedTabs.scss';

export type AppSegmentedTabOption<T extends string = string> = {
  disabled?: boolean;
  label: ReactNode;
  value: T;
};

type AppSegmentedTabsProps<T extends string = string> = {
  ariaLabel?: string;
  className?: string;
  itemMinWidth?: number;
  onChange: (value: T) => void;
  options: AppSegmentedTabOption<T>[];
  size?: SegmentedProps['size'];
  style?: CSSProperties;
  value: T;
};

function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

export function AppSegmentedTabs<T extends string = string>({
  ariaLabel,
  className,
  itemMinWidth = 60,
  onChange,
  options,
  size = 'large',
  style,
  value,
}: AppSegmentedTabsProps<T>) {
  return (
    <Segmented
      aria-label={ariaLabel}
      className={classNames('app-segmented-tabs', className)}
      onChange={(nextValue) => onChange(String(nextValue) as T)}
      options={options}
      shape="round"
      size={size}
      style={{
        '--app-segmented-tabs-item-min-width': `${itemMinWidth}px`,
        ...style,
      } as CSSProperties}
      value={value}
    />
  );
}
