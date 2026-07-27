import { db } from '../../db/database.js';
import { billingRepository } from '../billing/billing.repository.js';
import { roleRepository } from '../roles/role.repository.js';
import { listAllProtectedPermissionCodes } from '../../shared/resource-permission.js';
import type { ManagedUser, ManagedUserSortBy, ManagedUserSortOrder, User, UserRole } from './user.types.js';

type UserRow = {
  id: string;
  username: string;
  displayName: string;
  avatarUrl?: string | null;
  role: UserRole;
  authVersion: number;
  passwordHash: string;
  salt: string;
  createdAt: string;
  lastLoginAt?: string | null;
  isBlacklisted?: number;
  creditBalance?: number;
};

type ManagedUserRow = {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  createdAt: string;
  lastLoginAt?: string | null;
  isBlacklisted?: number;
  creditBalance?: number;
};

const userSelect = `
  SELECT
    id,
    username,
    display_name as displayName,
    avatar_url as avatarUrl,
    role,
    auth_version as authVersion,
    is_blacklisted as isBlacklisted,
    credit_balance as creditBalance,
    password_hash as passwordHash,
    salt,
    created_at as createdAt,
    last_login_at as lastLoginAt
  FROM users
`;

const managedUserSelect = `
  SELECT
    id,
    username,
    display_name as displayName,
    role,
    is_blacklisted as isBlacklisted,
    credit_balance as creditBalance,
    created_at as createdAt,
    last_login_at as lastLoginAt
  FROM users
`;

function parseUser(row: UserRow) {
  const assignedRoles = listAssignedRoles(row.id);
  const roleIds = assignedRoles.map((role) => role.id);
  return {
    ...row,
    roleIds,
    assignedRoles,
    isBlacklisted: Boolean(row.isBlacklisted),
    creditBalance: Number(row.creditBalance || 0),
  };
}

function parseManagedUser(row: ManagedUserRow, summary = {
  totalRechargeCredits: 0,
  totalUsageCredits: 0,
}) {
  const assignedRoles = listAssignedRoles(row.id);
  const roleIds = assignedRoles.map((role) => role.id);
  return {
    ...row,
    roleIds,
    assignedRoles,
    permissions: row.role === 'admin'
      ? listAllProtectedPermissionCodes()
      : roleRepository.listPermissionCodesByRoleIds(roleIds),
    isBlacklisted: Boolean(row.isBlacklisted),
    creditBalance: Number(row.creditBalance || 0),
    totalRechargeCredits: summary.totalRechargeCredits,
    totalUsageCredits: summary.totalUsageCredits,
  };
}

function listAssignedRoles(userId: string) {
  const rows = db.prepare(`
    SELECT DISTINCT role_id
    FROM user_role_assignments
    WHERE user_id = @userId
      AND role_id IS NOT NULL
      AND role_id != ''
  `).all({ userId }) as Array<{ role_id: string }>;
  return rows
    .map((row) => roleRepository.findAssignedRoleSummary(row.role_id))
    .filter((role): role is NonNullable<ReturnType<typeof roleRepository.findAssignedRoleSummary>> => Boolean(role));
}

