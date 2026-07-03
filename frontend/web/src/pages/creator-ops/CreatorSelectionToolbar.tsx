import { Button } from 'antd';
import './CreatorSelectionToolbar.scss';

type CreatorSelectionToolbarProps = {
  actionLabel?: string;
  className?: string;
  disabled?: boolean;
  onAction: () => void;
  selectedCount: number;
};

export function CreatorSelectionToolbar({
  actionLabel = '建联',
  className,
  disabled = false,
  onAction,
  selectedCount,
}: CreatorSelectionToolbarProps) {
  return (
    <div className={className || 'creator-selection-toolbar'}>
      <div className="creator-selection-toolbar__meta">
        已选择 {selectedCount} 位达人
      </div>
      <Button
        className="creator-selection-toolbar__action"
        disabled={disabled || !selectedCount}
        onClick={onAction}
        type="primary"
      >
        {actionLabel}
      </Button>
    </div>
  );
}
