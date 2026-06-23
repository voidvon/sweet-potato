import type {
  AdminBillableUsageRecord,
  AdminCreditLedgerEntry,
  AdminLlmUsageRecord,
  BillingSettings,
  MyCreditLedgerEntry,
} from '../../types';
import { request } from '../request';

enum Api {
  settings = '/api/billing/settings',
  ledger = '/api/billing/ledger',
  usage = '/api/billing/usage',
  billableUsage = '/api/billing/billable-usage',
  myLedger = '/api/billing/me/ledger',
}

export function getBillingSettings() {
  return request<BillingSettings>(Api.settings);
}

export function updateBillingSettings(payload: Pick<BillingSettings, 'videoUploadCreditsPerMb' | 'videoUnderstandingCreditsPer1MTokens'>) {
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
