import { useCallback, useEffect, useMemo, useRef, useState, type Key } from 'react'
import { message, type TableProps } from 'antd'
import {
  getAutomationTask,
  isElectronEgg,
  startAutomationTask,
  stopAutomationProfile,
  type AutomationTask,
} from '../../../ipc'
import {
  DOUYIN_FAVORITE_CREATORS_STORAGE_KEY,
  getDouyinFavoriteKey,
  readFavoriteCreatorKeys,
  readFavoriteCreatorRecords,
  upsertFavoriteCreatorRecord,
  writeFavoriteCreatorKeys,
  writeFavoriteCreatorRecords,
} from '../douyinFavoriteCreatorsStorage'
import {
  clearCreatorPendingOpenRequest,
  readCreatorPendingOpenRequest,
} from '../creatorPendingOpenStorage'
import { useRemainingTableHeight } from '../useRemainingTableHeight'
import {
  DEFAULT_DOUYIN_CONNECT_MESSAGE,
  DOUYIN_CONNECT_CREATORS_ADAPTER,
  DOUYIN_LOAD_MORE_LIMIT,
  DOUYIN_LOGIN_ADAPTER,
  DOUYIN_OPEN_PROFILE_ADAPTER,
  DOUYIN_PROFILE_PREFIX,
  DOUYIN_SEARCH_ADAPTER,
  DOUYIN_SELECTED_PROFILE_KEY,
  DOUYIN_STORAGE_KEY,
  createProfileId,
  dedupeDouyinResults,
  getDouyinResultRowKey,
  getLastSearchKeyword,
  readAccounts,
  readSelectedProfileId,
  toSearchRecord,
  upsertAccount,
  waitForTaskDone,
  writeAccounts,
  writeSelectedProfileId,
} from './pageHelpers'
import type {
  DouyinAccount,
  DouyinLoginResult,
  DouyinSearchRecord,
  OpenDouyinProfileOptions,
} from './pageTypes'

