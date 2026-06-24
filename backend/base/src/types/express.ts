import type { User } from '../modules/users/user.types.js';

declare global {
  namespace Express {
    interface Request {
      auth?: {
        user: User;
        userId: string;
        systemRole: User['role'];
        roleIds: string[];
        permissions: string[];
        hasPermission: (permissionKey: string) => boolean;
        hasResource: (resourceKey: string) => boolean;
      };
    }
  }
}

export {};
