import { Fragment } from 'react';
import { Cascader, Popover, Select } from 'antd';
import type { DefaultOptionType } from 'antd/es/cascader';
import type { DataNode } from 'antd/es/tree';
import { CaretDownOutlined } from '@ant-design/icons';
import { OptionPopoverFilter, type OptionPopoverFilterGroup, type OptionPopoverFilterValue } from '../../components/OptionPopoverFilter';
import { RangePopoverFilter, type RangePopoverFilterValue } from '../../components/RangePopoverFilter';
import { TreePopoverFilter } from '../../components/TreePopoverFilter';
import {
  BUYIN_CREATOR_FILTER_GROUPS,
  type BuyinAggregateFilterControl,
  type BuyinFilterItem,
  type BuyinFilterValue,
} from './buyinCreatorFilterData';

const ROOT_GROUP_KEY = '__root__';

function buildGroupChildValue(groupKey: string, option: string) {
  return `${groupKey}/${option}`;
}

function buildTreeDataFromGroups(groups: OptionPopoverFilterGroup[]): DataNode[] {
  return groups.flatMap((group) => {
    if (!group.label) {
      return group.options.map((option) => ({
        title: option,
        value: option,
        key: option,
      }));
    }

    return {
      title: group.label,
      value: group.key,
      key: group.key,
      children: group.options.map((option) => ({
        title: option,
        value: buildGroupChildValue(group.key, option),
        key: buildGroupChildValue(group.key, option),
      })),
    };
  });
}

function normalizeGroupSelectionsToTreeValues(groups: OptionPopoverFilterGroup[], currentValue: OptionPopoverFilterValue) {
  const values: string[] = [];

  for (const group of groups) {
    const selectedOptions = currentValue[group.key] || [];
    if (!group.label) {
      values.push(...selectedOptions);
      continue;
    }
    for (const option of selectedOptions) {
      values.push(option === group.key ? group.key : buildGroupChildValue(group.key, option));
    }
  }

  return values;
}

function normalizeTreeValuesToGroupSelections(groups: OptionPopoverFilterGroup[], values: string[]) {
  const nextValue = Object.fromEntries(groups.map((group) => [group.key, []])) as OptionPopoverFilterValue;
  const selectedValue = values[0] || '';
  if (!selectedValue) {
    return nextValue;
  }

  const exactGroup = groups.find((group) => group.label && group.key === selectedValue);
  if (exactGroup) {
    nextValue[exactGroup.key] = [exactGroup.key];
    return nextValue;
  }

  const splitIndex = selectedValue.indexOf('/');
  if (splitIndex > 0) {
    const groupKey = selectedValue.slice(0, splitIndex);
    const option = selectedValue.slice(splitIndex + 1);
    if (groups.some((group) => group.key === groupKey)) {
      nextValue[groupKey] = option ? [option] : [];
      return nextValue;
    }
  }

  const rootGroup = groups.find((group) => group.key === ROOT_GROUP_KEY);
  if (rootGroup) {
    nextValue[ROOT_GROUP_KEY] = [selectedValue];
  }
  return nextValue;
}

function normalizeMultiTreeValuesToGroupSelections(groups: OptionPopoverFilterGroup[], values: string[]) {
  const valueSet = new Set(values);
  const nextValue = Object.fromEntries(groups.map((group) => [group.key, []])) as OptionPopoverFilterValue;

  for (const group of groups) {
    if (!group.label) {
      nextValue[group.key] = group.options.filter((option) => valueSet.has(option));
      continue;
    }

    if (valueSet.has(group.key)) {
      nextValue[group.key] = [...group.options];
      continue;
    }

    nextValue[group.key] = group.options.filter((option) => valueSet.has(buildGroupChildValue(group.key, option)));
  }

  return nextValue;
}

function createDefaultSelection(groups: OptionPopoverFilterGroup[]) {
  return Object.fromEntries(
    groups.map((group) => [group.key, group.options.includes('全部') ? ['全部'] : []]),
  ) as OptionPopoverFilterValue;
}

function hasSelection(value: OptionPopoverFilterValue) {
  return Object.values(value).some((selectedOptions) => selectedOptions.length > 0);
}

function countSelections(value: OptionPopoverFilterValue) {
  return Object.values(value).reduce((count, selectedOptions) => count + selectedOptions.length, 0);
}

function buildAggregateTreeData(control: Extract<BuyinAggregateFilterControl, { type: 'tree-single' }>): DefaultOptionType[] {
  return control.options.map((option) => ({
    label: option.label,
    value: option.value,
    children: option.children?.map((child) => ({
      label: child.label,
      value: child.value,
    })),
  }));
}

function parseAggregateTreeValue(value: string) {
  if (!value) {
    return [];
  }
  return value.split('/').filter(Boolean);
}

type BuyinCreatorFiltersProps = {
  value: BuyinFilterValue;
  onChange: (nextValue: BuyinFilterValue) => void;
};

function isMainCategoryGroup(groupTitle: string) {
  return groupTitle === '主推类目';
}

