import type { NextFunction, Request, Response } from 'express';
import { userRepository } from '../modules/users/user.repository.js';
import { sendError } from './http.js';
import { extractBearerToken, verifyAuthToken } from './auth.js';

const publicApiPaths = new Set([
  '/api/auth/register',
  '/api/auth/login',
  '/api/content/real-person/callback',
]);

function readQueryToken(req: Request) {
  const token = req.query.token;
  return typeof token === 'string' ? token : null;
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.originalUrl.startsWith('/api')) {
    next();
    return;
  }

  const pathname = req.originalUrl.split('?')[0];
  if (publicApiPaths.has(pathname)) {
    next();
    return;
  }

  const token = extractBearerToken(req.header('authorization') || undefined) || readQueryToken(req);
  if (!token) {
    sendError(res, 401, '请先登录');
    return;
  }

  const payload = verifyAuthToken(token);
  if (!payload) {
    sendError(res, 401, '登录令牌无效或已过期');
    return;
  }

  const user = userRepository.findById(payload.sub);
  if (!user) {
    sendError(res, 401, '用户不存在');
    return;
  }

  if (user.isBlacklisted) {
    sendError(res, 403, '账号已被拉黑，请联系管理员');
    return;
  }

  req.auth = {
    user,
    userId: user.id,
  };

  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.auth?.user.role !== 'admin') {
    sendError(res, 403, '需要管理员权限');
    return;
  }

  next();
}
