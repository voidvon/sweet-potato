import { siteAccessLogRepository, type SiteAccessLogRecord } from './site-access-log.repository.js';

const cleanupIntervalMs = 60 * 60 * 1000;
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

function normalizePage(value: unknown, fallback: number, max: number) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

export const siteAccessLogService = {
  record(record: SiteAccessLogRecord) {
    siteAccessLogRepository.create(record);
  },

  list(input: { page?: unknown; pageSize?: unknown; ip?: unknown; username?: unknown; method?: unknown }) {
    return siteAccessLogRepository.list({
      page: normalizePage(input.page, 1, Number.MAX_SAFE_INTEGER),
      pageSize: normalizePage(input.pageSize, 20, 100),
      ip: String(input.ip || '').trim().slice(0, 100),
      username: String(input.username || '').trim().slice(0, 100),
      method: String(input.method || '').trim().toUpperCase().slice(0, 20),
    });
  },

  getSettings() {
    return siteAccessLogRepository.getSettings();
  },

  updateSettings(input: { retentionDays?: unknown }) {
    const retentionDays = Number(input.retentionDays);
    if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 7) {
      throw new Error('日志保留时间需为 1-7 天的整数');
    }
    const settings = siteAccessLogRepository.updateSettings(retentionDays);
    this.cleanupExpired();
    return settings;
  },

  cleanupExpired() {
    const { retentionDays } = siteAccessLogRepository.getSettings();
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
    return siteAccessLogRepository.deleteExpired(cutoff);
  },

  startCleanupScheduler() {
    if (cleanupTimer) return;
    this.cleanupExpired();
    cleanupTimer = setInterval(() => this.cleanupExpired(), cleanupIntervalMs);
    cleanupTimer.unref?.();
  },
};
