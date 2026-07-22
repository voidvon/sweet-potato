export type UserRole = 'admin' | 'user';
export type ManagedUserSortBy = 'creditBalance' | 'totalRechargeCredits' | 'totalUsageCredits';
export type ManagedUserSortOrder = 'asc' | 'desc';

export type AssignedRole = {
  id: string;
  key: string;
  name: string;
  description?: string;
  isSystem: boolean;
  isDefault: boolean;
  permissions?: string[];
  permissionCodes?: string[];
  resourceIds?: string[];
  resourceKeys?: string[];
};

export type User = {
  id: string;
  username: string;
  displayName: string;
  avatarUrl?: string | null;
  role: UserRole;
  roleIds?: string[];
  assignedRoles?: AssignedRole[];
  permissions?: string[];
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
  roleIds?: string[];
  assignedRoles?: AssignedRole[];
  permissions: string[];
  createdAt: string;
  lastLoginAt?: string;
  creditBalance: number;
};

export type ManagedUser = {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  roleIds?: string[];
  assignedRoles?: AssignedRole[];
  permissions: string[];
  isBlacklisted: boolean;
  creditBalance: number;
  totalRechargeCredits: number;
  totalUsageCredits: number;
  createdAt: string;
  lastLoginAt?: string | null;
};
