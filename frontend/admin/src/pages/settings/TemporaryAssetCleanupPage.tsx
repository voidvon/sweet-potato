import { SettingOutlined } from '@ant-design/icons';
import { Button, Tabs, Tooltip, message } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import {
  deleteOrphanContentFiles,
  deleteTemporaryAssets,
  getTemporaryAssetDiskSpace,
  inspectOrphanContentFiles,
  listTemporaryAssetCleanupCandidates,
  listTemporaryAssetCleanupLogs,
  runTemporaryAssetCleanup,
  type OrphanContentFileInspection,
  type TemporaryAssetCleanupCandidate,
  type TemporaryAssetCleanupLog,
} from '../../api/content-cleanup';
import { ContentStudioLayout } from '../../layouts/ContentStudioLayout';
import { useWorkspaceHeader } from '../../layouts/ProtectedLayout';
import { CleanupCandidatesTable } from './temporary-asset-cleanup/CleanupCandidatesTable';
import { CleanupLogsTable } from './temporary-asset-cleanup/CleanupLogsTable';
import { CleanupSettingsModal } from './temporary-asset-cleanup/CleanupSettingsModal';
import { OrphanInspectionModal } from './temporary-asset-cleanup/OrphanInspectionModal';
import { formatDiskSpace } from './temporary-asset-cleanup/cleanupFormatters';
import './TemporaryAssetCleanupPage.scss';

export function TemporaryAssetCleanupPage() {
  const { setHeaderExtra } = useWorkspaceHeader();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [candidates, setCandidates] = useState<TemporaryAssetCleanupCandidate[]>([]);
  const [logs, setLogs] = useState<TemporaryAssetCleanupLog[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [availableDiskBytes, setAvailableDiskBytes] = useState<number | null>(null);
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [checkingOrphans, setCheckingOrphans] = useState(false);
  const [orphanInspection, setOrphanInspection] = useState<OrphanContentFileInspection | null>(null);
  const [selectedOrphanPaths, setSelectedOrphanPaths] = useState<string[]>([]);
  const [deletingOrphans, setDeletingOrphans] = useState(false);

  useEffect(() => {
    setHeaderExtra(
      <Tooltip title="清理设置">
        <Button
          aria-label="清理设置"
          className="temporary-cleanup-header-settings"
          icon={<SettingOutlined />}
          onClick={() => setSettingsOpen(true)}
          type="text"
        />
      </Tooltip>,
    );
    return () => setHeaderExtra(null);
  }, [setHeaderExtra]);

  async function loadData(nextPage = page, nextPageSize = pageSize) {
    setLoading(true);
    try {
      const [candidateResult, cleanupLogs, diskSpace] = await Promise.all([
        listTemporaryAssetCleanupCandidates(nextPage, nextPageSize),
        listTemporaryAssetCleanupLogs(),
        getTemporaryAssetDiskSpace(),
      ]);
      setCandidates(candidateResult.items);
      setPage(candidateResult.page);
      setPageSize(candidateResult.pageSize);
      setTotal(candidateResult.total);
      setLogs(cleanupLogs);
      setAvailableDiskBytes(diskSpace.availableBytes);
      setSelectedAssetIds([]);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '临时素材清理数据加载失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData(1, 20);
  }, []);

  const expiredTotal = useMemo(
    () => candidates.filter((item) => new Date(item.expiresAt).getTime() <= Date.now()).length,
    [candidates],
  );

  async function handleDeleteAssets(assetIds: string[]) {
    setDeleting(true);
    try {
      const result = await deleteTemporaryAssets(assetIds);
      if (result.deleted) {
        message.success(`已删除 ${result.deleted} 条临时素材`);
      } else {
        message.warning('所选素材已不存在或已被引用');
      }
      const nextPage = assetIds.length >= candidates.length ? Math.max(1, page - 1) : page;
      await loadData(nextPage, pageSize);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '临时素材删除失败');
    } finally {
      setDeleting(false);
    }
  }

  async function handleCleanup() {
    setCleaning(true);
    try {
      const result = await runTemporaryAssetCleanup();
      message.success(result.deleted ? `已清理 ${result.deleted} 条临时素材` : '当前没有已过期素材');
      await loadData(1, pageSize);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '临时素材清理失败');
    } finally {
      setCleaning(false);
    }
  }

  async function handleInspectOrphanFiles() {
    setCheckingOrphans(true);
    try {
      const result = await inspectOrphanContentFiles();
      setOrphanInspection(result);
      setSelectedOrphanPaths([]);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '孤立文件检查失败');
    } finally {
      setCheckingOrphans(false);
    }
  }

  async function handleDeleteOrphanFiles(relativePaths: string[]) {
    setDeletingOrphans(true);
    try {
      const result = await deleteOrphanContentFiles(relativePaths);
      if (result.deleted) {
        message.success(`已删除 ${result.deleted} 个孤立文件`);
      } else {
        message.warning('所选文件已不存在或已被数据库引用');
      }
      setOrphanInspection(await inspectOrphanContentFiles());
      setSelectedOrphanPaths([]);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '孤立文件删除失败');
    } finally {
      setDeletingOrphans(false);
    }
  }

  return (
    <ContentStudioLayout>
      <section className="settings-page temporary-cleanup-page">
        <div className="temporary-cleanup-toolbar">
          <div className="temporary-cleanup-summary">
            <span>磁盘剩余空间 <strong>{formatDiskSpace(availableDiskBytes)}</strong></span>
            <span>待清理 <strong>{total}</strong></span>
            <span>当前页已过期 <strong className={expiredTotal ? 'is-danger' : ''}>{expiredTotal}</strong></span>
            <span>日志 <strong>{logs.length}</strong></span>
          </div>
        </div>

        <Tabs items={[
          {
            key: 'pending',
            label: `待清理 (${total})`,
            children: (
              <CleanupCandidatesTable
                candidates={candidates}
                checkingOrphans={checkingOrphans}
                cleaning={cleaning}
                deleting={deleting}
                loading={loading}
                onCleanup={() => void handleCleanup()}
                onDelete={(assetIds) => void handleDeleteAssets(assetIds)}
                onInspectOrphans={() => void handleInspectOrphanFiles()}
                onPageChange={(nextPage, nextPageSize) => void loadData(nextPage, nextPageSize)}
                onRefresh={() => void loadData()}
                onSelectionChange={setSelectedAssetIds}
                page={page}
                pageSize={pageSize}
                selectedAssetIds={selectedAssetIds}
                total={total}
              />
            ),
          },
          {
            key: 'logs',
            label: `清理日志 (${logs.length}/100)`,
            children: <CleanupLogsTable loading={loading} logs={logs} onRefresh={() => void loadData()} />,
          },
        ]} />

        <OrphanInspectionModal
          deleting={deletingOrphans}
          inspection={orphanInspection}
          onClose={() => setOrphanInspection(null)}
          onDelete={(paths) => void handleDeleteOrphanFiles(paths)}
          onSelectionChange={setSelectedOrphanPaths}
          selectedPaths={selectedOrphanPaths}
        />
        <CleanupSettingsModal
          onClose={() => setSettingsOpen(false)}
          onSaved={() => void loadData(1, pageSize)}
          open={settingsOpen}
        />
      </section>
    </ContentStudioLayout>
  );
}
