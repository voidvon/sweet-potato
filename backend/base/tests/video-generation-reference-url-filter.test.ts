import test from 'node:test';
import assert from 'node:assert/strict';

import { collectSeedanceVideoUrls } from '../src/modules/content/internals/content-video-generation.js';

test('collectSeedanceVideoUrls keeps local file urls when CONTENT_PUBLIC_BASE_URL can resolve them', () => {
  const urls = collectSeedanceVideoUrls({
    materialContext: {
      references: {
        videos: [
          {
            id: 'local-video',
            fileUrl: '/files/content/local-segment.mp4',
            url: '/files/content/local-segment.mp4',
            metadata: {},
          },
          {
            id: 'public-video',
            fileUrl: 'https://cdn.example.com/segment-1.mp4',
            url: 'https://cdn.example.com/segment-1.mp4',
            metadata: {},
          },
        ],
      },
    },
    videoGenerationFlow: {
      traceId: 'test-trace-reference-filter',
    },
  });

  assert.deepEqual(urls, [
    'http://124.221.146.111:5689/files/content/local-segment.mp4',
    'https://cdn.example.com/segment-1.mp4',
  ]);
});

test('collectSeedanceVideoUrls skips localhost and private network video references', () => {
  const urls = collectSeedanceVideoUrls({
    materialContext: {
      references: {
        videos: [
          {
            id: 'localhost-video',
            fileUrl: 'http://localhost:111/files/content/local.mp4',
            url: 'http://localhost:111/files/content/local.mp4',
            metadata: {},
          },
          {
            id: 'loopback-video',
            fileUrl: 'http://127.0.0.1:7072/files/content/local.mp4',
            url: 'http://127.0.0.1:7072/files/content/local.mp4',
            metadata: {},
          },
          {
            id: 'private-lan-video',
            fileUrl: 'http://192.168.11.151:7072/files/content/local.mp4',
            url: 'http://192.168.11.151:7072/files/content/local.mp4',
            metadata: {},
          },
          {
            id: 'public-domain-video',
            fileUrl: 'https://assets.example.com/segment-2.mp4',
            url: 'https://assets.example.com/segment-2.mp4',
            metadata: {},
          },
        ],
      },
    },
    videoGenerationFlow: {
      traceId: 'test-trace-reference-filter-private',
    },
  });

  assert.deepEqual(urls, ['https://assets.example.com/segment-2.mp4']);
});
