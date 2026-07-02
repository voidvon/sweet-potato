import type { CreatorSearchResult } from './CreatorResultsTable';

export const DOUYIN_FAVORITE_CREATORS_STORAGE_KEY = 'douyin_creator_favorite_keys';
export const DOUYIN_FAVORITE_CREATORS_RECORDS_STORAGE_KEY = 'douyin_creator_favorite_records';

export type FavoriteSourcePlatform = 'douyin' | 'xingtu' | 'buyin';

export type FavoriteCreatorSourceInfo = {
  profileId: string;
  profileName?: string;
  sourcePlatform: FavoriteSourcePlatform;
};

export type DouyinFavoriteCreatorRecord = CreatorSearchResult & FavoriteCreatorSourceInfo & {
  favoriteKey: string;
  favoritedAt: string;
};

export function formatDouyinFavoriteId(value: string | undefined) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return '';
  }

  const match = normalized.match(/抖音号[：:]\s*(\S+)/);
  return match ? match[1] : normalized;
}

export function getFavoriteSourceLabel(sourcePlatform: FavoriteSourcePlatform) {
  switch (sourcePlatform) {
    case 'douyin':
      return '抖音达人';
    case 'xingtu':
      return '星图达人';
    case 'buyin':
      return '精选联盟';
    default:
      return sourcePlatform;
  }
}

export function getDouyinFavoriteKey(record: Pick<CreatorSearchResult, 'href' | 'douyinId' | 'name'>) {
  const href = String(record.href || '').trim();
  const douyinId = String(record.douyinId || '').trim();
  const name = String(record.name || '').trim();

  if (href) {
    return `href:${href}`;
  }
  if (douyinId) {
    return `douyin:${douyinId}`;
  }
  return `name:${name}`;
}

export function readFavoriteCreatorKeys(storageKey = DOUYIN_FAVORITE_CREATORS_STORAGE_KEY) {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  } catch {
    return [];
  }
}

export function writeFavoriteCreatorKeys(keys: string[], storageKey = DOUYIN_FAVORITE_CREATORS_STORAGE_KEY) {
  const normalizedKeys = Array.from(new Set(keys.filter((item) => typeof item === 'string' && item.trim())));
  window.localStorage.setItem(storageKey, JSON.stringify(normalizedKeys));
}

export function readFavoriteCreatorRecords(storageKey = DOUYIN_FAVORITE_CREATORS_RECORDS_STORAGE_KEY) {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((item): item is DouyinFavoriteCreatorRecord => {
      return Boolean(
        item
        && typeof item === 'object'
        && typeof item.favoriteKey === 'string'
        && typeof item.name === 'string'
        && typeof item.profileId === 'string'
        && typeof item.sourcePlatform === 'string',
      );
    });
  } catch {
    return [];
  }
}

export function writeFavoriteCreatorRecords(
  records: DouyinFavoriteCreatorRecord[],
  storageKey = DOUYIN_FAVORITE_CREATORS_RECORDS_STORAGE_KEY,
) {
  const deduped = new Map<string, DouyinFavoriteCreatorRecord>();
  for (const record of records) {
    if (!record?.favoriteKey) {
      continue;
    }
    deduped.set(record.favoriteKey, record);
  }
  window.localStorage.setItem(storageKey, JSON.stringify(Array.from(deduped.values())));
}

export function upsertFavoriteCreatorRecord(
  currentRecords: DouyinFavoriteCreatorRecord[],
  record: CreatorSearchResult,
  sourceInfo: FavoriteCreatorSourceInfo,
  favoritedAt = new Date().toISOString(),
) {
  const favoriteKey = getDouyinFavoriteKey(record);
  const previousRecord = currentRecords.find((item) => item.favoriteKey === favoriteKey);
  const nextRecord: DouyinFavoriteCreatorRecord = {
    ...previousRecord,
    ...record,
    href: String(record.href || '').trim() || previousRecord?.href || '',
    favoriteKey,
    favoritedAt,
    profileId: sourceInfo.profileId,
    profileName: sourceInfo.profileName || record.profileName || previousRecord?.profileName || '',
    sourcePlatform: sourceInfo.sourcePlatform,
  };
  const nextRecords = currentRecords.filter((item) => item.favoriteKey !== favoriteKey);
  return [nextRecord, ...nextRecords];
}
