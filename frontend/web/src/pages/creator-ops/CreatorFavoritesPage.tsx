import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Tag, Tooltip, Typography, message } from 'antd';
import { StarFilled } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import {
  focusAutomationProfileWindow,
  getAutomationTask,
  isElectronEgg,
  startAutomationTask,
  type AutomationTask,
} from '../../ipc';
import { useWorkspaceHeader } from '../../layouts/ProtectedLayout';
import { routePaths } from '../../routes/paths';
import { AutomationTaskLogTrigger } from './AutomationTaskLogTrigger';
import { CreatorInfoCell } from './CreatorInfoCell';
import { CreatorResultsTable, type CreatorSearchResult } from './CreatorResultsTable';
import { CreatorResultsSection } from './CreatorResultsSection';
import { writeCreatorPendingOpenRequest } from './creatorPendingOpenStorage';
import {
  type DouyinFavoriteCreatorRecord,
  type FavoriteSourcePlatform,
  formatDouyinFavoriteId,
  getFavoriteSourceLabel,
  readFavoriteCreatorRecords,
  writeFavoriteCreatorRecords,
} from './douyinFavoriteCreatorsStorage';
import { useRemainingTableHeight } from './useRemainingTableHeight';
import './CreatorFavoritesPage.scss';

const TASK_POLL_INTERVAL_MS = 400;
const FOCUS_DELAY_MS = 240;
const DOUYIN_CONNECT_CREATORS_ADAPTER = 'douyin-connect-creators';
const DEFAULT_DOUYIN_CONNECT_MESSAGE = '你好，我们这边有合作需求，想和你进一步沟通，方便回复一下吗？';

const FAVORITE_OPEN_PROFILE_ADAPTER: Record<DouyinFavoriteCreatorRecord['sourcePlatform'], string> = {
  buyin: 'buyin-open-profile',
  douyin: 'douyin-open-profile',
  xingtu: 'xingtu-open-profile',
};

const FAVORITE_SOURCE_ROUTE_MAP: Record<DouyinFavoriteCreatorRecord['sourcePlatform'], string> = {
  buyin: routePaths.buyinCreators,
  douyin: routePaths.douyinCreators,
  xingtu: routePaths.xingtuCreators,
};

