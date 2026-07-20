import { MOBILE_USER_AGENT, safeFetch } from '../video-source.http.js';
import { VideoSourceError, type ResolvedVideoSource, type VideoSourceProvider } from '../video-source.types.js';

const kuaishouHostSuffixes = ['kuaishou.com', 'chenzhongtech.com', 'gifshow.com'] as const;
const initStateMarker = 'window.INIT_STATE = ';

export class KuaishouVideoSourceProvider implements VideoSourceProvider {
  readonly platform = 'kuaishou' as const;

  supports(url: URL) {
    const hostname = url.hostname.toLowerCase();
    return kuaishouHostSuffixes.some((suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`));
  }

  async resolve(url: URL): Promise<ResolvedVideoSource> {
    // Kuaishou omits video metadata when Accept is restricted to HTML types.
    const shareResponse = await safeFetch(url, {
      headers: {
        'user-agent': MOBILE_USER_AGENT,
      },
    }, { allowedHostSuffixes: kuaishouHostSuffixes });
    if (!shareResponse.ok) {
      throw new VideoSourceError(`快手视频信息获取失败（${shareResponse.status}）`, 502);
    }

    const resolvedShareUrl = shareResponse.url || url.toString();
    const shareHtml = await shareResponse.text();
    const photo = extractKuaishouPhoto(shareHtml);
    if (!photo) {
      throw new VideoSourceError('快手未返回可用的视频信息，链接可能已失效或不可见', 422);
    }

    const downloadUrl = firstUrl(photo, 'mainMvUrls');
    if (!downloadUrl) {
      throw new VideoSourceError('快手视频信息中缺少播放地址', 502);
    }

    const externalId = stringOrNumberValue(photo, 'photoId')
      || new URL(resolvedShareUrl).searchParams.get('photoId')
      || extractKuaishouPhotoId(resolvedShareUrl);
    const user = recordValue(photo, 'user');
    const userId = stringOrNumberValue(photo, 'userId') || stringOrNumberValue(user, 'user_id');
    const userEid = stringValue(photo, 'userEid');

    return {
      coverUrl: firstUrl(photo, 'coverUrls') || firstUrl(photo, 'webpCoverUrls'),
      downloadUrl,
      durationMs: numberValue(photo, 'duration'),
      externalId,
      height: numberValue(photo, 'height'),
      music: null,
      platform: this.platform,
      publishedAt: dateFromUnixMilliseconds(numberValue(photo, 'timestamp')),
      publisher: {
        avatarUrl: stringValue(photo, 'headUrl')
          || firstUrl(photo, 'headUrls')
          || stringValue(user, 'headurl'),
        id: userId,
        name: stringValue(photo, 'userName') || stringValue(user, 'user_name'),
        secUid: userEid,
        signature: stringValue(user, 'user_text'),
        uniqueId: userEid,
        verification: booleanValue(photo, 'verified') ? '已认证' : '',
      },
      resolvedShareUrl,
      sourceUrl: url.toString(),
      statistics: {
        collectCount: numberValue(photo, 'collectCount'),
        commentCount: numberValue(photo, 'commentCount'),
        diggCount: numberValue(photo, 'likeCount'),
        playCount: numberValue(photo, 'viewCount'),
        shareCount: numberValue(photo, 'shareCount') || numberValue(photo, 'forwardCount'),
      },
      title: stringValue(photo, 'caption') || `快手视频-${externalId}`,
      width: numberValue(photo, 'width'),
    };
  }
}

export function extractKuaishouPhotoId(value: string) {
  return new URL(value).pathname.match(/\/(?:fw\/photo|short-video)\/([A-Za-z0-9_-]+)/u)?.[1] || '';
}

export function extractKuaishouPhoto(html: string) {
  const markerIndex = html.indexOf(initStateMarker);
  if (markerIndex < 0) return null;
  const stateStart = markerIndex + initStateMarker.length;
  const scriptEnd = html.indexOf('</script>', stateStart);
  if (scriptEnd < 0) return null;

  const rawState = html.slice(stateStart, scriptEnd).trim().replace(/;$/u, '');
  let state: unknown;
  try {
    state = JSON.parse(rawState) as unknown;
  } catch {
    return null;
  }

  const pending: unknown[] = [state];
  while (pending.length > 0) {
    const value = pending.pop();
    if (!value || typeof value !== 'object') continue;
    if (Array.isArray(value)) {
      pending.push(...value);
      continue;
    }
    const record = value as Record<string, unknown>;
    if (firstUrl(record, 'mainMvUrls')) return record;
    pending.push(...Object.values(record));
  }
  return null;
}

function recordValue(value: unknown, key: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const next = (value as Record<string, unknown>)[key];
  return next && typeof next === 'object' && !Array.isArray(next)
    ? next as Record<string, unknown>
    : null;
}

function firstUrl(value: unknown, key: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  const entries = (value as Record<string, unknown>)[key];
  if (!Array.isArray(entries)) return '';
  for (const entry of entries) {
    const url = stringValue(entry, 'url');
    if (url) return url;
  }
  return '';
}

function stringValue(value: unknown, key: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  const next = (value as Record<string, unknown>)[key];
  return typeof next === 'string' ? next.trim() : '';
}

function stringOrNumberValue(value: unknown, key: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  const next = (value as Record<string, unknown>)[key];
  return typeof next === 'string' || typeof next === 'number' ? String(next).trim() : '';
}

function numberValue(value: unknown, key: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 0;
  const next = Number((value as Record<string, unknown>)[key]);
  return Number.isFinite(next) && next >= 0 ? next : 0;
}

function booleanValue(value: unknown, key: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return (value as Record<string, unknown>)[key] === true;
}

function dateFromUnixMilliseconds(value: number) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
