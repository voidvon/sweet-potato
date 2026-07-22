import type { NextFunction, Request, Response } from 'express';
import { extractBearerToken, verifyAuthToken } from '../../shared/auth.js';
import { sendError } from '../../shared/http.js';
import { resolveClientIp } from '../../shared/client-ip.js';
import { userRepository } from '../users/user.repository.js';
import { rateLimitSettingsService, type CompiledRateLimitRule } from './rate-limit-settings.service.js';

type RateLimitAudience = 'authenticated' | 'anonymous';
type RateLimitBucket = {
  timestamps: number[];
  updatedAt: number;
};

const ignoredPaths = new Set(['/api/health']);
const bucketStore = new Map<string, RateLimitBucket>();
const cleanupIntervalMs = 5 * 60 * 1000;

function readQueryToken(req: Request) {
  const token = req.query.token;
  return typeof token === 'string' ? token : null;
}

function resolveAudience(req: Request): RateLimitAudience {
  const token = extractBearerToken(req.header('authorization') || undefined) || readQueryToken(req);
  if (!token) return 'anonymous';
  const payload = verifyAuthToken(token);
  if (!payload) return 'anonymous';
  const user = userRepository.findById(payload.sub);
  if (!user || user.isBlacklisted) return 'anonymous';
  return 'authenticated';
}

function cleanupBuckets(now: number) {
  for (const [key, bucket] of bucketStore.entries()) {
    if (!bucket.timestamps.length || now - bucket.updatedAt > 24 * 60 * 60 * 1000) {
      bucketStore.delete(key);
    }
  }
}

setInterval(() => cleanupBuckets(Date.now()), cleanupIntervalMs).unref?.();

function shouldApplyRule(rule: CompiledRateLimitRule, audience: RateLimitAudience, pathname: string) {
  if (rule.targetUser !== 'all' && rule.targetUser !== audience) return false;
  rule.matcher.lastIndex = 0;
  return rule.matcher.test(pathname);
}

function checkRule(rule: CompiledRateLimitRule, ip: string, now: number) {
  const windowMs = rule.intervalSeconds * 1000;
  const cutoff = now - windowMs;
  const bucketKey = `${rule.id}:${ip}`;
  const bucket = bucketStore.get(bucketKey) || { timestamps: [], updatedAt: now };
  bucket.timestamps = bucket.timestamps.filter((timestamp) => timestamp > cutoff);
  bucket.updatedAt = now;
  if (bucket.timestamps.length >= rule.maxRequests) {
    bucketStore.set(bucketKey, bucket);
    return false;
  }
  bucket.timestamps.push(now);
  bucketStore.set(bucketKey, bucket);
  return true;
}

export function rateLimitSettingsMiddleware(req: Request, res: Response, next: NextFunction) {
  const pathname = req.originalUrl.split('?')[0] || req.path || '/';
  if (req.method === 'OPTIONS' || ignoredPaths.has(pathname)) {
    next();
    return;
  }

  const audience = resolveAudience(req);
  const ip = resolveClientIp(req);
  const now = Date.now();
  const matchingRules = rateLimitSettingsService.getCompiledRules()
    .filter((rule) => shouldApplyRule(rule, audience, pathname));

  for (const rule of matchingRules) {
    if (checkRule(rule, ip, now)) continue;
    sendError(
      res,
      429,
      `请求过于频繁：${rule.intervalSeconds} 秒内最多允许 ${rule.maxRequests} 次访问`,
    );
    return;
  }

  next();
}
