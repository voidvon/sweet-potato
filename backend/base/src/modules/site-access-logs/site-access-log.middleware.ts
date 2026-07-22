import type { NextFunction, Request, Response } from 'express';
import { resolveClientIp } from '../../shared/client-ip.js';
import { siteAccessLogService } from './site-access-log.service.js';

const ignoredPathPrefixes = ['/files/', '/api/access-logs', '/api/app'];
const ignoredPaths = new Set(['/api/health']);

function shouldRecord(req: Request) {
  if (req.method === 'OPTIONS') return false;
  const path = req.path;
  return !ignoredPaths.has(path) && !ignoredPathPrefixes.some((prefix) => path.startsWith(prefix));
}

export function siteAccessLogMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!shouldRecord(req)) {
    next();
    return;
  }

  const startedAt = Date.now();
  res.once('finish', () => {
    try {
      siteAccessLogService.record({
        ip: resolveClientIp(req),
        method: req.method.toUpperCase(),
        path: req.path.slice(0, 2000),
        userAgent: String(req.header('user-agent') || '').slice(0, 2000),
        statusCode: res.statusCode,
        durationMs: Math.max(0, Date.now() - startedAt),
        accessedAt: new Date().toISOString(),
      });
    } catch (error) {
      console.error('[site-access-log] failed to record request', error);
    }
  });

  next();
}