const FAVORITE_SOURCE_SELECTED_PROFILE_KEY_MAP: Record<DouyinFavoriteCreatorRecord['sourcePlatform'], string> = {
  buyin: 'buyin_creator_selected_profile_id',
  douyin: 'douyin_creator_selected_profile_id',
  xingtu: 'xingtu_creator_selected_profile_id',
};

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createAutomationTaskError(task: AutomationTask): Error {
  return new Error(task.error || (task.status === 'canceled' ? '任务已取消' : '任务未完成'));
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

function isProfileBusyMessage(messageText: string) {
  return messageText.includes('Profile 正在被任务使用') || messageText.includes('正在被任务使用');
}

function getFavoriteCreatorInfoVariant(sourcePlatform: FavoriteSourcePlatform) {
  if (sourcePlatform === 'douyin') {
    return 'douyin';
  }

  return sourcePlatform;
}

export function CreatorFavoritesPage() {
  const navigate = useNavigate();
  const { setHeaderExtra } = useWorkspaceHeader();
  const [favorites, setFavorites] = useState<DouyinFavoriteCreatorRecord[]>(() => readFavoriteCreatorRecords());
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [openingFavoriteKeys, setOpeningFavoriteKeys] = useState<string[]>([]);
  const [connectTask, setConnectTask] = useState<AutomationTask | null>(null);
  const resultsPanelRef = useRef<HTMLElement | null>(null);
  const resultsHeaderRef = useRef<HTMLDivElement | null>(null);
  const resultsTableScrollY = useRemainingTableHeight(
    resultsPanelRef,
    resultsHeaderRef,
    [favorites.length],
    { gap: 22, minHeight: 240 },
  );

  useEffect(() => {
    const syncFavorites = () => {
      setFavorites(readFavoriteCreatorRecords());
    };

    window.addEventListener('storage', syncFavorites);
    return () => {
      window.removeEventListener('storage', syncFavorites);
    };
  }, []);

  const selectedCount = selectedRowKeys.length;

  const rowSelection = useMemo(() => ({
    columnWidth: 52,
    fixed: true,
    preserveSelectedRowKeys: true,
    selectedRowKeys,
    onChange: (nextSelectedRowKeys: React.Key[]) => {
      setSelectedRowKeys(nextSelectedRowKeys);
    },
  }), [selectedRowKeys]);

  const handleOpenFavoriteProfile = useCallback(async (record: DouyinFavoriteCreatorRecord) => {
    const href = String(record.href || '').trim();
    const profileId = String(record.profileId || '').trim();
    const adapter = FAVORITE_OPEN_PROFILE_ADAPTER[record.sourcePlatform];

    if (!href) {
      message.warning('当前收藏没有主页地址');
      return;
    }

    if (!profileId) {
      message.warning('当前收藏缺少对应 Profile，无法保持登录态打开');
      return;
    }

    if (!isElectronEgg) {
      window.open(href, '_blank', 'noopener,noreferrer');
      return;
    }

    if (openingFavoriteKeys.includes(record.favoriteKey)) {
      return;
    }

    setOpeningFavoriteKeys((current) => [...current, record.favoriteKey]);
    try {
      const result = await startAutomationTask({
        adapter,
        profileId,
        input: { url: href },
      });

      if (!result.ok || !result.taskId) {
        throw new Error(result.message || '打开收藏主页失败');
      }

      await waitForTaskDone(result.taskId);
      message.success(`已使用 ${record.profileName || getFavoriteSourceLabel(record.sourcePlatform)} 打开主页`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '打开收藏主页失败';
      if (isProfileBusyMessage(errorMessage)) {
        window.localStorage.setItem(FAVORITE_SOURCE_SELECTED_PROFILE_KEY_MAP[record.sourcePlatform], profileId);
        writeCreatorPendingOpenRequest(record.sourcePlatform, {
          creatorName: record.name,
          href,
          profileId,
        });
        navigate(FAVORITE_SOURCE_ROUTE_MAP[record.sourcePlatform]);
        await wait(FOCUS_DELAY_MS);
        const focusResult = await focusAutomationProfileWindow(profileId);
        if (!focusResult.ok) {
          message.warning(focusResult.message || '已跳转到对应页面，但未能聚焦自动化窗口');
          return;
        }
        message.info(`对应 Profile 已在${getFavoriteSourceLabel(record.sourcePlatform)}页面打开，已为你跳转并聚焦窗口`);
        return;
      }

      message.error(errorMessage);
    } finally {
      setOpeningFavoriteKeys((current) => current.filter((item) => item !== record.favoriteKey));
    }
  }, [navigate, openingFavoriteKeys]);

  const columns = useMemo(() => ([
    {
      dataIndex: 'name',
      key: 'creatorInfo',
      title: '达人信息',
      minWidth: 280,
      render: (_value: string, record: CreatorSearchResult) => {
        const favoriteRecord = record as DouyinFavoriteCreatorRecord;
        return (
          <CreatorInfoCell
            onOpenProfile={() => {
              void handleOpenFavoriteProfile(favoriteRecord);
            }}
            record={{
              ...record,
              badges: favoriteRecord.sourcePlatform === 'douyin'
                ? record.badges
                : [
                  getFavoriteSourceLabel(favoriteRecord.sourcePlatform),
                  ...(record.badges || []),
                ],
            }}
            variant={getFavoriteCreatorInfoVariant(favoriteRecord.sourcePlatform)}
          />
        );
      },
    },
    {
      dataIndex: 'douyinId',
      key: 'douyinId',
      title: '抖音号',
      width: 180,
      render: (value: string | undefined) => formatDouyinFavoriteId(value) || '-',
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
      title: '简介',
      width: 320,
      render: (value: string | undefined, record: CreatorSearchResult) => value || record.summary || '-',
    },
    {
      dataIndex: 'favoritedAt',
      key: 'favoritedAt',
      title: '收藏时间',
      width: 180,
      render: (value: string | undefined) => value ? new Date(value).toLocaleString() : '-',
    },
    {
      key: 'action',
      title: '操作',
      width: 88,
      render: (_value: unknown, record: CreatorSearchResult) => {
        const favoriteRecord = record as DouyinFavoriteCreatorRecord;
        return (
          <div className="creator-favorites-cell-action">
            <Tooltip title="取消收藏">
              <Button
                aria-label="取消收藏"
                className="creator-favorites-remove-button"
                icon={<StarFilled />}
                onClick={() => {
                  const favoriteKey = favoriteRecord.favoriteKey;
                  const nextFavorites = favorites.filter((item) => item.favoriteKey !== favoriteKey);
                  setFavorites(nextFavorites);
                  writeFavoriteCreatorRecords(nextFavorites);
                }}
                shape="circle"
                type="text"
              />
            </Tooltip>
          </div>
        );
      },
    },
  ]), [favorites, handleOpenFavoriteProfile]);

  const handleConnectSelected = useCallback(async () => {
    if (!selectedCount) {
      return;
    }

    if (!isElectronEgg) {
      message.warning('当前仅支持在 Electron 中执行达人建联');
      return;
    }

    const selectedKeySet = new Set(selectedRowKeys.map((item) => String(item)));
    const selectedRecords = favorites.filter((record) => selectedKeySet.has(record.favoriteKey));
    const douyinRecords = selectedRecords.filter((record) => record.sourcePlatform === 'douyin');
    const skippedCount = selectedRecords.length - douyinRecords.length;

    if (!douyinRecords.length) {
      message.warning('当前选中项里没有可执行的抖音达人');
      return;
    }

    const groupedByProfile = new Map<string, DouyinFavoriteCreatorRecord[]>();
    for (const record of douyinRecords) {
      const profileId = String(record.profileId || '').trim();
      const href = String(record.href || '').trim();
      if (!profileId || !href) {
        continue;
      }

      const current = groupedByProfile.get(profileId) || [];
      current.push(record);
      groupedByProfile.set(profileId, current);
    }

    if (!groupedByProfile.size) {
      message.warning('选中的达人缺少可用的 Profile 或主页地址');
      return;
    }

    let totalSuccess = 0;
    let totalFail = 0;

    for (const [profileId, records] of groupedByProfile.entries()) {
      const creators = records
        .map((record) => ({
          href: String(record.href || '').trim(),
          name: String(record.name || '').trim(),
        }))
        .filter((record) => record.href);

      if (!creators.length) {
        continue;
      }

      const started = await startAutomationTask({
        adapter: DOUYIN_CONNECT_CREATORS_ADAPTER,
        profileId,
        input: {
          creators,
          messageTemplate: DEFAULT_DOUYIN_CONNECT_MESSAGE,
        },
      });

      if (!started.ok || !started.taskId) {
        throw new Error(started.message || '启动达人建联任务失败');
      }

      setConnectTask(started.task || null);
      const doneTask = await waitForTaskDone(started.taskId, setConnectTask);
      const result = doneTask.result && typeof doneTask.result === 'object'
        ? doneTask.result as { successCount?: number; failCount?: number }
        : {};
      totalSuccess += Number(result.successCount || 0);
      totalFail += Number(result.failCount || 0);
    }

    if (totalFail > 0 || skippedCount > 0) {
      message.warning(`建联完成，成功 ${totalSuccess} 位，失败 ${totalFail} 位，跳过 ${skippedCount} 位`);
      return;
    }

    message.success(`建联完成，已发送 ${totalSuccess} 位达人`);
  }, [favorites, selectedCount, selectedRowKeys]);

  const headerActions = useMemo(() => (
    <div className="creator-favorites-header-actions">
      <AutomationTaskLogTrigger
        emptyText="暂无达人建联日志"
        label="最近一次达人建联"
        task={connectTask}
      />
    </div>
  ), [connectTask]);

  useEffect(() => {
    setHeaderExtra(headerActions);
    return () => {
      setHeaderExtra(null);
    };
  }, [headerActions, setHeaderExtra]);

  return (
    <div className="creator-favorites-page">
      <section className="creator-favorites-panel" ref={resultsPanelRef}>
        <div className="creator-favorites-panel-header" ref={resultsHeaderRef}>
          <div>
            <Typography.Title level={4}>达人收藏</Typography.Title>
            <Typography.Paragraph type="secondary">
              收藏会保留来源平台和对应 Profile，打开主页时会复用对应登录态。
            </Typography.Paragraph>
          </div>
          <div className="creator-favorites-panel-header-actions">
            <Tag color="gold">{favorites.length} 位</Tag>
          </div>
        </div>
        <div className="creator-favorites-panel-body">
          <CreatorResultsSection
            actionDisabled={!selectedCount}
            emptyDescription="暂无收藏达人"
            hasResults={favorites.length > 0}
            onAction={handleConnectSelected}
            selectedCount={selectedCount}
            table={(
              <CreatorResultsTable
                className="creator-favorites-table"
                columns={columns}
                dataSource={favorites}
                loading={false}
                pagination={false}
                platform="douyin"
                rowKey={(record) => (record as DouyinFavoriteCreatorRecord).favoriteKey}
                rowSelection={rowSelection}
                scroll={{ x: 1180, y: resultsTableScrollY }}
                size="middle"
                tableLayout="auto"
              />
            )}
          />
        </div>
      </section>
    </div>
  );
}
