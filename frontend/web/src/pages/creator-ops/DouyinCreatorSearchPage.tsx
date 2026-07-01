import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Empty, Input, Popover, Tag, Tooltip, Typography, message } from 'antd';
import type { TableProps } from 'antd';
import { ArrowRightOutlined, CaretDownOutlined, CheckOutlined, InfoCircleOutlined, PlusOutlined, SearchOutlined, StarFilled, StarOutlined } from '@ant-design/icons';
import {
  getAutomationTask,
  isElectronEgg,
  startAutomationTask,
  stopAutomationProfile,
  type AutomationTask,
} from '../../ipc';
import { useWorkspaceHeader } from '../../layouts/ProtectedLayout';
import { CreatorResultsTable, type CreatorSearchResult } from './CreatorResultsTable';
import { useRemainingTableHeight } from './useRemainingTableHeight';
import './DouyinCreatorSearchPage.scss';

const DOUYIN_LOGIN_ADAPTER = 'douyin-login';
const DOUYIN_SEARCH_ADAPTER = 'douyin-open-search';
const DOUYIN_OPEN_PROFILE_ADAPTER = 'douyin-open-profile';
const DOUYIN_STORAGE_KEY = 'douyin_creator_accounts';
const DOUYIN_SELECTED_PROFILE_KEY = 'douyin_creator_selected_profile_id';
const DOUYIN_FAVORITE_CREATORS_STORAGE_KEY = 'douyin_creator_favorite_keys';
const DOUYIN_PROFILE_PREFIX = 'douyin';
const TASK_POLL_INTERVAL_MS = 400;
const DOUYIN_LOAD_MORE_LIMIT = 20;

type DouyinAccount = {
  id: string;
  name: string;
  profileId: string;
  status: 'logged_in';
  createdAt: string;
};

type DouyinLoginResult = {
  loggedIn?: boolean;
  nickname?: string;
  url?: string;
};

type DouyinSearchRecord = CreatorSearchResult;

type DouyinSearchTaskResult = {
  keyword: string;
  url: string;
  results?: DouyinSearchRecord[];
  totalResults?: number;
  previousCount?: number;
  hasMore?: boolean;
  loadMore?: boolean;
};

type OpenDouyinProfileOptions = {
  href?: string;
  creatorName?: string;
};

function getDouyinResultRowKey(record: DouyinSearchRecord) {
  return String(record.href || '').trim()
    || [
      String(record.name || '').trim(),
      formatDouyinId(record.douyinId),
      String(record.profileName || '').trim(),
    ].join('|');
}

function getDouyinFavoriteKey(record: DouyinSearchRecord) {
  const href = String(record.href || '').trim();
  const douyinId = String(record.douyinId || '').trim();
  const name = String(record.name || '').trim();

  if (href) {
    return `href:${href}`;
  }
  if (douyinId) {
    return `douyin:${douyinId}`;
  }
  return `name:${name}`;
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createProfileId(prefix: string) {
  const randomPart = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);

  return `${prefix}-${Date.now()}-${randomPart}`;
}

function normalizeAccounts(accounts: unknown[]): DouyinAccount[] {
  const seenProfileIds = new Set<string>();
  const normalizedAccounts: DouyinAccount[] = [];

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
      continue;
    }

    const normalizedAccount = account as DouyinAccount;
    if (seenProfileIds.has(normalizedAccount.profileId)) {
      continue;
    }

    seenProfileIds.add(normalizedAccount.profileId);
    normalizedAccounts.push(normalizedAccount);
  }

  return normalizedAccounts;
}

function migrateLegacyAccounts(accounts: unknown[]): DouyinAccount[] {
  const seenProfileIds = new Set<string>();
  const normalizedAccounts: DouyinAccount[] = [];

  for (const account of accounts) {
    if (!account || typeof account !== 'object') {
      continue;
    }

    const rawAccount = account as Partial<DouyinAccount> & {
      nickname?: string;
      label?: string;
    };
    const profileId = typeof rawAccount.profileId === 'string' && rawAccount.profileId.trim()
      ? rawAccount.profileId.trim()
      : typeof rawAccount.id === 'string' && rawAccount.id.trim()
        ? rawAccount.id.trim()
        : '';
    const name = typeof rawAccount.name === 'string' && rawAccount.name.trim()
      ? rawAccount.name.trim()
      : typeof rawAccount.nickname === 'string' && rawAccount.nickname.trim()
        ? rawAccount.nickname.trim()
        : typeof rawAccount.label === 'string' && rawAccount.label.trim()
          ? rawAccount.label.trim()
          : '';

    if (!profileId || !name || seenProfileIds.has(profileId)) {
      continue;
    }

    seenProfileIds.add(profileId);
    normalizedAccounts.push({
      id: typeof rawAccount.id === 'string' && rawAccount.id.trim() ? rawAccount.id.trim() : profileId,
      name,
      profileId,
      status: 'logged_in',
      createdAt: typeof rawAccount.createdAt === 'string' && rawAccount.createdAt.trim()
        ? rawAccount.createdAt
        : new Date(0).toISOString(),
    });
  }

  return normalizedAccounts;
}

