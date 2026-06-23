import { useState } from 'react';
import { Cascader, Popover } from 'antd';
import type { DefaultOptionType } from 'antd/es/cascader';
import type { DataNode } from 'antd/es/tree';
import { CaretDownOutlined } from '@ant-design/icons';
import './TreePopoverFilter.scss';

type TreePopoverFilterProps = {
  label: string;
  values: string[];
  treeData: DataNode[];
  onChange: (values: string[]) => void;
  normalizeValues?: (values: string[]) => string[];
  getDisplayCount?: (values: string[]) => number;
  selected?: boolean;
  allSelectedValues?: string[];
  minWidth?: number;
  maxWidth?: number | string;
  maxHeight?: number;
  fixedHeight?: number;
  actionIndent?: number;
  overlayClassName?: string;
  selectionMode?: 'multiple' | 'single';
  expandTrigger?: 'click' | 'hover';
  selectAllLabel?: string;
};

function joinClassNames(...names: Array<string | false | null | undefined>) {
  return names.filter(Boolean).join(' ');
}

const SELECT_ALL_PREFIX = '__tree_popover_filter_all__::';

type CascaderOption = DefaultOptionType & {
  __selectAllPath?: string;
};

function toText(value: unknown) {
  return String(value || '');
}

function createSelectAllValue(pathKey: string) {
  return `${SELECT_ALL_PREFIX}${pathKey}`;
}

function createPathKey(path: string[]) {
  return path.join('>');
}

function convertTreeDataToCascaderOptions(
  treeData: DataNode[],
  parentPath: string[] = [],
  includeSelectAll = true,
  selectAllLabel = '全选',
): CascaderOption[] {
  const convertedNodes = treeData.map((node) => {
    const value = toText('value' in node ? node.value : node.key);
    const title = toText('title' in node ? node.title : value);
    const nextPath = [...parentPath, value];
    const children = Array.isArray(node.children) && node.children.length > 0
      ? convertTreeDataToCascaderOptions(node.children as DataNode[], nextPath, includeSelectAll, selectAllLabel)
      : undefined;

    return {
      label: title,
      value,
      children,
    } satisfies CascaderOption;
  });

  if (!includeSelectAll) {
    return convertedNodes;
  }

  const pathKey = createPathKey(parentPath);
  const selectAllOption: CascaderOption = {
    label: selectAllLabel,
    value: createSelectAllValue(pathKey),
    __selectAllPath: pathKey,
  };

  return [selectAllOption, ...convertedNodes];
}

function collectSelectAllMaps(
  treeData: DataNode[],
  descendantLeafValueMap: Map<string, string[]>,
  parentPath: string[] = [],
  pathMap: Map<string, string[]> = new Map(),
  valuesMap: Map<string, string[]> = new Map(),
) {
  const pathKey = createPathKey(parentPath);
  const selectAllValue = createSelectAllValue(pathKey);
  const selectableValues = treeData.flatMap((node) => {
    const nodeValue = toText('value' in node ? node.value : node.key);
    const descendantLeafValues = descendantLeafValueMap.get(nodeValue) || [];

    if (descendantLeafValues.length > 0) {
      return descendantLeafValues;
    }

    return nodeValue ? [nodeValue] : [];
  });

  pathMap.set(selectAllValue, [...parentPath, selectAllValue]);
  valuesMap.set(selectAllValue, selectableValues);

  treeData.forEach((node) => {
    const value = toText('value' in node ? node.value : node.key);
    const nextPath = [...parentPath, value];

    if (Array.isArray(node.children) && node.children.length > 0) {
      collectSelectAllMaps(
        node.children as DataNode[],
        descendantLeafValueMap,
        nextPath,
        pathMap,
        valuesMap,
      );
    }
  });

  return { pathMap, valuesMap };
}

function collectValuePathMap(
  treeData: DataNode[],
  parentPath: string[] = [],
  result: Map<string, string[]> = new Map(),
) {
  treeData.forEach((node) => {
    const value = toText('value' in node ? node.value : node.key);
    const nextPath = [...parentPath, value];
    result.set(value, nextPath);

    if (Array.isArray(node.children) && node.children.length > 0) {
      collectValuePathMap(node.children as DataNode[], nextPath, result);
    }
  });

  return result;
}

function collectTerminalValues(treeData: DataNode[]) {
  const values: string[] = [];

  treeData.forEach((node) => {
    const value = toText('value' in node ? node.value : node.key);

    if (Array.isArray(node.children) && node.children.length > 0) {
      values.push(...collectTerminalValues(node.children as DataNode[]));
      return;
    }

    if (value) {
      values.push(value);
    }
  });

  return values;
}

function collectDescendantLeafValueMap(
  treeData: DataNode[],
  result: Map<string, string[]> = new Map(),
) {
  treeData.forEach((node) => {
    const value = toText('value' in node ? node.value : node.key);

    if (Array.isArray(node.children) && node.children.length > 0) {
      result.set(value, collectTerminalValues(node.children as DataNode[]));
      collectDescendantLeafValueMap(node.children as DataNode[], result);
      return;
    }

    result.set(value, []);
  });

  return result;
}

function normalizeCascaderValues(value: Array<Array<string | number>>) {
  return value
    .map((path) => path[path.length - 1])
    .filter((item): item is string | number => item !== undefined && item !== null)
    .map(String);
}

