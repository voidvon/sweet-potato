import assert from 'node:assert/strict';
import test from 'node:test';
import { DouyinVideoSourceProvider, extractDouyinVideoId } from '../src/modules/video-source/providers/douyin-video-source.provider.js';
import {
  extractKuaishouPhoto,
  extractKuaishouPhotoId,
  KuaishouVideoSourceProvider,
} from '../src/modules/video-source/providers/kuaishou-video-source.provider.js';
import {
  extractXiaohongshuNote,
  extractXiaohongshuNoteId,
  XiaohongshuVideoSourceProvider,
} from '../src/modules/video-source/providers/xiaohongshu-video-source.provider.js';
import { createVideoPreviewToken, verifyVideoPreviewToken } from '../src/modules/video-source/video-source.preview.js';
import { extractFirstHttpUrl } from '../src/modules/video-source/video-source.service.js';
import type { ResolvedVideoSource } from '../src/modules/video-source/video-source.types.js';
import {
  normalizeDanceTrimRange,
  resolveDanceRemakeGenerationOptions,
  resolveDanceRemakePrice,
} from '../src/modules/video-source/dance-remake.service.js';
import { subjectReplacePrompt } from '../src/modules/video-source/subject-replace.service.js';
import { shouldUseImplicitUploadGroup } from '../src/modules/content/content.service.js';
import { seedanceReferenceVideoMetadataSourceUrl } from '../src/modules/content/internals/content-video-generation.js';

const resolvedSource: ResolvedVideoSource = {
  coverUrl: 'https://example.com/cover.jpg',
  downloadUrl: 'https://video.example.com/play/video.mp4',
  durationMs: 10_000,
  externalId: '123',
  height: 1920,
  music: null,
  platform: 'douyin',
  publishedAt: null,
  publisher: {
    avatarUrl: '',
    id: 'publisher-1',
    name: '发布者',
    secUid: '',
    signature: '',
    uniqueId: '',
    verification: '',
  },
  resolvedShareUrl: 'https://www.iesdouyin.com/share/video/123/',
  sourceUrl: 'https://v.douyin.com/example/',
  statistics: {
    collectCount: 0,
    commentCount: 0,
    diggCount: 0,
    playCount: 0,
    shareCount: 0,
  },
  title: '测试视频',
  watermarkedUrl: 'https://video.example.com/playwm/video.mp4',
  width: 1080,
};

test('extractFirstHttpUrl extracts a URL from share copy', () => {
  const url = extractFirstHttpUrl('复制打开抖音，看看这个视频 https://v.douyin.com/JPa1xhq/ 03/26');
  assert.equal(url.toString(), 'https://v.douyin.com/JPa1xhq/');
});

test('extractFirstHttpUrl removes Chinese trailing punctuation', () => {
  const url = extractFirstHttpUrl('视频地址：https://v.douyin.com/JPa1xhq/。');
  assert.equal(url.toString(), 'https://v.douyin.com/JPa1xhq/');
});

test('extractDouyinVideoId supports share and standard video paths', () => {
  assert.equal(
    extractDouyinVideoId('https://www.iesdouyin.com/share/video/6883418578486349070/?region=CN'),
    '6883418578486349070',
  );
  assert.equal(
    extractDouyinVideoId('https://www.douyin.com/video/6883418578486349070'),
    '6883418578486349070',
  );
});

test('Douyin provider only accepts actual Douyin hosts', () => {
  const provider = new DouyinVideoSourceProvider();
  assert.equal(provider.supports(new URL('https://v.douyin.com/JPa1xhq/')), true);
  assert.equal(provider.supports(new URL('https://www.iesdouyin.com/share/video/123/')), true);
  assert.equal(provider.supports(new URL('https://douyin.com.example.org/video/123')), false);
});

test('Kuaishou provider accepts share and redirected hosts', () => {
  const provider = new KuaishouVideoSourceProvider();
  assert.equal(provider.supports(new URL('https://v.kuaishou.com/7cc0e1F5')), true);
  assert.equal(provider.supports(new URL('https://v.m.chenzhongtech.com/fw/photo/3xbzg49t6i9kerw')), true);
  assert.equal(provider.supports(new URL('https://kuaishou.com.example.org/short-video/example')), false);
});