function upsertAccount(accounts: DouyinAccount[], nextAccount: DouyinAccount) {
  return normalizeAccounts([
    nextAccount,
    ...accounts.filter((account) => account.profileId !== nextAccount.profileId),
  ]);
}

function readAccounts(storageKey: string): DouyinAccount[] {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    const normalizedAccounts = normalizeAccounts(parsed);
    if (normalizedAccounts.length === parsed.length) {
      return normalizedAccounts;
    }

    const migratedAccounts = migrateLegacyAccounts(parsed);
    if (migratedAccounts.length) {
      window.localStorage.setItem(storageKey, JSON.stringify(migratedAccounts));
    } else {
      window.localStorage.removeItem(storageKey);
    }
    return migratedAccounts;
  } catch {
    return [];
  }
}

function writeAccounts(storageKey: string, accounts: DouyinAccount[]) {
  window.localStorage.setItem(storageKey, JSON.stringify(normalizeAccounts(accounts)));
}

function readSelectedProfileId(selectedProfileKey: string) {
  return window.localStorage.getItem(selectedProfileKey) || '';
}

function writeSelectedProfileId(selectedProfileKey: string, profileId: string) {
  if (!profileId) {
    window.localStorage.removeItem(selectedProfileKey);
    return;
  }

  window.localStorage.setItem(selectedProfileKey, profileId);
}

function readFavoriteCreatorKeys(storageKey: string) {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  } catch {
    return [];
  }
}

function writeFavoriteCreatorKeys(storageKey: string, keys: string[]) {
  const normalizedKeys = Array.from(new Set(keys.filter((item) => typeof item === 'string' && item.trim())));
  window.localStorage.setItem(storageKey, JSON.stringify(normalizedKeys));
}

function createAutomationTaskError(task: AutomationTask): Error {
  return new Error(task.error || (task.status === 'canceled' ? '任务已取消' : '任务未完成'));
}

function getTaskStatusText(task: AutomationTask | null) {
  if (!task) {
    return '未执行';
  }

  switch (task.status) {
    case 'created':
      return '已创建';
    case 'running':
      return '执行中';
    case 'waiting_user':
      return '等待处理';
    case 'done':
      return '已完成';
    case 'failed':
      return '执行失败';
    case 'canceled':
      return '已取消';
    default:
      return task.status;
  }
}

function getTaskStatusTagColor(task: AutomationTask | null) {
  if (!task) {
    return 'default';
  }

  switch (task.status) {
    case 'done':
      return 'success';
    case 'failed':
      return 'error';
    case 'canceled':
      return 'warning';
    case 'running':
    case 'waiting_user':
      return 'processing';
    default:
      return 'default';
  }
}

function getAutomationTaskLogTriggerClassName(task: AutomationTask | null) {
  const status = task?.status ? ` is-${task.status}` : '';
  return `douyin-task-log-trigger${status}`;
}

function getSearchTaskResult(task: AutomationTask | null): DouyinSearchTaskResult | null {
  if (!task?.result || typeof task.result !== 'object') {
    return null;
  }

  return task.result as DouyinSearchTaskResult;
}

function getLastSearchKeyword(task: AutomationTask | null) {
  return getSearchTaskResult(task)?.keyword || '';
}

function formatDouyinId(value: string | undefined) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return '';
  }

  const match = normalized.match(/抖音号[：:]\s*(\S+)/);
  return match ? match[1] : normalized;
}

