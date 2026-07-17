import { request } from '../request';

export type VideoSourcePlatform = 'douyin' | 'xiaohongshu' | 'kuaishou';

export type ResolvedVideoSource = {
  coverUrl: string;
  downloadUrl: string;
  durationMs: number;
  externalId: string;
  height: number;
  music: {
    authorName: string;
    coverUrl: string;
    id: string;
    playUrl: string;
    title: string;
  } | null;
  platform: VideoSourcePlatform;
  previewUrl: string;
  publishedAt: string | null;
  publisher: {
    avatarUrl: string;
    id: string;
    name: string;
    secUid: string;
    signature: string;
    uniqueId: string;
    verification: string;
  };
  resolvedShareUrl: string;
  sourceUrl: string;
  statistics: {
    collectCount: number;
    commentCount: number;
    diggCount: number;
    playCount: number;
    shareCount: number;
  };
  title: string;
  watermarkedUrl?: string;
  width: number;
};

export function resolveVideoSource(input: string) {
  return request<{ source: ResolvedVideoSource }>('/api/video-source/resolve', {
    method: 'POST',
    body: JSON.stringify({ input }),
  });
}

export function createDanceRemake(payload: {
  characterImageAssetId: string;
  mode: 'standard' | 'enhanced';
  preserveAudio: boolean;
  quality: string;
  ratio: string;
  referenceVideoAssetId?: string;
  remoteVideo?: {
    input: string;
    trimEnd?: number;
    trimStart?: number;
  };
  videoModelId: string;
}) {
  return request<{ ok: true }>('/api/video-source/dance-remakes', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
