import { createHmac, timingSafeEqual } from 'node:crypto';
import { Readable } from 'node:stream';
import type { ReadableStream } from 'node:stream/web';
import type { Request, Response } from 'express';
import { videoSourcePreviewConfig } from '../../config/env.js';
import { safeFetch } from './video-source.http.js';
import { VideoSourceError, type ResolvedVideoSource } from './video-source.types.js';

type VideoPreviewTokenPayload = {
  expiresAt: number;
  platform: ResolvedVideoSource['platform'];
  referer: string;
  url: string;
};

export function createVideoPreviewToken(source: ResolvedVideoSource, now = Date.now()) {
  const payload: VideoPreviewTokenPayload = {
    expiresAt: now + videoSourcePreviewConfig.tokenTtlSeconds * 1000,
    platform: source.platform,
    referer: source.resolvedShareUrl,
    url: source.downloadUrl,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encodedPayload}.${signPayload(encodedPayload)}`;
}

export function verifyVideoPreviewToken(token: string, now = Date.now()) {
  const [encodedPayload, signature, ...rest] = token.split('.');
  if (!encodedPayload || !signature || rest.length > 0 || encodedPayload.length > 16_384) {
    throw new VideoSourceError('预览令牌无效', 401);
  }
  const expectedSignature = signPayload(encodedPayload);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) {
    throw new VideoSourceError('预览令牌无效', 401);
  }
  let payload: VideoPreviewTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as VideoPreviewTokenPayload;
  } catch {
    throw new VideoSourceError('预览令牌无效', 401);
  }
  if (!payload.url || !payload.referer || !Number.isFinite(payload.expiresAt)) {
    throw new VideoSourceError('预览令牌无效', 401);
  }
  if (payload.expiresAt <= now) {
    throw new VideoSourceError('预览地址已过期，请重新解析视频链接', 410);
  }
  return payload;
}

export function videoPreviewUrl(source: ResolvedVideoSource) {
  return `/api/video-source/preview?token=${encodeURIComponent(createVideoPreviewToken(source))}`;
}

export async function proxyVideoPreview(req: Request, res: Response) {
  const token = typeof req.query.token === 'string' ? req.query.token : '';
  const payload = verifyVideoPreviewToken(token);
  const range = normalizeRangeHeader(req.headers.range);
  const upstream = await safeFetch(payload.url, {
    headers: {
      accept: 'video/*,*/*;q=0.8',
      ...(range ? { range } : {}),
      referer: payload.referer,
    },
  }, { maxRedirects: 8, timeoutMs: 300000 });

  if (![200, 206].includes(upstream.status) || !upstream.body) {
    await upstream.body?.cancel();
    throw new VideoSourceError(`视频预览获取失败（${upstream.status}）`, 502);
  }
  const contentType = upstream.headers.get('content-type') || 'video/mp4';
  if (contentType.startsWith('text/') || contentType.includes('json')) {
    await upstream.body.cancel();
    throw new VideoSourceError('视频平台未返回有效的视频流', 502);
  }

  res.status(upstream.status);
  forwardHeader(upstream, res, 'accept-ranges');
  forwardHeader(upstream, res, 'content-length');
  forwardHeader(upstream, res, 'content-range');
  forwardHeader(upstream, res, 'etag');
  forwardHeader(upstream, res, 'last-modified');
  res.setHeader('Cache-Control', 'private, max-age=60');
  res.setHeader('Content-Type', contentType);
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('Referrer-Policy', 'no-referrer');

  const stream = Readable.fromWeb(upstream.body as ReadableStream<Uint8Array>);
  res.once('close', () => {
    if (!res.writableEnded) stream.destroy();
  });
  stream.on('error', (error) => res.destroy(error));
  stream.pipe(res);
}

function signPayload(payload: string) {
  return createHmac('sha256', videoSourcePreviewConfig.secret).update(payload).digest('base64url');
}

function normalizeRangeHeader(value: string | undefined) {
  if (!value) return '';
  if (value.length > 100 || !/^bytes=\d*-\d*$/u.test(value)) {
    throw new VideoSourceError('视频预览 Range 请求无效', 416);
  }
  return value;
}

function forwardHeader(upstream: globalThis.Response, response: import('express').Response, name: string) {
  const value = upstream.headers.get(name);
  if (value) response.setHeader(name, value);
}
