import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button,
  Dropdown,
  Empty,
  Flex,
  Image,
  Input,
  Modal,
  Popconfirm,
  Radio,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  Upload,
  message,
} from 'antd';
import type { MenuProps, TableColumnsType, UploadProps } from 'antd';
import {
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  ImagePlus,
  Play,
  Plus,
  RotateCcw,
  Trash2,
  UploadCloud,
} from 'lucide-react';
import {
  addBatchRows,
  createBatchGenerationEventSource,
  createBatchSheet,
  deleteBatchRow,
  deleteBatchSheet,
  getBatchRun,
  getBatchGenerationAsset,
  getBatchSheet,
  listBatchCapabilities,
  listBatchGenerationModelOptions,
  listBatchRuns,
  listBatchSheets,
  retryBatchRun,
  startBatchRun,
  updateBatchRow,
  updateBatchSheet,
  uploadBatchGenerationAsset,
} from '../../api/batch-generation';
import type {
  BatchAttempt,
  BatchExecutionStatus,
  BatchGenerationModelOption,
  BatchRow,
  BatchRunDetail,
  BatchSheetDetail,
  BatchSheetSummary,
  CreativeCapability,
  CreativeCapabilityField,
} from '../../api/batch-generation';
import { resolveAssetUrl } from '../../api/request';
import type { ContentAsset } from '../../types';
import './BatchGenerationPage.scss';

const MAX_ROWS = 200;

const capabilityColors = [
  '#3f82ef', '#ec4899', '#0ea5e9', '#f43f5e', '#06b6d4', '#f59e0b',
  '#f97316', '#10b981', '#a855f7', '#d946ef', '#e11d48', '#14b8a6',
  '#eab308', '#6366f1', '#7c3aed', '#0284c7', '#db2777', '#ea580c',
];

const statusMeta: Record<BatchExecutionStatus, { color: string; label: string }> = {
  idle: { color: 'default', label: '待提交' },
  queued: { color: 'processing', label: '排队中' },
  running: { color: 'processing', label: '处理中' },
  completed: { color: 'success', label: '已完成' },
  partial_failed: { color: 'warning', label: '部分失败' },
  failed: { color: 'error', label: '失败' },
  canceled: { color: 'default', label: '已取消' },
};

const resolutionOptions = [
  { label: '1K', value: '1K' },
  { label: '2K', value: '2K' },
  { label: '4K', value: '4K' },
];
const aspectRatioOptions = ['auto', '1:1', '3:4', '4:3', '9:16', '16:9'].map((value) => ({ label: value, value }));
const outputCountOptions = [1, 2, 3, 4].map((value) => ({ label: `${value} 张`, value }));
const durationOptions = [5, 10, 15].map((value) => ({ label: `${value} 秒`, value: `${value}秒` }));

function generateSheetName(label: string) {
  const now = new Date();
  const timestamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0'),
  ].join('');
  return `${label}-${timestamp}`;
}

