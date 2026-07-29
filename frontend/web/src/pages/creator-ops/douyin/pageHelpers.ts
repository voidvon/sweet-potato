import { getAutomationTask, type AutomationTask } from '../../../ipc'
import type {
  DouyinAccount,
  DouyinSearchRecord,
  DouyinSearchTaskResult,
} from './pageTypes'

export const DOUYIN_LOGIN_ADAPTER = 'douyin-login'
export const DOUYIN_SEARCH_ADAPTER = 'douyin-open-search'
export const DOUYIN_OPEN_PROFILE_ADAPTER = 'douyin-open-profile'
export const DOUYIN_CONNECT_CREATORS_ADAPTER = 'douyin-connect-creators'
export const DOUYIN_STORAGE_KEY = 'douyin_creator_accounts'
export const DOUYIN_SELECTED_PROFILE_KEY = 'douyin_creator_selected_profile_id'
export const DOUYIN_PROFILE_PREFIX = 'douyin'
export const DOUYIN_LOAD_MORE_LIMIT = 20
export const DEFAULT_DOUYIN_CONNECT_MESSAGE = '你好，我们这边有合作需求，想和你进一步沟通，方便回复一下吗？'

const TASK_POLL_INTERVAL_MS = 400

export function getDouyinResultRowKey(record: DouyinSearchRecord) {
  return String(record.href || '').trim()
    || [
      String(record.name || '').trim(),
      formatDouyinId(record.douyinId),
      String(record.profileName || '').trim(),
    ].join('|')
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function createProfileId(prefix: string) {
  const randomPart = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10)

  return `${prefix}-${Date.now()}-${randomPart}`
}

function normalizeAccounts(accounts: unknown[]): DouyinAccount[] {
  const seenProfileIds = new Set<string>()
  const normalizedAccounts: DouyinAccount[] = []

  for (const account of accounts) {
    if (!(
      account
      && typeof account === 'object'
      && typeof (account as DouyinAccount).id === 'string'
      && typeof (account as DouyinAccount).name === 'string'
      && typeof (account as DouyinAccount).profileId === 'string'
      && (account as DouyinAccount).status === 'logged_in'
      && typeof (account as DouyinAccount).createdAt === 'string'
    )) {
      continue
    }

    const normalizedAccount = account as DouyinAccount
    if (seenProfileIds.has(normalizedAccount.profileId)) {
      continue
    }

    seenProfileIds.add(normalizedAccount.profileId)
    normalizedAccounts.push(normalizedAccount)
  }

  return normalizedAccounts
}

function migrateLegacyAccounts(accounts: unknown[]): DouyinAccount[] {
  const seenProfileIds = new Set<string>()
  const normalizedAccounts: DouyinAccount[] = []

  for (const account of accounts) {
    if (!account || typeof account !== 'object') {
      continue
    }

    const rawAccount = account as Partial<DouyinAccount> & {
      nickname?: string
      label?: string
    }
    const profileId = typeof rawAccount.profileId === 'string' && rawAccount.profileId.trim()
      ? rawAccount.profileId.trim()
      : typeof rawAccount.id === 'string' && rawAccount.id.trim()
        ? rawAccount.id.trim()
        : ''
    const name = typeof rawAccount.name === 'string' && rawAccount.name.trim()
      ? rawAccount.name.trim()
      : typeof rawAccount.nickname === 'string' && rawAccount.nickname.trim()
        ? rawAccount.nickname.trim()
        : typeof rawAccount.label === 'string' && rawAccount.label.trim()
          ? rawAccount.label.trim()
          : ''

    if (!profileId || !name || seenProfileIds.has(profileId)) {
      continue
    }

    seenProfileIds.add(profileId)
    normalizedAccounts.push({
      id: typeof rawAccount.id === 'string' && rawAccount.id.trim() ? rawAccount.id.trim() : profileId,
      name,
      profileId,
      status: 'logged_in',
      createdAt: typeof rawAccount.createdAt === 'string' && rawAccount.createdAt.trim()
        ? rawAccount.createdAt
        : new Date(0).toISOString(),
    })
  }

  return normalizedAccounts
}

export function upsertAccount(accounts: DouyinAccount[], nextAccount: DouyinAccount) {
  return normalizeAccounts([
    nextAccount,
    ...accounts.filter((account) => account.profileId !== nextAccount.profileId),
  ])
}

