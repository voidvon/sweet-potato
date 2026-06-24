export type AssignedRoleSummary = {
  id: string;
  key: string;
  name: string;
  description?: string;
  isSystem: boolean;
  isDefault: boolean;
};

export type AppRoleGrantedResource = {
  id: string;
  name: string;
  resourceKey: string;
  resourceType: 'directory' | 'menu';
  platform: 'web' | 'admin';
  permissionCode: string;
};

export type AppRole = AssignedRoleSummary & {
  grantedResourceIds: string[];
  grantedResources: AppRoleGrantedResource[];
  assignedUserCount: number;
  createdAt: string;
  updatedAt: string;
};

export type CreateAppRoleInput = {
  name: string;
  description?: string;
  resourceIds?: string[];
  isDefault?: boolean;
};

export type UpdateAppRoleInput = CreateAppRoleInput;
