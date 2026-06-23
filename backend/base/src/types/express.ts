import type { User } from '../modules/users/user.types.js';

declare global {
  namespace Express {
    interface Request {
      auth?: {
        user: User;
        userId: string;
      };
    }
  }
}

export {};
