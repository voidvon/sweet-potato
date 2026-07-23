import type { ContentModuleCode, ContentResourceType } from '../content/content.types.js';

export type PermissionCatalogEntry = {
  key: string;
  label: string;
  description: string;
  group: 'chat' | 'content' | 'creator_ops' | 'system';
  moduleCodes?: readonly ContentModuleCode[];
  resourceTypes?: readonly ContentResourceType[];
};

export const defaultAppRoleKey = 'default-full-access';
export const defaultOnboardingRoleKey = 'default-onboarding';

export const permissionCatalog: PermissionCatalogEntry[] = [
  {
    key: 'web.module.chat',
    label: '图片创作',
    description: '允许访问图片创作、生图会话记录和图片生成工具。',
    group: 'chat',
  },
  {
    key: 'web.module.content.video_remake',
    label: '爆款复刻',
    description: '允许访问视频复刻工作流。',
    group: 'content',
  },
  {
    key: 'web.module.content.create_video',
    label: '视频创作',
    description: '允许访问视频创作与生成记录。',
    group: 'content',
    moduleCodes: ['create_video'] as const,
    resourceTypes: ['other'] as const,
  },
  {
    key: 'web.module.content.digital_human',
    label: '数字人素材',
    description: '允许访问数字人素材模块。',
    group: 'content',
    moduleCodes: ['digital_human'] as const,
    resourceTypes: ['digital_human'] as const,
  },
  {
    key: 'web.module.content.virtual_portrait_assets',
    label: '人物素材',
    description: '允许访问人物素材模块。',
    group: 'content',
    moduleCodes: ['virtual_portrait_assets'] as const,
    resourceTypes: ['virtual_portrait'] as const,
  },
  {
    key: 'web.module.content.real_person_assets',
    label: '真人素材',
    description: '允许访问真人素材模块。',
    group: 'content',
    moduleCodes: ['real_person_assets'] as const,
    resourceTypes: ['real_person'] as const,
  },
  {
    key: 'web.module.content.ai_voice',
    label: '人声素材',
    description: '允许访问人声素材模块。',
    group: 'content',
    moduleCodes: ['ai_voice'] as const,
    resourceTypes: ['voice'] as const,
  },
  {
    key: 'web.module.content.scene_library',
    label: '场景素材',
    description: '允许访问场景素材模块。',
    group: 'content',
    moduleCodes: ['scene_library'] as const,
    resourceTypes: ['scene'] as const,
  },
  {
    key: 'web.module.content.product_assets',
    label: '产品素材',
    description: '允许访问产品素材模块。',
    group: 'content',
    moduleCodes: ['product_assets'] as const,
    resourceTypes: ['product'] as const,
  },
  {
    key: 'web.module.content.finished_assets',
    label: '作品',
    description: '允许访问作品模块。',
    group: 'content',
    moduleCodes: ['finished_assets'] as const,
    resourceTypes: ['finished_video'] as const,
  },
  {
    key: 'web.module.creator_ops.xingtu',
    label: '星图达人',
    description: '允许访问星图达人搜索草稿与执行能力。',
    group: 'creator_ops',
  },
  {
    key: 'web.module.creator_ops.buyin',
    label: '精选联盟',
    description: '允许访问精选联盟模块。',
    group: 'creator_ops',
  },
  {
    key: 'web.module.creator_ops.douyin',
    label: '抖音达人',
    description: '允许访问抖音达人搜索入口，并在 Electron 中打开抖音 PC 版搜索页。',
    group: 'creator_ops',
  },
  {
    key: 'web.module.creator_ops.wechat',
    label: '微信运营',
    description: '允许访问微信运营模块。',
    group: 'creator_ops',
  },
] as const;

export type PermissionKey = PermissionCatalogEntry['key'];

const permissionCatalogMap = new Map<PermissionKey, PermissionCatalogEntry>(
  permissionCatalog.map((entry) => [entry.key, entry]),
);

const contentModulePermissionMap = new Map<ContentModuleCode, PermissionKey>(
  permissionCatalog.flatMap((entry) => (entry.moduleCodes || []).map((moduleCode) => [moduleCode, entry.key] as const)),
);

const contentResourcePermissionMap = new Map<ContentResourceType, PermissionKey>(
  permissionCatalog.flatMap((entry) => (entry.resourceTypes || []).map((resourceType) => [resourceType, entry.key] as const)),
);

export const allPermissionKeys = permissionCatalog.map((entry) => entry.key);

export const contentPermissionKeys = allPermissionKeys.filter((permissionKey) => permissionKey.startsWith('web.module.content.'));

export function isPermissionKey(value: unknown): value is PermissionKey {
  return permissionCatalogMap.has(String(value) as PermissionKey);
}

export function getPermissionCatalogEntry(permissionKey: PermissionKey) {
  return permissionCatalogMap.get(permissionKey) || null;
}

export function normalizePermissionKeys(input: unknown): PermissionKey[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const seen = new Set<PermissionKey>();
  const normalized: PermissionKey[] = [];

  for (const item of input) {
    if (!isPermissionKey(item)) {
      continue;
    }
    if (seen.has(item)) {
      continue;
    }
    seen.add(item);
    normalized.push(item);
  }

  return normalized;
}

export function permissionForContentModule(moduleCode: ContentModuleCode) {
  return contentModulePermissionMap.get(moduleCode) || null;
}

export function permissionForContentResourceType(resourceType: ContentResourceType) {
  return contentResourcePermissionMap.get(resourceType) || null;
}

export function allowedContentResourceTypes(permissionKeys: readonly string[]) {
  const allowed = new Set<ContentResourceType>();
  permissionKeys.forEach((permissionKey) => {
    const entry = permissionCatalogMap.get(permissionKey as PermissionKey);
    entry?.resourceTypes?.forEach((resourceType) => {
      allowed.add(resourceType);
    });
  });
  return Array.from(allowed);
}
