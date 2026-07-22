import type { NextFunction, Request, Response } from 'express';
import { resolveClientIp } from '../../shared/client-ip.js';
import { siteAccessLogService } from './site-access-log.service.js';

const ignoredPathPrefixes = ['/files/', '/api/access-logs', '/api/app'];
const ignoredPaths = new Set(['/api/health']);

function shouldRecord(req: Request) {
  if (req.method === 'OPTIONS') return false;
  const path = req.originalUrl.split('?')[0];
  return !ignoredPaths.has(path) && !ignoredPathPrefixes.some((prefix) => path.startsWith(prefix));
}

export function siteAccessLogMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!shouldRecord(req)) {
    next();
    return;
  }

  const startedAt = Date.now();
  const requestPath = req.originalUrl.split('?')[0].slice(0, 2000);
  res.once('finish', () => {
    try {
      siteAccessLogService.record({
        ip: resolveClientIp(req),
        userId: req.auth?.userId || '',
        username: req.auth?.user.username || '',
        method: req.method.toUpperCase(),
        path: requestPath,
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
