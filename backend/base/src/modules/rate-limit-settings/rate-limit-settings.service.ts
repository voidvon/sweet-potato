import { randomUUID } from 'node:crypto';
import {
  rateLimitSettingsRepository,
  type RateLimitRuleRecord,
} from './rate-limit-settings.repository.js';

export type RateLimitRule = {
  id: string;
  urlPattern: string;
  maxRequests: number;
  intervalSeconds: number;
  targetUser: 'all' | 'authenticated' | 'anonymous';
};

export type CompiledRateLimitRule = RateLimitRule & {
  matcher: RegExp;
};

let compiledRules: CompiledRateLimitRule[] | null = null;

function parseInteger(value: unknown, fieldName: string, max: number) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
    throw new Error(`${fieldName}需为 1-${max} 的整数`);
  }
  return parsed;
}

function normalizeTargetUser(value: unknown): RateLimitRule['targetUser'] {
  return value === 'authenticated' || value === 'anonymous' ? value : 'all';
}

function compileRules(records: RateLimitRule[]) {
  return records.map((record) => {
    let matcher: RegExp;
    try {
      matcher = new RegExp(record.urlPattern);
    } catch {
      throw new Error(`URL 正则无效：${record.urlPattern}`);
    }
    return {
      ...record,
      matcher,
    };
  });
}

function hydrate(records: RateLimitRuleRecord[]) {
  return compileRules(records.map((record) => ({
    id: record.id,
    urlPattern: record.urlPattern,
    maxRequests: record.maxRequests,
    intervalSeconds: record.intervalSeconds,
    targetUser: record.targetUser,
  })));
}

function ensureInitialized() {
  if (compiledRules) return compiledRules;
  compiledRules = hydrate(rateLimitSettingsRepository.list());
  return compiledRules;
}

export const rateLimitSettingsService = {
  listRules() {
    return ensureInitialized().map(({ matcher: _matcher, ...rule }) => rule);
  },

  updateRules(input: { rules?: unknown }) {
    const rawRules = Array.isArray(input.rules) ? input.rules : [];
    if (rawRules.length > 1000) {
      throw new Error('限速规则最多允许 1000 条');
    }

    const normalized = compileRules(rawRules.map((value, index) => {
      const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
      const urlPattern = String(record.urlPattern || '').trim();
      if (!urlPattern) {
        throw new Error(`第 ${index + 1} 条限速规则缺少 URL 正则`);
      }
      return {
        id: String(record.id || randomUUID()),
        urlPattern,
        maxRequests: parseInteger(record.maxRequests, `第 ${index + 1} 条规则的最大请求量`, 1_000_000),
        intervalSeconds: parseInteger(record.intervalSeconds, `第 ${index + 1} 条规则的间隔秒数`, 86_400),
        targetUser: normalizeTargetUser(record.targetUser),
      } satisfies RateLimitRule;
    }));

    const now = new Date().toISOString();
    rateLimitSettingsRepository.replace(normalized.map((rule) => ({
      id: rule.id,
      urlPattern: rule.urlPattern,
      maxRequests: rule.maxRequests,
      intervalSeconds: rule.intervalSeconds,
      targetUser: rule.targetUser,
      createdAt: now,
      updatedAt: now,
    })));
    compiledRules = normalized;
    return normalized.map(({ matcher: _matcher, ...rule }) => rule);
  },

  getCompiledRules() {
    return ensureInitialized();
  },
};
