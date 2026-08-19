import './SelectionCardGroup.scss';

export type SelectionCardOption = {
  badge?: string;
  description: string;
  key: string;
  onSelect: () => void;
  readOnly?: boolean;
  selected: boolean;
  title: string;
  tooltip?: string;
};

type SelectionCardGroupProps = {
  ariaLabel: string;
  columns: 2 | 3;
  options: SelectionCardOption[];
  selectionMode?: 'single' | 'multiple';
};

export function SelectionCardGroup({
  ariaLabel,
  columns,
  options,
  selectionMode = 'single',
}: SelectionCardGroupProps) {
  return (
    <div
      aria-label={ariaLabel}
      className={`selection-card-group is-${columns}-columns`}
      role={selectionMode === 'single' ? 'radiogroup' : 'group'}
    >
      {options.map((option) => (
        <button
          aria-checked={option.selected}
          aria-readonly={option.readOnly || undefined}
          className={`${option.selected ? 'is-active' : ''}${option.readOnly ? ' is-read-only' : ''}`}
          key={option.key}
          onClick={option.onSelect}
          role={selectionMode === 'single' ? 'radio' : 'checkbox'}
          title={option.tooltip}
          type="button"
        >
          <strong>
            {option.title}
            {option.badge && <em>{option.badge}</em>}
          </strong>
          <span>{option.description}</span>
        </button>
      ))}
    </div>
  );
}
