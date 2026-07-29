import { useState } from 'react';
import { Button, Input, Popover } from 'antd';
import { CaretDownOutlined, CheckOutlined } from '@ant-design/icons';
import type { OptionPopoverFilterGroup, OptionPopoverFilterValue } from '../../../components/OptionPopoverFilter';
import type { RangePopoverFilterValue } from '../../../components/RangePopoverFilter';
import type { MatchPresetRangeFilterItem } from '../xingtuCreatorFilterData';
import { hasRangeSelections, normalizeBoundedNumericInput } from './filterUtils';

type PresetRangeFilterProps = {
  item: MatchPresetRangeFilterItem;
  popoverValue: OptionPopoverFilterValue;
  rangeValue: RangePopoverFilterValue;
  onPopoverChange: (nextValue: OptionPopoverFilterValue) => void;
  onRangeChange: (nextValue: RangePopoverFilterValue) => void;
};

function createEmptyRangeValue(item: MatchPresetRangeFilterItem) {
  return Object.fromEntries(item.fields.map((field) => [field, { min: '', max: '' }]));
}

function createEmptyPopoverValue(item: { groups: OptionPopoverFilterGroup[] }) {
  return Object.fromEntries(item.groups.map((group) => [group.key, []]));
}

export function PresetRangeFilter({
  item,
  popoverValue,
  rangeValue,
  onPopoverChange,
  onRangeChange,
}: PresetRangeFilterProps) {
  const [open, setOpen] = useState(false);
  const normalizedPopoverValue = popoverValue || createEmptyPopoverValue(item);
  const normalizedRangeValue = rangeValue || createEmptyRangeValue(item);
  const [draftRangeValue, setDraftRangeValue] = useState<RangePopoverFilterValue>(normalizedRangeValue);
  const presetSelectedCount = item.groups.reduce((count, group) => count + (normalizedPopoverValue[group.key]?.length || 0), 0);
  const selectedPreset = item.groups.flatMap((group) => normalizedPopoverValue[group.key] || [])[0] || '';
  const rangeSelected = hasRangeSelections(normalizedRangeValue);
  const selected = presetSelectedCount > 0 || rangeSelected;
  const displayLabel = selectedPreset || (rangeSelected ? '自定义' : item.label);

  const clearRanges = () => createEmptyRangeValue(item);
  const clearPresets = () => createEmptyPopoverValue(item);
  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      setDraftRangeValue(normalizedRangeValue);
    }
    setOpen(nextOpen);
  };

  const content = (
    <div className="option-popover-filter xingtu-preset-range-filter">
      <div className="option-popover-filter__body">
        {item.groups.map((group) => {
          const selectedOptions = normalizedPopoverValue[group.key] || [];
          return (
            <div className="option-popover-filter__group" key={group.key}>
              <div className="option-popover-filter__options">
                {group.options.map((option) => {
                  const isChecked = selectedOptions.includes(option);
                  return (
                    <button
                      className={`option-popover-filter__option${isChecked ? ' is-selected' : ''}`}
                      key={option}
                      onClick={() => {
                        onRangeChange(clearRanges());
                        onPopoverChange({
                          ...normalizedPopoverValue,
                          [group.key]: isChecked ? [] : [option],
                        });
                        setOpen(false);
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
        <div className="range-popover-filter__body">
          {item.fields.map((field) => {
            const fieldValue = draftRangeValue[field] || { min: '', max: '' };
            return (
              <div className="range-popover-filter__row xingtu-preset-range-filter__row" key={field}>
                <div className="range-popover-filter__inputs xingtu-preset-range-filter__inputs">
                  <Input
                    inputMode="decimal"
                    onChange={(event) => {
                      const nextValue = normalizeBoundedNumericInput(event.target.value, item.min, item.max);
                      setDraftRangeValue({
                        ...draftRangeValue,
                        [field]: {
                          ...fieldValue,
                          min: nextValue,
                        },
                      });
                    }}
                    placeholder={typeof item.min === 'number' ? String(item.min) : undefined}
                    style={{ width: 100 }}
                    suffix={item.unit}
                    value={fieldValue.min}
                  />
                  <span className="range-popover-filter__separator">-</span>
                  <Input
                    inputMode="decimal"
                    onChange={(event) => {
                      const nextValue = normalizeBoundedNumericInput(event.target.value, item.min, item.max);
                      setDraftRangeValue({
                        ...draftRangeValue,
                        [field]: {
                          ...fieldValue,
                          max: nextValue,
                        },
                      });
                    }}
                    placeholder={typeof item.max === 'number' ? String(item.max) : undefined}
                    style={{ width: 100 }}
                    suffix={item.unit}
                    value={fieldValue.max}
                  />
                </div>
              </div>
            );
          })}
        </div>
        <div className="range-popover-filter__footer xingtu-preset-range-filter__footer">
          <Button
            onClick={() => {
              onPopoverChange(clearPresets());
              const emptyRange = clearRanges();
              onRangeChange(emptyRange);
              setDraftRangeValue(emptyRange);
            }}
            size="small"
            type="text"
          >
            重置
          </Button>
          <Button
            onClick={() => {
              onPopoverChange(clearPresets());
              onRangeChange(draftRangeValue);
              setOpen(false);
            }}
            size="small"
            type="primary"
          >
            确定
          </Button>
        </div>
      </div>
    </div>
  );

  return (
    <Popover
      arrow={false}
      content={content}
      onOpenChange={handleOpenChange}
      open={open}
      overlayClassName="option-popover-filter-overlay range-popover-filter-overlay xingtu-preset-range-filter-overlay"
      placement="bottomLeft"
      trigger="click"
    >
      <button className={`xingtu-filter-option xingtu-filter-option-dropdown${selected ? ' selected' : ''}`} type="button">
        <span>{displayLabel}</span>
        <CaretDownOutlined />
      </button>
    </Popover>
  );
}
