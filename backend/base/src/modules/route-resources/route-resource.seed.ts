import { permissionCatalog } from '../roles/permission-catalog.js';
import type { RouteResourceInput } from './route-resource.types.js';

type SeedRouteResource = RouteResourceInput & {
  grantToDefaultRole?: boolean;
  id: string;
};

const routeResourcePermissionKeys = new Set<(typeof permissionCatalog)[number]['key']>([
  'web.module.chat',
  'web.module.content.video_remake',
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
    path: '/app/modules/claw',
  },
  'web.module.content.video_remake': {
    path: '/app/content/video_remake',
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

export const defaultRoleResourceIds = permissionCatalog
  .filter((entry) => routeResourcePermissionKeys.has(entry.key))
  .map((entry) => `rr-${entry.key}`);

export const seededRouteResources: SeedRouteResource[] = [
  {
    id: 'rr-web-root-content',
    name: '素材库',
    resourceKey: 'web.root.content',
    resourceType: 'directory',
    platform: 'web',
    path: '/app/content',
    permissionCode: 'web.directory.content',
    status: true,
    sortOrder: 20,
    isSystem: true,
  },
  {
    id: 'rr-web-root-video',
    name: '视频生成',
    resourceKey: 'web.root.video',
    resourceType: 'directory',
    platform: 'web',
    path: '/app/content',
    permissionCode: 'web.directory.video',
    status: true,
    sortOrder: 30,
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
    sortOrder: 40,
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
      if (entry.key === 'web.module.content.video_remake') {
        return 'rr-web-root-video';
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
      'web.module.content.video_remake': 10,
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
];
