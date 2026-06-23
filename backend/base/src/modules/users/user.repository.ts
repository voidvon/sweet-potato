import { db } from '../../db/database.js';
import type { ManagedUser, User } from './user.types.js';

type UserRow = Omit<User, 'isBlacklisted' | 'creditBalance'> & {
  isBlacklisted?: number;
  creditBalance?: number;
};

type ManagedUserRow = Omit<ManagedUser, 'isBlacklisted' | 'creditBalance'> & {
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
  return {
    ...row,
    isBlacklisted: Boolean(row.isBlacklisted),
    creditBalance: Number(row.creditBalance || 0),
  };
}

function parseManagedUser(row: ManagedUserRow) {
  return {
    ...row,
    isBlacklisted: Boolean(row.isBlacklisted),
    creditBalance: Number(row.creditBalance || 0),
  };
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

  list() {
    const listUsersQuery = db.prepare(`${managedUserSelect} ORDER BY created_at ASC`);
    return (listUsersQuery.all() as ManagedUserRow[])
      .map(parseManagedUser);
  },

  create(user: User) {
    const insertUserQuery = db.prepare(`
      INSERT INTO users (id, username, display_name, role, is_blacklisted, credit_balance, password_hash, salt, created_at, last_login_at)
      VALUES (@id, @username, @displayName, @role, @isBlacklisted, @creditBalance, @passwordHash, @salt, @createdAt, @lastLoginAt)
    `);

    insertUserQuery.run({
      ...user,
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