export function useDouyinCreatorSearchController() {
  const [accounts, setAccounts] = useState<DouyinAccount[]>(() => readAccounts(DOUYIN_STORAGE_KEY))
  const [selectedProfileId, setSelectedProfileId] = useState(() => readSelectedProfileId(DOUYIN_SELECTED_PROFILE_KEY))
  const [accountPickerOpen, setAccountPickerOpen] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [running, setRunning] = useState(false)
  const [loginTaskId, setLoginTaskId] = useState<string | null>(null)
  const [loginProfileId, setLoginProfileId] = useState<string | null>(null)
  const [loginTask, setLoginTask] = useState<AutomationTask | null>(null)
  const [searchTask, setSearchTask] = useState<AutomationTask | null>(null)
  const [connectTask, setConnectTask] = useState<AutomationTask | null>(null)
  const [searchResults, setSearchResults] = useState<DouyinSearchRecord[]>([])
  const [selectedRowKeys, setSelectedRowKeys] = useState<Key[]>([])
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [hasMoreResults, setHasMoreResults] = useState(true)
  const [isStartingLogin, setIsStartingLogin] = useState(false)
  const [isSwitchingProfile, setIsSwitchingProfile] = useState(false)
  const [openingProfileIds, setOpeningProfileIds] = useState<string[]>([])
  const [favoriteCreatorKeys, setFavoriteCreatorKeys] = useState<string[]>(
    () => readFavoriteCreatorKeys(DOUYIN_FAVORITE_CREATORS_STORAGE_KEY),
  )
  const isPageActiveRef = useRef(true)
  const selectedProfileIdRef = useRef(selectedProfileId)
  const profileSwitchPromiseRef = useRef<Promise<void>>(Promise.resolve())
  const completedLoginTaskIdsRef = useRef(new Set<string>())
  const isLoadingMoreRef = useRef(false)
  const lastSearchKeywordRef = useRef('')
  const resultsPanelRef = useRef<HTMLElement | null>(null)
  const resultsHeaderRef = useRef<HTMLDivElement | null>(null)
  const isLoginRunning = Boolean(loginTaskId)
  const resultsTableScrollY = useRemainingTableHeight(
    resultsPanelRef,
    resultsHeaderRef,
    [searchResults.length],
    { gap: 22, minHeight: 240 },
  )

  const selectedAccount = accounts.find((account) => account.profileId === selectedProfileId) || null
  const displayedAccount = selectedAccount || accounts[0] || null
  const favoriteCreatorKeySet = useMemo(() => new Set(favoriteCreatorKeys), [favoriteCreatorKeys])
  const displayedAccountAvatar = displayedAccount?.name?.trim().slice(0, 1) || '抖'
  const selectedCount = selectedRowKeys.length

  useEffect(() => {
    isPageActiveRef.current = true
    return () => {
      isPageActiveRef.current = false
    }
  }, [])

  useEffect(() => {
    selectedProfileIdRef.current = selectedProfileId
  }, [selectedProfileId])

  useEffect(() => {
    isLoadingMoreRef.current = isLoadingMore
  }, [isLoadingMore])

  useEffect(() => {
    writeAccounts(DOUYIN_STORAGE_KEY, accounts)
  }, [accounts])

  useEffect(() => {
    writeFavoriteCreatorKeys(favoriteCreatorKeys)
  }, [favoriteCreatorKeys])

  useEffect(() => {
    if (!accounts.length) {
      if (selectedProfileId) {
        setSelectedProfileId('')
        selectedProfileIdRef.current = ''
        writeSelectedProfileId(DOUYIN_SELECTED_PROFILE_KEY, '')
      }
      return
    }

    if (!selectedProfileId || !accounts.some((account) => account.profileId === selectedProfileId)) {
      setSelectedProfileId(accounts[0].profileId)
      selectedProfileIdRef.current = accounts[0].profileId
      writeSelectedProfileId(DOUYIN_SELECTED_PROFILE_KEY, accounts[0].profileId)
    }
  }, [accounts, selectedProfileId])

  const waitForPendingProfileSwitch = useCallback(async () => {
    await profileSwitchPromiseRef.current.catch(() => {})
  }, [])

  const selectAccountProfile = useCallback(async (profileId: string) => {
    const nextProfileId = profileId.trim()
    if (!nextProfileId) {
      return
    }

    const queued = profileSwitchPromiseRef.current
      .catch(() => {})
      .then(async () => {
        if (!isPageActiveRef.current) {
          return
        }

        setIsSwitchingProfile(true)
        const previousProfileId = selectedProfileIdRef.current.trim()

        selectedProfileIdRef.current = nextProfileId
        setSelectedProfileId(nextProfileId)
        writeSelectedProfileId(DOUYIN_SELECTED_PROFILE_KEY, nextProfileId)
        setAccountPickerOpen(false)

        if (isElectronEgg && previousProfileId && previousProfileId !== nextProfileId) {
          const stopResult = await stopAutomationProfile(previousProfileId, 'douyin')
          if (isPageActiveRef.current && !stopResult.ok) {
            message.warning(stopResult.message || '关闭旧 Profile 窗口失败')
          }
        }
      })
      .finally(() => {
        if (isPageActiveRef.current) {
          setIsSwitchingProfile(false)
        }
      })

    profileSwitchPromiseRef.current = queued
    await queued
  }, [])

  useEffect(() => {
    if (!loginTaskId || !loginProfileId) {
      return undefined
    }

    let stopped = false
    let syncing = false
    const syncTask = async () => {
      if (syncing) {
        return
      }

      syncing = true
      const result = await getAutomationTask(loginTaskId)
      syncing = false

      if (stopped) {
        return
      }

      if (!result.ok || !result.task) {
        stopped = true
        message.error(result.message || '获取抖音登录状态失败')
        setLoginTaskId(null)
        setLoginProfileId(null)
        setLoginTask(null)
        return
      }

      setLoginTask(result.task)
      if (result.task.status === 'done') {
        if (completedLoginTaskIdsRef.current.has(result.task.id)) {
          stopped = true
          setLoginTaskId(null)
          setLoginProfileId(null)
          setLoginTask(null)
          return
        }

        completedLoginTaskIdsRef.current.add(result.task.id)
        stopped = true
        const taskResult = (result.task.result || {}) as DouyinLoginResult
        const nickname = typeof taskResult.nickname === 'string' ? taskResult.nickname.trim() : ''

        if (!nickname) {
          message.error('抖音登录成功，但未读取到账号名称')
        } else {
          const nextAccount: DouyinAccount = {
            id: loginProfileId,
            name: nickname,
            profileId: loginProfileId,
            status: 'logged_in',
            createdAt: new Date().toISOString(),
          }

          setAccounts((current) => upsertAccount(current, nextAccount))
          await selectAccountProfile(loginProfileId)
          message.success(`抖音账号已登录：${nickname}`)
        }

        setLoginTaskId(null)
        setLoginProfileId(null)
        setLoginTask(null)
        return
      }

      if (result.task.status === 'canceled') {
        stopped = true
        message.info('抖音登录窗口已关闭，未新增账号')
        setLoginTaskId(null)
        setLoginProfileId(null)
        setLoginTask(null)
        return
      }

      if (result.task.status === 'failed') {
        stopped = true
        message.error(result.task.error || '抖音登录失败')
        setLoginTaskId(null)
        setLoginProfileId(null)
        setLoginTask(null)
      }
    }

    void syncTask()
    const timer = window.setInterval(syncTask, 1000)
    return () => {
      stopped = true
      window.clearInterval(timer)
    }
  }, [loginProfileId, loginTaskId, selectAccountProfile])

  const handleAddAccount = useCallback(async () => {
    if (!isElectronEgg) {
      message.warning('抖音登录只能在 Electron 应用内进行')
      return
    }

    if (isLoginRunning) {
      message.warning('已有抖音登录窗口正在处理')
      return
    }

    const profileId = createProfileId(DOUYIN_PROFILE_PREFIX)
    setIsStartingLogin(true)
    const result = await startAutomationTask({
      adapter: DOUYIN_LOGIN_ADAPTER,
      profileId,
      input: {},
    })
    setIsStartingLogin(false)

    if (!result.ok || !result.taskId) {
      message.error(result.message || '打开抖音登录窗口失败')
      return
    }

    setLoginProfileId(profileId)
    setLoginTaskId(result.taskId)
    setLoginTask(result.task || null)
    setAccountPickerOpen(false)
    message.info('请在新窗口完成抖音登录')
  }, [isLoginRunning])

  const handleSelectAccount = useCallback(async (account: DouyinAccount) => {
    await selectAccountProfile(account.profileId)
  }, [selectAccountProfile])

  const handleOpenProfile = useCallback(async (account: DouyinAccount) => {
    await waitForPendingProfileSwitch()
    if (!isElectronEgg) {
      message.warning('只能在 Electron 应用内打开抖音主页')
      return
    }

    if (openingProfileIds.includes(account.profileId)) {
      return
    }

    setOpeningProfileIds((value) => [...value, account.profileId])
    try {
      const result = await startAutomationTask({
        adapter: DOUYIN_OPEN_PROFILE_ADAPTER,
        profileId: account.profileId,
        input: {},
      })

      if (!result.ok || !result.taskId) {
        message.error(result.message || '打开抖音主页失败')
        return
      }

      await waitForTaskDone(result.taskId)
      if (!isPageActiveRef.current) {
        return
      }

      message.success(`已打开 ${account.name} 的抖音主页`)
    } catch (error) {
      if (!isPageActiveRef.current) {
        return
      }

      message.error(error instanceof Error ? error.message : '打开抖音主页失败')
    } finally {
      if (isPageActiveRef.current) {
        setOpeningProfileIds((value) => value.filter((profileId) => profileId !== account.profileId))
      }
    }
  }, [openingProfileIds, waitForPendingProfileSwitch])

  const handleOpenCreatorProfile = useCallback(async ({ href, creatorName }: OpenDouyinProfileOptions) => {
    const profileId = selectedProfileIdRef.current.trim() || displayedAccount?.profileId || ''
    const normalizedHref = String(href || '').trim()

    if (!normalizedHref) {
      return
    }

    await waitForPendingProfileSwitch()
    if (!isElectronEgg) {
      message.warning('鍙兘鍦?Electron 搴旂敤鍐呬娇鐢ㄥ綋鍓?Profile 鎵撳紑涓婚〉')
      return
    }

    if (!profileId) {
      message.warning('璇峰厛閫夋嫨涓€涓?Profile')
      return
    }

    if (openingProfileIds.includes(profileId)) {
      return
    }

    setOpeningProfileIds((value) => [...value, profileId])
    try {
      const result = await startAutomationTask({
        adapter: DOUYIN_OPEN_PROFILE_ADAPTER,
        profileId,
        input: { url: normalizedHref },
      })

      if (!result.ok || !result.taskId) {
        message.error(result.message || '鎵撳紑鎶栭煶杈句汉涓婚〉澶辫触')
        return
      }

      await waitForTaskDone(result.taskId)
      if (!isPageActiveRef.current) {
        return
      }

      message.success(`宸蹭娇鐢ㄥ綋鍓?Profile 鎵撳紑${creatorName || '杈句汉'}涓婚〉`)
    } catch (error) {
      if (!isPageActiveRef.current) {
        return
      }

      message.error(error instanceof Error ? error.message : '鎵撳紑鎶栭煶杈句汉涓婚〉澶辫触')
    } finally {
      if (isPageActiveRef.current) {
        setOpeningProfileIds((value) => value.filter((item) => item !== profileId))
      }
    }
  }, [displayedAccount?.profileId, openingProfileIds, waitForPendingProfileSwitch])

  useEffect(() => {
    const pendingRequest = readCreatorPendingOpenRequest('douyin')
    if (!pendingRequest) {
      return
    }

    if (pendingRequest.profileId !== selectedProfileIdRef.current.trim()) {
      return
    }

    clearCreatorPendingOpenRequest('douyin')
    void handleOpenCreatorProfile({
      href: pendingRequest.href,
      creatorName: pendingRequest.creatorName,
    })
  }, [handleOpenCreatorProfile, selectedProfileId])

  const handleToggleFavoriteCreator = useCallback((record: DouyinSearchRecord) => {
    const favoriteKey = getDouyinFavoriteKey(record)
    const profileId = selectedProfileIdRef.current.trim() || displayedAccount?.profileId || ''
    const profileName = displayedAccount?.name || record.profileName || ''
    let nextFavorite = false

    setFavoriteCreatorKeys((current) => {
      if (current.includes(favoriteKey)) {
        nextFavorite = false
        return current.filter((item) => item !== favoriteKey)
      }

      nextFavorite = true
      return [...current, favoriteKey]
    })

    const currentRecords = readFavoriteCreatorRecords()
    if (nextFavorite) {
      writeFavoriteCreatorRecords(upsertFavoriteCreatorRecord(
        currentRecords,
        {
          ...record,
          profileName,
        },
        {
          profileId,
          profileName,
          sourcePlatform: 'douyin',
        },
      ))
    } else {
      writeFavoriteCreatorRecords(currentRecords.filter((item) => item.favoriteKey !== favoriteKey))
    }

    message.success(nextFavorite ? '已收藏' : '已取消收藏')
  }, [displayedAccount?.name, displayedAccount?.profileId])

  const runSearch = useCallback(async (nextKeyword: string) => {
    const normalizedKeyword = nextKeyword.trim()
    const profileId = selectedProfileIdRef.current.trim() || displayedAccount?.profileId || ''
    const profileName = displayedAccount?.name || ''

    if (!normalizedKeyword) {
      message.warning('请输入抖音达人关键词')
      return
    }

    if (!profileId) {
      message.warning('请先新增并选择一个 Profile')
      return
    }

    await waitForPendingProfileSwitch()
    setRunning(true)
    setHasMoreResults(true)
    setSelectedRowKeys([])
    try {
      const started = await startAutomationTask({
        adapter: DOUYIN_SEARCH_ADAPTER,
        profileId,
        input: { keyword: normalizedKeyword, limit: DOUYIN_LOAD_MORE_LIMIT },
      })

      if (!started.ok || !started.taskId) {
        throw new Error(started.message || '启动抖音搜索失败')
      }

      if (started.task) {
        setSearchTask(started.task)
      }

      const doneTask = await waitForTaskDone(started.taskId, setSearchTask)
      setSearchTask(doneTask)
      const taskResult = toSearchRecord(doneTask, profileName, normalizedKeyword)
      setSearchResults(dedupeDouyinResults(taskResult.results || []))
      setHasMoreResults(taskResult.hasMore !== false)
      lastSearchKeywordRef.current = taskResult.keyword || normalizedKeyword
      message.success(`已使用 ${profileName || '当前 Profile'} 打开抖音搜索页`)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '打开抖音搜索失败')
    } finally {
      setRunning(false)
    }
  }, [displayedAccount?.name, displayedAccount?.profileId, waitForPendingProfileSwitch])

  const handleSearch = useCallback(async () => {
    await runSearch(keyword)
  }, [keyword, runSearch])

  const handleLoadMore = useCallback(async () => {
    const normalizedKeyword = lastSearchKeywordRef.current.trim()
      || getLastSearchKeyword(searchTask).trim()
      || keyword.trim()
    const profileId = selectedProfileIdRef.current.trim() || displayedAccount?.profileId || ''
    const profileName = displayedAccount?.name || ''

    if (!normalizedKeyword || !profileId || running || isLoadingMoreRef.current || !hasMoreResults) {
      return
    }

    await waitForPendingProfileSwitch()
    setIsLoadingMore(true)
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
      })

      if (!started.ok || !started.taskId) {
        throw new Error(started.message || '继续加载抖音达人失败')
      }

      if (started.task) {
        setSearchTask(started.task)
      }

      const doneTask = await waitForTaskDone(started.taskId, setSearchTask)
      setSearchTask(doneTask)
      const taskResult = toSearchRecord(doneTask, profileName, normalizedKeyword)
      const appendedResults = taskResult.results || []

      setSearchResults((current) => dedupeDouyinResults([...current, ...appendedResults]))
      setHasMoreResults(taskResult.hasMore !== false)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '继续加载抖音达人失败')
    } finally {
      if (isPageActiveRef.current) {
        setIsLoadingMore(false)
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
  ])

  const handleSelectionChange = useCallback((nextSelectedRowKeys: Key[]) => {
    setSelectedRowKeys(nextSelectedRowKeys)
  }, [])

  const handleConnectSelectedAction = useCallback(async () => {
    if (!selectedCount) {
      message.warning('请先选择要建联的达人')
      return
    }

    if (!isElectronEgg) {
      message.warning('当前仅支持在 Electron 中执行抖音建联')
      return
    }

    const profileId = selectedProfileIdRef.current.trim()
    if (!profileId) {
      message.warning('请先选择用于建联的 Profile')
      return
    }

    const selectedKeySet = new Set(selectedRowKeys.map((item) => String(item)))
    const selectedRecords = searchResults.filter((record) => selectedKeySet.has(getDouyinResultRowKey(record)))
    const creators = selectedRecords
      .map((record) => ({
        href: String(record.href || '').trim(),
        name: String(record.name || '').trim(),
      }))
      .filter((record) => record.href)

    if (!creators.length) {
      message.warning('选中的达人缺少主页地址，无法建联')
      return
    }

    try {
      const started = await startAutomationTask({
        adapter: DOUYIN_CONNECT_CREATORS_ADAPTER,
        profileId,
        input: {
          creators,
          messageTemplate: DEFAULT_DOUYIN_CONNECT_MESSAGE,
        },
      })

      if (!started.ok || !started.taskId) {
        throw new Error(started.message || '启动抖音建联任务失败')
      }

      setConnectTask(started.task || null)
      const doneTask = await waitForTaskDone(started.taskId, setConnectTask)
      const result = doneTask.result && typeof doneTask.result === 'object'
        ? doneTask.result as { successCount?: number; failCount?: number }
        : {}
      const successCount = Number(result.successCount || 0)
      const failCount = Number(result.failCount || 0)
      if (failCount > 0) {
        message.warning(`建联完成，成功 ${successCount} 位，失败 ${failCount} 位，请查看日志`)
        return
      }
      message.success(`建联完成，已发送 ${successCount} 位达人`)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '抖音建联失败')
    }
  }, [searchResults, selectedCount, selectedRowKeys])

  const rowSelection = useMemo<TableProps<DouyinSearchRecord>['rowSelection']>(() => ({
    columnWidth: 52,
    fixed: true,
    preserveSelectedRowKeys: true,
    selectedRowKeys,
    onChange: handleSelectionChange,
  }), [handleSelectionChange, selectedRowKeys])

  return {
    accountPickerOpen,
    accounts,
    connectTask,
    displayedAccount,
    displayedAccountAvatar,
    favoriteCreatorKeySet,
    handleAddAccount,
    handleConnectSelectedAction,
    handleLoadMore,
    handleOpenCreatorProfile,
    handleOpenProfile,
    handleSearch,
    handleSelectAccount,
    handleToggleFavoriteCreator,
    hasMoreResults,
    isElectronEgg,
    isLoadingMore,
    isLoginRunning,
    isStartingLogin,
    isSwitchingProfile,
    keyword,
    loginTask,
    openingProfileIds,
    resultsHeaderRef,
    resultsPanelRef,
    resultsTableScrollY,
    rowSelection,
    running,
    searchResults,
    searchTask,
    selectedCount,
    setAccountPickerOpen,
    setKeyword,
  }
}

export type DouyinCreatorSearchController = ReturnType<typeof useDouyinCreatorSearchController>