test('extractKuaishouPhoto reads video metadata from SSR state', () => {
  const html = `<html><script>window.INIT_STATE = ${JSON.stringify({
    unrelated: { value: true },
    video: {
      caption: '#性感热舞',
      coverUrls: [{ url: 'https://image.example.com/cover.jpg' }],
      duration: 9266,
      mainMvUrls: [{ url: 'https://video.example.com/video.mp4' }],
      photoId: '5241908628105208698',
      userName: '萱宝吖',
      viewCount: 668429,
    },
  })}</script></html>`;
  const photo = extractKuaishouPhoto(html);
  assert.equal(photo?.caption, '#性感热舞');
  assert.equal(photo?.photoId, '5241908628105208698');
  assert.equal(photo?.viewCount, 668429);
});

test('extractKuaishouPhotoId supports redirected and standard video paths', () => {
  assert.equal(
    extractKuaishouPhotoId('https://v.m.chenzhongtech.com/fw/photo/3xbzg49t6i9kerw?photoId=123'),
    '3xbzg49t6i9kerw',
  );
  assert.equal(
    extractKuaishouPhotoId('https://www.kuaishou.com/short-video/3xbzg49t6i9kerw'),
    '3xbzg49t6i9kerw',
  );
});

test('Xiaohongshu provider accepts share and note hosts', () => {
  const provider = new XiaohongshuVideoSourceProvider();
  assert.equal(provider.supports(new URL('http://xhslink.com/o/1Is9ucTEEKs')), true);
  assert.equal(provider.supports(new URL('https://www.xiaohongshu.com/discovery/item/6a2695c60000000036002a54')), true);
  assert.equal(provider.supports(new URL('https://xiaohongshu.com.example.org/explore/example')), false);
});

test('extractXiaohongshuNote reads video metadata from setup server state', () => {
  const html = `<html><script>window.__SETUP_SERVER_STATE__=${JSON.stringify({
    LAUNCHER_SSR_STORE_PAGE_DATA: {
      noteData: {
        interactInfo: { collectedCount: '1,365', likedCount: '3,556' },
        noteId: '6a2695c60000000036002a54',
        title: '慢摇才是感受',
        type: 'video',
        video: {
          media: {
            stream: {
              h264: [{ masterUrl: 'http://video.example.com/video.mp4', videoDuration: 16200 }],
            },
          },
        },
      },
    },
  })}</script></html>`;
  const note = extractXiaohongshuNote(html);
  assert.equal(note?.noteId, '6a2695c60000000036002a54');
  assert.equal(note?.title, '慢摇才是感受');
});

test('extractXiaohongshuNoteId supports discovery and explore paths', () => {
  assert.equal(
    extractXiaohongshuNoteId('https://www.xiaohongshu.com/discovery/item/6a2695c60000000036002a54?xsec_token=test'),
    '6a2695c60000000036002a54',
  );
  assert.equal(
    extractXiaohongshuNoteId('https://www.xiaohongshu.com/explore/6a2695c60000000036002a54'),
    '6a2695c60000000036002a54',
  );
});

test('extractFirstHttpUrl rejects content without a URL', () => {
  assert.throws(() => extractFirstHttpUrl('没有链接的分享文案'), /有效链接/u);
});

test('preview token preserves trusted video URL and referer', () => {
  const now = Date.now();
  const payload = verifyVideoPreviewToken(createVideoPreviewToken(resolvedSource, now), now);
  assert.equal(payload.url, resolvedSource.downloadUrl);
  assert.equal(payload.referer, resolvedSource.resolvedShareUrl);
  assert.equal(payload.platform, 'douyin');
});

test('preview token rejects tampering and expiry', () => {
  const now = Date.now();
  const token = createVideoPreviewToken(resolvedSource, now);
  assert.throws(() => verifyVideoPreviewToken(`${token}x`, now), /令牌无效/u);
  assert.throws(() => verifyVideoPreviewToken(token, now + 3_600_001), /已过期/u);
});

