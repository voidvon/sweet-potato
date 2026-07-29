import { useState } from 'react';
import { Button, Input, Popover, Select } from 'antd';
import { CaretDownOutlined, CheckOutlined } from '@ant-design/icons';
import type { OptionPopoverFilterValue } from '../../../components/OptionPopoverFilter';
import type { RangePopoverFilterValue } from '../../../components/RangePopoverFilter';
import type { MatchPriceQuoteFilterItem, MatchTaskCountFilterItem } from '../xingtuCreatorFilterData';
import type { PriceQuoteFilterValue, TaskCountFilterValue } from './filterTypes';
import { createEmptyTaskCountValue, hasRangeSelections, normalizeBoundedNumericInput } from './filterUtils';

function createEmptyRangeValue(item: MatchPriceQuoteFilterItem) {
  return Object.fromEntries(item.fields.map((field) => [field, { min: '', max: '' }]));
}

type PriceQuoteRangeSelectProps = {
  item: MatchPriceQuoteFilterItem;
  quoteRangeValue: OptionPopoverFilterValue;
  customRangeValue: RangePopoverFilterValue;
  onQuoteRangeChange: (nextValue: OptionPopoverFilterValue) => void;
  onCustomRangeChange: (nextValue: RangePopoverFilterValue) => void;
};

