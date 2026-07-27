import { createHash, randomBytes } from 'node:crypto';
import { db } from '../../db/database.js';
import { createAuthToken } from '../../shared/auth.js';
import { getRegistrationRole, resolveUserPermissions } from '../roles/role.service.js';
import { userRepository } from './user.repository.js';
import type { PublicUser, User } from './user.types.js';

export class UserAlreadyExistsError extends Error {
  constructor() {
    super('账号已存在');
    this.name = 'UserAlreadyExistsError';
  }
}

export function hashPassword(password: string, salt: string) {
  return createHash('sha256').update(`${salt}:${password}`).digest('hex');
}

export function createToken(user: Pick<User, 'id' | 'role' | 'authVersion'>) {
  return createAuthToken({ userId: user.id, role: user.role, authVersion: user.authVersion });
}

export function publicUser(user: User): PublicUser {
  const permissions = user.permissions || resolveUserPermissions(user);
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl || undefined,
    role: user.role,
    roleIds: user.roleIds || [],
    assignedRoles: user.assignedRoles || [],
    permissions,
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
    const firstUser = userRepository.count() === 0;
    const registrationRole = firstUser ? null : getRegistrationRole();
    const user: User = {
      id: randomBytes(12).toString('hex'),
      username: input.username,
      displayName: input.displayName,
      role: firstUser ? 'admin' : 'user',
      authVersion: 1,
      isBlacklisted: false,
      creditBalance: 0,
      salt,
      passwordHash: hashPassword(input.password, salt),
      createdAt,
      lastLoginAt: createdAt,
    };

    userRepository.create(user);
    if (registrationRole) {
      userRepository.updateRoleAssignments(user.id, [registrationRole.id]);
      user.roleIds = [registrationRole.id];
      user.assignedRoles = [registrationRole];
    }
    return user;
  });

  return createUserTransaction({ username, password, displayName });
}