test('dance remake requires an explicit range for videos over 15 seconds', () => {
  assert.throws(() => normalizeDanceTrimRange(30), /先选择截取区间/u);
  assert.deepEqual(normalizeDanceTrimRange(30, 5, 20), { duration: 15, end: 20, start: 5 });
});

test('dance remake uses the full duration for short videos', () => {
  assert.deepEqual(normalizeDanceTrimRange(12), { duration: 12, end: 12, start: 0 });
  assert.throws(() => normalizeDanceTrimRange(3), /4-15 秒/u);
});

test('standard dance remake always uses Seedance 2.0 Mini at 480p', () => {
  assert.deepEqual(resolveDanceRemakeGenerationOptions({
    mode: 'standard',
    quality: '标清 (720p)',
    videoModelId: 'doubao-seedance-2-0-260128',
  }), {
    quality: '普清 (480p)',
    videoModelId: 'doubao-seedance-2-0-mini-260615',
  });
  assert.deepEqual(resolveDanceRemakeGenerationOptions({
    mode: 'enhanced',
    quality: '标清 (720p)',
    videoModelId: 'doubao-seedance-2-0-fast-260128',
  }), {
    quality: '标清 (720p)',
    videoModelId: 'doubao-seedance-2-0-fast-260128',
  });
});

test('dance remake price uses the effective model, resolution, and duration', () => {
  const settings = {
    seedance2CreditsPerSecond480p: 12,
    seedance2CreditsPerSecond720p: 20,
    seedance2FastCreditsPerSecond480p: 11,
    seedance2FastCreditsPerSecond720p: 18,
    seedance2MiniCreditsPerSecond480p: 7,
    seedance2MiniCreditsPerSecond720p: 15,
  };
  assert.deepEqual(resolveDanceRemakePrice({
    durationSeconds: 8,
    quality: '普清 (480p)',
    settings,
    videoModelId: 'doubao-seedance-2-0-mini-260615',
  }), {
    credits: 56,
    creditsPerSecond: 7,
    resolution: '480p',
  });
  assert.deepEqual(resolveDanceRemakePrice({
    durationSeconds: 8,
    quality: '标清 (720p)',
    settings,
    videoModelId: 'doubao-seedance-2-0-fast-260128',
  }), {
    credits: 144,
    creditsPerSecond: 18,
    resolution: '720p',
  });
});

test('subject replacement prompts bind the selected image roles and source video', () => {
  assert.match(subjectReplacePrompt('model', 1, true), /图片1中的模特/);
  assert.match(subjectReplacePrompt('model', 1, true), /视频1/);
  assert.match(subjectReplacePrompt('model', 1, true), /保留并参考原视频中的音乐和节奏/);
  assert.match(subjectReplacePrompt('clothing', 2, false), /图片1的服饰正面和图片2的服饰反面/);
  assert.match(subjectReplacePrompt('clothing', 2, false), /不生成声音/);
  assert.match(subjectReplacePrompt('background', 1, true), /替换视频1的背景/);
  assert.match(subjectReplacePrompt('product', 1, true), /商品替换视频1中的商品主体/);
});

test('remote temporary reference videos use the implicit upload group', () => {
  assert.equal(shouldUseImplicitUploadGroup({
    kind: 'video_create_reference_upload',
    source: 'remote_video_download',
    temporary: true,
  }), true);
  assert.equal(shouldUseImplicitUploadGroup({ source: 'remote_video_download' }), false);
});

test('remote video share links are never sent to Seedance as video_url', () => {
  assert.equal(seedanceReferenceVideoMetadataSourceUrl({
    source: 'remote_video_download',
    sourceUrl: 'https://v.douyin.com/example/',
  }), '');
  assert.equal(seedanceReferenceVideoMetadataSourceUrl({
    source: 'external_asset',
    sourceUrl: 'https://cdn.example.com/video.mp4',
  }), 'https://cdn.example.com/video.mp4');
});
