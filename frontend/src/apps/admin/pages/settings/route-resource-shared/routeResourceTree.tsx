import { Space, Tag } from 'antd';
import type { TreeDataNode } from 'antd';
import type { ManagedRouteResource, RouteResourcePlatform, RouteResourceType } from '../../../types';
import { flattenRouteResources } from './routeResourceNormalize';
import { t } from '@shared/i18n';

export function resourceTypeMeta(type: RouteResourceType) {
  switch (type) {
    case 'directory':
      return { color: 'blue', text: t("目录") };
    case 'menu':
      return { color: 'geekblue', text: t("菜单") };
    default:
      return { color: 'default', text: type };
  }
}

export function buildRouteResourceTreeNodes(resources: ManagedRouteResource[]): TreeDataNode[] {
  return resources
    .filter((resource) => resource.status !== false)
    .map((resource) => ({
      key: resource.resourceKey,
      title: (
        <Space direction="vertical" size={2}>
          <Space size={6} wrap>
            <span>{resource.name}</span>
            <Tag color={resource.platform === 'admin' ? 'gold' : 'cyan'}>{resource.platform.toUpperCase()}</Tag>
            <Tag>{resourceTypeMeta(resource.resourceType).text}</Tag>
          </Space>
          <span style={{ color: 'var(--text-secondary, #6b7280)', fontSize: 12 }}>
            {resource.permissionCode || resource.resourceKey}
          </span>
        </Space>
      ),
      children: buildRouteResourceTreeNodes(resource.children || []),
    }));
}

export function collectSelectableResourceIds(resources: ManagedRouteResource[]) {
  return flattenRouteResources(resources)
    .filter((resource) => resource.status !== false)
    .map((resource) => resource.resourceKey);
}

export function filterResourcesByPlatform(resources: ManagedRouteResource[], platform: RouteResourcePlatform) {
  return resources.filter((resource) => resource.platform === platform);
}