export function BuyinCreatorFilters({ value, onChange }: BuyinCreatorFiltersProps) {
  function updateSelection(label: string, nextValue: OptionPopoverFilterValue) {
    onChange({
      ...value,
      selections: {
        ...value.selections,
        [label]: nextValue,
      },
    });
  }

  function hasMainCategorySiblingSelection(excludeLabel?: string) {
    const mainCategoryGroup = BUYIN_CREATOR_FILTER_GROUPS.find((group) => isMainCategoryGroup(group.title));
    if (!mainCategoryGroup) {
      return false;
    }

    return mainCategoryGroup.filters.some((item) => {
      if (item.label === '全部' || item.label === excludeLabel || item.type === 'range') {
        return false;
      }
      return hasSelection(value.selections[item.label] || {});
    });
  }

  function toggleInlineOption(label: string, option: string) {
    const current = value.selections[label]?.[ROOT_GROUP_KEY] || [];
    const isChecked = current.includes(option);
    let nextSelected: string[];

    if (option === '全部') {
      nextSelected = ['全部'];
    } else {
      const withoutAll = current.filter((item) => item !== '全部');
      nextSelected = isChecked
        ? withoutAll.filter((item) => item !== option)
        : [...withoutAll, option];
    }

    updateSelection(label, {
      [ROOT_GROUP_KEY]: nextSelected,
    });
  }

  function updateRange(label: string, nextValue: RangePopoverFilterValue) {
    onChange({
      ...value,
      ranges: {
        ...value.ranges,
        [label]: nextValue,
      },
    });
  }

  function updateAggregateSelection(label: string, controlKey: string, nextSelected: string[]) {
    onChange({
      ...value,
      selections: {
        ...value.selections,
        [label]: {
          ...(value.selections[label] || {}),
          [controlKey]: nextSelected,
        },
      },
    });
  }

  function toggleFilter(label: string) {
    const selected = value.selections[label]?.[ROOT_GROUP_KEY]?.includes(label);
    if (label === '全部') {
      const mainCategoryGroup = BUYIN_CREATOR_FILTER_GROUPS.find((group) => isMainCategoryGroup(group.title));
      if (!mainCategoryGroup) {
        return;
      }

      const nextSelections: BuyinFilterValue['selections'] = {
        ...value.selections,
        [label]: {
          [ROOT_GROUP_KEY]: ['全部'],
        },
      };

      for (const item of mainCategoryGroup.filters) {
        if (item.label === '全部' || item.type !== 'popover') {
          continue;
        }
        nextSelections[item.label] = Object.fromEntries(item.groups.map((group) => [group.key, []]));
      }

      onChange({
        ...value,
        selections: nextSelections,
      });
      return;
    }

    onChange({
      ...value,
      selections: {
        ...value.selections,
        [label]: {
          [ROOT_GROUP_KEY]: selected ? [] : [label],
        },
      },
    });
  }

  function renderFilter(item: BuyinFilterItem, groupTitle: string) {
    if (item.type === 'popover') {
      if (item.renderAsTree) {
        const defaultValue = createDefaultSelection(item.groups);
        const savedValue = value.selections[item.label];
        const currentValue = savedValue && hasSelection(savedValue) ? savedValue : defaultValue;
        const treeValues = normalizeGroupSelectionsToTreeValues(item.groups, currentValue);
        const isMultipleTree = item.treeSelectionMode === 'multiple';
        return (
          <TreePopoverFilter
            expandTrigger={isMultipleTree ? 'click' : 'hover'}
            fixedHeight={isMultipleTree ? undefined : 328}
            label={item.label}
            maxHeight={isMultipleTree ? 380 : 328}
            minWidth={140}
            onChange={(nextValues) => {
              const normalizedValue = isMultipleTree
                ? normalizeMultiTreeValuesToGroupSelections(item.groups, nextValues)
                : normalizeTreeValuesToGroupSelections(item.groups, nextValues);
              const nextSelection = hasSelection(normalizedValue) ? normalizedValue : defaultValue;

              if (isMainCategoryGroup(groupTitle)) {
                onChange({
                  ...value,
                  selections: {
                    ...value.selections,
                    全部: {
                      [ROOT_GROUP_KEY]: hasSelection(nextSelection) ? [] : ['全部'],
                    },
                    [item.label]: nextSelection,
                  },
                });
                return;
              }

              updateSelection(item.label, nextSelection);
            }}
            selected={treeValues.length > 0}
            selectionMode={isMultipleTree ? 'multiple' : 'single'}
            selectAllLabel={item.treeSelectAllLabel}
            treeData={buildTreeDataFromGroups(item.groups)}
            values={treeValues}
          />
        );
      }

      return (
        <OptionPopoverFilter
          displayMode={item.displayMode}
          groups={item.groups}
          label={item.label}
          maxHeight={380}
          minWidth={140}
          onChange={(nextValue) => updateSelection(item.label, nextValue)}
          value={value.selections[item.label] || createDefaultSelection(item.groups)}
        />
      );
    }

    if (item.type === 'toggle') {
      const selected = item.label === '全部' && isMainCategoryGroup(groupTitle)
        ? !hasMainCategorySiblingSelection()
        : value.selections[item.label]?.[ROOT_GROUP_KEY]?.includes(item.label);
      return (
        <button
          className={`xingtu-filter-option${selected ? ' selected' : ''}`}
          onClick={() => toggleFilter(item.label)}
          type="button"
        >
          {item.label}
        </button>
      );
    }

    if (item.type === 'inline-options') {
      const savedValue = value.selections[item.label];
      const selectedOptions = savedValue && hasSelection(savedValue)
        ? (savedValue[item.group.key] || [])
        : (item.group.options.includes('全部') ? ['全部'] : []);
      return (
        <span className="buyin-inline-options">
          {item.group.options.map((option) => {
            const selected = selectedOptions.includes(option);
            return (
              <button
                className={`xingtu-filter-option${selected ? ' selected' : ''}`}
                key={option}
                onClick={() => toggleInlineOption(item.label, option)}
                type="button"
              >
                {option}
              </button>
            );
          })}
        </span>
      );
    }

    if (item.type === 'aggregate-popover') {
      const selectionValue = value.selections[item.label] || Object.fromEntries(item.controls.map((control) => [control.key, []]));
      const selectedCount = countSelections(selectionValue);
      const selected = selectedCount > 0;
      const content = (
        <div className="buyin-aggregate-filter">
          <div className="buyin-aggregate-filter__body">
            {item.controls.map((control) => {
              const selectedValue = selectionValue[control.key]?.[0] || '';
              return (
                <div className="buyin-aggregate-filter__row" key={control.key}>
                  <div className="buyin-aggregate-filter__label">{control.label}</div>
                  <div className="buyin-aggregate-filter__control">
                    {control.type === 'single' ? (
                      <Select
                        allowClear={!control.defaultValue}
                        className="buyin-aggregate-filter__select"
                        options={control.options.map((option) => ({ label: option, value: option }))}
                        onChange={(nextValue) => {
                          if (nextValue === undefined) {
                            updateAggregateSelection(item.label, control.key, []);
                            return;
                          }
                          updateAggregateSelection(item.label, control.key, nextValue === control.defaultValue ? [] : [String(nextValue)]);
                        }}
                        popupMatchSelectWidth={false}
                        placeholder={control.defaultValue}
                        size="small"
                        value={selectedValue || control.defaultValue || undefined}
                      />
                    ) : (
                      <Cascader
                        allowClear={!control.defaultValue}
                        changeOnSelect
                        className="buyin-aggregate-filter__select"
                        displayRender={(labels) => labels[labels.length - 1] || control.defaultValue || ''}
                        onChange={(nextValue) => {
                          const path = (nextValue as Array<string | number>).map(String).filter(Boolean);
                          if (!path.length || path[0] === control.defaultValue) {
                            updateAggregateSelection(item.label, control.key, []);
                            return;
                          }
                          updateAggregateSelection(item.label, control.key, [path.join('/')]);
                        }}
                        options={buildAggregateTreeData(control)}
                        placeholder={control.defaultValue}
                        popupClassName="buyin-aggregate-filter-dropdown"
                        size="small"
                        value={parseAggregateTreeValue(selectedValue)}
                      />
                    )}
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
          overlayClassName="buyin-aggregate-filter-overlay"
          placement="bottomLeft"
          trigger="click"
        >
          <button
            className={`xingtu-filter-option xingtu-filter-option-dropdown${selected ? ' selected' : ''}`}
            type="button"
          >
            <span>{selectedCount > 0 ? `${item.label}·${selectedCount}` : item.label}</span>
            <CaretDownOutlined />
          </button>
        </Popover>
      );
    }

    return (
      <RangePopoverFilter
        fields={item.fields}
        label={item.label}
        maxWidth={360}
        minWidth={320}
        onChange={(nextValue) => updateRange(item.label, nextValue)}
        unit={item.unit}
        value={value.ranges[item.label] || Object.fromEntries(item.fields.map((field) => [field, { min: '', max: '' }]))}
      />
    );
  }

  return (
    <>
      {BUYIN_CREATOR_FILTER_GROUPS.map((group, index) => (
        <Fragment key={`${group.sectionTitle}-${group.title}`}>
          {index > 0 ? <div className="xingtu-filter-panel-divider" /> : null}
          <div className="xingtu-filter-section-row">
            <div className="xingtu-filter-section-side">{group.title}</div>
            <div className="xingtu-filter-section-body">
              <div className="xingtu-filter-line xingtu-filter-line-match">
                <div className="xingtu-filter-line-content xingtu-filter-line-content-match">
                  {group.filters.map((item) => (
                    <span className="xingtu-match-option-shell" key={item.label}>
                      {renderFilter(item, group.title)}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </Fragment>
      ))}
    </>
  );
}
