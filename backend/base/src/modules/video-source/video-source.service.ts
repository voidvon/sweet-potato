import { DouyinVideoSourceProvider } from './providers/douyin-video-source.provider.js';
import {
  VideoSourceError,
  type ResolvedVideoSource,
  type VideoSourceProvider,
} from './video-source.types.js';

const providers: VideoSourceProvider[] = [new DouyinVideoSourceProvider()];

export const videoSourceService = {
  async resolve(input: string): Promise<ResolvedVideoSource> {
    const sourceUrl = extractFirstHttpUrl(input);
    const provider = providers.find((candidate) => candidate.supports(sourceUrl));
    if (!provider) {
      throw new VideoSourceError('当前仅支持抖音视频链接，小红书和快手将在后续接入');
    }
    return provider.resolve(sourceUrl);
  },
};

export function extractFirstHttpUrl(value: string) {
  const matched = String(value || '').match(/https?:\/\/[^\s<>"']+/iu)?.[0]
    .replace(/[),，。；;!?！？\]}】》]+$/u, '');
  if (!matched) {
    throw new VideoSourceError('请输入包含有效链接的分享内容');
  }
  try {
    return new URL(matched);
  } catch {
    throw new VideoSourceError('视频链接格式不正确');
  }
}
