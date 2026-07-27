import { Router } from 'express';
import { sendError } from '../../shared/http.js';
import { userRepository } from '../users/user.repository.js';
import {
  createToken,
  createUser,
  hashPassword,
  publicUser,
  UserAlreadyExistsError,
} from '../users/user.service.js';

export function createAuthRouter() {
  const router = Router();

  router.post('/register', (req, res) => {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');
    const displayName = String(req.body.displayName || username).trim();

    if (username.length < 3 || password.length < 6) {
      sendError(res, 400, '用户名至少 3 位，密码至少 6 位');
      return;
    }

    try {
      const user = createUser(username, password, displayName);
      res.status(201).json({ user: publicUser(user), token: createToken(user) });
    } catch (error) {
      if (error instanceof UserAlreadyExistsError) {
        sendError(res, 409, error.message);
        return;
      }
      throw error;
    }
  });

  router.post('/login', (req, res) => {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');
    const user = userRepository.findByUsername(username);

    if (!user || user.passwordHash !== hashPassword(password, user.salt)) {
      sendError(res, 401, '账号或密码不正确');
      return;
    }

    if (user.isBlacklisted) {
      sendError(res, 403, '账号已被拉黑，请联系管理员');
      return;
    }

    const lastLoginAt = new Date().toISOString();
    userRepository.updateLastLogin(user.id, lastLoginAt);
    res.json({
      user: publicUser({
        ...user,
        lastLoginAt,
      }),
      token: createToken(user),
    });
  });

  return router;
}