function createDouyinStructuredColumns(
  openDouyinProfile: (options: OpenDouyinProfileOptions) => void,
): TableProps<DouyinSearchRecord>['columns'] {
  const renderDouyinId = (value: string | undefined) => {
    const normalized = String(value || '').trim();
    if (!normalized) {
      return '-';
    }

    const match = normalized.match(/\u6296\u97f3\u53f7[\uFF1A:]\s*(\S+)/);
    return match ? match[1] : normalized;
  };

  return [
    {
      dataIndex: 'name',
      key: 'creatorInfo',
      title: '达人信息',
      minWidth: 280,
      render: (_value: string, record) => {
        const titleNode = record.href
          ? (
            <button
              className="douyin-cell-link-button"
              onClick={() => {
                openDouyinProfile({ href: record.href, creatorName: record.name });
              }}
              type="button"
            >
              {record.name}
            </button>
          )
          : <span>{record.name}</span>;

        return (
          <div className="douyin-cell-creator">
            <div className="douyin-cell-avatar">
              {record.href ? (
                <button
                  className="douyin-cell-avatar-button"
                  onClick={() => {
                    openDouyinProfile({ href: record.href, creatorName: record.name });
                  }}
                  type="button"
                >
                  {record.avatarUrl ? (
                    <img alt={record.name} referrerPolicy="no-referrer" src={record.avatarUrl} />
                  ) : (
                    <span>{record.name.slice(0, 1)}</span>
                  )}
                </button>
              ) : (
                <>
                  {record.avatarUrl ? (
                    <img alt={record.name} referrerPolicy="no-referrer" src={record.avatarUrl} />
                  ) : (
                    <span>{record.name.slice(0, 1)}</span>
                  )}
                </>
              )}
            </div>
            <div className="douyin-cell-creator-main">
              <div className="douyin-cell-creator-title">{titleNode}</div>
              <div className="douyin-cell-creator-meta">
                {record.profileName ? <Tag bordered={false}>{record.profileName}</Tag> : null}
              </div>
            </div>
          </div>
        );
      },
    },
    {
      dataIndex: 'creatorType',
      key: 'creatorType',
      title: '类型',
      width: 120,
      render: (value: string | undefined) => value ? <Tag bordered={false}>{value}</Tag> : '-',
    },
    {
      dataIndex: 'douyinId',
      key: 'douyinId',
      title: '抖音号',
      width: 180,
      render: (value: string | undefined) => renderDouyinId(value),
    },
    {
      dataIndex: 'likeCount',
      key: 'likeCount',
      title: '获赞',
      width: 140,
      render: (value: string | undefined) => value || '-',
    },
    {
      dataIndex: 'followerCount',
      key: 'followerCount',
      title: '粉丝',
      width: 140,
      render: (value: string | undefined) => value || '-',
    },
    {
      dataIndex: 'intro',
      key: 'intro',
      title: '个人介绍',
      width: 320,
      render: (value: string | undefined, record) => value || record.summary || '-',
    },
    {
      dataIndex: 'operationLabel',
      key: 'action',
      title: '操作',
      width: 150,
      render: (_value: string | undefined, record) => (
        <div className="douyin-cell-operation">
          {record.href ? (
            <Button
              danger
              onClick={() => {
                openDouyinProfile({ href: record.href, creatorName: record.name });
              }}
              size="small"
              type="primary"
            >
              {record.operationLabel || '查看主页'}
            </Button>
          ) : (
            <Button danger size="small" type="primary">
              {record.operationLabel || '查看主页'}
            </Button>
          )}
        </div>
      ),
    },
  ];
}

function toSearchRecord(task: AutomationTask, profileName: string, fallbackKeyword = ''): DouyinSearchTaskResult {
  const result = task.result && typeof task.result === 'object'
    ? task.result as {
      keyword?: unknown;
      url?: unknown;
      results?: unknown;
      totalResults?: unknown;
      previousCount?: unknown;
      hasMore?: unknown;
      loadMore?: unknown;
    }
    : {};

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
  };
}

function dedupeDouyinResults(records: DouyinSearchRecord[]) {
  const seen = new Set<string>();
  const nextRecords: DouyinSearchRecord[] = [];

  for (const record of records) {
    const key = String(record.href || '').trim()
      || [
        String(record.name || '').trim(),
        String(record.douyinId || '').trim(),
        String(record.likeCount || '').trim(),
        String(record.followerCount || '').trim(),
      ].join('|');

    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    nextRecords.push(record);
  }

  return nextRecords;
}

async function waitForTaskDone(taskId: string, onUpdate?: (task: AutomationTask) => void) {
  while (true) {
    const result = await getAutomationTask(taskId);
    if (!result.ok || !result.task) {
      throw new Error(result.message || '读取任务状态失败');
    }

    onUpdate?.(result.task);

    if (result.task.status === 'done') {
      return result.task;
    }

    if (result.task.status === 'failed' || result.task.status === 'canceled') {
      throw createAutomationTaskError(result.task);
    }

    await wait(TASK_POLL_INTERVAL_MS);
  }
}

