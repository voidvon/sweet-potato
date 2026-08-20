import type {
  RouteResourcePlatform,
  RouteResourceType,
  RouteResourceVisibilityMode,
} from '../../../types';
import { t } from '@shared/i18n';

export const resourceTypeOptions: Array<{ label: string; value: RouteResourceType }> = [
  { label: t("目录"), value: 'directory' },
  { label: t("菜单"), value: 'menu' },
];

export const platformOptions: Array<{ label: string; value: RouteResourcePlatform }> = [
  { label: 'Web', value: 'web' },
  { label: 'Admin', value: 'admin' },
];

export const visibilityModeOptions: Array<{ label: string; value: RouteResourceVisibilityMode }> = [
  { label: t("有权限时显示"), value: 'permission' },
  { label: t("始终显示"), value: 'always' },
];

export const platformTabs = platformOptions.map((item) => ({ key: item.value, label: item.label }));
