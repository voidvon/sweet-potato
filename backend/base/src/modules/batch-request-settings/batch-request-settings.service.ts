import {
  batchRequestSettingsRepository,
  type BatchRequestSettingsRecord,
} from './batch-request-settings.repository.js';

export type BatchRequestSettings = BatchRequestSettingsRecord;

const maxCountLimit = 1000;
const maxDurationSecondsLimit = 24 * 60 * 60;
const maxFileSizeMbLimit = 10 * 1024;

let cachedSettings: BatchRequestSettings | null = null;

function parseInteger(value: unknown, fieldName: string, max: number) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
    throw new Error(`${fieldName}需为 1-${max} 的整数`);
  }
  return parsed;
}

function ensureInitialized() {
  if (cachedSettings) return cachedSettings;
  cachedSettings = batchRequestSettingsRepository.get();
  return cachedSettings;
}

export const batchRequestSettingsService = {
  getSettings() {
    return ensureInitialized();
  },

  updateSettings(input: {
    maxCount?: unknown;
    maxDurationSeconds?: unknown;
    maxFileSizeMb?: unknown;
  }) {
    const nextSettings = {
      maxCount: parseInteger(input.maxCount, '批量请求最大数量', maxCountLimit),
      maxDurationSeconds: parseInteger(input.maxDurationSeconds, '最大处理时间', maxDurationSecondsLimit),
      maxFileSizeMb: parseInteger(input.maxFileSizeMb, '最大文件大小', maxFileSizeMbLimit),
    } satisfies BatchRequestSettings;
    batchRequestSettingsRepository.update(nextSettings);
    cachedSettings = nextSettings;
    return nextSettings;
  },

  getFileSizeLimitBytes() {
    return this.getSettings().maxFileSizeMb * 1024 * 1024;
  },
};
