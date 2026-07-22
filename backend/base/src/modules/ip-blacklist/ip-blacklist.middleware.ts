import type { NextFunction, Request, Response } from 'express';
import { resolveClientIp } from '../../shared/client-ip.js';
import { sendError } from '../../shared/http.js';
import { siteAccessLogService } from '../site-access-logs/site-access-log.service.js';
import { ipBlacklistService } from './ip-blacklist.service.js';

export function ipBlacklistMiddleware(req: Request, res: Response, next: NextFunction) {
  if (req.path === '/api/health') {
    next();
    return;
  }

  const ip = resolveClientIp(req);
  if (!ipBlacklistService.isBlocked(ip)) {
    next();
    return;
  }

  try {
    siteAccessLogService.record({
      ip,
      userId: '',
      username: '',
      method: req.method.toUpperCase(),
      path: req.path.slice(0, 2000),
      userAgent: String(req.header('user-agent') || '').slice(0, 2000),
      statusCode: 403,
      durationMs: 0,
      accessedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[ip-blacklist] failed to record blocked request', error);
  }

  sendError(res, 403, '当前 IP 已被禁止访问');
}
