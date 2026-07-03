export type CreatorPendingOpenPlatform = 'buyin' | 'douyin' | 'xingtu';

export type CreatorPendingOpenRequest = {
  creatorName?: string;
  href: string;
  profileId: string;
};

const CREATOR_PENDING_OPEN_STORAGE_KEY_MAP: Record<CreatorPendingOpenPlatform, string> = {
  buyin: 'buyin_creator_pending_open_request',
  douyin: 'douyin_creator_pending_open_request',
  xingtu: 'xingtu_creator_pending_open_request',
};

function getCreatorPendingOpenStorageKey(platform: CreatorPendingOpenPlatform) {
  return CREATOR_PENDING_OPEN_STORAGE_KEY_MAP[platform];
}

export function readCreatorPendingOpenRequest(platform: CreatorPendingOpenPlatform): CreatorPendingOpenRequest | null {
  try {
    const raw = window.localStorage.getItem(getCreatorPendingOpenStorageKey(platform));
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    const href = String(parsed.href || '').trim();
    const profileId = String(parsed.profileId || '').trim();
    const creatorName = String(parsed.creatorName || '').trim();
    if (!href || !profileId) {
      return null;
    }

    return {
      creatorName: creatorName || undefined,
      href,
      profileId,
    };
  } catch {
    return null;
  }
}

export function writeCreatorPendingOpenRequest(
  platform: CreatorPendingOpenPlatform,
  request: CreatorPendingOpenRequest,
) {
  const href = String(request.href || '').trim();
  const profileId = String(request.profileId || '').trim();
  const creatorName = String(request.creatorName || '').trim();

  if (!href || !profileId) {
    clearCreatorPendingOpenRequest(platform);
    return;
  }

  window.localStorage.setItem(getCreatorPendingOpenStorageKey(platform), JSON.stringify({
    creatorName: creatorName || undefined,
    href,
    profileId,
  }));
}

export function clearCreatorPendingOpenRequest(platform: CreatorPendingOpenPlatform) {
  window.localStorage.removeItem(getCreatorPendingOpenStorageKey(platform));
}
