import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AllCommunityModule,
  ModuleRegistry,
  themeQuartz,
} from 'ag-grid-community';
import type { ColDef, ICellRendererParams, ValueSetterParams } from 'ag-grid-community';
import { AgGridReact } from 'ag-grid-react';
import {
  Button,
  Dropdown,
  Flex,
  Image,
  Input,
  Modal,
  Popconfirm,
  Popover,
  Radio,
  Select,
  Space,
  Switch,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  Upload,
  message,
} from 'antd';
import type { MenuProps, UploadProps } from 'antd';
import {
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  Play,
  Plus,
  RotateCcw,
  Scan,
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
import {
  ImageOutputSizePicker,
  getImageResolutionOptions,
  imageAspectRatioOptions,
  type ImageAspectRatio,
  type ImageResolution,
} from '../../components/ImageOutputSizePicker';
import type { ContentAsset } from '../../types';
import './BatchGenerationPage.scss';

const MAX_ROWS = 200;
const LOCAL_ROW_ID_PREFIX = 'local-row:';

ModuleRegistry.registerModules([AllCommunityModule]);

const batchGridTheme = themeQuartz.withParams({
  accentColor: '#3f82ef',
  borderColor: '#e8edf5',
  fontFamily: 'inherit',
  fontSize: 13,
  headerBackgroundColor: '#f8fafd',
  headerFontWeight: 600,
  rowBorder: { color: '#e8edf5' },
  spacing: 6,
});

function isLocalRow(row: BatchRow) {
  return row.id.startsWith(LOCAL_ROW_ID_PREFIX);
}

function withRowPositions(rows: BatchRow[]) {
  return rows.map((row, position) => row.position === position ? row : { ...row, position });
}

function createLocalRow(sheetId: string, params: Record<string, unknown>, position: number): BatchRow {
  const now = new Date().toISOString();
  return {
    id: `${LOCAL_ROW_ID_PREFIX}${globalThis.crypto.randomUUID()}`,
    sheetId,
    position,
    params: { ...params },
    validationStatus: 'draft',
    validationErrors: [],
    executionStatus: 'idle',
    latestAttemptId: null,
    actualCredits: 0,
    revision: 1,
    createdAt: now,
    updatedAt: now,
  };
}

type GridSelectOption = {
  label: string;
  value: string | number;
};

type GridSelectCellProps = {
  disabled?: boolean;
  label: string;
  onOpen: (anchor: HTMLElement) => void;
};

type ActiveGridSelect = {
  anchor: { height: number; left: number; top: number; width: number };
  fieldKey: string;
  options: GridSelectOption[];
  rowId: string;
  value?: string | number;
};

type ActiveGridTooltip = {
  anchor: { height: number; left: number; top: number; width: number };
  title: string;
};

function GridSelectCell({
  disabled,
  label,
  onOpen,
}: GridSelectCellProps) {
  return (
    <div
      aria-disabled={disabled}
      className={`batch-generation-grid-select-cell${disabled ? ' batch-generation-grid-select-cell--disabled' : ''}`}
      onKeyDown={(event) => {
        if (!disabled && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          onOpen(event.currentTarget);
        }
      }}
      onPointerDown={(event) => {
        event.stopPropagation();
        if (!disabled) onOpen(event.currentTarget);
      }}
      role="button"
      tabIndex={disabled ? -1 : 0}
    >
      <span className="batch-generation-grid-select-cell__value">{label}</span>
      <ChevronDown aria-hidden="true" size={14} />
    </div>
  );
}

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

const imageResolutionOptions = [
  { label: '1K', value: '1K' },
  { label: '2K', value: '2K' },
  { label: '4K', value: '4K' },
];
const videoResolutionOptions = imageResolutionOptions;
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

function defaultGlobalParamsForCapability(
  capability: CreativeCapability,
  availableModels: BatchGenerationModelOption[],
) {
  const model = availableModels.find((item) => item.type === capability.mediaKind);
  const params: Record<string, unknown> = {};
  if (model) params.modelConfigId = model.id;
  if (capability.mediaKind === 'image') {
    params.aspectRatio = 'auto';
    const resolution = getImageResolutionOptions(model)[0];
    if (resolution) params.resolution = resolution;
    if (capability.globalFields.some((field) => field.key === 'outputCount')) params.outputCount = 1;
  }
  return params;
}

export function BatchGenerationPage() {
  const gridRef = useRef<AgGridReact<BatchRow>>(null);
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
  const [activeGridSelect, setActiveGridSelect] = useState<ActiveGridSelect | null>(null);
  const [activeGridTooltip, setActiveGridTooltip] = useState<ActiveGridTooltip | null>(null);

  const showGridTooltip = useCallback((target: HTMLElement, title: string) => {
    const rect = target.getBoundingClientRect();
    setActiveGridTooltip({
      anchor: { height: rect.height, left: rect.left, top: rect.top, width: rect.width },
      title,
    });
  }, []);
  const hideGridTooltip = useCallback(() => setActiveGridTooltip(null), []);

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
    if (!selectedRowIds.length) gridRef.current?.api?.deselectAll();
  }, [selectedRowIds.length]);

  useEffect(() => {
    if (!activeGridSelect) return;
    const closeSelect = () => setActiveGridSelect(null);
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('.batch-generation-grid-select-cell')) return;
      if (target.closest('.batch-generation-grid-select-popup')) return;
      closeSelect();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeSelect();
    };
    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('resize', closeSelect);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('resize', closeSelect);
    };
  }, [activeGridSelect]);

  useEffect(() => {
    if (!activeGridTooltip) return;
    window.addEventListener('resize', hideGridTooltip);
    window.addEventListener('scroll', hideGridTooltip, true);
    return () => {
      window.removeEventListener('resize', hideGridTooltip);
      window.removeEventListener('scroll', hideGridTooltip, true);
    };
  }, [activeGridTooltip, hideGridTooltip]);

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
      if (globalDirty) {
        const nextSheet = await updateBatchSheet(detail.sheet.id, { globalParams, revision: detail.sheet.revision });
        setDetail((current) => current ? { ...current, sheet: nextSheet } : current);
        setGlobalDirty(false);
      }
      const changedRows = rows.filter((row) => dirtyRowIds.includes(row.id));
      for (const row of changedRows.filter((item) => !isLocalRow(item))) {
        const updated = await updateBatchRow(detail.sheet.id, row.id, {
          params: row.params,
          revision: row.revision,
        });
        setRows((current) => current.map((item) => item.id === row.id ? updated : item));
        setDirtyRowIds((current) => current.filter((id) => id !== row.id));
      }
      for (const row of rows.filter(isLocalRow)) {
        const [created] = await addBatchRows(detail.sheet.id, [row.params], row.position);
        if (!created) throw new Error('新增行保存失败');
        setRows((current) => withRowPositions(current.map((item) => item.id === row.id ? created : item)));
        setDirtyRowIds((current) => current.filter((id) => id !== row.id));
      }
      await loadSheet(detail.sheet.id);
      message.success('已保存');
      return true;
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存失败');
      return false;
    } finally {
      setSaving(false);
    }
  }

  function addRow(params: Record<string, unknown> = {}) {
    if (!detail || rows.length >= MAX_ROWS) return;
    const created = createLocalRow(detail.sheet.id, params, rows.length);
    setRows((current) => [...current, created]);
    setDirtyRowIds((current) => [...current, created.id]);
  }

  function copySelectedRows() {
    if (!detail || !selectedRows.length) return;
    const created = selectedRows
      .slice(0, MAX_ROWS - rows.length)
      .map((row, index) => createLocalRow(detail.sheet.id, row.params, rows.length + index));
    setRows((current) => [...current, ...created]);
    setDirtyRowIds((current) => [...current, ...created.map((row) => row.id)]);
    setSelectedRowIds([]);
  }

  function copyRow(row: BatchRow) {
    if (!detail || rows.length >= MAX_ROWS) return;
    const index = rows.findIndex((item) => item.id === row.id);
    if (index < 0) return;
    const created = createLocalRow(detail.sheet.id, row.params, index + 1);
    setRows((current) => withRowPositions([
      ...current.slice(0, index + 1),
      created,
      ...current.slice(index + 1),
    ]));
    setDirtyRowIds((current) => [...current, created.id]);
    setSelectedRowIds([]);
  }

  async function removeRow(row: BatchRow) {
    if (!detail) return;
    if (isLocalRow(row)) {
      setRows((current) => withRowPositions(current.filter((item) => item.id !== row.id)));
      setDirtyRowIds((current) => current.filter((id) => id !== row.id));
      setSelectedRowIds((current) => current.filter((id) => id !== row.id));
      return;
    }
    try {
      await deleteBatchRow(detail.sheet.id, row.id);
      setRows((current) => withRowPositions(current.filter((item) => item.id !== row.id)));
      setDirtyRowIds((current) => current.filter((id) => id !== row.id));
      setSelectedRowIds((current) => current.filter((id) => id !== row.id));
    } catch (error) {
      message.error(error instanceof Error ? error.message : '删除行失败');
    }
  }

  async function runRows(rowIds?: string[]) {
    if (!detail) return;
    if (hasUnsavedChanges) {
      message.warning('请先保存当前改动再执行');
      return;
    }
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
        globalParams: defaultGlobalParamsForCapability(selectedCapability, modelOptions),
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

  function renderResults(row: BatchRow) {
    const attempt = attemptForRow(row.id);
    if (!attempt?.outputs.length) {
      return attempt?.errorMessage
        ? (
          <Typography.Text
            onBlur={hideGridTooltip}
            onFocus={(event) => showGridTooltip(event.currentTarget, attempt.errorMessage!)}
            onMouseEnter={(event) => showGridTooltip(event.currentTarget, attempt.errorMessage!)}
            onMouseLeave={hideGridTooltip}
            tabIndex={0}
            type="danger"
          >
            查看错误
          </Typography.Text>
        )
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

  const columns = useMemo<ColDef<BatchRow>[]>(() => {
    const rowFields = activeCapability?.rowFields || [];
    const rowFieldKeys = new Set(rowFields.map((field) => field.key));
    const overrideFields = (activeCapability?.globalFields || [])
      .filter((field) => field.overridable && !rowFieldKeys.has(field.key))
      .map((field) => ({ ...field, isGlobalOverride: true, label: `${field.label}（覆盖）` }));
    const businessColumns: ColDef<BatchRow>[] = [...rowFields, ...overrideFields].map((field) => {
      const isAsset = field.valueType === 'asset-list' || field.valueType === 'asset';
      const effectiveValue = (row: BatchRow) => {
        const rowValue = valueAt(row.params, field.key);
        return rowValue === undefined && 'isGlobalOverride' in field
          ? valueAt(globalParams, field.key)
          : rowValue;
      };
      const selectOptions = field.key === 'modelConfigId'
        ? modelOptions
          .filter((model) => model.type === activeCapability?.mediaKind)
          .map((model) => ({ label: model.name, value: model.id as string | number }))
        : field.key === 'resolution' ? imageResolutionOptions
          : field.key === 'aspectRatio' ? aspectRatioOptions
            : field.key === 'outputCount' ? outputCountOptions
              : field.key === 'duration' ? durationOptions
                : [];
      const selectLabels = new Map<string | number, string>(selectOptions.map((option) => [option.value, option.label]));
      const valueSetter = (params: ValueSetterParams<BatchRow>) => {
        if (!params.data) return false;
        const nextValue = params.newValue === '' || params.newValue === null
          ? undefined
          : field.valueType === 'number' ? Number(params.newValue) : params.newValue;
        updateRowParams(params.data.id, field.key, nextValue);
        return true;
      };

      return {
        autoHeight: isAsset || (!selectOptions.length && field.valueType === 'string'),
        cellEditor: field.valueType === 'number' ? 'agNumberCellEditor'
            : field.valueType === 'string' ? 'agLargeTextCellEditor'
              : undefined,
        cellEditorParams: field.valueType === 'string'
          ? { cols: 50, maxLength: 10000, rows: 6 }
          : undefined,
        cellEditorPopup: !selectOptions.length && field.valueType === 'string',
        cellRenderer: isAsset
          ? (params: ICellRendererParams<BatchRow>) => params.data ? renderAssetField(field, params.data) : null
          : field.valueType === 'boolean'
            ? (params: ICellRendererParams<BatchRow>) => params.data ? (
              <Switch
                checked={effectiveValue(params.data) === true}
                disabled={['queued', 'running'].includes(params.data.executionStatus)}
                onChange={(checked) => updateRowParams(params.data!.id, field.key, checked)}
                size="small"
              />
            ) : null
            : selectOptions.length
              ? (params: ICellRendererParams<BatchRow>) => params.data ? (
                <GridSelectCell
                  disabled={['queued', 'running'].includes(params.data.executionStatus)}
                  label={selectLabels.get(effectiveValue(params.data) as string | number)
                    || String(effectiveValue(params.data) ?? '-')}
                  onOpen={(anchor) => {
                    const rect = anchor.getBoundingClientRect();
                    setActiveGridSelect((current) => {
                      if (current?.rowId === params.data!.id && current.fieldKey === field.key) return null;
                      return {
                        anchor: { height: rect.height, left: rect.left, top: rect.top, width: rect.width },
                        fieldKey: field.key,
                        options: selectOptions,
                        rowId: params.data!.id,
                        value: valueAt(params.data!.params, field.key) as string | number | undefined,
                      };
                    });
                  }}
                />
              ) : null
              : undefined,
        colId: field.key,
        editable: (params) => Boolean(params.data)
          && !isAsset
          && field.valueType !== 'boolean'
          && !selectOptions.length
          && !['queued', 'running'].includes(params.data!.executionStatus),
        headerName: `${field.label}${field.required ? ' *' : ''}`,
        minWidth: isAsset ? 180 : 140,
        valueFormatter: selectOptions.length
          ? (params) => {
            const value = params.data ? effectiveValue(params.data) : params.value;
            return selectLabels.get(value as string | number) || String(value ?? '-');
          }
          : undefined,
        valueGetter: (params) => params.data ? valueAt(params.data.params, field.key) : undefined,
        valueSetter,
        initialWidth: isAsset ? 240 : 300,
        wrapText: field.valueType === 'string',
      };
    });
    return [
      {
        cellClass: 'batch-generation-grid-index-cell',
        colId: 'index',
        editable: false,
        headerName: '#',
        maxWidth: 58,
        minWidth: 48,
        pinned: 'left',
        resizable: false,
        suppressMovable: true,
        valueGetter: (params) => (params.node?.rowIndex ?? 0) + 1,
        initialWidth: 48,
      },
      ...businessColumns,
      {
        cellRenderer: (params: ICellRendererParams<BatchRow>) => {
          if (!params.data) return null;
          const status = attemptForRow(params.data.id)?.status || params.data.executionStatus;
          return <Tag color={statusMeta[status].color}>{statusMeta[status].label}</Tag>;
        },
        colId: 'status',
        editable: false,
        headerName: '状态',
        minWidth: 96,
        initialWidth: 110,
      },
      {
        autoHeight: true,
        cellRenderer: (params: ICellRendererParams<BatchRow>) => params.data ? renderResults(params.data) : null,
        colId: 'result',
        editable: false,
        headerName: '结果',
        minWidth: 110,
        initialWidth: 160,
      },
      {
        colId: 'credits',
        editable: false,
        headerName: '消耗积分',
        minWidth: 96,
        valueGetter: (params) => params.data
          ? attemptForRow(params.data.id)?.actualCredits ?? params.data.actualCredits ?? 0
          : 0,
        initialWidth: 105,
      },
      {
        cellClass: 'batch-generation-grid-actions-cell',
        cellRenderer: (params: ICellRendererParams<BatchRow>) => params.data ? (
          <Space size={4}>
            <Button
              aria-label="执行此行"
              className="batch-generation-grid-action-button batch-generation-grid-action-button--run"
              disabled={['queued', 'running'].includes(params.data.executionStatus)}
              icon={<Play fill="currentColor" size={14} />}
              onBlur={hideGridTooltip}
              onClick={() => {
                hideGridTooltip();
                void runRows([params.data!.id]);
              }}
              onFocus={(event) => showGridTooltip(event.currentTarget, '执行此行')}
              onMouseEnter={(event) => showGridTooltip(event.currentTarget, '执行此行')}
              onMouseLeave={hideGridTooltip}
              size="small"
              type="default"
            />
            <Button
              aria-label="复制此行"
              className="batch-generation-grid-action-button"
              disabled={rows.length >= MAX_ROWS}
              icon={<Copy size={14} />}
              onBlur={hideGridTooltip}
              onClick={() => {
                hideGridTooltip();
                void copyRow(params.data!);
              }}
              onFocus={(event) => showGridTooltip(event.currentTarget, '复制此行')}
              onMouseEnter={(event) => showGridTooltip(event.currentTarget, '复制此行')}
              onMouseLeave={hideGridTooltip}
              size="small"
              type="default"
            />
            <Popconfirm onConfirm={() => void removeRow(params.data!)} title="确认删除这一行？">
              <Button
                aria-label="删除"
                className="batch-generation-grid-action-button batch-generation-grid-action-button--delete"
                disabled={['queued', 'running'].includes(params.data.executionStatus)}
                icon={<Trash2 size={14} />}
                onBlur={hideGridTooltip}
                onClick={hideGridTooltip}
                onFocus={(event) => showGridTooltip(event.currentTarget, '删除')}
                onMouseEnter={(event) => showGridTooltip(event.currentTarget, '删除')}
                onMouseLeave={hideGridTooltip}
                size="small"
                type="default"
              />
            </Popconfirm>
          </Space>
        ) : null,
        colId: 'actions',
        editable: false,
        headerName: '操作',
        minWidth: 120,
        pinned: 'right',
        resizable: false,
        suppressMovable: true,
        initialWidth: 120,
      },
    ];
  }, [activeCapability, assets, detail?.latestAttempts, detail?.sheet.id, globalParams, hideGridTooltip, latestRun, modelOptions, rows.length, showGridTooltip, uploadingCell]);

  const rowStats = useMemo(() => {
    const statuses = rows.map((row) => attemptForRow(row.id)?.status || row.executionStatus);
    return {
      completed: statuses.filter((status) => status === 'completed').length,
      failed: statuses.filter((status) => ['failed', 'partial_failed'].includes(status)).length,
      pending: statuses.filter((status) => status === 'idle').length,
      processing: statuses.filter((status) => ['queued', 'running'].includes(status)).length,
    };
  }, [detail?.latestAttempts, latestRun, rows]);

  const availableGlobalModels = modelOptions.filter((model) => model.type === activeCapability?.mediaKind);
  const activeModelOptions = availableGlobalModels
    .map((model) => ({ label: model.name, value: model.id as string }));
  const selectedGlobalModel = availableGlobalModels.find((model) => model.id === globalParams.modelConfigId)
    || availableGlobalModels[0];
  const globalImageResolutions = getImageResolutionOptions(selectedGlobalModel);
  const currentAspectRatio = typeof globalParams.aspectRatio === 'string'
    && imageAspectRatioOptions.includes(globalParams.aspectRatio as ImageAspectRatio)
    ? globalParams.aspectRatio as ImageAspectRatio
    : 'auto';
  const currentResolution = typeof globalParams.resolution === 'string'
    && globalImageResolutions.includes(globalParams.resolution as ImageResolution)
    ? globalParams.resolution as ImageResolution
    : globalImageResolutions[0] || '2K';

  useEffect(() => {
    if (!activeCapability || !selectedGlobalModel) return;
    const isImage = activeCapability.mediaKind === 'image';
    const resolution = isImage && globalImageResolutions.length ? currentResolution : undefined;
    const hasOutputCount = activeCapability.globalFields.some((field) => field.key === 'outputCount');
    const outputCount = typeof globalParams.outputCount === 'number' && globalParams.outputCount >= 1
      ? globalParams.outputCount
      : 1;
    const isCurrent = globalParams.modelConfigId === selectedGlobalModel.id
      && (!isImage || (
        globalParams.aspectRatio === currentAspectRatio
        && globalParams.resolution === resolution
        && (!hasOutputCount || globalParams.outputCount === outputCount)
      ));
    if (isCurrent) return;
    setGlobalParams((current) => ({
      ...current,
      modelConfigId: selectedGlobalModel.id,
      ...(isImage ? {
        aspectRatio: currentAspectRatio,
        resolution,
        ...(hasOutputCount ? { outputCount } : {}),
      } : {}),
    }));
    setGlobalDirty(true);
  }, [
    activeCapability,
    currentAspectRatio,
    currentResolution,
    globalImageResolutions.join('|'),
    globalParams.aspectRatio,
    globalParams.modelConfigId,
    globalParams.outputCount,
    globalParams.resolution,
    selectedGlobalModel?.id,
  ]);

  function renderGlobalField(field: CreativeCapabilityField) {
    const value = globalParams[field.key];
    const update = (next: unknown) => {
      setGlobalParams((current) => ({ ...current, [field.key]: next }));
      setGlobalDirty(true);
    };
    if (field.key === 'modelConfigId') {
      return (
        <Select
          onChange={(modelConfigId) => {
            const nextModel = modelOptions.find((model) => model.id === modelConfigId);
            const nextResolutionOptions = activeCapability?.mediaKind === 'image'
              ? getImageResolutionOptions(nextModel).map((resolution) => ({ label: resolution, value: resolution }))
              : videoResolutionOptions;
            setGlobalParams((current) => {
              const currentResolution = typeof current.resolution === 'string' ? current.resolution : '';
              const resolution = nextResolutionOptions.some((option) => option.value === currentResolution)
                ? currentResolution
                : nextResolutionOptions[0]?.value;
              return { ...current, modelConfigId, resolution };
            });
            setGlobalDirty(true);
          }}
          options={activeModelOptions}
          placeholder="选择模型"
          value={(value as string | undefined) || selectedGlobalModel?.id}
        />
      );
    }
    if (field.key === 'resolution') return activeCapability?.mediaKind === 'image' ? null : <Select onChange={update} options={videoResolutionOptions} placeholder="分辨率" value={value as string | undefined} />;
    if (field.key === 'aspectRatio' && activeCapability?.mediaKind === 'image') {
      return (
        <Popover
          arrow={false}
          classNames={{ root: 'image-output-size-popover' }}
          content={(
            <ImageOutputSizePicker
              aspectRatio={currentAspectRatio}
              model={selectedGlobalModel}
              onAspectRatioChange={(aspectRatio) => {
                setGlobalParams((current) => ({ ...current, aspectRatio }));
                setGlobalDirty(true);
              }}
              onResolutionChange={(resolution) => {
                setGlobalParams((current) => ({ ...current, resolution }));
                setGlobalDirty(true);
              }}
              resolution={currentResolution}
            />
          )}
          placement="bottomLeft"
          trigger="click"
        >
          <Button className="sheet-global-size-button" icon={<Scan size={13} />} size="small" type="text">
            {currentAspectRatio}{globalImageResolutions.length ? ` · ${currentResolution}` : ''}<ChevronDown size={12} />
          </Button>
        </Popover>
      );
    }
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
        {(activeCapability?.globalFields || [])
          .filter((field) => field.key !== 'resolution' || activeCapability?.mediaKind !== 'image')
          .map((field) => (
            <div className="sheet-global-settings__field" key={field.key}>
              <span>{field.key === 'aspectRatio' && activeCapability?.mediaKind === 'image' ? '画面尺寸' : field.label}</span>
              {renderGlobalField(field)}
            </div>
          ))}
      </section>

      <section className="sheet-toolbar" aria-label="表格工具栏">
        <span>{rows.length} / {MAX_ROWS} 行</span><i />
        <Button icon={<Plus size={17} />} onClick={() => void addRow()} type="text">新增行</Button>
        <Button disabled={!selectedRows.length || rows.length >= MAX_ROWS} icon={<Copy size={17} />} onClick={() => void copySelectedRows()} type="text">复制</Button>
      </section>

      <div className="sheet-table-area">
        <section className="sheet-grid" aria-label="批量生成表格">
          <AgGridReact<BatchRow>
            ref={gridRef}
            animateRows={false}
            columnDefs={columns}
            defaultColDef={{
              resizable: true,
              sortable: false,
              suppressHeaderMenuButton: true,
            }}
            getRowId={(params) => params.data.id}
            headerHeight={42}
            loading={loading}
            onBodyScroll={() => {
              setActiveGridSelect(null);
              hideGridTooltip();
            }}
            onSelectionChanged={(event) => {
              setSelectedRowIds(event.api.getSelectedRows().map((row) => row.id));
            }}
            overlayNoRowsTemplate="暂无表格行"
            rowData={rows}
            rowHeight={56}
            rowSelection={{
              checkboxes: true,
              enableClickSelection: false,
              headerCheckbox: true,
              mode: 'multiRow',
            }}
            selectionColumnDef={{
              pinned: 'left',
              resizable: false,
              suppressMovable: true,
              width: 42,
            }}
            stopEditingWhenCellsLoseFocus
            theme={batchGridTheme}
          />
        </section>
        {activeGridSelect ? (
          <div
            className="batch-generation-grid-select-anchor"
            key={`${activeGridSelect.rowId}:${activeGridSelect.fieldKey}`}
            style={{
              height: activeGridSelect.anchor.height,
              left: activeGridSelect.anchor.left,
              top: activeGridSelect.anchor.top,
              width: activeGridSelect.anchor.width,
            }}
          >
            <Select<string | number>
              autoFocus
              onChange={(nextValue) => {
                updateRowParams(
                  activeGridSelect.rowId,
                  activeGridSelect.fieldKey,
                  nextValue === '' ? undefined : nextValue,
                );
                setActiveGridSelect(null);
              }}
              open
              options={[
                { label: '使用全局设置', value: '' },
                ...activeGridSelect.options,
              ]}
              popupClassName="ag-custom-component-popup batch-generation-grid-select-popup"
              popupMatchSelectWidth={Math.max(activeGridSelect.anchor.width, 160)}
              value={activeGridSelect.value ?? ''}
            />
          </div>
        ) : null}
        {activeGridTooltip ? (
          <Tooltip open placement="top" title={activeGridTooltip.title}>
            <span
              className="batch-generation-grid-tooltip-anchor"
              style={{
                height: activeGridTooltip.anchor.height,
                left: activeGridTooltip.anchor.left,
                top: activeGridTooltip.anchor.top,
                width: activeGridTooltip.anchor.width,
              }}
            />
          </Tooltip>
        ) : null}
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
