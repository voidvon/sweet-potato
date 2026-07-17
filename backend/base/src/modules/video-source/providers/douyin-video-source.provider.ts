import { MOBILE_USER_AGENT, safeFetch } from '../video-source.http.js';
import { VideoSourceError, type ResolvedVideoSource, type VideoSourceProvider } from '../video-source.types.js';

const douyinHostSuffixes = ['douyin.com', 'iesdouyin.com'] as const;

export class DouyinVideoSourceProvider implements VideoSourceProvider {
  readonly platform = 'douyin' as const;

  supports(url: URL) {
    const hostname = url.hostname.toLowerCase();
    return douyinHostSuffixes.some((suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`));
  }

  async resolve(url: URL): Promise<ResolvedVideoSource> {
    const shareResponse = await safeFetch(url, {
      headers: {
        accept: 'text/html,application/xhtml+xml',
        'user-agent': MOBILE_USER_AGENT,
      },
    }, { allowedHostSuffixes: douyinHostSuffixes });
    const resolvedShareUrl = shareResponse.url || url.toString();
    const shareHtml = await shareResponse.text();
    const videoId = extractDouyinVideoId(resolvedShareUrl);
    if (!videoId) {
      throw new VideoSourceError('未能从抖音链接中识别视频 ID');
    }

    const itemInfoUrl = new URL('https://www.iesdouyin.com/web/api/v2/aweme/iteminfo/');
    itemInfoUrl.searchParams.set('item_ids', videoId);
    const itemInfoResponse = await safeFetch(itemInfoUrl, {
      headers: {
        accept: 'application/json',
        referer: resolvedShareUrl,
        'user-agent': MOBILE_USER_AGENT,
      },
    }, { allowedHostSuffixes: douyinHostSuffixes });
    let payload: unknown = null;
    if (itemInfoResponse.ok) {
      payload = await itemInfoResponse.json().catch(() => null);
    }
    const item = firstRecord(recordValue(payload, 'item_list')) || itemFromShareHtml(shareHtml);
    if (!item) {
      if (!itemInfoResponse.ok) {
        throw new VideoSourceError(`抖音视频信息获取失败（${itemInfoResponse.status}）`, 502);
      }
      throw new VideoSourceError(videoUnavailableMessage(shareHtml), 422);
    }
    const video = recordValue(item, 'video');
    const playAddress = recordValue(video, 'play_addr') || recordValue(video, 'play_addr_h264');
    const watermarkedUrl = firstString(recordValue(playAddress, 'url_list'));
    if (!watermarkedUrl) {
      throw new VideoSourceError('抖音视频信息中缺少播放地址', 502);
    }

    const author = recordValue(item, 'author');
    const cover = recordValue(video, 'cover') || recordValue(video, 'origin_cover');
    const music = recordValue(item, 'music');
    const statistics = recordValue(item, 'statistics');
    return {
      coverUrl: firstString(recordValue(cover, 'url_list')),
      downloadUrl: watermarkedUrl.replace('/playwm/', '/play/'),
      durationMs: numberValue(video, 'duration'),
      externalId: videoId,
      height: numberValue(video, 'height'),
      music: music ? {
        authorName: stringValue(music, 'author'),
        coverUrl: firstString(recordValue(recordValue(music, 'cover_thumb'), 'url_list')),
        id: stringValue(music, 'id_str') || String(numberValue(music, 'id') || ''),
        playUrl: firstString(recordValue(recordValue(music, 'play_url'), 'url_list')),
        title: stringValue(music, 'title'),
      } : null,
      platform: this.platform,
      publishedAt: dateFromUnixSeconds(numberValue(item, 'create_time')),
      publisher: {
        avatarUrl: firstString(recordValue(recordValue(author, 'avatar_thumb'), 'url_list')),
        id: stringValue(author, 'uid'),
        name: stringValue(author, 'nickname'),
        secUid: stringValue(author, 'sec_uid'),
        signature: stringValue(author, 'signature'),
        uniqueId: stringValue(author, 'unique_id'),
        verification: stringValue(author, 'enterprise_verify_reason') || stringValue(author, 'custom_verify'),
      },
      resolvedShareUrl,
      sourceUrl: url.toString(),
      statistics: {
        collectCount: numberValue(statistics, 'collect_count'),
        commentCount: numberValue(statistics, 'comment_count'),
        diggCount: numberValue(statistics, 'digg_count'),
        playCount: numberValue(statistics, 'play_count'),
        shareCount: numberValue(statistics, 'share_count'),
      },
      title: stringValue(item, 'desc') || `抖音视频-${videoId}`,
      watermarkedUrl,
      width: numberValue(video, 'width'),
    };
  }
}

export function extractDouyinVideoId(value: string) {
  return new URL(value).pathname.match(/\/(?:share\/)?video\/(\d+)/u)?.[1] || '';
}

function itemFromShareHtml(html: string) {
  const rawRouterData = html.match(/window\._ROUTER_DATA\s*=\s*(\{.*?\})<\/script>/su)?.[1];
  if (!rawRouterData) return null;
  try {
    const routerData = JSON.parse(rawRouterData) as unknown;
    const loaderData = asRecord(recordValue(routerData, 'loaderData'));
    for (const loader of Object.values(loaderData || {})) {
      const videoInfo = asRecord(recordValue(loader, 'videoInfoRes'));
      const item = firstRecord(recordValue(videoInfo, 'item_list'));
      if (item) return item;
    }
  } catch {
    return null;
  }
  return null;
}

function videoUnavailableMessage(html: string) {
  if (html.includes('status_deleted')) return '该抖音视频已删除';
  if (html.includes('author_invalid')) return '该抖音视频作者状态异常，无法获取视频';
  return '抖音未返回可用的视频信息，链接可能已失效或不可见';
}

function recordValue(value: unknown, key: string): Record<string, unknown> | unknown[] | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const next = (value as Record<string, unknown>)[key];
  return next && typeof next === 'object' ? next as Record<string, unknown> | unknown[] : null;
}

function firstRecord(value: Record<string, unknown> | unknown[] | null) {
  if (!Array.isArray(value)) return null;
  const first = value[0];
  return first && typeof first === 'object' && !Array.isArray(first) ? first as Record<string, unknown> : null;
}

function asRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function firstString(value: Record<string, unknown> | unknown[] | null) {
  if (!Array.isArray(value)) return '';
  return value.find((item): item is string => typeof item === 'string' && item.trim().length > 0) || '';
}

function stringValue(value: unknown, key: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  const next = (value as Record<string, unknown>)[key];
  return typeof next === 'string' ? next.trim() : '';
}

function numberValue(value: unknown, key: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 0;
  const next = Number((value as Record<string, unknown>)[key]);
  return Number.isFinite(next) && next >= 0 ? next : 0;
}

function dateFromUnixSeconds(value: number) {
  if (!value) return null;
  const date = new Date(value * 1000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
