import type {
  RouteResourcePlatform,
  RouteResourceType,
  RouteResourceVisibilityMode,
} from '../../../types';

export const resourceTypeOptions: Array<{ label: string; value: RouteResourceType }> = [
  { label: '目录', value: 'directory' },
  { label: '菜单', value: 'menu' },
];

export const platformOptions: Array<{ label: string; value: RouteResourcePlatform }> = [
  { label: 'Web', value: 'web' },
  { label: 'Admin', value: 'admin' },
];

export const visibilityModeOptions: Array<{ label: string; value: RouteResourceVisibilityMode }> = [
  { label: '有权限时显示', value: 'permission' },
  { label: '始终显示', value: 'always' },
];

export const platformTabs = platformOptions.map((item) => ({ key: item.value, label: item.label }));
