import { createHash, randomBytes } from 'node:crypto';
import { db } from '../../db/database.js';
import { createAuthToken } from '../../shared/auth.js';
import { userRepository } from './user.repository.js';
import type { PublicUser, User, UserRole } from './user.types.js';

export class UserAlreadyExistsError extends Error {
  constructor() {
    super('账号已存在');
    this.name = 'UserAlreadyExistsError';
  }
}

export function hashPassword(password: string, salt: string) {
  return createHash('sha256').update(`${salt}:${password}`).digest('hex');
}

export function createToken(userId: string, role: UserRole) {
  return createAuthToken({ userId, role });
}

export function publicUser(user: User): PublicUser {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl || undefined,
    role: user.role,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt || undefined,
    creditBalance: user.creditBalance,
  };
}

export function createUser(username: string, password: string, displayName: string) {
  const createUserTransaction = db.transaction((input: { username: string; password: string; displayName: string }) => {
    if (userRepository.findByUsername(input.username)) {
      throw new UserAlreadyExistsError();
    }

    const salt = randomBytes(16).toString('hex');
    const createdAt = new Date().toISOString();
    const user: User = {
      id: randomBytes(12).toString('hex'),
      username: input.username,
      displayName: input.displayName,
      role: userRepository.count() === 0 ? 'admin' : 'user',
      isBlacklisted: false,
      creditBalance: 0,
      salt,
      passwordHash: hashPassword(input.password, salt),
      createdAt,
      lastLoginAt: createdAt,
    };

    userRepository.create(user);
    return user;
  });

  return createUserTransaction({ username, password, displayName });
}
