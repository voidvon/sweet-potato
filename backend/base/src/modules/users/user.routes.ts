import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { requireAdmin } from '../../shared/auth.middleware.js';
import { sendError } from '../../shared/http.js';
import { adjustUserCredits } from '../billing/billing.service.js';
import { resolveUserPermissions } from '../roles/role.service.js';
import { ensureRoleAssignable } from '../roles/role.service.js';
import { userRepository } from './user.repository.js';
import { hashPassword, publicUser } from './user.service.js';
import type { ManagedUser, User } from './user.types.js';

function parseAmount(value: unknown) {
  const amount = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(amount) ? amount : null;
}

function serializeManagedUser(user: ManagedUser | User) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    roleIds: user.roleIds || [],
    assignedRoles: user.assignedRoles || [],
    permissions: user.permissions || resolveUserPermissions(user),
    isBlacklisted: user.isBlacklisted,
    creditBalance: user.creditBalance,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
  };
}

function normalizeRoleIds(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(new Set(value.flatMap((item) => typeof item === 'string' && item.trim() ? [item.trim()] : [])));
}

export function createUserRouter() {
  const router = Router();

  router.get('/', requireAdmin, (_req, res) => {
    res.json(userRepository.list().map(serializeManagedUser));
  });

  router.get('/me', (req, res) => {
    const currentUserId = req.auth?.userId;
    if (!currentUserId) {
      sendError(res, 401, '请先登录');
      return;
    }

    const user = userRepository.findById(currentUserId);
    if (!user) {
      sendError(res, 404, '用户不存在');
      return;
    }

    res.json({ user: publicUser(user) });
  });

  router.put('/:id/profile', (req, res) => {
    const currentUser = req.auth;
    const user = userRepository.findById(req.params.id);
    if (!user) {
      sendError(res, 404, '用户不存在');
      return;
    }

    if (!currentUser || currentUser.userId !== user.id) {
      sendError(res, 403, '无权修改该用户');
      return;
    }

    const displayName = String(req.body.displayName || '').trim();
    if (displayName.length < 2) {
      sendError(res, 400, '用户名至少 2 位');
      return;
    }

    const avatarUrl = typeof req.body.avatarUrl === 'string' ? req.body.avatarUrl.trim() : user.avatarUrl || '';
    const nextUser = { ...user, displayName, avatarUrl };
    userRepository.updateProfile(nextUser);
    res.json({ user: publicUser(nextUser) });
  });

  router.put('/:id/password', (req, res) => {
    const currentUser = req.auth;
    const user = userRepository.findById(req.params.id);
    if (!user) {
      sendError(res, 404, '用户不存在');
      return;
    }

    if (!currentUser || currentUser.userId !== user.id) {
      sendError(res, 403, '无权修改该用户');
      return;
    }

    const currentPassword = String(req.body.currentPassword || '');
    const nextPassword = String(req.body.nextPassword || '');

    if (user.passwordHash !== hashPassword(currentPassword, user.salt)) {
      sendError(res, 401, '当前密码不正确');
      return;
    }

    if (nextPassword.length < 6) {
      sendError(res, 400, '新密码至少 6 位');
      return;
    }

    const salt = randomBytes(16).toString('hex');
    userRepository.updatePassword({
      id: user.id,
      salt,
      passwordHash: hashPassword(nextPassword, salt),
    });
    res.json({ ok: true });
  });

  router.put('/:id/admin-password', requireAdmin, (req, res) => {
    const user = userRepository.findById(String(req.params.id || ''));
    if (!user) {
      sendError(res, 404, '用户不存在');
      return;
    }
    if (user.role === 'admin') {
      sendError(res, 400, '管理员账号不支持修改密码');
      return;
    }

    const nextPassword = String(req.body.nextPassword || '');
    if (nextPassword.length < 6) {
      sendError(res, 400, '新密码至少 6 位');
      return;
    }

    const salt = randomBytes(16).toString('hex');
    userRepository.updatePassword({
      id: user.id,
      salt,
      passwordHash: hashPassword(nextPassword, salt),
    });
    res.json({ ok: true });
  });

  router.patch('/:id/credits', requireAdmin, (req, res) => {
    const targetUserId = String(req.params.id || '');
    const user = userRepository.findById(targetUserId);
    if (!user) {
      sendError(res, 404, '用户不存在');
      return;
    }

    const delta = parseAmount(req.body.delta);
    if (delta === null || delta === 0) {
      sendError(res, 400, '请输入有效的积分变动值');
      return;
    }

    let updated;
    try {
      updated = adjustUserCredits({
        userId: user.id,
        delta,
        operatorUserId: req.auth?.userId,
      });
    } catch (error) {
      sendError(res, 400, error instanceof Error ? error.message : '用户积分调整失败');
      return;
    }
    res.json({
      user: updated
        ? {
          id: updated.id,
          username: updated.username,
          displayName: updated.displayName,
          role: updated.role,
          roleIds: updated.roleIds || [],
          assignedRoles: updated.assignedRoles || [],
          permissions: resolveUserPermissions(updated),
          isBlacklisted: updated.isBlacklisted,
          creditBalance: updated.creditBalance,
          createdAt: updated.createdAt,
          lastLoginAt: updated.lastLoginAt,
        }
        : null,
    });
  });

  router.patch('/:id/blacklist', requireAdmin, (req, res) => {
    const currentUser = req.auth;
    const targetUserId = String(req.params.id || '');
    const user = userRepository.findById(targetUserId);
    if (!user) {
      sendError(res, 404, '用户不存在');
      return;
    }

    if (currentUser && currentUser.userId === user.id) {
      sendError(res, 400, '不能拉黑自己');
      return;
    }

    const isBlacklisted = Boolean(req.body.isBlacklisted);
    if (isBlacklisted && user.role === 'admin' && userRepository.countActiveAdmins() <= 1) {
      sendError(res, 400, '至少保留一个未拉黑的管理员');
      return;
    }

    userRepository.updateBlacklist(user.id, isBlacklisted);
    const updated = userRepository.findById(user.id);
    res.json({
      user: updated
        ? {
          id: updated.id,
          username: updated.username,
          displayName: updated.displayName,
          role: updated.role,
          roleIds: updated.roleIds || [],
          assignedRoles: updated.assignedRoles || [],
          permissions: resolveUserPermissions(updated),
          isBlacklisted: updated.isBlacklisted,
          creditBalance: updated.creditBalance,
          createdAt: updated.createdAt,
          lastLoginAt: updated.lastLoginAt,
        }
        : null,
    });
  });

  router.patch('/:id/role-assignment', requireAdmin, (req, res) => {
    const targetUserId = String(req.params.id || '');
    const user = userRepository.findById(targetUserId);
    if (!user) {
      sendError(res, 404, '用户不存在');
      return;
    }

    if (user.role === 'admin') {
      sendError(res, 400, '管理员账号无需分配业务角色');
      return;
    }

    const nextRoleIds = normalizeRoleIds(req.body.roleIds);

    try {
      nextRoleIds.forEach((roleId) => ensureRoleAssignable(roleId));
    } catch (error) {
      sendError(res, 400, error instanceof Error ? error.message : '角色分配失败');
      return;
    }

    userRepository.updateRoleAssignments(user.id, nextRoleIds);
    const updated = userRepository.findById(user.id);
    if (!updated) {
      sendError(res, 404, '用户不存在');
      return;
    }
    res.json({ user: serializeManagedUser(updated) });
  });

  return router;
}
