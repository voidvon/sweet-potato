import { createHmac, timingSafeEqual } from 'node:crypto';
import { authTokenExpiresInSeconds, authTokenSecret } from '../config/env.js';
import { userRepository } from '../modules/users/user.repository.js';
import type { User, UserRole } from '../modules/users/user.types.js';

type JwtHeader = {
  alg: 'HS256';
  typ: 'JWT';
};

export type AuthTokenPayload = {
  sub: string;
  role: UserRole;
  authVersion: number;
  iat: number;
  exp: number;
};

function base64UrlDecode(value: string) {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function sign(input: string) {
  return createHmac('sha256', authTokenSecret).update(input).digest('base64url');
}

function safeEquals(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function createAuthToken(input: { userId: string; role: UserRole; authVersion: number }) {
  const header: JwtHeader = { alg: 'HS256', typ: 'JWT' };
  const iat = Math.floor(Date.now() / 1000);
  const expiresIn = Number.isFinite(authTokenExpiresInSeconds) && authTokenExpiresInSeconds > 0
    ? authTokenExpiresInSeconds
    : 60 * 60 * 24 * 30;
  const payload: AuthTokenPayload = {
    sub: input.userId,
    role: input.role,
    authVersion: input.authVersion,
    iat,
    exp: iat + expiresIn,
  };
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = sign(`${encodedHeader}.${encodedPayload}`);
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

export function verifyAuthToken(token: string): AuthTokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return null;
  }

  const [encodedHeader, encodedPayload, signature] = parts;
  const expectedSignature = sign(`${encodedHeader}.${encodedPayload}`);
  if (!safeEquals(signature, expectedSignature)) {
    return null;
  }

  try {
    const header = JSON.parse(base64UrlDecode(encodedHeader)) as Partial<JwtHeader>;
    if (header.alg !== 'HS256' || header.typ !== 'JWT') {
      return null;
    }

    const payload = JSON.parse(base64UrlDecode(encodedPayload)) as Partial<AuthTokenPayload>;
    const authVersion = payload.authVersion === undefined ? 1 : Number(payload.authVersion);
    if (
      typeof payload.sub !== 'string'
      || (payload.role !== 'admin' && payload.role !== 'user')
      || !Number.isInteger(authVersion)
      || authVersion < 1
      || typeof payload.iat !== 'number'
      || typeof payload.exp !== 'number'
    ) {
      return null;
    }

    if (payload.exp <= Math.floor(Date.now() / 1000)) {
      return null;
    }

    return {
      sub: payload.sub,
      role: payload.role,
      authVersion,
      iat: payload.iat,
      exp: payload.exp,
    };
  } catch {
    return null;
  }
}

export function extractBearerToken(value: string | undefined) {
  if (!value) {
    return null;
  }

  const match = value.match(/^Bearer\s+(.+)$/i);
  return (match ? match[1] : value).trim() || null;
}

export function resolveAuthenticatedUser(token: string): { payload: AuthTokenPayload; user: User } | null {
  const payload = verifyAuthToken(token);
  if (!payload) {
    return null;
  }

  const user = userRepository.findById(payload.sub);
  if (!user) {
    return null;
  }

  if (user.authVersion !== payload.authVersion) {
    return null;
  }

  return { payload, user };
}
