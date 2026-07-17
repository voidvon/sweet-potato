import type {
  AdminBillableUsageRecord,
  AdminCreditLedgerEntry,
  AdminLlmUsageRecord,
  BillingSettings,
  MyCreditLedgerEntry,
  SiteConfig,
} from '../../types';
import { request } from '../core/request';

enum Api {
  settings = '/api/billing/settings',
  siteConfig = '/api/site-config',
  ledger = '/api/billing/ledger',
  usage = '/api/billing/usage',
  billableUsage = '/api/billing/billable-usage',
  myLedger = '/api/billing/me/ledger',
}

export function getBillingSettings() {
  return request<BillingSettings>(Api.settings);
}

export function getSiteConfig() {
  return request<SiteConfig>(Api.siteConfig);
}

export function updateBillingSettings(payload: Pick<
  BillingSettings,
  | 'seedance2CreditsPerSecond720p'
  | 'seedance2CreditsPerSecond480p'
  | 'seedance2FastCreditsPerSecond720p'
  | 'seedance2FastCreditsPerSecond480p'
  | 'seedance2MiniCreditsPerSecond720p'
  | 'seedance2MiniCreditsPerSecond480p'
  | 'videoUploadCreditsPerMb'
  | 'videoUnderstandingCreditsPer1MTokens'
  | 'contentPlanningAnalysisCreditsPerRequest'
  | 'contentPlanningGenerationCreditsPerRequest'
  | 'marketingVideoCreditsPerRequest'
  | 'marketingVideoStoryboardModelConfigId'
  | 'videoUpscaleCreditsPerRequest'
  | 'subtitleRemovalCreditsPerSecond'
  | 'videoTranslationSubtitleCreditsPerSecond'
  | 'videoTranslationVoiceCreditsPerSecond'
  | 'videoTranslationFaceCreditsPerSecond'
  | 'videoTranslationEraseSourceCreditsPerSecond'
>) {
  return request<BillingSettings>(Api.settings, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export function listCreditLedger(userId: string, limit = 200) {
  const params = new URLSearchParams({ userId, limit: String(limit) });
  return request<AdminCreditLedgerEntry[]>(`${Api.ledger}?${params.toString()}`);
}

export function listLlmUsageRecords(userId: string, limit = 200) {
  const params = new URLSearchParams({ userId, limit: String(limit) });
  return request<AdminLlmUsageRecord[]>(`${Api.usage}?${params.toString()}`);
}

export function listBillableUsageRecords(userId: string, limit = 200) {
  const params = new URLSearchParams({ userId, limit: String(limit) });
  return request<AdminBillableUsageRecord[]>(`${Api.billableUsage}?${params.toString()}`);
}

export function listMyCreditLedger(limit = 200) {
  const params = new URLSearchParams({ limit: String(limit) });
  return request<MyCreditLedgerEntry[]>(`${Api.myLedger}?${params.toString()}`);
}
