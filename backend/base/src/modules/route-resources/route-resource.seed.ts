import { permissionCatalog } from '../roles/permission-catalog.js';
import type { RouteResourceInput } from './route-resource.types.js';

type SeedRouteResource = RouteResourceInput & {
  grantToDefaultRole?: boolean;
  id: string;
};

const routeResourcePermissionKeys = new Set<(typeof permissionCatalog)[number]['key']>([
  'web.module.chat',
  'web.module.content.video_remake',
  'web.module.content.create_video',
  'web.module.content.virtual_portrait_assets',
  'web.module.content.ai_voice',
  'web.module.content.scene_library',
  'web.module.content.product_assets',
  'web.module.content.finished_assets',
  'web.module.creator_ops.xingtu',
  'web.module.creator_ops.buyin',
  'web.module.creator_ops.douyin',
  'web.module.creator_ops.wechat',
]);

const webRouteMetaByPermission = {
  'web.module.chat': {
    path: '/app/image',
  },
  'web.module.content.video_remake': {
    path: '/app/content/video_remake',
  },
  'web.module.content.create_video': {
    path: '/app/content/create_video',
  },
  'web.module.content.virtual_portrait_assets': {
    path: '/app/content/virtual_portrait_assets',
  },
  'web.module.content.ai_voice': {
    path: '/app/content/ai_voice',
  },
  'web.module.content.scene_library': {
    path: '/app/content/scene_library',
  },
  'web.module.content.product_assets': {
    path: '/app/content/product_assets',
  },
  'web.module.content.finished_assets': {
    path: '/app/content/finished_assets',
  },
  'web.module.creator_ops.xingtu': {
    path: '/app/creator-ops/xingtu',
  },
  'web.module.creator_ops.buyin': {
    path: '/app/creator-ops/buyin',
  },
  'web.module.creator_ops.douyin': {
    path: '/app/creator-ops/douyin',
  },
  'web.module.creator_ops.wechat': {
    path: '/app/creator-ops/wechat',
  },
} as const satisfies Partial<Record<(typeof permissionCatalog)[number]['key'], {
  path: string;
}>>;

export const defaultRoleResourceIds = [
  'rr-web-discover',
  ...permissionCatalog
    .filter((entry) => routeResourcePermissionKeys.has(entry.key))
    .map((entry) => `rr-${entry.key}`),
];

