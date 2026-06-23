import { Popover, Input, Button } from 'antd';
import { CaretDownOutlined } from '@ant-design/icons';
import './RangePopoverFilter.scss';

export type RangePopoverFilterFieldValue = {
  min: string;
  max: string;
};

export type RangePopoverFilterValue = Record<string, RangePopoverFilterFieldValue>;

type RangePopoverFilterProps = {
  label: string;
  fields: string[];
  value: RangePopoverFilterValue;
  onChange: (nextValue: RangePopoverFilterValue) => void;
  minWidth?: number;
  maxWidth?: number | string;
  unit?: string;
  overlayClassName?: string;
};

function joinClassNames(...names: Array<string | false | null | undefined>) {
  return names.filter(Boolean).join(' ');
}

export function countRangePopoverFilterSelections(value: RangePopoverFilterValue) {
  return Object.values(value).filter((field) => field?.min || field?.max).length;
}

export function RangePopoverFilter({
  label,
  fields,
  value,
  onChange,
  minWidth = 300,
  maxWidth = 360,
  unit = 'w',
  overlayClassName,
}: RangePopoverFilterProps) {
  const selectedCount = countRangePopoverFilterSelections(value);
  const selected = selectedCount > 0;

  const content = (
    <div
      className="range-popover-filter"
      style={{
        ['--range-popover-filter-min-width' as string]: `${minWidth}px`,
        ['--range-popover-filter-max-width' as string]: typeof maxWidth === 'number' ? `${maxWidth}px` : maxWidth,
      }}
    >
      <div className="range-popover-filter__body">
        {fields.map((field) => {
          const fieldValue = value[field] || { min: '', max: '' };
          return (
            <div className="range-popover-filter__row" key={field}>
              <div className="range-popover-filter__label">{field}</div>
              <div className="range-popover-filter__inputs">
                <Input
                  inputMode="numeric"
                  onChange={(event) => {
                    onChange({
                      ...value,
                      [field]: {
                        ...fieldValue,
                        min: event.target.value,
                      },
                    });
                  }}
                  suffix={unit}
                  value={fieldValue.min}
                />
                <span className="range-popover-filter__separator">-</span>
                <Input
                  inputMode="numeric"
                  onChange={(event) => {
                    onChange({
                      ...value,
                      [field]: {
                        ...fieldValue,
                        max: event.target.value,
                      },
                    });
                  }}
                  suffix={unit}
                  value={fieldValue.max}
                />
              </div>
            </div>
          );
        })}
      </div>
      <div className="range-popover-filter__footer">
        <Button
          onClick={() => {
            onChange(Object.fromEntries(fields.map((field) => [field, { min: '', max: '' }])));
          }}
          size="small"
          type="text"
        >
          重置
        </Button>
      </div>
    </div>
  );

  return (
    <Popover
      arrow={false}
      content={content}
      overlayClassName={joinClassNames('range-popover-filter-overlay', overlayClassName)}
      placement="bottomLeft"
      trigger="click"
    >
      <button
        className={`xingtu-filter-option xingtu-filter-option-dropdown${selected ? ' selected' : ''}`}
        type="button"
      >
        <span>{selectedCount > 0 ? `${label}·${selectedCount}` : label}</span>
        <CaretDownOutlined />
      </button>
    </Popover>
  );
}