export function DouyinCreatorSearchPage() {
  const { setHeaderExtra } = useWorkspaceHeader();
  const [accounts, setAccounts] = useState<DouyinAccount[]>(() => readAccounts(DOUYIN_STORAGE_KEY));
  const [selectedProfileId, setSelectedProfileId] = useState(() => readSelectedProfileId(DOUYIN_SELECTED_PROFILE_KEY));
  const [accountPickerOpen, setAccountPickerOpen] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [running, setRunning] = useState(false);
  const [loginTaskId, setLoginTaskId] = useState<string | null>(null);
  const [loginProfileId, setLoginProfileId] = useState<string | null>(null);
  const [loginTask, setLoginTask] = useState<AutomationTask | null>(null);
  const [searchTask, setSearchTask] = useState<AutomationTask | null>(null);
  const [searchResults, setSearchResults] = useState<DouyinSearchRecord[]>([]);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMoreResults, setHasMoreResults] = useState(true);
  const [isStartingLogin, setIsStartingLogin] = useState(false);
  const [isSwitchingProfile, setIsSwitchingProfile] = useState(false);
  const [openingProfileIds, setOpeningProfileIds] = useState<string[]>([]);
  const [logPopoverOpen, setLogPopoverOpen] = useState(false);
  const [favoriteCreatorKeys, setFavoriteCreatorKeys] = useState<string[]>(() => readFavoriteCreatorKeys(DOUYIN_FAVORITE_CREATORS_STORAGE_KEY));
  const isPageActiveRef = useRef(true);
  const selectedProfileIdRef = useRef(selectedProfileId);
  const profileSwitchPromiseRef = useRef<Promise<void>>(Promise.resolve());
  const completedLoginTaskIdsRef = useRef(new Set<string>());
  const isLoadingMoreRef = useRef(false);
  const lastSearchKeywordRef = useRef('');
  const resultsPanelRef = useRef<HTMLElement | null>(null);
  const resultsHeaderRef = useRef<HTMLDivElement | null>(null);
  const isLoginRunning = Boolean(loginTaskId);
  const resultsTableScrollY = useRemainingTableHeight(
    resultsPanelRef,
    resultsHeaderRef,
    [searchResults.length],
    { gap: 22, minHeight: 240 },
  );

  const selectedAccount = accounts.find((account) => account.profileId === selectedProfileId) || null;
  const displayedAccount = selectedAccount || accounts[0] || null;
  const favoriteCreatorKeySet = useMemo(() => new Set(favoriteCreatorKeys), [favoriteCreatorKeys]);
  const displayedAccountAvatar = displayedAccount?.name?.trim().slice(0, 1) || '抖';
  const selectedCount = selectedRowKeys.length;

  useEffect(() => {
    isPageActiveRef.current = true;
    return () => {
      isPageActiveRef.current = false;
    };
  }, []);

  useEffect(() => {
    selectedProfileIdRef.current = selectedProfileId;
  }, [selectedProfileId]);

  useEffect(() => {
    isLoadingMoreRef.current = isLoadingMore;
  }, [isLoadingMore]);

  useEffect(() => {
    writeAccounts(DOUYIN_STORAGE_KEY, accounts);
  }, [accounts]);

  useEffect(() => {
    writeFavoriteCreatorKeys(DOUYIN_FAVORITE_CREATORS_STORAGE_KEY, favoriteCreatorKeys);
  }, [favoriteCreatorKeys]);

  useEffect(() => {
    if (!accounts.length) {
      if (selectedProfileId) {
        setSelectedProfileId('');
        selectedProfileIdRef.current = '';
        writeSelectedProfileId(DOUYIN_SELECTED_PROFILE_KEY, '');
      }
      return;
    }

    if (!selectedProfileId || !accounts.some((account) => account.profileId === selectedProfileId)) {
      setSelectedProfileId(accounts[0].profileId);
      selectedProfileIdRef.current = accounts[0].profileId;
      writeSelectedProfileId(DOUYIN_SELECTED_PROFILE_KEY, accounts[0].profileId);
    }
  }, [accounts, selectedProfileId]);

  const waitForPendingProfileSwitch = useCallback(async () => {
    await profileSwitchPromiseRef.current.catch(() => {});
  }, []);

  const selectAccountProfile = useCallback(async (profileId: string) => {
    const nextProfileId = profileId.trim();
    if (!nextProfileId) {
      return;
    }

    const queued = profileSwitchPromiseRef.current
      .catch(() => {})
      .then(async () => {
        if (!isPageActiveRef.current) {
          return;
        }

        setIsSwitchingProfile(true);
        const previousProfileId = selectedProfileIdRef.current.trim();

        selectedProfileIdRef.current = nextProfileId;
        setSelectedProfileId(nextProfileId);
        writeSelectedProfileId(DOUYIN_SELECTED_PROFILE_KEY, nextProfileId);
        setAccountPickerOpen(false);

        if (isElectronEgg && previousProfileId && previousProfileId !== nextProfileId) {
          const stopResult = await stopAutomationProfile(previousProfileId, 'douyin');
          if (isPageActiveRef.current && !stopResult.ok) {
            message.warning(stopResult.message || '关闭旧 Profile 窗口失败');
          }
        }
      })
      .finally(() => {
        if (isPageActiveRef.current) {
          setIsSwitchingProfile(false);
        }
      });

    profileSwitchPromiseRef.current = queued;
    await queued;
  }, []);

  useEffect(() => {
    if (!loginTaskId || !loginProfileId) {
      return undefined;
    }

    let stopped = false;
    let syncing = false;
    const syncTask = async () => {
      if (syncing) {
        return;
      }

      syncing = true;
      const result = await getAutomationTask(loginTaskId);
      syncing = false;

      if (stopped) {
        return;
      }

      if (!result.ok || !result.task) {
        stopped = true;
        message.error(result.message || '获取抖音登录状态失败');
        setLoginTaskId(null);
        setLoginProfileId(null);
        setLoginTask(null);
        return;
      }

      setLoginTask(result.task);
      if (result.task.status === 'done') {
        if (completedLoginTaskIdsRef.current.has(result.task.id)) {
          stopped = true;
          setLoginTaskId(null);
          setLoginProfileId(null);
          setLoginTask(null);
          return;
        }

        completedLoginTaskIdsRef.current.add(result.task.id);
        stopped = true;
        const taskResult = (result.task.result || {}) as DouyinLoginResult;
        const nickname = typeof taskResult.nickname === 'string' ? taskResult.nickname.trim() : '';

        if (!nickname) {
          message.error('抖音登录成功，但未读取到账号名称');
        } else {
          const nextAccount: DouyinAccount = {
            id: loginProfileId,
            name: nickname,
            profileId: loginProfileId,
            status: 'logged_in',
            createdAt: new Date().toISOString(),
          };

          setAccounts((current) => upsertAccount(current, nextAccount));
          await selectAccountProfile(loginProfileId);
          message.success(`抖音账号已登录：${nickname}`);
        }

        setLoginTaskId(null);
        setLoginProfileId(null);
        setLoginTask(null);
        return;
      }

      if (result.task.status === 'canceled') {
        stopped = true;
        message.info('抖音登录窗口已关闭，未新增账号');
        setLoginTaskId(null);
        setLoginProfileId(null);
        setLoginTask(null);
        return;
      }

      if (result.task.status === 'failed') {
        stopped = true;
        message.error(result.task.error || '抖音登录失败');
        setLoginTaskId(null);
        setLoginProfileId(null);
        setLoginTask(null);
      }
    };

    void syncTask();
    const timer = window.setInterval(syncTask, 1000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [loginProfileId, loginTaskId, selectAccountProfile]);

  const handleAddAccount = useCallback(async () => {
    if (!isElectronEgg) {
      message.warning('抖音登录只能在 Electron 应用内进行');
      return;
    }

    if (isLoginRunning) {
      message.warning('已有抖音登录窗口正在处理');
      return;
    }

    const profileId = createProfileId(DOUYIN_PROFILE_PREFIX);
    setIsStartingLogin(true);
    const result = await startAutomationTask({
      adapter: DOUYIN_LOGIN_ADAPTER,
      profileId,
      input: {},
    });
    setIsStartingLogin(false);

    if (!result.ok || !result.taskId) {
      message.error(result.message || '打开抖音登录窗口失败');
      return;
    }

    setLoginProfileId(profileId);
    setLoginTaskId(result.taskId);
    setLoginTask(result.task || null);
    setAccountPickerOpen(false);
    message.info('请在新窗口完成抖音登录');
  }, [isLoginRunning]);

  const handleSelectAccount = useCallback(async (account: DouyinAccount) => {
    await selectAccountProfile(account.profileId);
  }, [selectAccountProfile]);

  const handleOpenProfile = useCallback(async (account: DouyinAccount) => {
    await waitForPendingProfileSwitch();
    if (!isElectronEgg) {
      message.warning('只能在 Electron 应用内打开抖音主页');
      return;
    }

    if (openingProfileIds.includes(account.profileId)) {
      return;
    }

    setOpeningProfileIds((value) => [...value, account.profileId]);
    try {
      const result = await startAutomationTask({
        adapter: DOUYIN_OPEN_PROFILE_ADAPTER,
        profileId: account.profileId,
        input: {},
      });

      if (!result.ok || !result.taskId) {
        message.error(result.message || '打开抖音主页失败');
        return;
      }

      await waitForTaskDone(result.taskId);
      if (!isPageActiveRef.current) {
        return;
      }

      message.success(`已打开 ${account.name} 的抖音主页`);
    } catch (error) {
      if (!isPageActiveRef.current) {
        return;
      }

      message.error(error instanceof Error ? error.message : '打开抖音主页失败');
    } finally {
      if (isPageActiveRef.current) {
        setOpeningProfileIds((value) => value.filter((profileId) => profileId !== account.profileId));
      }
    }
  }, [openingProfileIds, waitForPendingProfileSwitch]);

  const handleOpenCreatorProfile = useCallback(async ({ href, creatorName }: OpenDouyinProfileOptions) => {
    const profileId = selectedProfileIdRef.current.trim() || displayedAccount?.profileId || '';
    const normalizedHref = String(href || '').trim();

    if (!normalizedHref) {
      return;
    }

    await waitForPendingProfileSwitch();
    if (!isElectronEgg) {
      message.warning('鍙兘鍦?Electron 搴旂敤鍐呬娇鐢ㄥ綋鍓?Profile 鎵撳紑涓婚〉');
      return;
    }

    if (!profileId) {
      message.warning('璇峰厛閫夋嫨涓€涓?Profile');
      return;
    }

    if (openingProfileIds.includes(profileId)) {
      return;
    }

    setOpeningProfileIds((value) => [...value, profileId]);
    try {
      const result = await startAutomationTask({
        adapter: DOUYIN_OPEN_PROFILE_ADAPTER,
        profileId,
        input: { url: normalizedHref },
      });

      if (!result.ok || !result.taskId) {
        message.error(result.message || '鎵撳紑鎶栭煶杈句汉涓婚〉澶辫触');
        return;
      }

      await waitForTaskDone(result.taskId);
      if (!isPageActiveRef.current) {
        return;
      }

      message.success(`宸蹭娇鐢ㄥ綋鍓?Profile 鎵撳紑${creatorName || '杈句汉'}涓婚〉`);
    } catch (error) {
      if (!isPageActiveRef.current) {
        return;
      }

      message.error(error instanceof Error ? error.message : '鎵撳紑鎶栭煶杈句汉涓婚〉澶辫触');
    } finally {
      if (isPageActiveRef.current) {
        setOpeningProfileIds((value) => value.filter((item) => item !== profileId));
      }
    }
  }, [displayedAccount?.profileId, openingProfileIds, waitForPendingProfileSwitch]);

  const handleToggleFavoriteCreator = useCallback((record: DouyinSearchRecord) => {
    const favoriteKey = getDouyinFavoriteKey(record);
    let nextFavorite = false;

    setFavoriteCreatorKeys((current) => {
      if (current.includes(favoriteKey)) {
        nextFavorite = false;
        return current.filter((item) => item !== favoriteKey);
      }

      nextFavorite = true;
      return [...current, favoriteKey];
    });

    message.success(nextFavorite ? '已收藏' : '已取消收藏');
  }, []);

  const runSearch = useCallback(async (nextKeyword: string) => {
    const normalizedKeyword = nextKeyword.trim();
    const profileId = selectedProfileIdRef.current.trim() || displayedAccount?.profileId || '';
    const profileName = displayedAccount?.name || '';

    if (!normalizedKeyword) {
      message.warning('请输入抖音达人关键词');
      return;
    }

    if (!profileId) {
      message.warning('请先新增并选择一个 Profile');
      return;
    }

    await waitForPendingProfileSwitch();
    setRunning(true);
    setHasMoreResults(true);
    setSelectedRowKeys([]);
    try {
      const started = await startAutomationTask({
        adapter: DOUYIN_SEARCH_ADAPTER,
        profileId,
        input: { keyword: normalizedKeyword, limit: DOUYIN_LOAD_MORE_LIMIT },
      });

      if (!started.ok || !started.taskId) {
        throw new Error(started.message || '启动抖音搜索失败');
      }

      if (started.task) {
        setSearchTask(started.task);
      }

      const doneTask = await waitForTaskDone(started.taskId, setSearchTask);
      setSearchTask(doneTask);
      const taskResult = toSearchRecord(doneTask, profileName, normalizedKeyword);
      setSearchResults(dedupeDouyinResults(taskResult.results || []));
      setHasMoreResults(taskResult.hasMore !== false);
      lastSearchKeywordRef.current = taskResult.keyword || normalizedKeyword;
      message.success(`已使用 ${profileName || '当前 Profile'} 打开抖音搜索页`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '打开抖音搜索失败');
    } finally {
      setRunning(false);
    }
  }, [displayedAccount?.name, displayedAccount?.profileId, waitForPendingProfileSwitch]);

  const handleSearch = useCallback(async () => {
    await runSearch(keyword);
  }, [keyword, runSearch]);

  const handleLoadMore = useCallback(async () => {
    const normalizedKeyword = lastSearchKeywordRef.current.trim() || getLastSearchKeyword(searchTask).trim() || keyword.trim();
    const profileId = selectedProfileIdRef.current.trim() || displayedAccount?.profileId || '';
    const profileName = displayedAccount?.name || '';

    if (!normalizedKeyword || !profileId || running || isLoadingMoreRef.current || !hasMoreResults) {
      return;
    }

    await waitForPendingProfileSwitch();
    setIsLoadingMore(true);
    try {
      const started = await startAutomationTask({
        adapter: DOUYIN_SEARCH_ADAPTER,
        profileId,
        input: {
          keyword: normalizedKeyword,
          loadMore: true,
          previousCount: searchResults.length,
          limit: DOUYIN_LOAD_MORE_LIMIT,
        },
      });

      if (!started.ok || !started.taskId) {
        throw new Error(started.message || '继续加载抖音达人失败');
      }

      if (started.task) {
        setSearchTask(started.task);
      }

      const doneTask = await waitForTaskDone(started.taskId, setSearchTask);
      setSearchTask(doneTask);
      const taskResult = toSearchRecord(doneTask, profileName, normalizedKeyword);
      const appendedResults = taskResult.results || [];

      setSearchResults((current) => dedupeDouyinResults([...current, ...appendedResults]));
      setHasMoreResults(taskResult.hasMore !== false);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '继续加载抖音达人失败');
    } finally {
      if (isPageActiveRef.current) {
        setIsLoadingMore(false);
      }
    }
  }, [
    displayedAccount?.name,
    displayedAccount?.profileId,
    hasMoreResults,
    keyword,
    running,
    searchResults.length,
    searchTask,
    waitForPendingProfileSwitch,
  ]);

  const searchTaskLogContent = useMemo(() => {
    const logs = searchTask?.logs.slice(-6) || [];

    return (
      <div className="douyin-task-log-popover">
        {searchTask ? (
          <>
            <div className="douyin-task-log-popover-header">
              <span>最近一次抖音搜索</span>
              <Tag color={getTaskStatusTagColor(searchTask)}>
                {getTaskStatusText(searchTask)}
              </Tag>
            </div>
            <div>Task ID: {searchTask.id}</div>
            <div>Profile: {searchTask.profileId}</div>
            {searchTask.error ? <div>错误: {searchTask.error}</div> : null}
          </>
        ) : (
          <div className="douyin-task-log-popover-header">
            <span>抖音搜索日志</span>
          </div>
        )}

        {logs.length ? (
          <div className="douyin-task-log-lines">
            {logs.map((log) => (
              <div key={`${log.time}-${log.message}`}>
                [{log.level}] {log.message}
              </div>
            ))}
          </div>
        ) : null}

        {!searchTask ? (
          <div className="douyin-task-log-popover-empty">
            暂无搜索日志
          </div>
        ) : null}
      </div>
    );
  }, [searchTask]);

  const accountPickerContent = useMemo(() => (
    <div className="douyin-account-popover">
      {accounts.length ? (
        <div className="douyin-account-list" role="list">
          {accounts.map((account) => {
            const selected = account.profileId === displayedAccount?.profileId;
            return (
              <div className="douyin-account-list-item" key={account.id} role="listitem">
                <div
                  className={`douyin-account-item${selected ? ' selected' : ''}`}
                  onClick={() => {
                    void handleSelectAccount(account);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      void handleSelectAccount(account);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <span className="douyin-account-name">
                    {selected ? <CheckOutlined /> : null}
                    <span>{account.name}</span>
                  </span>
                  <Tooltip title="打开主页">
                    <Button
                      className="douyin-account-backstage"
                      disabled={!isElectronEgg}
                      icon={<ArrowRightOutlined />}
                      loading={openingProfileIds.includes(account.profileId)}
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleOpenProfile(account);
                      }}
                      shape="circle"
                      type="text"
                    />
                  </Tooltip>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <Empty className="douyin-account-list-empty" description="暂无 Profile" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      )}
      <div className="douyin-account-popover-footer">
        <Button
          block
          disabled={!isElectronEgg || isSwitchingProfile || isLoginRunning}
          icon={<PlusOutlined />}
          loading={isStartingLogin || isLoginRunning}
          onClick={() => {
            void handleAddAccount();
          }}
        >
          新增 Profile
        </Button>
      </div>
    </div>
  ), [
    accounts,
    displayedAccount?.profileId,
    handleAddAccount,
    handleOpenProfile,
    handleSelectAccount,
    isLoginRunning,
    isStartingLogin,
    isSwitchingProfile,
    openingProfileIds,
  ]);

  const handleSelectionChange = useCallback((nextSelectedRowKeys: React.Key[]) => {
    setSelectedRowKeys(nextSelectedRowKeys);
  }, []);

  const handleConnectSelected = useCallback(() => {
    if (!selectedCount) {
      message.warning('请先选择要建联的达人');
      return;
    }

    message.info(`建联功能开发中，当前已选择 ${selectedCount} 位达人`);
  }, [selectedCount]);

  const rowSelection = useMemo<TableProps<DouyinSearchRecord>['rowSelection']>(() => ({
    columnWidth: 52,
    fixed: true,
    preserveSelectedRowKeys: true,
    selectedRowKeys,
    onChange: handleSelectionChange,
  }), [handleSelectionChange, selectedRowKeys]);

  const headerActions = useMemo(() => (
    <div className="douyin-creator-header-actions">
      <Popover
        arrow={false}
        content={searchTaskLogContent}
        onOpenChange={setLogPopoverOpen}
        open={logPopoverOpen}
        placement="bottomRight"
        trigger={['hover', 'click']}
      >
        <Button
          aria-label="查看抖音搜索日志"
          className={getAutomationTaskLogTriggerClassName(searchTask)}
          icon={<InfoCircleOutlined />}
          shape="circle"
          type="text"
        />
      </Popover>

      <Popover
        arrow={false}
        content={accountPickerContent}
        onOpenChange={setAccountPickerOpen}
        open={accountPickerOpen}
        placement="bottomLeft"
        trigger="click"
      >
        <Button className="douyin-account-trigger" type="text">
          <span className="douyin-account-trigger-avatar" aria-hidden="true">{displayedAccountAvatar}</span>
          <span className="douyin-account-trigger-name">{displayedAccount?.name || '未选择 Profile'}</span>
          <CaretDownOutlined />
        </Button>
      </Popover>
    </div>
  ), [
    accountPickerContent,
    accountPickerOpen,
    displayedAccount?.name,
    displayedAccountAvatar,
    searchTask,
    searchTaskLogContent,
  ]);

  useEffect(() => {
    setHeaderExtra(headerActions);
    return () => {
      setHeaderExtra(null);
    };
  }, [headerActions, setHeaderExtra]);

  const columns = useMemo(() => {
    const baseColumns = createDouyinStructuredColumns(handleOpenCreatorProfile) || [];
    return baseColumns.map((column) => {
      if (column.key !== 'action') {
        return column;
      }

      return {
        ...column,
        width: 88,
        render: (_value: string | undefined, record: DouyinSearchRecord) => {
          const favorite = favoriteCreatorKeySet.has(getDouyinFavoriteKey(record));
          return (
            <div className="douyin-cell-operation">
              <Tooltip title={favorite ? '取消收藏' : '收藏'}>
                <Button
                  aria-label={favorite ? '取消收藏' : '收藏'}
                  className={`douyin-favorite-button${favorite ? ' is-active' : ''}`}
                  icon={favorite ? <StarFilled /> : <StarOutlined />}
                  onClick={() => {
                    handleToggleFavoriteCreator(record);
                  }}
                  shape="circle"
                  type="text"
                />
              </Tooltip>
            </div>
          );
        },
      };
    });
  }, [favoriteCreatorKeySet, handleOpenCreatorProfile, handleToggleFavoriteCreator]);

  return (
    <div className="douyin-creator-page">
      {!isElectronEgg ? (
        <Alert
          message="当前是 Web 预览模式，抖音达人入口仅支持在 Electron 应用内使用。"
          showIcon
          type="warning"
        />
      ) : null}

      {loginTask ? (
        <Alert
          description={loginTask.status === 'running'
            ? '请在弹出的抖音窗口完成登录，完成后会自动保存为可复用的 Profile。'
            : '正在准备抖音登录窗口。'}
          message="抖音登录进行中"
          showIcon
          type="info"
        />
      ) : null}

      {!accounts.length ? (
        <Alert
          message="请先新增一个 Profile"
          description="每个 Profile 对应一套独立的抖音登录态。右上角点击 Profile 后新增账号，登录成功后会自动保留，下次可直接复用。"
          showIcon
          type="info"
        />
      ) : null}

      <section className="douyin-spotlight-panel">
        <div className="douyin-spotlight-bar">
          <Input
            className="douyin-command-input"
            disabled={!isElectronEgg || running || isSwitchingProfile}
            onChange={(event) => setKeyword(event.target.value)}
            onPressEnter={() => {
              void handleSearch();
            }}
            placeholder="输入达人昵称、抖音号或业务关键词，直接打开抖音 PC 搜索"
            prefix={<SearchOutlined />}
            value={keyword}
          />
          <Button
            className="douyin-search-button"
            disabled={!isElectronEgg || isSwitchingProfile}
            icon={<SearchOutlined />}
            loading={running || isLoadingMore}
            onClick={() => {
              void handleSearch();
            }}
            shape="circle"
            type="primary"
          />
        </div>
      </section>

      <section className="douyin-results-panel" ref={resultsPanelRef}>
        <div className="douyin-results-panel-header" ref={resultsHeaderRef}>
          <div>
            <Typography.Title level={4}>达人搜索结果</Typography.Title>
            <Typography.Paragraph type="secondary">
              {getLastSearchKeyword(searchTask)
                ? `当前展示 “${getLastSearchKeyword(searchTask)}” 的抖音达人搜索结果。`
                : '当前搜索会绑定到选中的 Profile，并在下方展示抖音达人搜索结果。'}
            </Typography.Paragraph>
          </div>
        </div>

        <div className="douyin-results-panel-body">
        {searchResults.length ? (
          <div className="douyin-results-toolbar">
            <div className="douyin-results-toolbar-meta">
              已选择 {selectedCount} 位达人
            </div>
            <Button
              className="douyin-results-toolbar-action"
              disabled={!selectedCount}
              onClick={handleConnectSelected}
              type="primary"
            >
              建联
            </Button>
          </div>
        ) : null}
        {searchResults.length ? (
          <CreatorResultsTable
            className="douyin-search-results-table"
            columns={columns}
            dataSource={searchResults}
            loading={running || isLoadingMore}
            locale={{ emptyText: running ? '正在搜索抖音达人' : '暂无达人搜索结果' }}
            pagination={false}
            platform="douyin"
            rowKey={getDouyinResultRowKey}
            rowSelection={rowSelection}
            resultsMode={{
              type: 'infinite',
              infiniteScroll: {
                disabled: running || !hasMoreResults,
                loading: isLoadingMore,
                onLoadMore: () => {
                  void handleLoadMore();
                },
              },
            }}
            scroll={{ x: 1180, y: resultsTableScrollY }}
            size="middle"
            tableLayout="auto"
          />
        ) : (
          <Empty description={running ? '正在搜索抖音达人' : '暂无达人搜索结果'} image={Empty.PRESENTED_IMAGE_SIMPLE} />
        )}
        </div>
      </section>
    </div>
  );
}