function PriceQuoteRangeSelect({
  item,
  quoteRangeValue,
  customRangeValue,
  onQuoteRangeChange,
  onCustomRangeChange,
}: PriceQuoteRangeSelectProps) {
  const [open, setOpen] = useState(false);
  const group = item.quoteRangeGroup;
  const normalizedQuoteRangeValue = quoteRangeValue || { [group.key]: [] };
  const normalizedCustomRangeValue = customRangeValue || createEmptyRangeValue(item);
  const [draftRangeValue, setDraftRangeValue] = useState<RangePopoverFilterValue>(normalizedCustomRangeValue);
  const selectedOptions = normalizedQuoteRangeValue[group.key] || [];
  const selectedPreset = selectedOptions[0] || '';
  const customRangeSelected = hasRangeSelections(normalizedCustomRangeValue);

  const clearRanges = () => createEmptyRangeValue(item);
  const clearPresets = () => ({ [group.key]: [] });
  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      setDraftRangeValue(normalizedCustomRangeValue);
    }
    setOpen(nextOpen);
  };

  const content = (
    <div className="option-popover-filter xingtu-preset-range-filter">
      <div className="option-popover-filter__body">
        <div className="option-popover-filter__group">
          <div className="option-popover-filter__options">
            {group.options.map((option) => {
              const isChecked = selectedOptions.includes(option);
              return (
                <button
                  className={`option-popover-filter__option${isChecked ? ' is-selected' : ''}`}
                  key={option}
                  onClick={() => {
                    onCustomRangeChange(clearRanges());
                    onQuoteRangeChange(option === '全部' || isChecked ? clearPresets() : { [group.key]: [option] });
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
              const emptyRange = clearRanges();
              onQuoteRangeChange(clearPresets());
              onCustomRangeChange(emptyRange);
              setDraftRangeValue(emptyRange);
            }}
            size="small"
            type="text"
          >
            重置
          </Button>
          <Button
            onClick={() => {
              onQuoteRangeChange(clearPresets());
              onCustomRangeChange(draftRangeValue);
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
    <Select
      className="xingtu-price-quote-filter__select-control"
      open={open}
      onOpenChange={handleOpenChange}
      options={[
        ...group.options.map((option) => ({ label: option, value: option })),
        ...(customRangeSelected ? [{ label: '自定义', value: '__custom__' }] : []),
      ]}
      placeholder="全部"
      popupClassName="option-popover-filter-overlay range-popover-filter-overlay xingtu-preset-range-filter-overlay"
      popupMatchSelectWidth={false}
      popupRender={() => content}
      size="small"
      value={selectedPreset || (customRangeSelected ? '__custom__' : undefined)}
    />
  );
}

type PriceQuoteFilterProps = {
  item: MatchPriceQuoteFilterItem;
  value: PriceQuoteFilterValue;
  onChange: (nextValue: PriceQuoteFilterValue) => void;
};

export function PriceQuoteFilter({ item, value, onChange }: PriceQuoteFilterProps) {
  const [open, setOpen] = useState(false);
  const normalizedValue = value || {
    quoteType: { [item.quoteTypeGroup.key]: [] },
    quoteRange: { [item.quoteRangeGroup.key]: [] },
    customRange: createEmptyRangeValue(item),
  };
  const normalizedCustomRange = normalizedValue.customRange || createEmptyRangeValue(item);
  const selectedQuoteType = (normalizedValue.quoteType?.[item.quoteTypeGroup.key] || [])[0] || '';
  const selectedQuoteRange = (normalizedValue.quoteRange?.[item.quoteRangeGroup.key] || [])[0] || '';
  const customRangeSelected = hasRangeSelections(normalizedCustomRange);
  const selected = Boolean(selectedQuoteType || selectedQuoteRange || customRangeSelected);
  const selectedCount = [Boolean(selectedQuoteType), Boolean(selectedQuoteRange || customRangeSelected)].filter(Boolean).length;
  const displayLabel = selectedCount > 0 ? `${item.label}·${selectedCount}` : item.label;

  const clearCustomRange = () => createEmptyRangeValue(item);
  const emptyQuoteType = () => ({ [item.quoteTypeGroup.key]: [] });
  const emptyQuoteRange = () => ({ [item.quoteRangeGroup.key]: [] });

  const content = (
    <div className="option-popover-filter xingtu-price-quote-filter">
      <div className="option-popover-filter__body xingtu-price-quote-filter__body">
        <div className="xingtu-price-quote-filter__row">
          <span className="xingtu-price-quote-filter__label">选择报价类型</span>
          <Select
            className="xingtu-price-quote-filter__select-control"
            onChange={(option) => {
              onChange({
                ...normalizedValue,
                quoteType: option === '全部' ? emptyQuoteType() : { [item.quoteTypeGroup.key]: [option] },
              });
            }}
            options={item.quoteTypeGroup.options.map((option) => ({ label: option, value: option }))}
            popupClassName="xingtu-filter-dropdown-menu xingtu-price-quote-filter__menu"
            size="small"
            value={selectedQuoteType || '全部'}
          />
        </div>

        <div className="xingtu-price-quote-filter__row">
          <span className="xingtu-price-quote-filter__label">报价区间</span>
          <PriceQuoteRangeSelect
            customRangeValue={normalizedCustomRange}
            item={item}
            onCustomRangeChange={(nextCustomRange) => {
              onChange({
                ...normalizedValue,
                quoteRange: emptyQuoteRange(),
                customRange: nextCustomRange,
              });
            }}
            onQuoteRangeChange={(nextQuoteRange) => {
              onChange({
                ...normalizedValue,
                quoteRange: nextQuoteRange,
                customRange: clearCustomRange(),
              });
            }}
            quoteRangeValue={normalizedValue.quoteRange}
          />
        </div>

        <div className="range-popover-filter__footer xingtu-preset-range-filter__footer">
          <Button
            onClick={() => {
              onChange({
                quoteType: emptyQuoteType(),
                quoteRange: emptyQuoteRange(),
                customRange: clearCustomRange(),
              });
            }}
            size="small"
            type="text"
          >
            重置
          </Button>
          <Button onClick={() => setOpen(false)} size="small" type="primary">确定</Button>
        </div>
      </div>
    </div>
  );

  return (
    <Popover
      arrow={false}
      content={content}
      onOpenChange={setOpen}
      open={open}
      overlayClassName="option-popover-filter-overlay range-popover-filter-overlay xingtu-price-quote-filter-overlay"
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

type TaskCountFilterProps = {
  item: MatchTaskCountFilterItem;
  value: TaskCountFilterValue;
  onChange: (nextValue: TaskCountFilterValue) => void;
};

export function TaskCountFilter({ item, value, onChange }: TaskCountFilterProps) {
  const [open, setOpen] = useState(false);
  const defaultValue = createEmptyTaskCountValue(item);
  const normalizedValue = value
    ? {
      taskTime: value.taskTime || defaultValue.taskTime,
      taskCount: {
        min: value.taskCount?.min || '',
        max: value.taskCount?.max || '',
      },
    }
    : defaultValue;
  const [draftValue, setDraftValue] = useState<TaskCountFilterValue>(normalizedValue);
  const selectedTaskTime = (normalizedValue.taskTime?.[item.taskTimeGroup.key] || [])[0] || '';
  const selectedMin = normalizedValue.taskCount?.min || '';
  const selectedMax = normalizedValue.taskCount?.max || '';
  const selected = Boolean(selectedTaskTime || selectedMin || selectedMax);
  const countLabel = [selectedMin ? `> ${selectedMin}` : '', selectedMax ? `< ${selectedMax}` : ''].filter(Boolean).join(' 且 ');
  const displayLabel = [selectedTaskTime, countLabel].filter(Boolean).join(' ') || item.label;

  const draftTaskTime = (draftValue.taskTime?.[item.taskTimeGroup.key] || [])[0] || '';
  const draftMin = draftValue.taskCount?.min || '';
  const draftMax = draftValue.taskCount?.max || '';
  const maxNumber = draftMax === '' ? null : Number(draftMax);
  const minNumber = draftMin === '' ? null : Number(draftMin);
  const availableMinOptions = item.minOptions.filter((option) => maxNumber === null || Number(option) < maxNumber);
  const availableMaxOptions = item.maxOptions.filter((option) => minNumber === null || Number(option) > minNumber);

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      setDraftValue(normalizedValue);
    }
    setOpen(nextOpen);
  };

  const updateDraftTaskTime = (option: string) => {
    setDraftValue({
      ...draftValue,
      taskTime: {
        [item.taskTimeGroup.key]: option ? [option] : [],
      },
    });
  };

  const updateDraftMin = (option?: string) => {
    const nextMin = option || '';
    const nextMinNumber = nextMin === '' ? null : Number(nextMin);
    const nextMax = nextMinNumber !== null && draftMax !== '' && Number(draftMax) <= nextMinNumber ? '' : draftMax;
    setDraftValue({
      ...draftValue,
      taskCount: {
        min: nextMin,
        max: nextMax,
      },
    });
  };

  const updateDraftMax = (option?: string) => {
    const nextMax = option || '';
    const nextMaxNumber = nextMax === '' ? null : Number(nextMax);
    const nextMin = nextMaxNumber !== null && draftMin !== '' && Number(draftMin) >= nextMaxNumber ? '' : draftMin;
    setDraftValue({
      ...draftValue,
      taskCount: {
        min: nextMin,
        max: nextMax,
      },
    });
  };

  const content = (
    <div className="option-popover-filter xingtu-task-count-filter">
      <div className="option-popover-filter__body xingtu-task-count-filter__body">
        <div className="xingtu-price-quote-filter__row">
          <span className="xingtu-price-quote-filter__label">任务时间</span>
          <Select
            allowClear
            className="xingtu-task-count-filter__select xingtu-task-count-filter__select-time"
            onChange={updateDraftTaskTime}
            options={item.taskTimeGroup.options.map((option) => ({ label: option, value: option }))}
            placeholder="任务时间"
            popupClassName="xingtu-filter-dropdown-menu xingtu-task-count-filter__menu"
            size="small"
            value={draftTaskTime || undefined}
          />
        </div>

        <div className="xingtu-price-quote-filter__row">
          <span className="xingtu-price-quote-filter__label">任务数量</span>
          <div className="xingtu-task-count-filter__range-selects">
            <Select
              allowClear
              className="xingtu-task-count-filter__select xingtu-task-count-filter__select-number"
              onChange={updateDraftMin}
              options={availableMinOptions.map((option) => ({ label: option, value: option }))}
              placeholder="最低数量"
              popupClassName="xingtu-filter-dropdown-menu xingtu-task-count-filter__menu"
              size="small"
              value={draftMin || undefined}
            />
            <span className="range-popover-filter__separator">-</span>
            <Select
              allowClear
              className="xingtu-task-count-filter__select xingtu-task-count-filter__select-number"
              onChange={updateDraftMax}
              options={availableMaxOptions.map((option) => ({ label: option, value: option }))}
              placeholder="最高数量"
              popupClassName="xingtu-filter-dropdown-menu xingtu-task-count-filter__menu"
              size="small"
              value={draftMax || undefined}
            />
          </div>
        </div>

        <div className="range-popover-filter__footer xingtu-preset-range-filter__footer">
          <Button
            onClick={() => {
              const emptyValue = createEmptyTaskCountValue(item);
              setDraftValue(emptyValue);
              onChange(emptyValue);
            }}
            size="small"
            type="text"
          >
            重置
          </Button>
          <Button
            onClick={() => {
              onChange(draftValue);
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
      overlayClassName="option-popover-filter-overlay range-popover-filter-overlay xingtu-task-count-filter-overlay"
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