export function readAccounts(storageKey: string): DouyinAccount[] {
  try {
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) {
      return []
    }

    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      return []
    }

    const normalizedAccounts = normalizeAccounts(parsed)
    if (normalizedAccounts.length === parsed.length) {
      return normalizedAccounts
    }

    const migratedAccounts = migrateLegacyAccounts(parsed)
    if (migratedAccounts.length) {
      window.localStorage.setItem(storageKey, JSON.stringify(migratedAccounts))
    } else {
      window.localStorage.removeItem(storageKey)
    }
    return migratedAccounts
  } catch {
    return []
  }
}

export function writeAccounts(storageKey: string, accounts: DouyinAccount[]) {
  window.localStorage.setItem(storageKey, JSON.stringify(normalizeAccounts(accounts)))
}

export function readSelectedProfileId(selectedProfileKey: string) {
  return window.localStorage.getItem(selectedProfileKey) || ''
}

export function writeSelectedProfileId(selectedProfileKey: string, profileId: string) {
  if (!profileId) {
    window.localStorage.removeItem(selectedProfileKey)
    return
  }

  window.localStorage.setItem(selectedProfileKey, profileId)
}

function createAutomationTaskError(task: AutomationTask): Error {
  return new Error(task.error || (task.status === 'canceled' ? '任务已取消' : '任务未完成'))
}

export function getSearchTaskResult(task: AutomationTask | null): DouyinSearchTaskResult | null {
  if (!task?.result || typeof task.result !== 'object') {
    return null
  }

  return task.result as DouyinSearchTaskResult
}

export function getLastSearchKeyword(task: AutomationTask | null) {
  return getSearchTaskResult(task)?.keyword || ''
}

function formatDouyinId(value: string | undefined) {
  const normalized = String(value || '').trim()
  if (!normalized) {
    return ''
  }

  const match = normalized.match(/抖音号[：:]\s*(\S+)/)
  return match ? match[1] : normalized
}

export function toSearchRecord(
  task: AutomationTask,
  profileName: string,
  fallbackKeyword = '',
): DouyinSearchTaskResult {
  const result = task.result && typeof task.result === 'object'
    ? task.result as {
      keyword?: unknown
      url?: unknown
      results?: unknown
      totalResults?: unknown
      previousCount?: unknown
      hasMore?: unknown
      loadMore?: unknown
    }
    : {}

  return {
    keyword: typeof result.keyword === 'string' && result.keyword.trim()
      ? result.keyword
      : fallbackKeyword,
    url: typeof result.url === 'string' ? result.url : '',
    results: Array.isArray(result.results)
      ? (result.results as DouyinSearchRecord[]).map((item) => ({ ...item, profileName }))
      : [],
    totalResults: typeof result.totalResults === 'number' ? result.totalResults : undefined,
    previousCount: typeof result.previousCount === 'number' ? result.previousCount : undefined,
    hasMore: typeof result.hasMore === 'boolean' ? result.hasMore : undefined,
    loadMore: typeof result.loadMore === 'boolean' ? result.loadMore : undefined,
  }
}

export function dedupeDouyinResults(records: DouyinSearchRecord[]) {
  const seen = new Set<string>()
  const nextRecords: DouyinSearchRecord[] = []

  for (const record of records) {
    const key = String(record.href || '').trim()
      || [
        String(record.name || '').trim(),
        String(record.douyinId || '').trim(),
        String(record.likeCount || '').trim(),
        String(record.followerCount || '').trim(),
      ].join('|')

    if (!key || seen.has(key)) {
      continue
    }

    seen.add(key)
    nextRecords.push(record)
  }

  return nextRecords
}

export async function waitForTaskDone(
  taskId: string,
  onUpdate?: (task: AutomationTask) => void,
) {
  while (true) {
    const result = await getAutomationTask(taskId)
    if (!result.ok || !result.task) {
      throw new Error(result.message || '读取任务状态失败')
    }

    onUpdate?.(result.task)

    if (result.task.status === 'done') {
      return result.task
    }

    if (result.task.status === 'failed' || result.task.status === 'canceled') {
      throw createAutomationTaskError(result.task)
    }

    await wait(TASK_POLL_INTERVAL_MS)
  }
}
