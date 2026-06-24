import type { NextFunction, Request, Response } from 'express';
import { resolveUserPermissions } from '../modules/roles/role.service.js';
import { userRepository } from '../modules/users/user.repository.js';
import { findResourceByPermissionCode, findResourceByResourceKey } from './resource-permission.js';
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

  const permissions = resolveUserPermissions(user);
  req.auth = {
    user,
    userId: user.id,
    systemRole: user.role,
    roleIds: user.roleIds || [],
    permissions,
    hasPermission(permissionKey: string) {
      return user.role === 'admin' || permissions.includes(permissionKey);
    },
    hasResource(resourceKey: string) {
      const resource = findResourceByResourceKey(resourceKey);
      if (!resource) {
        return false;
      }
      return user.role === 'admin' || permissions.includes(resource.permissionCode);
    },
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

export function requirePermission(permissionKey: string) {
  return function permissionGuard(req: Request, res: Response, next: NextFunction) {
    if (!req.auth) {
      sendError(res, 401, '请先登录');
      return;
    }

    const resource = findResourceByPermissionCode(permissionKey);
    if (!resource || !resource.status) {
      sendError(res, 403, '当前账号无权访问该功能');
      return;
    }

    if (!req.auth.hasPermission(permissionKey)) {
      sendError(res, 403, '当前账号无权访问该功能');
      return;
    }

    next();
  };
}

export function requireAnyPermission(permissionKeys: string[]) {
  return function anyPermissionGuard(req: Request, res: Response, next: NextFunction) {
    if (!req.auth) {
      sendError(res, 401, '请先登录');
      return;
    }

    if (req.auth.systemRole === 'admin') {
      next();
      return;
    }

    const knownPermissionKeys = permissionKeys.filter((permissionKey) => {
      const resource = findResourceByPermissionCode(permissionKey);
      return Boolean(resource?.status);
    });

    if (!knownPermissionKeys.length) {
      sendError(res, 403, '当前账号无权访问该功能');
      return;
    }

    if (!knownPermissionKeys.some((permissionKey) => req.auth?.hasPermission(permissionKey))) {
      sendError(res, 403, '当前账号无权访问该功能');
      return;
    }

    next();
  };
}

export function requireResource(resourceKey: string) {
  return function resourceGuard(req: Request, res: Response, next: NextFunction) {
    if (!req.auth) {
      sendError(res, 401, '请先登录');
      return;
    }
    const resource = findResourceByResourceKey(resourceKey);
    if (!resource || !resource.status) {
      sendError(res, 403, '当前账号无权访问该功能');
      return;
    }
    if (!req.auth.hasResource(resourceKey)) {
      sendError(res, 403, '当前账号无权访问该功能');
      return;
    }
    next();
  };
}
