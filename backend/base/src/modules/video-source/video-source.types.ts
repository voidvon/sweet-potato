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

export interface VideoSourceProvider {
  readonly platform: VideoSourcePlatform;
  supports(url: URL): boolean;
  resolve(url: URL): Promise<ResolvedVideoSource>;
}

export class VideoSourceError extends Error {
  constructor(message: string, readonly statusCode = 400) {
    super(message);
    this.name = 'VideoSourceError';
  }
}