export const seededRouteResources: SeedRouteResource[] = [
  {
    id: 'rr-web-discover',
    name: '发现',
    resourceKey: 'web.discover',
    resourceType: 'menu',
    platform: 'web',
    path: '/app/discover',
    permissionCode: 'web.route.discover.view',
    visibilityMode: 'always',
    status: true,
    sortOrder: 0,
    isSystem: true,
    grantToDefaultRole: true,
  },
  {
    id: 'rr-web-root-content',
    name: '素材',
    resourceKey: 'web.root.content',
    resourceType: 'directory',
    platform: 'web',
    path: '/app/content',
    permissionCode: 'web.directory.content',
    status: true,
    sortOrder: 40,
    isSystem: true,
  },
  {
    id: 'rr-web-root-creator-ops',
    name: '达人运营',
    resourceKey: 'web.root.creator_ops',
    resourceType: 'directory',
    platform: 'web',
    path: '/app/creator-ops',
    permissionCode: 'web.directory.creator_ops',
    status: true,
    sortOrder: 60,
    isSystem: true,
  },
  ...permissionCatalog.filter((entry) => routeResourcePermissionKeys.has(entry.key)).map((entry, index) => {
    const routeMeta = webRouteMetaByPermission[entry.key as keyof typeof webRouteMetaByPermission];
    const parentId = (() => {
      if (entry.group === 'chat') {
        return undefined;
      }
      if (entry.group === 'creator_ops') {
        return 'rr-web-root-creator-ops';
      }
      if (entry.group === 'system') {
        return undefined;
      }
      if (
        entry.key === 'web.module.content.finished_assets'
        || entry.key === 'web.module.content.video_remake'
        || entry.key === 'web.module.content.create_video'
      ) {
        return undefined;
      }
      return 'rr-web-root-content';
    })();
    const sortOrderByKey: Partial<Record<(typeof permissionCatalog)[number]['key'], number>> = {
      'web.module.chat': 10,
      'web.module.content.virtual_portrait_assets': 10,
      'web.module.content.ai_voice': 20,
      'web.module.content.scene_library': 30,
      'web.module.content.product_assets': 40,
      'web.module.content.finished_assets': 50,
      'web.module.content.video_remake': 30,
      'web.module.content.create_video': 20,
      'web.module.creator_ops.xingtu': 10,
      'web.module.creator_ops.buyin': 20,
      'web.module.creator_ops.douyin': 30,
      'web.module.creator_ops.wechat': 40,
    };
    return {
      id: `rr-${entry.key}`,
      parentId,
      name: entry.label,
      resourceKey: entry.key,
      resourceType: 'menu',
      platform: 'web',
      path: routeMeta?.path || '',
      permissionCode: entry.key,
      status: true,
      sortOrder: sortOrderByKey[entry.key] ?? 100 + index,
      isSystem: true,
      grantToDefaultRole: true,
    } satisfies SeedRouteResource;
  }),
  {
    id: 'rr-admin-root-users',
    name: '用户管理',
    resourceKey: 'admin.root.users',
    resourceType: 'directory',
    platform: 'admin',
    path: '/users',
    permissionCode: 'admin.directory.users',
    status: true,
    sortOrder: 10,
    isSystem: true,
  },
  {
    id: 'rr-admin-users-accounts',
    parentId: 'rr-admin-root-users',
    name: '账号管理',
    resourceKey: 'admin.users.accounts',
    resourceType: 'menu',
    platform: 'admin',
    path: '/users/accounts',
    permissionCode: 'admin.route.users.accounts.view',
    status: true,
    sortOrder: 20,
    isSystem: true,
  },
  {
    id: 'rr-admin-users-roles',
    parentId: 'rr-admin-root-users',
    name: '角色管理',
    resourceKey: 'admin.users.roles',
    resourceType: 'menu',
    platform: 'admin',
    path: '/users/roles',
    permissionCode: 'admin.route.users.roles.view',
    status: true,
    sortOrder: 30,
    isSystem: true,
  },
  {
    id: 'rr-admin-all-works',
    name: '全部作品',
    resourceKey: 'admin.all_works',
    resourceType: 'menu',
    platform: 'admin',
    path: '/works',
    permissionCode: 'admin.route.all_works.view',
    status: true,
    sortOrder: 35,
    isSystem: true,
  },
  {
    id: 'rr-admin-discover',
    name: '发现',
    resourceKey: 'admin.discover',
    resourceType: 'menu',
    platform: 'admin',
    path: '/discover',
    permissionCode: 'admin.route.discover.view',
    status: true,
    sortOrder: 37,
    isSystem: true,
  },
  {
    id: 'rr-admin-system-billing',
    name: '积分设置',
    resourceKey: 'admin.system.billing',
    resourceType: 'menu',
    platform: 'admin',
    path: '/billing',
    permissionCode: 'admin.route.system.billing.view',
    status: true,
    sortOrder: 40,
    isSystem: true,
  },
  {
    id: 'rr-admin-system-models',
    name: '模型配置',
    resourceKey: 'admin.system.models',
    resourceType: 'menu',
    platform: 'admin',
    path: '/models',
    permissionCode: 'admin.route.system.models.view',
    status: true,
    sortOrder: 50,
    isSystem: true,
  },
  {
    id: 'rr-admin-system-route-resources',
    name: '路由管理',
    resourceKey: 'admin.system.route_resources',
    resourceType: 'menu',
    platform: 'admin',
    path: '/system/routes',
    permissionCode: 'admin.route.system.route_resources.view',
    status: true,
    sortOrder: 60,
    isSystem: true,
  },
  {
    id: 'rr-admin-system-file-management',
    name: '文件管理',
    resourceKey: 'admin.system.file_management',
    resourceType: 'menu',
    platform: 'admin',
    path: '/system/files',
    permissionCode: 'admin.route.system.file_management.view',
    status: true,
    sortOrder: 70,
    isSystem: true,
  },
  {
    id: 'rr-admin-system-temporary-assets',
    name: '临时素材清理',
    resourceKey: 'admin.system.temporary_assets',
    resourceType: 'menu',
    platform: 'admin',
    path: '/system/temporary-assets',
    permissionCode: 'admin.route.system.temporary_assets.view',
    status: true,
    sortOrder: 80,
    isSystem: true,
  },
  {
    id: 'rr-admin-system-settings',
    name: '系统设置',
    resourceKey: 'admin.system.settings',
    resourceType: 'menu',
    platform: 'admin',
    path: '/system/settings',
    permissionCode: 'admin.route.system.settings.view',
    status: true,
    sortOrder: 90,
    isSystem: true,
  },
  {
    id: 'rr-admin-system-access-logs',
    name: '站点访问日志',
    resourceKey: 'admin.system.access_logs',
    resourceType: 'menu',
    platform: 'admin',
    path: '/system/access-logs',
    permissionCode: 'admin.route.system.access_logs.view',
    status: true,
    sortOrder: 100,
    isSystem: true,
  },
];