export function TreePopoverFilter({
  label,
  values,
  treeData,
  onChange,
  normalizeValues,
  getDisplayCount,
  selected,
  allSelectedValues: _allSelectedValues,
  minWidth = 120,
  maxWidth = 'min(420px, 100vw)',
  maxHeight = 360,
  fixedHeight,
  actionIndent: _actionIndent = 54,
  overlayClassName,
  selectionMode = 'multiple',
  expandTrigger = 'click',
  selectAllLabel = '全选',
}: TreePopoverFilterProps) {
  const [open, setOpen] = useState(false);
  const isMultiple = selectionMode === 'multiple';
  const normalize = (nextValues: string[]) => (normalizeValues ? normalizeValues(nextValues) : nextValues);
  const cascaderOptions = convertTreeDataToCascaderOptions(treeData, [], isMultiple, selectAllLabel);
  const valuePathMap = collectValuePathMap(treeData);
  const descendantLeafValueMap = collectDescendantLeafValueMap(treeData);
  const { pathMap: selectAllPathMap, valuesMap: selectAllValuesMap } = collectSelectAllMaps(
    treeData,
    descendantLeafValueMap,
  );
  const displayCount = getDisplayCount ? getDisplayCount(values) : values.length;
  const isSelected = selected ?? values.length > 0;
  const normalizedValues = normalize(values);
  const triggerLabel = !isMultiple
    ? label
    : displayCount > 0
      ? `${label}·${displayCount}`
      : label;
  const effectiveSelectedSet = new Set(normalizedValues);
  const cascaderValueMap = new Map<string, string[]>();

  normalizedValues.forEach((value) => {
    const leafValues = descendantLeafValueMap.get(value);

    if (leafValues?.length) {
      leafValues.forEach((leafValue) => {
        effectiveSelectedSet.add(leafValue);
        const path = valuePathMap.get(leafValue);
        if (path?.length) {
          cascaderValueMap.set(path.join('>'), path);
        }
      });
      return;
    }

    const path = valuePathMap.get(value);
    if (path?.length) {
      cascaderValueMap.set(path.join('>'), path);
    }
  });

  if (isMultiple) {
    selectAllValuesMap.forEach((selectValues, selectAllValue) => {
      if (selectValues.length > 0 && selectValues.every((value) => effectiveSelectedSet.has(value))) {
        const path = selectAllPathMap.get(selectAllValue);
        if (path) {
          cascaderValueMap.set(path.join('>'), path);
        }
      }
    });
  }

  const cascaderValues = Array.from(cascaderValueMap.values());
  const singleCascaderValue = normalizedValues[0] ? valuePathMap.get(normalizedValues[0]) || [] : [];
  const panel = isMultiple ? (
    <Cascader.Panel
      changeOnSelect
      expandTrigger={expandTrigger}
      multiple
      onChange={(nextValue) => {
        const nextPathValues = normalizeCascaderValues(nextValue as Array<Array<string | number>>);
        const nextSet = new Set(nextPathValues.filter((value) => !value.startsWith(SELECT_ALL_PREFIX)));
        const prevSelectAllSet = new Set(
          cascaderValues
            .map((path) => path[path.length - 1])
            .filter((value): value is string => typeof value === 'string' && value.startsWith(SELECT_ALL_PREFIX)),
        );
        const nextSelectAllSet = new Set(nextPathValues.filter((value) => value.startsWith(SELECT_ALL_PREFIX)));

        selectAllValuesMap.forEach((selectValues, selectAllValue) => {
          const hadSelectAll = prevSelectAllSet.has(selectAllValue);
          const hasSelectAll = nextSelectAllSet.has(selectAllValue);

          if (hasSelectAll && !hadSelectAll) {
            selectValues.forEach((value) => nextSet.add(value));
          }

          if (!hasSelectAll && hadSelectAll) {
            selectValues.forEach((value) => nextSet.delete(value));
          }
        });

        onChange(normalize(Array.from(nextSet)));
      }}
      options={cascaderOptions}
      optionRender={(option) => (
        option.__selectAllPath
          ? <span className="tree-popover-filter__select-all-option">{selectAllLabel}</span>
          : option.label
      )}
      showCheckedStrategy={Cascader.SHOW_CHILD}
      value={cascaderValues}
    />
  ) : (
    <Cascader.Panel
      changeOnSelect
      expandTrigger={expandTrigger}
      onChange={(nextValue) => {
        const nextPath = nextValue as Array<string | number>;
        const selectedValue = nextPath.length ? String(nextPath[nextPath.length - 1]) : '';
        onChange(normalize(selectedValue ? [selectedValue] : []));
        setOpen(false);
      }}
      options={cascaderOptions}
      optionRender={(option) => option.label}
      value={singleCascaderValue}
    />
  );

  const content = (
    <div
      className="tree-popover-filter"
      style={{
        ['--tree-popover-filter-height' as string]: fixedHeight ? `${fixedHeight}px` : 'auto',
        ['--tree-popover-filter-min-width' as string]: `${minWidth}px`,
        ['--tree-popover-filter-max-width' as string]: typeof maxWidth === 'number' ? `${maxWidth}px` : maxWidth,
        ['--tree-popover-filter-max-height' as string]: `${maxHeight}px`,
      }}
    >
      <div className="tree-popover-filter__body">
        {panel}
      </div>
    </div>
  );

  return (
    <Popover
      arrow={false}
      content={content}
      onOpenChange={setOpen}
      open={open}
      overlayClassName={joinClassNames('tree-popover-filter-overlay', overlayClassName)}
      placement="bottomLeft"
      trigger="click"
    >
      <button
        className={`xingtu-filter-option xingtu-filter-option-dropdown${isSelected ? ' selected' : ''}`}
        type="button"
      >
        <span>{triggerLabel}</span>
        <CaretDownOutlined />
      </button>
    </Popover>
  );
}
