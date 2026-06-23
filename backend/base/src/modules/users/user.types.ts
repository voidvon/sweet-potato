export type UserRole = 'admin' | 'user';

export type User = {
  id: string;
  username: string;
  displayName: string;
  avatarUrl?: string | null;
  role: UserRole;
  isBlacklisted: boolean;
  creditBalance: number;
  passwordHash: string;
  salt: string;
  createdAt: string;
  lastLoginAt?: string | null;
};

export type PublicUser = {
  id: string;
  username: string;
  displayName: string;
  avatarUrl?: string;
  role: UserRole;
  createdAt: string;
  lastLoginAt?: string;
  creditBalance: number;
};

export type ManagedUser = {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  isBlacklisted: boolean;
  creditBalance: number;
  createdAt: string;
  lastLoginAt?: string | null;
};
