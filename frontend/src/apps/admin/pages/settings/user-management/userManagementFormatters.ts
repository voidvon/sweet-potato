import type {
  AdminBillableUsageRecord,
  AdminCreditLedgerEntry,
  AdminLlmUsageRecord,
} from '../../../types';
import { t } from '@shared/i18n';

export function formatCredits(credits: number) {
  return `${credits.toFixed(2)} Credit`;
}

export function formatDateTime(value?: string | null) {
  if (!value) {
    return t("未登录");
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString('zh-CN', { hour12: false });
}

export function sanitizeCreditAmountInput(value: string) {
  const normalizedValue = value.replace(/[^\d.]/g, '');
  if (!normalizedValue) {
    return '';
  }

  const firstDotIndex = normalizedValue.indexOf('.');
  if (firstDotIndex === -1) {
    return normalizedValue;
  }

  const integerPart = normalizedValue.slice(0, firstDotIndex) || '0';
  const decimalPart = normalizedValue.slice(firstDotIndex + 1).replace(/\./g, '').slice(0, 2);
  return `${integerPart}.${decimalPart}`;
}

export function ledgerTypeLabel(entry: AdminCreditLedgerEntry) {
  if (entry.type === 'admin_adjust' && entry.creditDelta > 0) {
    return { color: 'green', text: t("充值") };
  }
  if (entry.type === 'admin_adjust' && entry.creditDelta < 0) {
    return { color: 'red', text: t("人工扣减") };
  }
  if (entry.type === 'reserve_debit') {
    return { color: 'gold', text: t("预扣") };
  }
  if (entry.type === 'reserve_refund') {
    return { color: 'blue', text: t("退回") };
  }
  if (entry.type === 'usage_debit') {
    return { color: 'purple', text: t("业务扣费") };
  }
  return { color: 'volcano', text: t("补扣") };
}

export function usageModelName(record: AdminLlmUsageRecord) {
  return record.modelName?.trim() || record.modelConfigId;
}

export function billableCategoryLabel(category: AdminBillableUsageRecord['category']) {
  switch (category) {
    case 'content_planning_analysis':
      return { color: 'lime', text: t("策划识别") };
    case 'content_planning_generation':
      return { color: 'green', text: t("策划生成") };
    case 'image_generation':
      return { color: 'cyan', text: t("图片生成") };
    case 'video_generation':
      return { color: 'geekblue', text: t("视频生成") };
    case 'video_upscale':
      return { color: 'blue', text: t("视频高清放大") };
    case 'voice_clone':
      return { color: 'orange', text: t("声音克隆") };
    case 'speech_synthesis':
      return { color: 'gold', text: t("语音合成") };
    case 'vod_upload':
      return { color: 'blue', text: t("视频上传") };
    default:
      return { color: 'default', text: category };
  }
}

export function billableUsageName(record: AdminBillableUsageRecord) {
  if (record.model && record.model.trim()) {
    return record.model;
  }
  if (record.provider && record.provider.trim()) {
    return record.provider;
  }
  return record.category;
}

export function pricingModeLabel(mode: AdminBillableUsageRecord['pricingMode']) {
  switch (mode) {
    case 'per_request':
      return t("按次");
    case 'per_second':
      return t("按秒");
    case 'per_minute':
      return t("按分钟");
    case 'per_1k_chars':
      return t("按千字");
    case 'per_mb':
      return t("按 MB");
    case 'per_1m_tokens':
      return t("按百万 token");
    default:
      return mode;
  }
}
