import { MOBILE_USER_AGENT, safeFetch } from '../video-source.http.js';
import { VideoSourceError, type ResolvedVideoSource, type VideoSourceProvider } from '../video-source.types.js';

const xiaohongshuHostSuffixes = ['xhslink.com', 'xiaohongshu.com'] as const;
const setupStatePattern = /window\.__SETUP_SERVER_STATE__\s*=\s*/u;

export class XiaohongshuVideoSourceProvider implements VideoSourceProvider {
  readonly platform = 'xiaohongshu' as const;

  supports(url: URL) {
    const hostname = url.hostname.toLowerCase();
    return xiaohongshuHostSuffixes.some((suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`));
  }

  async resolve(url: URL): Promise<ResolvedVideoSource> {
    const shareResponse = await safeFetch(url, {
      headers: {
        accept: 'text/html,application/xhtml+xml',
        'user-agent': MOBILE_USER_AGENT,
      },
    }, { allowedHostSuffixes: xiaohongshuHostSuffixes });
    if (!shareResponse.ok) {
      throw new VideoSourceError(`小红书视频信息获取失败（${shareResponse.status}）`, 502);
    }

    const resolvedShareUrl = shareResponse.url || url.toString();
    const note = extractXiaohongshuNote(await shareResponse.text());
    if (!note) {
      throw new VideoSourceError('小红书未返回可用的笔记信息，链接可能已失效或不可见', 422);
    }
    if (stringValue(note, 'type') !== 'video') {
      throw new VideoSourceError('该小红书链接不是视频笔记', 422);
    }

    const video = recordValue(note, 'video');
    const media = recordValue(video, 'media');
    const stream = recordValue(media, 'stream');
    const selectedStream = firstRecord(recordValue(stream, 'h264'))
      || firstRecord(recordValue(stream, 'h265'));
    const downloadUrl = httpsUrl(stringValue(selectedStream, 'masterUrl'))
      || httpsUrl(firstString(recordValue(selectedStream, 'backupUrls')));
    if (!downloadUrl) {
      throw new VideoSourceError('小红书视频信息中缺少播放地址', 502);
    }

    const noteId = stringValue(note, 'noteId') || extractXiaohongshuNoteId(resolvedShareUrl);
    const user = recordValue(note, 'user');
    const interactInfo = recordValue(note, 'interactInfo');
    const cover = firstRecord(recordValue(note, 'imageList'));

    return {
      coverUrl: httpsUrl(stringValue(cover, 'url')),
      downloadUrl,
      durationMs: numberValue(selectedStream, 'videoDuration') || numberValue(selectedStream, 'duration'),
      externalId: noteId,
      height: numberValue(selectedStream, 'height'),
      music: null,
      platform: this.platform,
      publishedAt: dateFromUnixMilliseconds(numberValue(note, 'time')),
      publisher: {
        avatarUrl: httpsUrl(stringValue(user, 'avatar')),
        id: stringValue(user, 'userId'),
        name: stringValue(user, 'nickName'),
        secUid: '',
        signature: '',
        uniqueId: '',
        verification: numberValue(user, 'redOfficialVerifyType') > 0 ? '已认证' : '',
      },
      resolvedShareUrl,
      sourceUrl: url.toString(),
      statistics: {
        collectCount: countValue(interactInfo, 'collectedCount'),
        commentCount: countValue(interactInfo, 'commentCount'),
        diggCount: countValue(interactInfo, 'likedCount'),
        playCount: 0,
        shareCount: countValue(interactInfo, 'shareCount'),
      },
      title: stringValue(note, 'title') || stringValue(note, 'desc') || `小红书视频-${noteId}`,
      width: numberValue(selectedStream, 'width'),
    };
  }
}

export function extractXiaohongshuNoteId(value: string) {
  return new URL(value).pathname.match(/\/(?:discovery\/item|explore)\/([A-Za-z0-9]+)/u)?.[1] || '';
}

export function extractXiaohongshuNote(html: string) {
  const matched = setupStatePattern.exec(html);
  if (!matched || matched.index === undefined) return null;
  const stateStart = matched.index + matched[0].length;
  const scriptEnd = html.indexOf('</script>', stateStart);
  if (scriptEnd < 0) return null;

  try {
    const state = JSON.parse(html.slice(stateStart, scriptEnd).trim().replace(/;$/u, '')) as unknown;
    return recordValue(recordValue(state, 'LAUNCHER_SSR_STORE_PAGE_DATA'), 'noteData');
  } catch {
    return null;
  }
}

function recordValue(value: unknown, key: string): Record<string, unknown> | unknown[] | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const next = (value as Record<string, unknown>)[key];
  return next && typeof next === 'object'
    ? next as Record<string, unknown> | unknown[]
    : null;
}

function firstRecord(value: Record<string, unknown> | unknown[] | null) {
  if (!Array.isArray(value)) return null;
  const first = value[0];
  return first && typeof first === 'object' && !Array.isArray(first)
    ? first as Record<string, unknown>
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

function countValue(value: unknown, key: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 0;
  const raw = (value as Record<string, unknown>)[key];
  if (typeof raw === 'number') return Number.isFinite(raw) && raw >= 0 ? raw : 0;
  if (typeof raw !== 'string') return 0;
  const matched = raw.trim().replace(/,/gu, '').match(/^([\d.]+)\s*(万|亿)?$/u);
  if (!matched) return 0;
  const number = Number(matched[1]);
  const multiplier = matched[2] === '亿' ? 100_000_000 : matched[2] === '万' ? 10_000 : 1;
  return Number.isFinite(number) ? Math.round(number * multiplier) : 0;
}

function httpsUrl(value: string) {
  return value.replace(/^http:\/\//u, 'https://');
}

function dateFromUnixMilliseconds(value: number) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
