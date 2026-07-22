import { compileIpRules, normalizeIpRules } from './ip-blacklist.matcher.js';
import { ipBlacklistRepository } from './ip-blacklist.repository.js';

function readEmergencyAllowlist() {
  return (process.env.IP_BLACKLIST_ALLOWLIST || '')
    .split(/[\s,]+/)
    .map((rule) => rule.trim())
    .filter(Boolean);
}

let blacklist = compileIpRules([]);
let allowlist = compileIpRules([]);
let initialized = false;

function ensureInitialized() {
  if (initialized) return;
  blacklist = compileIpRules(ipBlacklistRepository.list());
  allowlist = compileIpRules(normalizeIpRules(readEmergencyAllowlist()));
  initialized = true;
}

export const ipBlacklistService = {
  getSettings(currentIp?: string) {
    ensureInitialized();
    return { entries: blacklist.rules, currentIp: currentIp || 'unknown' };
  },

  updateSettings(input: { entries?: unknown }, currentIp: string) {
    ensureInitialized();
    const entries = normalizeIpRules(input.entries);
    const nextBlacklist = compileIpRules(entries);
    if (nextBlacklist.matches(currentIp)) {
      throw new Error(`不能将当前管理端 IP（${currentIp}）加入黑名单`);
    }
    ipBlacklistRepository.replace(entries);
    blacklist = nextBlacklist;
    return { entries: blacklist.rules, currentIp };
  },

  isBlocked(ip: string) {
    ensureInitialized();
    return !allowlist.matches(ip) && blacklist.matches(ip);
  },
};
