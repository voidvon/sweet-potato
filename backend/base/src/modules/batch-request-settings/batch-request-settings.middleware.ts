import type { NextFunction, Request, Response } from 'express';
import { sendError } from '../../shared/http.js';
import { batchRequestSettingsService } from './batch-request-settings.service.js';

const ignoredPaths = new Set(['/api/health']);
const directCountKeys = new Set([
  'tasks',
  'images',
  'referenceImages',
  'files',
  'attachments',
]);
const additiveAssetKeys = new Set([
  'assetIds',
  'imageAssetIds',
  'videoAssetIds',
  'audioAssetIds',
]);
const additiveMediaKeys = new Set([
  'images',
  'referenceImages',
  'videos',
  'audios',
  'files',
  'attachments',
]);

function shouldHandle(req: Request) {
  if (req.method === 'OPTIONS') return false;
  if (ignoredPaths.has(req.path)) return false;
  return req.path.startsWith('/api/');
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isMultipartRequest(req: Request) {
  return String(req.headers['content-type'] || '').toLowerCase().includes('multipart/form-data');
}

function applyTimeout(req: Request, res: Response, timeoutSeconds: number) {
  const timeoutMs = timeoutSeconds * 1000;
  req.setTimeout(timeoutMs);
  res.setTimeout(timeoutMs, () => {
    if (!res.headersSent) {
      sendError(res, 408, `批量请求处理超时，最长允许 ${timeoutSeconds} 秒`);
    } else if (!res.writableEnded) {
      res.end();
    }
    req.destroy();
  });
}

function estimateBatchCount(value: unknown): number {
  if (Array.isArray(value)) {
    return value.length;
  }
  if (!isPlainObject(value)) {
    return 0;
  }

  let best = 0;
  let assetCount = 0;
  let mediaCount = 0;

  for (const [key, item] of Object.entries(value)) {
    if (Array.isArray(item)) {
      if (directCountKeys.has(key)) {
        best = Math.max(best, item.length);
      }
      if (additiveAssetKeys.has(key)) {
        assetCount += item.length;
      }
      if (additiveMediaKeys.has(key)) {
        mediaCount += item.length;
      }
      for (const child of item) {
        best = Math.max(best, estimateBatchCount(child));
      }
      continue;
    }
    best = Math.max(best, estimateBatchCount(item));
  }

  return Math.max(best, assetCount, mediaCount);
}

export function batchRequestSettingsMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!shouldHandle(req)) {
    next();
    return;
  }

  const settings = batchRequestSettingsService.getSettings();
  const batchCount = isMultipartRequest(req) ? 1 : estimateBatchCount(req.body);

  if (batchCount > settings.maxCount) {
    sendError(res, 400, `单次批量请求最多允许 ${settings.maxCount} 项，当前为 ${batchCount} 项`);
    return;
  }

  if (batchCount > 1 || isMultipartRequest(req)) {
    applyTimeout(req, res, settings.maxDurationSeconds);
  }

  next();
}
