import { Button, Form, Space, Tabs, Tree } from 'antd';
import type { FormInstance } from 'antd';
import { useEffect, useMemo } from 'react';
import type { ManagedRouteResource, RouteResourcePlatform } from '../../../types';
import { flattenRouteResources } from '../route-resource-shared/routeResourceNormalize';
import {
  buildRouteResourceTreeNodes,
  collectSelectableResourceIds,
  filterResourcesByPlatform,
} from '../route-resource-shared/routeResourceTree';
import { normalizeResourceIds, type RoleFormValues } from './roleManagementHelpers';
import { t } from '@shared/i18n';

const resourcePlatformTabs: Array<{ key: RouteResourcePlatform; label: string }> = [
  { key: 'web', label: t("Web 权限") },
  { key: 'admin', label: t("Admin 权限") },
];

type RolePermissionTabsProps = {
  activePlatform: RouteResourcePlatform;
  form: FormInstance<RoleFormValues>;
  resources: ManagedRouteResource[];
  onPlatformChange: (platform: RouteResourcePlatform) => void;
};

export function RolePermissionTabs({ activePlatform, form, resources, onPlatformChange }: RolePermissionTabsProps) {
  const watchedResourceIds = normalizeResourceIds(Form.useWatch('grantedResourceIds', form));
  const resourceById = useMemo(
    () => new Map(flattenRouteResources(resources).map((resource) => [resource.resourceKey, resource] as const)),
    [resources],
  );
  const treesByPlatform = useMemo(
    () => Object.fromEntries(
      resourcePlatformTabs.map(({ key }) => [key, filterResourcesByPlatform(resources, key)]),
    ) as Record<RouteResourcePlatform, ManagedRouteResource[]>,
    [resources],
  );
  const selectableIdsByPlatform = useMemo(
    () => Object.fromEntries(
      resourcePlatformTabs.map(({ key }) => [key, collectSelectableResourceIds(treesByPlatform[key])]),
    ) as Record<RouteResourcePlatform, string[]>,
    [treesByPlatform],
  );
  const visibleTabs = useMemo(
    () => resourcePlatformTabs.filter(({ key }) => treesByPlatform[key].length > 0),
    [treesByPlatform],
  );

  useEffect(() => {
    if (visibleTabs.length > 0 && !visibleTabs.some((item) => item.key === activePlatform)) {
      onPlatformChange(visibleTabs[0].key);
    }
  }, [activePlatform, onPlatformChange, visibleTabs]);

  return (
    <Tabs
      activeKey={activePlatform}
      onChange={(key) => onPlatformChange(key as RouteResourcePlatform)}
      items={visibleTabs.map(({ key, label }) => ({
        key,
        label,
        children: (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Space wrap>
              <Button
                size="small"
                type="link"
                onClick={() => {
                  const current = new Set(normalizeResourceIds(form.getFieldValue('grantedResourceIds')));
                  selectableIdsByPlatform[key].forEach((resourceId) => current.add(resourceId));
                  form.setFieldValue('grantedResourceIds', Array.from(current));
                }}
              >
                {t("全选当前页签")}
              </Button>
              <Button
                size="small"
                type="link"
                onClick={() => {
                  const removeIds = new Set(selectableIdsByPlatform[key]);
                  form.setFieldValue(
                    'grantedResourceIds',
                    normalizeResourceIds(form.getFieldValue('grantedResourceIds'))
                      .filter((resourceId) => !removeIds.has(resourceId)),
                  );
                }}
              >
                {t("清空当前页签")}
              </Button>
            </Space>
            <div style={{ maxHeight: 420, overflow: 'auto', paddingRight: 8 }}>
              <Tree
                checkable
                defaultExpandAll
                treeData={buildRouteResourceTreeNodes(treesByPlatform[key])}
                checkedKeys={watchedResourceIds.filter((resourceId) => resourceById.get(resourceId)?.platform === key)}
                onCheck={(checkedKeys) => {
                  const platformResourceIds = new Set(selectableIdsByPlatform[key]);
                  const checkedPlatformKeys = new Set(
                    (Array.isArray(checkedKeys) ? checkedKeys : checkedKeys.checked)
                      .filter((item): item is string => typeof item === 'string'),
                  );
                  const currentOtherKeys = normalizeResourceIds(form.getFieldValue('grantedResourceIds'))
                    .filter((resourceId) => !platformResourceIds.has(resourceId));
                  form.setFieldValue('grantedResourceIds', [...currentOtherKeys, ...Array.from(checkedPlatformKeys)]);
                }}
              />
            </div>
          </Space>
        ),
      }))}
    />
  );
}
