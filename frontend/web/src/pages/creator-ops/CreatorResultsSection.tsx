import type { ReactNode } from 'react';
import { Empty } from 'antd';
import { CreatorSelectionToolbar } from './CreatorSelectionToolbar';
import './CreatorResultsSection.scss';

type CreatorResultsSectionProps = {
  actionDisabled?: boolean;
  actionLabel?: string;
  className?: string;
  emptyDescription: string;
  gap?: number | string;
  hasResults: boolean;
  onAction: () => void;
  selectedCount: number;
  table: ReactNode;
};

export function CreatorResultsSection({
  actionDisabled = false,
  actionLabel,
  className,
  emptyDescription,
  gap = 12,
  hasResults,
  onAction,
  selectedCount,
  table,
}: CreatorResultsSectionProps) {
  return hasResults ? (
    <div
      className={className || 'creator-results-section'}
      style={{
        ['--creator-results-section-gap' as string]: typeof gap === 'number' ? `${gap}px` : gap,
      }}
    >
      <CreatorSelectionToolbar
        actionLabel={actionLabel}
        disabled={actionDisabled}
        onAction={onAction}
        selectedCount={selectedCount}
      />
      {table}
    </div>
  ) : (
    <Empty description={emptyDescription} image={Empty.PRESENTED_IMAGE_SIMPLE} />
  );
}
