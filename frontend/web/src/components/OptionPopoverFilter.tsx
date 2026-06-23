import { useMemo } from 'react';
import { Button, Popover } from 'antd';
import { CaretDownOutlined, CheckOutlined } from '@ant-design/icons';
import './OptionPopoverFilter.scss';

export type OptionPopoverFilterMode = 'single' | 'multi';

export type OptionPopoverFilterGroup = {
  key: string;
  label?: string;
  options: string[];
  mode: OptionPopoverFilterMode;
  showSelectAll?: boolean;
};

export type OptionPopoverFilterValue = Record<string, string[]>;

type OptionPopoverFilterProps = {
  label: string;
  groups: OptionPopoverFilterGroup[];
  value: OptionPopoverFilterValue;
  onChange: (nextValue: OptionPopoverFilterValue) => void;
  displayMode?: 'count' | 'selected';
  minWidth?: number;
  maxWidth?: number | string;
  maxHeight?: number;
  overlayClassName?: string;
};

function joinClassNames(...names: Array<string | false | null | undefined>) {
  return names.filter(Boolean).join(' ');
}

function collectSelectedValues(groups: OptionPopoverFilterGroup[], value: OptionPopoverFilterValue) {
  return groups.flatMap((group) => value[group.key] || []);
}

export function countOptionPopoverFilterSelections(groups: OptionPopoverFilterGroup[], value: OptionPopoverFilterValue) {
  return collectSelectedValues(groups, value).length;
}

export function hasOptionPopoverFilterSelections(groups: OptionPopoverFilterGroup[], value: OptionPopoverFilterValue) {
  return countOptionPopoverFilterSelections(groups, value) > 0;
}

export function OptionPopoverFilter({
  label,
  groups,
  value,
  onChange,
  displayMode = 'count',
  minWidth = 200,
  maxWidth = 340,
  maxHeight = 360,
  overlayClassName,
}: OptionPopoverFilterProps) {
  const selectedValues = useMemo(() => collectSelectedValues(groups, value), [groups, value]);
  const selectedCount = selectedValues.length;
  const selected = selectedCount > 0;

  const displayLabel = useMemo(() => {
    if (!selectedCount) {
      return label;
    }
    if (displayMode === 'selected' && selectedCount === 1) {
      return selectedValues[0];
    }
    return `${label}·${selectedCount}`;
  }, [displayMode, label, selectedCount, selectedValues]);

  const content = (
    <div
      className="option-popover-filter"
      style={{
        ['--option-popover-filter-min-width' as string]: `${minWidth}px`,
        ['--option-popover-filter-max-width' as string]: typeof maxWidth === 'number' ? `${maxWidth}px` : maxWidth,
        ['--option-popover-filter-max-height' as string]: `${maxHeight}px`,
      }}
    >
      <div className="option-popover-filter__body">
        {groups.map((group) => {
          const selectedOptions = value[group.key] || [];
          const isAllSelected = group.mode === 'multi'
            && group.options.length > 0
            && selectedOptions.length === group.options.length;

          return (
            <div className="option-popover-filter__group" key={group.key}>
              {group.label ? (
                <div className="option-popover-filter__group-label">{group.label}</div>
              ) : null}
              {group.mode === 'multi' && group.showSelectAll && group.options.length > 1 ? (
                <Button
                  className="option-popover-filter__select-all"
                  onClick={() => {
                    onChange({
                      ...value,
                      [group.key]: isAllSelected ? [] : [...group.options],
                    });
                  }}
                  size="small"
                  type="text"
                >
                  {isAllSelected ? '反选' : '全选'}
                </Button>
              ) : null}
              <div className="option-popover-filter__options">
                {group.options.map((option) => {
                  const isChecked = selectedOptions.includes(option);
                  return (
                    <button
                      className={joinClassNames(
                        'option-popover-filter__option',
                        isChecked && 'is-selected',
                      )}
                      key={option}
                      onClick={() => {
                        if (group.mode === 'single') {
                          onChange({
                            ...value,
                            [group.key]: isChecked ? [] : [option],
                          });
                          return;
                        }
                        const nextSelected = isChecked
                          ? selectedOptions.filter((item) => item !== option)
                          : [...selectedOptions, option];
                        onChange({
                          ...value,
                          [group.key]: nextSelected,
                        });
                      }}
                      type="button"
                    >
                      <span className="option-popover-filter__option-text">{option}</span>
                      {isChecked ? <CheckOutlined /> : null}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <Popover
      arrow={false}
      content={content}
      overlayClassName={joinClassNames('option-popover-filter-overlay', overlayClassName)}
      placement="bottomLeft"
      trigger="click"
    >
      <button
        className={`xingtu-filter-option xingtu-filter-option-dropdown${selected ? ' selected' : ''}`}
        type="button"
      >
        <span>{displayLabel}</span>
        <CaretDownOutlined />
      </button>
    </Popover>
  );
}