function valueAt(params: Record<string, unknown>, key: string) {
  const parts = key.split('.');
  let current: unknown = params;
  for (const part of parts) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function withValue(params: Record<string, unknown>, key: string, value: unknown) {
  const parts = key.split('.');
  const result = { ...params };
  let target = result;
  parts.forEach((part, index) => {
    if (index === parts.length - 1) {
      target[part] = value;
      return;
    }
    const existing = target[part];
    const next = existing && typeof existing === 'object' && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {};
    target[part] = next;
    target = next;
  });
  return result;
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function rowAssetIds(rows: BatchRow[], capability?: CreativeCapability) {
  const assetFields = capability?.rowFields.filter((field) => field.valueType === 'asset' || field.valueType === 'asset-list') || [];
  return [...new Set(rows.flatMap((row) => assetFields.flatMap((field) => {
    const value = valueAt(row.params, field.key);
    return field.valueType === 'asset-list' ? stringArray(value) : typeof value === 'string' ? [value] : [];
  })).filter(Boolean))];
}

function assetAccept(field: CreativeCapabilityField) {
  if (/Video/i.test(field.key)) return 'video/*';
  if (/Audio/i.test(field.key)) return 'audio/*';
  return 'image/*';
}

function assetLabel(field: CreativeCapabilityField) {
  if (/Video/i.test(field.key)) return '视频';
  if (/Audio/i.test(field.key)) return '音频';
  return '图片';
}

export function BatchGenerationPage() {
  const [capabilities, setCapabilities] = useState<CreativeCapability[]>([]);
  const [sheets, setSheets] = useState<BatchSheetSummary[]>([]);
  const [activeSheetId, setActiveSheetId] = useState('');
  const [detail, setDetail] = useState<BatchSheetDetail | null>(null);
  const [rows, setRows] = useState<BatchRow[]>([]);
  const [dirtyRowIds, setDirtyRowIds] = useState<string[]>([]);
  const [globalParams, setGlobalParams] = useState<Record<string, unknown>>({});
  const [globalDirty, setGlobalDirty] = useState(false);
  const [selectedRowIds, setSelectedRowIds] = useState<string[]>([]);
  const [latestRun, setLatestRun] = useState<BatchRunDetail | null>(null);
  const [assets, setAssets] = useState<Record<string, ContentAsset>>({});
  const [modelOptions, setModelOptions] = useState<BatchGenerationModelOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [uploadingCell, setUploadingCell] = useState('');
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [selectedCapabilityKey, setSelectedCapabilityKey] = useState('');
  const [newSheetName, setNewSheetName] = useState('');
  const [suggestedSheetName, setSuggestedSheetName] = useState('');

  const activeCapability = useMemo(
    () => capabilities.find((item) => item.key === detail?.sheet.capabilityKey),
    [capabilities, detail?.sheet.capabilityKey],
  );
  const selectedCapability = capabilities.find((item) => item.key === selectedCapabilityKey) || capabilities[0];
  const activeSheet = sheets.find((sheet) => sheet.id === activeSheetId);
  const selectedRows = rows.filter((row) => selectedRowIds.includes(row.id));
  const hasUnsavedChanges = globalDirty || dirtyRowIds.length > 0;

  const loadAssetsById = useCallback(async (ids: string[]) => {
    const uniqueIds = [...new Set(ids.filter(Boolean))];
    if (!uniqueIds.length) return;
    const loaded = await Promise.all(uniqueIds.map((id) => getBatchGenerationAsset(id).catch(() => null)));
    setAssets((current) => ({
      ...current,
      ...Object.fromEntries(loaded.filter((asset): asset is ContentAsset => Boolean(asset)).map((asset) => [asset.id, asset])),
    }));
  }, []);

  const loadAttemptAssets = useCallback(async (attempts: BatchAttempt[]) => {
    await loadAssetsById(attempts.flatMap((attempt) => attempt.outputs.map((output) => output.assetId)));
  }, [loadAssetsById]);

  const loadLatestRun = useCallback(async (sheetId: string) => {
    const runs = await listBatchRuns(sheetId);
    if (!runs[0]) {
      setLatestRun(null);
      return;
    }
    const run = await getBatchRun(runs[0].id);
    setLatestRun(run);
    await loadAttemptAssets(run.attempts);
  }, [loadAttemptAssets]);

  const loadSheet = useCallback(async (sheetId: string, capabilityList = capabilities) => {
    const next = await getBatchSheet(sheetId);
    setDetail(next);
    setRows(next.rows);
    setGlobalParams(next.sheet.globalParams);
    setDirtyRowIds([]);
    setGlobalDirty(false);
    setSelectedRowIds([]);
    const capability = capabilityList.find((item) => item.key === next.sheet.capabilityKey);
    await loadAssetsById(rowAssetIds(next.rows, capability));
    await loadAttemptAssets(next.latestAttempts);
    await loadLatestRun(sheetId);
  }, [capabilities, loadAssetsById, loadAttemptAssets, loadLatestRun]);

  const loadInitialData = useCallback(async () => {
    setLoading(true);
    try {
      const [capabilityList, sheetList, availableModelOptions] = await Promise.all([
        listBatchCapabilities(),
        listBatchSheets(),
        listBatchGenerationModelOptions(),
      ]);
      setCapabilities(capabilityList);
      setSheets(sheetList);
      setModelOptions(availableModelOptions);
      const firstCapability = capabilityList[0];
      if (firstCapability) {
        setSelectedCapabilityKey(firstCapability.key);
        setSuggestedSheetName(generateSheetName(firstCapability.label));
      }
      const targetSheetId = sheetList.find((sheet) => sheet.id === activeSheetId)?.id || sheetList[0]?.id || '';
      setActiveSheetId(targetSheetId);
      if (targetSheetId) await loadSheet(targetSheetId, capabilityList);
      else setCreateModalOpen(Boolean(firstCapability));
    } catch (error) {
      message.error(error instanceof Error ? error.message : '批量表格加载失败');
    } finally {
      setLoading(false);
    }
  }, [activeSheetId, loadSheet]);

  useEffect(() => { void loadInitialData(); }, []);

  useEffect(() => {
    const source = createBatchGenerationEventSource();
    const handleRun = (event: MessageEvent<string>) => {
      try {
        const run = JSON.parse(event.data) as BatchRunDetail;
        if (run.sheetId !== activeSheetId) return;
        setLatestRun(run);
        void loadAttemptAssets(run.attempts);
        if (['completed', 'partial_failed', 'failed', 'canceled'].includes(run.status)) {
          setRunning(false);
          void loadSheet(activeSheetId);
        }
      } catch {
        // Ignore malformed realtime events and keep the current table state.
      }
    };
    source.addEventListener('run', handleRun as EventListener);
    return () => source.close();
  }, [activeSheetId, loadAttemptAssets, loadSheet]);

  function attemptForRow(rowId: string) {
    return latestRun?.attempts.find((attempt) => attempt.rowId === rowId)
      || detail?.latestAttempts.find((attempt) => attempt.rowId === rowId);
  }

  function updateRowParams(rowId: string, key: string, value: unknown) {
    setRows((current) => current.map((row) => row.id === rowId
      ? { ...row, params: withValue(row.params, key, value), validationStatus: 'draft', validationErrors: [] }
      : row));
    setDirtyRowIds((current) => current.includes(rowId) ? current : [...current, rowId]);
  }

  async function saveChanges() {
    if (!detail) return false;
    setSaving(true);
    try {
      let nextSheet = detail.sheet;
      if (globalDirty) {
        nextSheet = await updateBatchSheet(detail.sheet.id, { globalParams, revision: detail.sheet.revision });
      }
      const changedRows = rows.filter((row) => dirtyRowIds.includes(row.id));
      const updatedRows = await Promise.all(changedRows.map((row) => updateBatchRow(detail.sheet.id, row.id, {
        params: row.params,
        revision: row.revision,
      })));
      const updatedById = new Map(updatedRows.map((row) => [row.id, row]));
      setRows((current) => current.map((row) => updatedById.get(row.id) || row));
      setDetail((current) => current ? { ...current, sheet: nextSheet } : current);
      setDirtyRowIds([]);
      setGlobalDirty(false);
      message.success('已保存');
      return true;
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存失败');
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function addRow(params: Record<string, unknown> = {}) {
    if (!detail || rows.length >= MAX_ROWS) return;
    try {
      const created = await addBatchRows(detail.sheet.id, [params]);
      setRows((current) => [...current, ...created]);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '新增行失败');
    }
  }

  async function copySelectedRows() {
    if (!detail || !selectedRows.length) return;
    try {
      const created = await addBatchRows(
        detail.sheet.id,
        selectedRows.slice(0, MAX_ROWS - rows.length).map((row) => row.params),
      );
      setRows((current) => [...current, ...created]);
      setSelectedRowIds([]);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '复制行失败');
    }
  }

  async function removeRow(row: BatchRow) {
    if (!detail) return;
    try {
      await deleteBatchRow(detail.sheet.id, row.id);
      await loadSheet(detail.sheet.id);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '删除行失败');
    }
  }

  async function runRows(rowIds?: string[]) {
    if (!detail) return;
    if (hasUnsavedChanges && !await saveChanges()) return;
    setRunning(true);
    try {
      const run = await startBatchRun(detail.sheet.id, rowIds);
      setLatestRun(run);
      message.success('任务已提交');
      await loadSheet(detail.sheet.id);
    } catch (error) {
      setRunning(false);
      message.error(error instanceof Error ? error.message : '任务提交失败');
    }
  }

  async function retryFailed() {
    if (!latestRun) return;
    setRunning(true);
    try {
      const run = await retryBatchRun(latestRun.id);
      setLatestRun(run);
      message.success('失败行已重新提交');
    } catch (error) {
      setRunning(false);
      message.error(error instanceof Error ? error.message : '重试失败');
    }
  }

  async function uploadAssets(row: BatchRow, field: CreativeCapabilityField, files: File[]) {
    const cellKey = `${row.id}:${field.key}`;
    setUploadingCell(cellKey);
    try {
      const uploaded = await Promise.all(files.map((file) => uploadBatchGenerationAsset({
        file,
        sheetId: detail?.sheet.id || '',
        fieldKey: field.key,
      })));
      setAssets((current) => ({
        ...current,
        ...Object.fromEntries(uploaded.map((asset) => [asset.id, asset])),
      }));
      const uploadedIds = uploaded.map((asset) => asset.id);
      if (field.valueType === 'asset-list') {
        const currentIds = stringArray(valueAt(row.params, field.key));
        updateRowParams(row.id, field.key, [...new Set([...currentIds, ...uploadedIds])]);
      } else {
        updateRowParams(row.id, field.key, uploadedIds[0]);
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : '素材上传失败');
    } finally {
      setUploadingCell('');
    }
  }

  async function createSheet(enterSheet: boolean) {
    if (!selectedCapability) return;
    try {
      const sheet = await createBatchSheet({
        name: newSheetName.trim() || suggestedSheetName,
        capabilityKey: selectedCapability.key,
      });
      const createdRows = await addBatchRows(sheet.id, [{}]);
      const summary: BatchSheetSummary = {
        ...sheet,
        rowCount: createdRows.length,
        completedCount: 0,
        failedCount: 0,
        runningCount: 0,
      };
      setSheets((current) => [...current, summary]);
      setCreateModalOpen(false);
      setNewSheetName('');
      if (enterSheet || !activeSheetId) {
        setActiveSheetId(sheet.id);
        await loadSheet(sheet.id);
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : '表格创建失败');
    }
  }

  async function removeSheet(sheetId: string) {
    if (sheets.length <= 1) return;
    try {
      await deleteBatchSheet(sheetId);
      const next = sheets.filter((sheet) => sheet.id !== sheetId);
      setSheets(next);
      if (sheetId === activeSheetId) {
        setActiveSheetId(next[0].id);
        await loadSheet(next[0].id);
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : '表格删除失败');
    }
  }

  function renderAssetField(field: CreativeCapabilityField, row: BatchRow) {
    const storedValue = valueAt(row.params, field.key);
    const ids = field.valueType === 'asset-list'
      ? stringArray(storedValue)
      : typeof storedValue === 'string' && storedValue ? [storedValue] : [];
    const uploadProps: UploadProps = {
      accept: assetAccept(field),
      beforeUpload: (_file, fileList) => {
        if (_file.uid === fileList[0]?.uid) {
          const files = field.valueType === 'asset-list' ? fileList : fileList.slice(0, 1);
          void uploadAssets(row, field, files as unknown as File[]);
        }
        return Upload.LIST_IGNORE;
      },
      multiple: field.valueType === 'asset-list',
      showUploadList: false,
    };
    return (
      <Space size={6} wrap>
        {ids.map((id) => {
          const asset = assets[id];
          return (
            <Tag
              closable={!['queued', 'running'].includes(row.executionStatus)}
              key={id}
              onClose={(event) => {
                event.preventDefault();
                const nextIds = ids.filter((assetId) => assetId !== id);
                updateRowParams(row.id, field.key, field.valueType === 'asset-list' ? nextIds : undefined);
              }}
            >
              {asset?.name || asset?.originalFileName || `${assetLabel(field)} ${ids.indexOf(id) + 1}`}
            </Tag>
          );
        })}
        <Upload {...uploadProps}>
          <Button
            aria-label={`添加${field.label}`}
            disabled={['queued', 'running'].includes(row.executionStatus)}
            icon={<UploadCloud size={15} />}
            loading={uploadingCell === `${row.id}:${field.key}`}
            size="small"
            type="dashed"
          >
            添加
          </Button>
        </Upload>
      </Space>
    );
  }

  function renderBusinessField(field: CreativeCapabilityField, row: BatchRow) {
    const value = valueAt(row.params, field.key);
    if (field.valueType === 'asset' || field.valueType === 'asset-list') return renderAssetField(field, row);
    if (field.key === 'modelConfigId') {
      const models = modelOptions.filter((model) => model.type === activeCapability?.mediaKind);
      return (
        <Select
          allowClear
          onChange={(next) => updateRowParams(row.id, field.key, next)}
          options={models.map((model) => ({ label: model.name, value: model.id }))}
          placeholder="使用全局模型"
          value={value as string | undefined}
        />
      );
    }
    if (field.key === 'resolution') return <Select allowClear onChange={(next) => updateRowParams(row.id, field.key, next)} options={resolutionOptions} placeholder="使用全局设置" value={value as string | undefined} />;
    if (field.key === 'aspectRatio') return <Select allowClear onChange={(next) => updateRowParams(row.id, field.key, next)} options={aspectRatioOptions} placeholder="使用全局设置" value={value as string | undefined} />;
    if (field.key === 'outputCount') return <Select allowClear onChange={(next) => updateRowParams(row.id, field.key, next)} options={outputCountOptions} placeholder="使用全局设置" value={value as number | undefined} />;
    if (field.key === 'duration') return <Select allowClear onChange={(next) => updateRowParams(row.id, field.key, next)} options={durationOptions} placeholder="使用全局设置" value={value as string | undefined} />;
    if (field.valueType === 'boolean') {
      return <Switch checked={value === true} onChange={(checked) => updateRowParams(row.id, field.key, checked)} size="small" />;
    }
    if (field.valueType === 'number') {
      return <Input onChange={(event) => updateRowParams(row.id, field.key, Number(event.target.value))} type="number" value={Number(value || 0)} />;
    }
    return (
      <Input.TextArea
        autoSize={{ minRows: 1, maxRows: 4 }}
        onChange={(event) => updateRowParams(row.id, field.key, event.target.value)}
        placeholder={field.required ? `请输入${field.label}` : `选填：${field.label}`}
        value={String(value || '')}
      />
    );
  }

  function renderResults(row: BatchRow) {
    const attempt = attemptForRow(row.id);
    if (!attempt?.outputs.length) {
      return attempt?.errorMessage
        ? <Tooltip title={attempt.errorMessage}><Typography.Text type="danger">查看错误</Typography.Text></Tooltip>
        : <Typography.Text type="secondary">-</Typography.Text>;
    }
    return (
      <Space size={6}>
        {attempt.outputs.map((output) => {
          const asset = assets[output.assetId];
          const url = resolveAssetUrl(asset?.fileUrl);
          if (asset?.mimeType.startsWith('image/') && url) {
            return <Image height={36} key={output.id} src={url} width={36} />;
          }
          return (
            <Button
              disabled={!url}
              href={url || undefined}
              icon={<ExternalLink size={14} />}
              key={output.id}
              rel="noreferrer"
              size="small"
              target="_blank"
              type="link"
            >
              查看
            </Button>
          );
        })}
      </Space>
    );
  }

  const columns = useMemo<TableColumnsType<BatchRow>>(() => {
    const rowFields = activeCapability?.rowFields || [];
    const rowFieldKeys = new Set(rowFields.map((field) => field.key));
    const overrideFields = (activeCapability?.globalFields || [])
      .filter((field) => field.overridable && !rowFieldKeys.has(field.key))
      .map((field) => ({ ...field, label: `${field.label}（覆盖）` }));
    const businessColumns: TableColumnsType<BatchRow> = [...rowFields, ...overrideFields].map((field) => ({
      key: field.key,
      render: (_value, row) => renderBusinessField(field, row),
      title: <span>{field.label}{field.required ? <b> *</b> : null}</span>,
      width: field.valueType === 'asset-list' || field.valueType === 'asset' ? 220 : 300,
    }));
    return [
      { key: 'index', render: (_value, _row, index) => index + 1, title: '#', width: 58 },
      ...businessColumns,
      {
        key: 'status',
        render: (_value, row) => {
          const status = attemptForRow(row.id)?.status || row.executionStatus;
          return <Tag color={statusMeta[status].color}>{statusMeta[status].label}</Tag>;
        },
        title: '状态',
        width: 105,
      },
      { key: 'result', render: (_value, row) => renderResults(row), title: '结果', width: 150 },
      {
        key: 'credits',
        render: (_value, row) => attemptForRow(row.id)?.actualCredits ?? row.actualCredits ?? 0,
        title: '消耗积分',
        width: 100,
      },
      {
        fixed: 'right',
        key: 'actions',
        render: (_value, row) => (
          <Space size={2}>
            <Tooltip title="执行此行"><Button disabled={['queued', 'running'].includes(row.executionStatus)} icon={<Play size={14} />} onClick={() => void runRows([row.id])} size="small" type="text" /></Tooltip>
            <Popconfirm onConfirm={() => void removeRow(row)} title="确认删除这一行？"><Tooltip title="删除"><Button disabled={['queued', 'running'].includes(row.executionStatus)} icon={<Trash2 size={14} />} size="small" type="text" /></Tooltip></Popconfirm>
          </Space>
        ),
        title: '操作',
        width: 90,
      },
    ];
  }, [activeCapability, assets, detail?.latestAttempts, latestRun, modelOptions, rows, uploadingCell]);

  const rowStats = useMemo(() => {
    const statuses = rows.map((row) => attemptForRow(row.id)?.status || row.executionStatus);
    return {
      completed: statuses.filter((status) => status === 'completed').length,
      failed: statuses.filter((status) => ['failed', 'partial_failed'].includes(status)).length,
      pending: statuses.filter((status) => status === 'idle').length,
      processing: statuses.filter((status) => ['queued', 'running'].includes(status)).length,
    };
  }, [detail?.latestAttempts, latestRun, rows]);

  const activeModelOptions = modelOptions
    .filter((model) => model.type === activeCapability?.mediaKind)
    .map((model) => ({ label: model.name, value: model.id as string }));

  function renderGlobalField(field: CreativeCapabilityField) {
    const value = globalParams[field.key];
    const update = (next: unknown) => {
      setGlobalParams((current) => ({ ...current, [field.key]: next }));
      setGlobalDirty(true);
    };
    if (field.key === 'modelConfigId') return <Select onChange={update} options={activeModelOptions} placeholder="选择模型" value={value as string | undefined} />;
    if (field.key === 'resolution') return <Select onChange={update} options={resolutionOptions} placeholder="分辨率" value={value as string | undefined} />;
    if (field.key === 'aspectRatio') return <Select onChange={update} options={aspectRatioOptions} placeholder="画面比例" value={value as string | undefined} />;
    if (field.key === 'outputCount') return <Select onChange={update} options={outputCountOptions} placeholder="张数" value={value as number | undefined} />;
    if (field.key === 'duration') return <Select onChange={update} options={durationOptions} placeholder="时长" value={value as string | undefined} />;
    if (field.key === 'generateAudio') return <Switch checked={value !== false} onChange={update} size="small" />;
    return <Input onChange={(event) => update(event.target.value)} value={String(value || '')} />;
  }

  const titleMenu: MenuProps['items'] = sheets.map((sheet) => ({
    key: sheet.id,
    label: sheet.name,
    onClick: () => { setActiveSheetId(sheet.id); void loadSheet(sheet.id); },
  }));

  return (
    <main className="sheet-workspace">
      <header className="sheet-workspace__header">
        <div className="sheet-workspace__breadcrumb">
          <span className="sheet-workspace__dot" /><span>表格</span><span className="sheet-workspace__slash">/</span>
          <Dropdown menu={{ items: titleMenu }} trigger={['click']}>
            <button className="sheet-workspace__title-button" type="button"><strong>{activeSheet?.name || '批量生成'}</strong><ChevronDown size={18} /></button>
          </Dropdown>
          <span className="sheet-workspace__slash">/</span>
          <span className="sheet-workspace__new-state"><span className="sheet-workspace__state-dot" />{running ? '执行中' : hasUnsavedChanges ? '未保存' : '已保存'}</span>
        </div>
        <div className="sheet-workspace__header-actions">
          <Button disabled={!latestRun?.failedCount || running} icon={<RotateCcw size={15} />} onClick={() => void retryFailed()}>重试所有失败</Button>
          <Button disabled={!rows.length || running} loading={running} onClick={() => void runRows(selectedRowIds.length ? selectedRowIds : undefined)} type="primary">批量执行</Button>
          <Button disabled={!hasUnsavedChanges} icon={<Check size={16} />} loading={saving} onClick={() => void saveChanges()} type="primary">保存</Button>
        </div>
      </header>

      <Tabs
        activeKey={activeSheetId}
        className="sheet-workspace__tabs"
        items={sheets.map((sheet) => ({
          closable: sheets.length > 1,
          key: sheet.id,
          label: `${sheet.name} · ${sheet.mediaKind === 'image' ? '图片' : '视频'}`,
        }))}
        onChange={(sheetId) => { setActiveSheetId(sheetId); void loadSheet(sheetId); }}
        onEdit={(targetKey, action) => {
          if (action === 'add') {
            const capability = selectedCapability || capabilities[0];
            if (capability) setSuggestedSheetName(generateSheetName(capability.label));
            setCreateModalOpen(true);
          } else if (typeof targetKey === 'string') {
            void removeSheet(targetKey);
          }
        }}
        type="editable-card"
      />

      <section className="sheet-global-settings" aria-label="全局参数">
        <div className="sheet-global-settings__intro"><strong>全局参数</strong><span>应用到所有行，行内可覆盖</span></div>
        <div className="sheet-global-settings__divider" />
        {(activeCapability?.globalFields || []).map((field) => <label key={field.key}>{field.label}{renderGlobalField(field)}</label>)}
      </section>

      <section className="sheet-toolbar" aria-label="表格工具栏">
        <span>{rows.length} / {MAX_ROWS} 行</span><i />
        <Button icon={<Plus size={17} />} onClick={() => void addRow()} type="text">新增行</Button>
        <Button disabled={!selectedRows.length || rows.length >= MAX_ROWS} icon={<Copy size={17} />} onClick={() => void copySelectedRows()} type="text">复制</Button>
      </section>

      <div className="sheet-table-area">
        <section className="sheet-grid" aria-label="批量生成表格">
          <Table
            columns={columns}
            dataSource={rows}
            loading={loading}
            locale={{ emptyText: <Empty description="暂无表格行" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
            pagination={false}
            rowKey="id"
            rowSelection={{ onChange: (keys) => setSelectedRowIds(keys as string[]), selectedRowKeys: selectedRowIds }}
            scroll={{ x: 'max-content', y: 'calc(100vh - 330px)' }}
          />
        </section>
        <section className="sheet-add-row"><Button disabled={rows.length >= MAX_ROWS} icon={<Plus size={20} />} onClick={() => void addRow()} type="dashed">新增一行</Button></section>
      </div>

      <Modal
        centered
        footer={<><Button onClick={() => setCreateModalOpen(false)}>取消</Button><Button disabled={!selectedCapability} onClick={() => void createSheet(false)}>创建</Button><Button disabled={!selectedCapability} onClick={() => void createSheet(true)} type="primary">创建并进入</Button></>}
        onCancel={() => setCreateModalOpen(false)}
        open={createModalOpen}
        title="新建批量表格"
      >
        <Flex gap="middle" vertical>
          <Typography.Paragraph type="secondary">选择功能并命名，一表一功能，创建后不可切换。</Typography.Paragraph>
          <Typography.Text strong>功能类型</Typography.Text>
          {(['image', 'video'] as const).map((mediaKind) => {
            const options = capabilities.filter((capability) => capability.mediaKind === mediaKind);
            return (
              <Flex gap="small" key={mediaKind} vertical>
                <Space><Tag color={mediaKind === 'image' ? 'blue' : 'purple'}>{mediaKind === 'image' ? '图片' : '视频'}</Tag><Typography.Text className="batch-generation-create-modal__count" type="secondary">共 {options.length} 项</Typography.Text></Space>
                <Radio.Group
                  className="batch-generation-create-modal__options"
                  onChange={(event) => {
                    const capability = capabilities.find((item) => item.key === event.target.value);
                    if (!capability) return;
                    setSelectedCapabilityKey(capability.key);
                    setSuggestedSheetName(generateSheetName(capability.label));
                  }}
                  value={selectedCapabilityKey}
                >
                  {options.map((option) => (
                    <Radio.Button key={option.key} value={option.key}><span className="batch-generation-create-modal__option-content"><i style={{ backgroundColor: capabilityColors[capabilities.indexOf(option) % capabilityColors.length] }} />{option.label}</span></Radio.Button>
                  ))}
                </Radio.Group>
              </Flex>
            );
          })}
          <Typography.Text strong>表名 <Typography.Text type="secondary">（可留空按模板生成）</Typography.Text></Typography.Text>
          <Input maxLength={60} onChange={(event) => setNewSheetName(event.target.value)} placeholder={suggestedSheetName} showCount size="large" value={newSheetName} />
        </Flex>
      </Modal>

      <section className="sheet-remaining">剩余可添加&nbsp;<strong>{MAX_ROWS - rows.length}</strong>&nbsp;/ {MAX_ROWS}</section>
      <footer className="sheet-task-stats">
        <span>共 <strong>{rows.length}</strong> 行</span><i />
        <span className="sheet-task-stats__done"><span className="sheet-task-stats__dot" />完成 <strong>{rowStats.completed}</strong></span>
        <span className="sheet-task-stats__processing"><span className="sheet-task-stats__dot" />处理中 <strong>{rowStats.processing}</strong></span>
        <span className="sheet-task-stats__failed"><span className="sheet-task-stats__dot" />失败 <strong>{rowStats.failed}</strong></span>
        <span className="sheet-task-stats__pending"><span className="sheet-task-stats__dot" />待提交 <strong>{rowStats.pending}</strong></span>
        <i /><span>累计消耗 <strong>{detail?.stats.actualCredits || 0}</strong> 积分</span>
        {hasUnsavedChanges ? <><i /><span className="sheet-task-stats__unsaved">有未保存的改动</span></> : null}
      </footer>
    </main>
  );
}
