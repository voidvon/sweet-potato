import { Fragment } from 'react';
import { Dropdown, Popover } from 'antd';
import { CaretDownOutlined } from '@ant-design/icons';
import { TreePopoverFilter } from '../../../components/TreePopoverFilter';
import {
  COOPERATION_SECTION_LINES,
  getShortDramaDisplayCount,
  normalizeShortDramaSelections,
  type CollaborationObjectOption,
  type CreatorFilterControlSchema,
  type CreatorTypeOption,
  type GoalOption,
} from '../xingtuCreatorFilterData';
import type { XingtuCreatorFilterActions, XingtuCreatorFilterValues } from './filterTypes';
import { buildMenu } from './filterUtils';

function renderFilterOption(label: string, selected: boolean, onClick: () => void) {
  return (
    <button
      className={`xingtu-filter-option${selected ? ' selected' : ''}`}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}

function renderDropdownTrigger(label: string, selected: boolean, count = 0) {
  return (
    <button
      className={`xingtu-filter-option xingtu-filter-option-dropdown${selected ? ' selected' : ''}`}
      type="button"
    >
      <span>{label}</span>
      {count > 0 ? <span className="xingtu-filter-option-count">{count}</span> : null}
      <CaretDownOutlined />
    </button>
  );
}

type XingtuCooperationSectionProps = {
  values: XingtuCreatorFilterValues;
  actions: XingtuCreatorFilterActions;
};

export function XingtuCooperationSection({ values, actions }: XingtuCooperationSectionProps) {
  function renderCooperationControl(control: CreatorFilterControlSchema) {
    switch (control.kind) {
      case 'option': {
        if (control.intent === 'collaborationObject') {
          const value = control.value as CollaborationObjectOption;
          return renderFilterOption(control.label, values.collaborationObject === value, () => {
            if (values.collaborationObject !== value) {
              actions.onCollaborationObjectChange(value);
            }
          });
        }

        if (control.intent === 'creatorType') {
          const value = control.value as CreatorTypeOption;
          return renderFilterOption(control.label, values.creatorTypes.includes(value), () => {
            actions.onCreatorTypeSelect(value);
          });
        }

        if (control.intent === 'goal') {
          const value = control.value as GoalOption;
          return renderFilterOption(control.label, values.goals.includes(value), () => {
            actions.onGoalSelect(value);
          });
        }

        return renderFilterOption(control.label, values.audienceMode === '不限', () => {
          if (values.audienceMode === '不限' && values.audienceTreeKeys.length === 0) {
            return;
          }
          actions.onAudienceModeReset();
        });
      }

      case 'tree':
        if (control.groupValue === '短剧演员') {
          return (
            <TreePopoverFilter
              key={control.groupValue}
              actionIndent={control.actionIndent}
              allSelectedValues={control.allSelectedValues}
              getDisplayCount={getShortDramaDisplayCount}
              label={control.label}
              maxHeight={control.maxHeight}
              maxWidth={control.maxWidth}
              minWidth={control.minWidth}
              normalizeValues={control.normalizeMode === 'shortDrama' ? normalizeShortDramaSelections : undefined}
              onChange={actions.onShortDramaSelectionsChange}
              selected={values.creatorTypes.includes(control.groupValue) || values.shortDramaSelections.length > 0}
              treeData={control.treeData}
              values={values.shortDramaSelections}
            />
          );
        }

        return (
          <TreePopoverFilter
            key={control.groupValue}
            label={control.label}
            maxHeight={control.maxHeight}
            maxWidth={control.maxWidth}
            minWidth={control.minWidth}
            onChange={actions.onShortLiveSelectionsChange}
            selected={values.creatorTypes.includes(control.groupValue) || values.shortLiveSelections.length > 0}
            treeData={control.treeData}
            values={values.shortLiveSelections}
          />
        );

      case 'dropdown':
        if (control.intent === 'extraCreatorType') {
          const selected = values.creatorTypes.includes('其它题材') || values.extraCreatorTypes.length > 0;
          return (
            <Dropdown classNames={{ root: 'xingtu-filter-dropdown-overlay' }} menu={buildMenu(control.options, values.extraCreatorTypes, actions.onExtraCreatorTypeSelect)} placement="bottomLeft" trigger={['click']}>
              {renderDropdownTrigger(values.extraCreatorTypes[0] || control.defaultLabel, selected)}
            </Dropdown>
          );
        }

        if (control.intent === 'grassSelection') {
          const selected = values.goals.includes('破圈种草') || values.grassSelections.length > 0;
          return (
            <Dropdown classNames={{ root: 'xingtu-filter-dropdown-overlay' }} menu={buildMenu(control.options, values.grassSelections, actions.onGrassSelectionSelect)} placement="bottomLeft" trigger={['click']}>
              {renderDropdownTrigger(values.grassSelections[0] || control.defaultLabel, selected)}
            </Dropdown>
          );
        }

        return (
          <Dropdown classNames={{ root: 'xingtu-filter-dropdown-overlay' }} menu={buildMenu(control.options, values.audienceTreeKeys, actions.onAudienceOptionSelect)} placement="bottomLeft" trigger={['click']}>
            {renderDropdownTrigger(values.audienceTreeKeys[0] || control.defaultLabel, values.audienceMode === '八大人群' || values.audienceTreeKeys.length > 0)}
          </Dropdown>
        );

      case 'popover': {
        const content = (
          <div className="xingtu-filter-popover">
            <div className="xingtu-filter-popover-grid">
              {control.options.map((option) => (
                <Fragment key={option}>
                  {renderFilterOption(option, values.industry === option, () => actions.onIndustryChange(option))}
                </Fragment>
              ))}
            </div>
          </div>
        );

        return (
          <Popover arrow={false} content={content} placement="bottomLeft" trigger="click">
            <button className={`xingtu-filter-option${values.industry !== '不限' ? ' selected' : ''}`} type="button">
              {values.industry}
              <CaretDownOutlined />
            </button>
          </Popover>
        );
      }

      case 'subgroup':
        return (
          <>
            <div className="xingtu-filter-subgroup-label">{control.label}</div>
            {control.controls.map((childControl) => (
              <Fragment key={childControl.key}>
                {renderCooperationControl(childControl)}
              </Fragment>
            ))}
          </>
        );

      default:
        return null;
    }
  }

  return (
    <div className="xingtu-filter-section-row">
      <div className="xingtu-filter-section-side">合作诉求</div>
      <div className="xingtu-filter-section-body">
        {COOPERATION_SECTION_LINES.map((line) => (
          <div className="xingtu-filter-line xingtu-filter-line-match" key={line.key}>
            {line.fields.map((field) => (
              <Fragment key={field.key}>
                <div className="xingtu-filter-line-label">{field.label}</div>
                <div className={`xingtu-filter-line-content xingtu-filter-line-content-match${field.contentClassName ? ` ${field.contentClassName}` : ''}`}>
                  {field.controls.map((control) => (
                    <Fragment key={control.key}>
                      {renderCooperationControl(control)}
                    </Fragment>
                  ))}
                </div>
              </Fragment>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