export const userRepository = {
  findByUsername(username: string) {
    const findUserByUsernameQuery = db.prepare(`${userSelect} WHERE username = ?`);
    const row = findUserByUsernameQuery.get(username) as UserRow | undefined;
    return row ? parseUser(row) : undefined;
  },

  findById(id: string) {
    const findUserByIdQuery = db.prepare(`${userSelect} WHERE id = ?`);
    const row = findUserByIdQuery.get(id) as UserRow | undefined;
    return row ? parseUser(row) : undefined;
  },

  count() {
    const countUsersQuery = db.prepare('SELECT COUNT(*) as count FROM users');
    const result = countUsersQuery.get() as { count: number };
    return Number(result.count || 0);
  },

  countActiveAdmins() {
    const countAdminsQuery = db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'admin' AND is_blacklisted = 0");
    const result = countAdminsQuery.get() as { count: number };
    return Number(result.count || 0);
  },

  list(input: {
    username?: string;
    sortBy?: ManagedUserSortBy;
    sortOrder?: ManagedUserSortOrder;
  } = {}) {
    const listUsersQuery = db.prepare(`${managedUserSelect} ORDER BY created_at ASC`);
    const summaries = new Map(
      billingRepository.listCreditSummaries().map((summary) => [summary.userId, summary]),
    );
    const normalizedUsername = input.username?.trim().toLocaleLowerCase();
    const users = (listUsersQuery.all() as ManagedUserRow[])
      .filter((row) => !normalizedUsername || row.username.toLocaleLowerCase().includes(normalizedUsername))
      .map((row) => parseManagedUser(row, summaries.get(row.id)));
    if (!input.sortBy || !input.sortOrder) {
      return users;
    }
    const direction = input.sortOrder === 'asc' ? 1 : -1;
    return users.sort((left, right) => {
      const difference = left[input.sortBy!] - right[input.sortBy!];
      if (difference !== 0) {
        return difference * direction;
      }
      return left.createdAt.localeCompare(right.createdAt);
    });
  },

  create(user: User) {
    const insertUserQuery = db.prepare(`
      INSERT INTO users (id, username, display_name, role, auth_version, role_id, is_blacklisted, credit_balance, password_hash, salt, created_at, last_login_at)
      VALUES (@id, @username, @displayName, @role, @authVersion, @roleId, @isBlacklisted, @creditBalance, @passwordHash, @salt, @createdAt, @lastLoginAt)
    `);

    insertUserQuery.run({
      ...user,
      roleId: null,
      isBlacklisted: user.isBlacklisted ? 1 : 0,
    });
  },

  updateProfile(user: Pick<User, 'id' | 'displayName' | 'avatarUrl'>) {
    const updateUserProfileQuery = db.prepare(`
      UPDATE users
      SET display_name = @displayName, avatar_url = @avatarUrl
      WHERE id = @id
    `);

    updateUserProfileQuery.run(user);
  },

  updatePassword(payload: Pick<User, 'id' | 'passwordHash' | 'salt'>) {
    const updateUserPasswordQuery = db.prepare(`
      UPDATE users
      SET password_hash = @passwordHash, salt = @salt
      WHERE id = @id
    `);

    updateUserPasswordQuery.run(payload);
  },

  updateBlacklist(id: string, isBlacklisted: boolean) {
    const updateUserBlacklistQuery = db.prepare(`
      UPDATE users
      SET is_blacklisted = @isBlacklisted
      WHERE id = @id
    `);

    updateUserBlacklistQuery.run({
      id,
      isBlacklisted: isBlacklisted ? 1 : 0,
    });
  },

  updateRoleAssignments(id: string, roleIds: string[]) {
    const uniqueRoleIds = Array.from(new Set(roleIds.filter(Boolean)));
    this.replaceRoleAssignments(id, uniqueRoleIds);
  },

  replaceRoleAssignments(id: string, roleIds: string[]) {
    const uniqueRoleIds = Array.from(new Set(roleIds.filter(Boolean)));
    db.prepare('DELETE FROM user_role_assignments WHERE user_id = ?').run(id);
    const insert = db.prepare(`
      INSERT INTO user_role_assignments (user_id, role_id, created_at)
      VALUES (@userId, @roleId, @createdAt)
    `);
    const createdAt = new Date().toISOString();
    uniqueRoleIds.forEach((roleId) => {
      insert.run({ userId: id, roleId, createdAt });
    });
  },

  bumpAuthVersion(id: string) {
    db.prepare(`
      UPDATE users
      SET auth_version = auth_version + 1
      WHERE id = @id
    `).run({ id });
  },

  bumpAuthVersions(userIds: string[]) {
    const uniqueUserIds = Array.from(new Set(userIds.filter(Boolean)));
    if (!uniqueUserIds.length) {
      return;
    }
    const placeholders = uniqueUserIds.map((_, index) => `@userId${index}`).join(', ');
    const params = Object.fromEntries(uniqueUserIds.map((userId, index) => [`userId${index}`, userId]));
    db.prepare(`
      UPDATE users
      SET auth_version = auth_version + 1
      WHERE id IN (${placeholders})
    `).run(params);
  },

  updateCreditBalance(id: string, creditBalance: number) {
    const updateUserCreditBalanceQuery = db.prepare(`
      UPDATE users
      SET credit_balance = @creditBalance
      WHERE id = @id
    `);

    updateUserCreditBalanceQuery.run({ id, creditBalance });
  },

  updateLastLogin(id: string, lastLoginAt: string) {
    const updateUserLastLoginQuery = db.prepare(`
      UPDATE users
      SET last_login_at = @lastLoginAt
      WHERE id = @id
    `);

    updateUserLastLoginQuery.run({ id, lastLoginAt });
  },
};
