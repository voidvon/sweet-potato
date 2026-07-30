import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import {
  AllCommunityModule,
  ModuleRegistry,
  themeQuartz,
} from 'ag-grid-community';
import { AgGridReact } from 'ag-grid-react';
import { useSearchParams } from 'react-router-dom';
import {
  Button,
  Dropdown,
  Flex,
  Input,
  Modal,
  Popover,
  Radio,
  Select,
  Space,
  Switch,
  Tabs,
  Tag,
  Typography,
  message,
} from 'antd';
import type { InputRef, MenuProps } from 'antd';
import {
  ChevronDown,
  Columns3,
  Copy,
  Pencil,
  Plus,
  RotateCcw,
  Scan,
} from 'lucide-react';
import {
  addBatchRows,
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
import { listVideoModelProviders } from '../../api/model-config';
import type {
  BatchAttempt,
  BatchGenerationModelOption,
  BatchRow,
  BatchRunDetail,
  BatchSheetDetail,
  BatchSheetSummary,
  CreativeCapability,
  CreativeCapabilityField,
} from '../../api/batch-generation';
import type { VideoModelProviderOption } from '../../api/model-config';
import { resolveAssetUrl } from '../../api/request';
import {
  ImageOutputSizePicker,
  getImageResolutionOptions,
  imageAspectRatioOptions,
  type ImageAspectRatio,
  type ImageResolution,
} from '../../components/ImageOutputSizePicker';
import {
  VideoOutputSizePicker,
  videoAspectRatioOptions,
  videoResolutionOptions,
  type VideoAspectRatio,
  type VideoResolution,
} from '../../components/VideoOutputSizePicker';
import { AppImage } from '../../components/AppImage';
import { CompactButton } from '../../components/CompactButton';
import type { MentionRichTextareaRef } from '../../components/MentionRichTextarea';
import {
  appRealtimeEventNames,
  type AppBatchGenerationRunUpdatedDetail,
} from '../../events/appRealtimeEvents';
import type { ContentAsset } from '../../types';
import {
  danceRemakeDefaults,
  danceRemakeModeOptions,
  preferredVideoModelId,
  qualityOptions as sharedVideoQualityOptions,
  videoModelDefinitions,
} from './shared/videoGenerationOptions';
import {
  GridCanvasOverlay,
  GridPromptEditorOverlay,
  GridSelectOverlay,
  GridTooltipOverlay,
} from './batch-generation/BatchGenerationGridOverlays';
import type {
  ActiveAssetPreview,
  ActiveGridCanvas,
  ActiveGridSelect,
  ActiveGridTooltip,
  ActivePromptEditor,
  PendingAssetUpload,
} from './batch-generation/batchGenerationGrid.types';
import {
  MAX_REFERENCE_IMAGE_COUNT,
  assetAccept,
  aspectRatioOptions,
  durationOptions,
  outputCountOptions,
  promptMentionOptions,
  stringArray,
  valueAt,
} from './batch-generation/batchGenerationGrid.utils';
import { useBatchGenerationColumns } from './batch-generation/useBatchGenerationColumns';
import './BatchGenerationPage.scss';

const MAX_ROWS = 200;
const BATCH_RUNNABLE_STATUSES = new Set<BatchRow['executionStatus']>(['idle', 'failed', 'partial_failed']);
const LOCAL_ROW_ID_PREFIX = 'local-row:';
const GRID_ADD_ROW_ID = 'grid-control:add-row';
const LAST_ACTIVE_SHEET_STORAGE_KEY = 'batch-generation:last-sheet-id';
const PREFERRED_VIDEO_MODEL_ID = preferredVideoModelId;
const DEFAULT_SHEET_NAME = '批量';

const gridAddRow: BatchRow = {
  id: GRID_ADD_ROW_ID,
  sheetId: '',
  position: Number.MAX_SAFE_INTEGER,
  params: {},
  validationStatus: 'draft',
  validationErrors: [],
  executionStatus: 'idle',
  latestAttemptId: null,
  actualCredits: 0,
  revision: 0,
  createdAt: '',
  updatedAt: '',
};

function storedActiveSheetId() {
  try {
    return window.localStorage.getItem(LAST_ACTIVE_SHEET_STORAGE_KEY)?.trim() || '';
  } catch {
    return '';
  }
}

function storeActiveSheetId(sheetId: string) {
  try {
    if (sheetId) window.localStorage.setItem(LAST_ACTIVE_SHEET_STORAGE_KEY, sheetId);
    else window.localStorage.removeItem(LAST_ACTIVE_SHEET_STORAGE_KEY);
  } catch {
    // URL state remains available when browser storage is unavailable.
  }
}

function SheetTitleEditor({
  menuItems,
  onRename,
  sheet,
}: {
  menuItems: MenuProps['items'];
  onRename: (sheetId: string, value: string) => Promise<void>;
  sheet?: BatchSheetSummary;
}) {
  const inputRef = useRef<InputRef>(null);
  const [editing, setEditing] = useState(false);

  useLayoutEffect(() => {
    if (editing) inputRef.current?.focus({ cursor: 'all' });
  }, [editing]);

  if (editing && sheet) {
    return (
      <Input
        className="sheet-workspace__title-input"
        defaultValue={sheet.name}
        maxLength={100}
        onBlur={(event) => {
          setEditing(false);
          void onRename(sheet.id, event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') setEditing(false);
        }}
        ref={inputRef}
        size="small"
      />
    );
  }

  return (
    <>
      <Dropdown menu={{ items: menuItems }} trigger={['click']}>
        <button className="sheet-workspace__title-button" type="button"><strong>{sheet?.name || DEFAULT_SHEET_NAME}</strong><ChevronDown size={18} /></button>
      </Dropdown>
      <Button
        aria-label="重命名当前表格"
        className="sheet-workspace__title-edit"
        disabled={!sheet}
        icon={<Pencil size={14} />}
        onClick={() => setEditing(true)}
        size="small"
        title="重命名"
        type="text"
      />
    </>
  );
}

function SheetTabLabel({
  onRename,
  sheet,
}: {
  onRename: (sheetId: string, value: string) => Promise<void>;
  sheet: BatchSheetSummary;
}) {
  const inputRef = useRef<InputRef>(null);
  const [editing, setEditing] = useState(false);

  useLayoutEffect(() => {
    if (editing) inputRef.current?.focus({ cursor: 'all' });
  }, [editing]);

  return (
    <span className="sheet-workspace__tab-label">
      <span
        className="sheet-workspace__tab-name-editor"
        onMouseDown={(event) => {
          if (event.detail !== 2) return;
          event.preventDefault();
          event.stopPropagation();
          setEditing(true);
        }}
      >
        <span className={editing ? 'sheet-workspace__tab-name sheet-workspace__tab-name--editing' : 'sheet-workspace__tab-name'}>
          {sheet.name}
        </span>
        {editing ? (
          <Input
            className="sheet-workspace__tab-name-input"
            defaultValue={sheet.name}
            maxLength={100}
            onBlur={(event) => {
              event.stopPropagation();
              setEditing(false);
              void onRename(sheet.id, event.target.value);
            }}
            onClick={(event) => event.stopPropagation()}
            onFocus={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === 'Enter') event.currentTarget.blur();
              if (event.key === 'Escape') setEditing(false);
            }}
            onMouseDown={(event) => event.stopPropagation()}
            ref={inputRef}
            size="small"
          />
        ) : null}
      </span>
      <Tag color={sheet.mediaKind === 'image' ? 'blue' : 'purple'}>
        {sheet.mediaKind === 'image' ? '图片' : '视频'}
      </Tag>
    </span>
  );
}

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
  wrapperBorder: false,
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

const capabilityColors = [
  '#3f82ef', '#ec4899', '#0ea5e9', '#f43f5e', '#06b6d4', '#f59e0b',
  '#f97316', '#10b981', '#a855f7', '#d946ef', '#e11d48', '#14b8a6',
  '#eab308', '#6366f1', '#7c3aed', '#0284c7', '#db2777', '#ea580c',
];

function generateSheetName(label: string) {
  const now = new Date();
  const timestamp = [
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0'),
  ].join('');
  return `${label}-${timestamp}`;
}

type AvailableBatchModelOption = BatchGenerationModelOption & {
  configId: string;
  disabled?: boolean;
};
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

function rowAssetIds(rows: BatchRow[], capability?: CreativeCapability) {
  const assetFields = capability?.rowFields.filter((field) => field.valueType === 'asset' || field.valueType === 'asset-list') || [];
  return [...new Set(rows.flatMap((row) => assetFields.flatMap((field) => {
    const value = valueAt(row.params, field.key);
    return field.valueType === 'asset-list' ? stringArray(value) : typeof value === 'string' ? [value] : [];
  })).filter(Boolean))];
}

function defaultGlobalParamsForCapability(
  capability: CreativeCapability,
  availableModels: AvailableBatchModelOption[],
) {
  if (capability.key === 'video.upscale') return {};
  if (capability.key === 'video.dance_remake') {
    return {
      danceRemakeMode: 'standard',
      preserveAudio: danceRemakeDefaults.preserveAudio,
      quality: danceRemakeDefaults.quality,
      videoModelId: danceRemakeDefaults.videoModelId,
    };
  }
  const model = capability.mediaKind === 'video'
    ? availableModels.find((item) => item.type === 'video' && item.model === PREFERRED_VIDEO_MODEL_ID)
      || availableModels.find((item) => item.type === 'video')
    : availableModels.find((item) => item.type === capability.mediaKind);
  const params: Record<string, unknown> = {};
  if (model) {
    params.modelConfigId = model.configId;
    if (capability.mediaKind === 'video') params.videoModelId = model.model;
  }
  if (capability.mediaKind === 'image') {
    params.aspectRatio = 'auto';
    const resolution = getImageResolutionOptions(model)[0];
    if (resolution) params.resolution = resolution;
    if (capability.globalFields.some((field) => field.key === 'outputCount')) params.outputCount = 1;
  } else {
    params.aspectRatio = '9:16';
    params.resolution = '720P';
    params.duration = '10秒';
    params.generateAudio = false;
  }
  return params;
}

function availableBatchModelOptions(
  modelOptions: BatchGenerationModelOption[],
  videoProviders: VideoModelProviderOption[],
): AvailableBatchModelOption[] {
  const imageOptions = modelOptions
    .filter((option) => option.type === 'image')
    .map((option) => ({ ...option, configId: option.id }));
  const configuredVideoProviders = new Set(
    modelOptions.filter((option) => option.type === 'video').map((option) => option.provider),
  );
  const videoOptions = videoProviders
    .filter((provider) => configuredVideoProviders.has(provider.id))
    .flatMap((provider) => {
      const config = modelOptions.find((option) => option.type === 'video' && option.provider === provider.id);
      if (!config) return [];
      return provider.models.map((model) => ({
        ...config,
        configId: config.id,
        disabled: model.disabled,
        id: `${config.id}::${model.id}`,
        model: model.id,
        name: model.name,
      }));
    });
  return [...imageOptions, ...videoOptions];
}

export function BatchGenerationPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlSheetId = searchParams.get('sheetId')?.trim() || '';
  const gridRef = useRef<AgGridReact<BatchRow>>(null);
  const gridContainerRef = useRef<HTMLElement>(null);
  const initialUrlSheetIdRef = useRef(urlSheetId);
  const initialDataLoadedRef = useRef(false);
  const pendingLocationSheetIdRef = useRef<string | null>(null);
  const activeSheetIdRef = useRef('');
  const sheetLoadRequestRef = useRef(0);
  const sheetSwitchFrameRef = useRef<number | null>(null);
  const gridRevealTimerRef = useRef<number | null>(null);
  const gridCanRevealRef = useRef(false);
  const assetInputRef = useRef<HTMLInputElement>(null);
  const pendingAssetUploadRef = useRef<PendingAssetUpload | null>(null);
  const promptEditorRef = useRef<MentionRichTextareaRef>(null);
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
  const [videoModelProviders, setVideoModelProviders] = useState<VideoModelProviderOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [gridLayoutReady, setGridLayoutReady] = useState(false);
  const [switchingSheetRequest, setSwitchingSheetRequest] = useState<{ requestId: number; sheetId: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [batchRunning, setBatchRunning] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [uploadingCell, setUploadingCell] = useState('');
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const scheduleGridReveal = useCallback(() => {
    if (gridRevealTimerRef.current !== null) window.clearTimeout(gridRevealTimerRef.current);
    gridRevealTimerRef.current = window.setTimeout(() => {
      gridRevealTimerRef.current = null;
      if (!gridCanRevealRef.current) return;
      setGridLayoutReady(true);
    }, 80);
  }, []);
  const [selectedCapabilityKey, setSelectedCapabilityKey] = useState('');
  const [newSheetName, setNewSheetName] = useState('');
  const [suggestedSheetName, setSuggestedSheetName] = useState('');
  const [activeGridCanvas, setActiveGridCanvas] = useState<ActiveGridCanvas | null>(null);
  const [activeGridSelect, setActiveGridSelect] = useState<ActiveGridSelect | null>(null);
  const [activePromptEditor, setActivePromptEditor] = useState<ActivePromptEditor | null>(null);
  const [activeGridTooltip, setActiveGridTooltip] = useState<ActiveGridTooltip | null>(null);
  const [activeAssetPreview, setActiveAssetPreview] = useState<ActiveAssetPreview | null>(null);
  const gridRows = useMemo(() => [...rows, gridAddRow], [rows]);

  const showGridTooltip = useCallback((target: HTMLElement, title: string) => {
    const rect = target.getBoundingClientRect();
    setActiveGridTooltip({
      anchor: { height: rect.height, left: rect.left, top: rect.top, width: rect.width },
      title,
    });
  }, []);
  const hideGridTooltip = useCallback(() => setActiveGridTooltip(null), []);

  const syncActiveSheetLocation = useCallback((sheetId: string) => {
    storeActiveSheetId(sheetId);
    pendingLocationSheetIdRef.current = sheetId;
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (sheetId) next.set('sheetId', sheetId);
      else next.delete('sheetId');
      if (next.toString() === current.toString()) pendingLocationSheetIdRef.current = null;
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const activeCapability = useMemo(
    () => capabilities.find((item) => item.key === detail?.sheet.capabilityKey),
    [capabilities, detail?.sheet.capabilityKey],
  );
  const availableModelOptions = useMemo(
    () => availableBatchModelOptions(modelOptions, videoModelProviders),
    [modelOptions, videoModelProviders],
  );
  const selectedCapability = capabilities.find((item) => item.key === selectedCapabilityKey) || capabilities[0];
  const activeSheet = sheets.find((sheet) => sheet.id === activeSheetId);
  const selectedRows = rows.filter((row) => selectedRowIds.includes(row.id));
  const hasUnsavedChanges = globalDirty || dirtyRowIds.length > 0;
  const switchingSheet = Boolean(switchingSheetRequest);
  const activePromptRow = activePromptEditor
    ? rows.find((row) => row.id === activePromptEditor.rowId)
    : undefined;
  const activePromptOptions = activePromptRow
    ? promptMentionOptions(activePromptRow, activeCapability, assets)
    : [];
  const activePromptValue = activePromptRow && activePromptEditor
    ? String(valueAt(activePromptRow.params, activePromptEditor.fieldKey) ?? '')
    : '';

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
    if (!runs[0]) return null;
    const run = await getBatchRun(runs[0].id);
    await loadAttemptAssets(run.attempts);
    return run;
  }, [loadAttemptAssets]);

  const loadSheet = useCallback(async (
    sheetId: string,
    capabilityList = capabilities,
    requestId?: number,
  ) => {
    if (activeSheetIdRef.current && activeSheetIdRef.current !== sheetId) return false;
    const currentRequestId = requestId ?? ++sheetLoadRequestRef.current;
    const next = await getBatchSheet(sheetId);
    if (currentRequestId !== sheetLoadRequestRef.current || activeSheetIdRef.current !== sheetId) return false;
    setDetail(next);
    setGridLayoutReady(false);
    gridCanRevealRef.current = false;
    if (gridRevealTimerRef.current !== null) {
      window.clearTimeout(gridRevealTimerRef.current);
      gridRevealTimerRef.current = null;
    }
    setRows(next.rows);
    setGlobalParams(next.sheet.globalParams);
    setDirtyRowIds([]);
    setGlobalDirty(false);
    setSelectedRowIds([]);
    setLatestRun(null);
    setSwitchingSheetRequest((current) => current?.requestId === currentRequestId ? null : current);
    const capability = capabilityList.find((item) => item.key === next.sheet.capabilityKey);
    const [, , run] = await Promise.all([
      loadAssetsById(rowAssetIds(next.rows, capability)),
      loadAttemptAssets(next.latestAttempts),
      loadLatestRun(sheetId),
    ]);
    if (currentRequestId !== sheetLoadRequestRef.current || activeSheetIdRef.current !== sheetId) return false;
    setLatestRun(run);
    gridCanRevealRef.current = true;
    requestAnimationFrame(scheduleGridReveal);
    return true;
  }, [capabilities, loadAssetsById, loadAttemptAssets, loadLatestRun, scheduleGridReveal]);

  const activateSheet = useCallback(async (sheetId: string, capabilityList = capabilities) => {
    if (!sheetId) return;
    const requestId = ++sheetLoadRequestRef.current;
    activeSheetIdRef.current = sheetId;
    pendingLocationSheetIdRef.current = sheetId;
    setActiveSheetId(sheetId);
    if (sheetSwitchFrameRef.current !== null) cancelAnimationFrame(sheetSwitchFrameRef.current);
    let requestFinished = false;
    let transitionStarted = false;
    const frameId = requestAnimationFrame(() => {
      if (activeSheetIdRef.current !== sheetId) return;
      sheetSwitchFrameRef.current = null;
      syncActiveSheetLocation(sheetId);
      setActiveGridCanvas(null);
      setActiveGridSelect(null);
      setActivePromptEditor(null);
      setActiveGridTooltip(null);
      setActiveAssetPreview(null);
      if (requestId === sheetLoadRequestRef.current && !requestFinished) {
        transitionStarted = true;
        setSwitchingSheetRequest({ requestId, sheetId });
      }
    });
    sheetSwitchFrameRef.current = frameId;
    try {
      await loadSheet(sheetId, capabilityList, requestId);
    } catch (error) {
      if (requestId === sheetLoadRequestRef.current) {
        setDetail(null);
        setRows([]);
        gridCanRevealRef.current = true;
        setGridLayoutReady(true);
        setLatestRun(null);
        message.error(error instanceof Error ? error.message : '表格加载失败');
      }
    } finally {
      requestFinished = true;
      if (transitionStarted) {
        setSwitchingSheetRequest((current) => current?.requestId === requestId ? null : current);
      }
    }
  }, [capabilities, loadSheet, syncActiveSheetLocation]);

  const loadInitialData = useCallback(async () => {
    setLoading(true);
    try {
      const [capabilityList, sheetList, availableModelOptionConfigs, videoProviderList] = await Promise.all([
        listBatchCapabilities(),
        listBatchSheets(),
        listBatchGenerationModelOptions(),
        listVideoModelProviders(),
      ]);
      setCapabilities(capabilityList);
      setSheets(sheetList);
      setModelOptions(availableModelOptionConfigs);
      setVideoModelProviders(videoProviderList);
      const firstCapability = capabilityList[0];
      if (firstCapability) {
        setSelectedCapabilityKey(firstCapability.key);
        setSuggestedSheetName(generateSheetName(firstCapability.label));
      }
      const requestedSheetId = initialUrlSheetIdRef.current || storedActiveSheetId();
      const targetSheetId = sheetList.find((sheet) => sheet.id === requestedSheetId)?.id || sheetList[0]?.id || '';
      if (targetSheetId) await activateSheet(targetSheetId, capabilityList);
      else {
        syncActiveSheetLocation('');
        setCreateModalOpen(Boolean(firstCapability));
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : '批量表格加载失败');
    } finally {
      initialDataLoadedRef.current = true;
      setLoading(false);
    }
  }, [activateSheet, syncActiveSheetLocation]);

  useEffect(() => { void loadInitialData(); }, []);

  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = true;
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges]);

  useEffect(() => () => {
    if (sheetSwitchFrameRef.current !== null) cancelAnimationFrame(sheetSwitchFrameRef.current);
    if (gridRevealTimerRef.current !== null) window.clearTimeout(gridRevealTimerRef.current);
  }, []);

  useEffect(() => {
    if (!initialDataLoadedRef.current) return;
    const pendingLocationSheetId = pendingLocationSheetIdRef.current;
    if (pendingLocationSheetId !== null) {
      if (urlSheetId === pendingLocationSheetId) pendingLocationSheetIdRef.current = null;
      else return;
    }
    if (!urlSheetId) {
      if (activeSheetId) syncActiveSheetLocation(activeSheetId);
      return;
    }
    if (urlSheetId === activeSheetId) return;
    if (!sheets.some((sheet) => sheet.id === urlSheetId)) {
      syncActiveSheetLocation(activeSheetId);
      return;
    }
    void activateSheet(urlSheetId);
  }, [activateSheet, activeSheetId, sheets, syncActiveSheetLocation, urlSheetId]);

  useEffect(() => {
    if (!selectedRowIds.length) gridRef.current?.api?.deselectAll();
  }, [selectedRowIds.length]);

  useEffect(() => {
    const executingRowIds = new Set(rows
      .filter((row) => ['queued', 'running'].includes(row.executionStatus))
      .map((row) => row.id));
    if (!executingRowIds.size) return;
    setActiveGridCanvas((current) => current && executingRowIds.has(current.rowId) ? null : current);
    setActiveGridSelect((current) => current && executingRowIds.has(current.rowId) ? null : current);
    setActivePromptEditor((current) => current && executingRowIds.has(current.rowId) ? null : current);
    setSelectedRowIds((current) => {
      const next = current.filter((rowId) => !executingRowIds.has(rowId));
      return next.length === current.length ? current : next;
    });
    const api = gridRef.current?.api;
    if (!api) return;
    const selectedExecutingNodes = api.getSelectedNodes()
      .filter((node) => node.data && executingRowIds.has(node.data.id));
    if (selectedExecutingNodes.length) {
      api.setNodesSelected({ nodes: selectedExecutingNodes, newValue: false, source: 'api' });
    }
  }, [rows]);

  useEffect(() => {
    if (!activeGridCanvas) return;
    const closeCanvas = () => setActiveGridCanvas(null);
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('.batch-generation-grid-canvas-cell')) return;
      if (target.closest('.batch-generation-grid-canvas-popover')) return;
      closeCanvas();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeCanvas();
    };
    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('resize', closeCanvas);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('resize', closeCanvas);
    };
  }, [activeGridCanvas]);

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
    if (!activePromptEditor) return;
    const focusFrame = requestAnimationFrame(() => promptEditorRef.current?.focus());
    const handlePointerDown = (event: PointerEvent) => {
      if (activePromptEditor.mode === 'fullscreen') return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('.batch-generation-grid-prompt-cell')) return;
      if (target.closest('.batch-generation-grid-prompt-editor')) return;
      if (target.closest('.mention-rich-textarea-menu')) return;
      closePromptEditor();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (activePromptEditor.mode !== 'fullscreen') return;
      if (event.key === 'Escape') {
        event.preventDefault();
        closePromptEditor(true);
      } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        closePromptEditor();
      }
    };
    const handleResize = () => closePromptEditor();
    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('resize', handleResize);
    return () => {
      cancelAnimationFrame(focusFrame);
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('resize', handleResize);
    };
  }, [activePromptEditor]);

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
    const handleRun = (event: Event) => {
      const run = (event as CustomEvent<AppBatchGenerationRunUpdatedDetail>).detail.run;
      if (run.sheetId !== activeSheetIdRef.current) return;
      setLatestRun(run);
      const attemptStatusByRow = new Map(run.attempts.map((attempt) => [attempt.rowId, attempt.status]));
      setRows((current) => current.map((row) => {
        const executionStatus = attemptStatusByRow.get(row.id);
        return executionStatus && executionStatus !== row.executionStatus
          ? { ...row, executionStatus }
          : row;
      }));
      void loadAttemptAssets(run.attempts);
      if (['completed', 'partial_failed', 'failed', 'canceled'].includes(run.status)) {
        setBatchRunning(false);
        setRetrying(false);
        void loadSheet(run.sheetId);
      }
    };
    window.addEventListener(appRealtimeEventNames.batchGenerationRunUpdated, handleRun);
    return () => window.removeEventListener(appRealtimeEventNames.batchGenerationRunUpdated, handleRun);
  }, [loadAttemptAssets, loadSheet]);

  const attemptForRow = useCallback((rowId: string) => {
    return latestRun?.attempts.find((attempt) => attempt.rowId === rowId)
      || detail?.latestAttempts.find((attempt) => attempt.rowId === rowId);
  }, [detail?.latestAttempts, latestRun?.attempts]);

  const executionStatusForRow = useCallback((row: BatchRow) => (
    ['queued', 'running'].includes(row.executionStatus)
      ? row.executionStatus
      : attemptForRow(row.id)?.status || row.executionStatus
  ), [attemptForRow]);

  function updateRowParams(rowId: string, key: string, value: unknown) {
    const row = rows.find((item) => item.id === rowId);
    if (!row || ['queued', 'running', 'completed'].includes(row.executionStatus)) return;
    setRows((current) => current.map((row) => row.id === rowId
      ? { ...row, params: withValue(row.params, key, value), validationStatus: 'draft', validationErrors: [] }
      : row));
    setDirtyRowIds((current) => current.includes(rowId) ? current : [...current, rowId]);
  }

  function closePromptEditor(revert = false) {
    if (revert && activePromptEditor && activePromptRow) {
      updateRowParams(activePromptRow.id, activePromptEditor.fieldKey, activePromptEditor.initialValue);
    }
    setActivePromptEditor(null);
  }

  async function saveChanges({
    notify = true,
    reload = true,
  }: {
    notify?: boolean;
    reload?: boolean;
  } = {}) {
    if (!detail) return null;
    const savedRowIds = new Map(rows.map((row) => [row.id, row.id]));
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
        savedRowIds.set(row.id, created.id);
        setRows((current) => withRowPositions(current.map((item) => item.id === row.id ? created : item)));
        setDirtyRowIds((current) => current.filter((id) => id !== row.id));
      }
      if (reload) await loadSheet(detail.sheet.id);
      if (notify) message.success('已保存');
      return savedRowIds;
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存失败');
      return null;
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
    const selectedRowIds = new Set(selectedRows.map((row) => row.id));
    const created: BatchRow[] = [];
    const nextRows: BatchRow[] = [];
    let remainingCapacity = MAX_ROWS - rows.length;
    rows.forEach((row) => {
      nextRows.push(row);
      if (remainingCapacity <= 0 || !selectedRowIds.has(row.id)) return;
      const copy = createLocalRow(detail.sheet.id, row.params, nextRows.length);
      created.push(copy);
      nextRows.push(copy);
      remainingCapacity -= 1;
    });
    setRows(withRowPositions(nextRows));
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

  async function runRows(rowIds?: string[], source: 'batch' | 'row' = 'batch') {
    if (!detail) return;
    if (hasUnsavedChanges) {
      if (source === 'batch') {
        message.warning('请先保存当前改动再执行');
        return;
      }
      const savedRowIds = await saveChanges({ notify: false, reload: false });
      if (!savedRowIds) return;
      rowIds = rowIds?.map((rowId) => savedRowIds.get(rowId) || rowId);
    }
    const requestedRowIds = new Set(rowIds?.length ? rowIds : rows.map((row) => row.id));
    const targetRows = rows.filter((row) => requestedRowIds.has(row.id)
      && BATCH_RUNNABLE_STATUSES.has(executionStatusForRow(row)));
    const targetRowIds = source === 'row'
      ? requestedRowIds
      : new Set(targetRows.map((row) => row.id));
    if (!targetRowIds.size) {
      if (source === 'batch') message.warning('没有可批量执行的待提交或失败项');
      return;
    }
    const previousStatuses = new Map<string, BatchRow['executionStatus']>(
      [...targetRowIds].map((rowId) => [
        rowId,
        rows.find((row) => row.id === rowId)?.executionStatus || 'idle',
      ]),
    );
    setActiveGridCanvas((current) => current && targetRowIds.has(current.rowId) ? null : current);
    setActiveGridSelect((current) => current && targetRowIds.has(current.rowId) ? null : current);
    setActivePromptEditor((current) => current && targetRowIds.has(current.rowId) ? null : current);
    setRows((current) => current.map((row) => targetRowIds.has(row.id)
      ? { ...row, executionStatus: 'queued' }
      : row));
    if (source === 'batch') setBatchRunning(true);
    try {
      const run = await startBatchRun(detail.sheet.id, [...targetRowIds]);
      setLatestRun(run);
      message.success('任务已提交');
      if (source === 'batch') await loadSheet(detail.sheet.id);
    } catch (error) {
      setRows((current) => current.map((row) => {
        const previousStatus = previousStatuses.get(row.id);
        return previousStatus && row.executionStatus === 'queued'
          ? { ...row, executionStatus: previousStatus }
          : row;
      }));
      if (source === 'batch') setBatchRunning(false);
      message.error(error instanceof Error ? error.message : '任务提交失败');
    }
  }

  async function retryFailed() {
    if (!latestRun) return;
    setRetrying(true);
    try {
      const run = await retryBatchRun(latestRun.id);
      setLatestRun(run);
      message.success('失败行已重新提交');
    } catch (error) {
      setRetrying(false);
      message.error(error instanceof Error ? error.message : '重试失败');
    }
  }

  async function uploadAssets(row: BatchRow, field: CreativeCapabilityField, files: File[]) {
    const uploaded = await uploadUploadedAssets(row, field, files);
    if (!uploaded.length) return;
    const uploadedIds = uploaded.map((asset) => asset.id);
    if (field.valueType === 'asset-list') {
      const currentIds = stringArray(valueAt(row.params, field.key));
      updateRowParams(row.id, field.key, [...new Set([...currentIds, ...uploadedIds])]);
    } else {
      updateRowParams(row.id, field.key, uploadedIds[0]);
    }
  }

  async function uploadUploadedAssets(row: BatchRow, field: CreativeCapabilityField, files: File[]) {
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
      return uploaded;
    } catch (error) {
      message.error(error instanceof Error ? error.message : '素材上传失败');
      return [];
    } finally {
      setUploadingCell('');
    }
  }

  function openAssetUpload(row: BatchRow, field: CreativeCapabilityField, currentCount: number, maxCount: number) {
    const input = assetInputRef.current;
    const remainingCount = Math.max(0, maxCount - currentCount);
    if (!input || remainingCount === 0) return;
    pendingAssetUploadRef.current = { field, maxCount, remainingCount, row };
    input.accept = assetAccept(field);
    input.multiple = maxCount > 1;
    input.value = '';
    input.click();
  }

  function handleAssetInputChange(event: ChangeEvent<HTMLInputElement>) {
    const pending = pendingAssetUploadRef.current;
    const selectedFiles = Array.from(event.currentTarget.files || []);
    event.currentTarget.value = '';
    pendingAssetUploadRef.current = null;
    if (!pending || !selectedFiles.length) return;
    const files = selectedFiles.slice(0, pending.remainingCount);
    if (files.length < selectedFiles.length) {
      message.warning(`${pending.field.label}最多上传 ${pending.maxCount} 张`);
    }
    void uploadAssets(pending.row, pending.field, files);
  }

  async function createSheet(enterSheet: boolean) {
    if (!selectedCapability) return;
    try {
      const sheet = await createBatchSheet({
        name: newSheetName.trim() || suggestedSheetName,
        capabilityKey: selectedCapability.key,
        globalParams: defaultGlobalParamsForCapability(selectedCapability, availableModelOptions),
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
        await activateSheet(sheet.id);
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
        await activateSheet(next[0].id);
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : '表格删除失败');
    }
  }

  async function renameSheet(sheetId: string, value: string) {
    const sheet = sheets.find((item) => item.id === sheetId);
    if (!sheet) return;
    const name = value.trim();
    if (!name) {
      message.error('表名不能为空');
      return;
    }
    if (name === sheet.name) {
      return;
    }
    try {
      const revision = detail?.sheet.id === sheetId ? detail.sheet.revision : sheet.revision;
      const updated = await updateBatchSheet(sheetId, { name, revision });
      setSheets((current) => current.map((item) => item.id === sheetId ? { ...item, ...updated } : item));
      setDetail((current) => current?.sheet.id === sheetId
        ? { ...current, sheet: updated }
        : current);
      message.success('重命名成功');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '重命名失败');
    }
  }

  function confirmRemoveSheet(sheetId: string) {
    const sheet = sheets.find((item) => item.id === sheetId);
    if (!sheet) return;
    Modal.confirm({
      cancelText: '取消',
      centered: true,
      content: `即将删除「${sheet.name}」，表内所有数据将丢失，操作不可撤销。`,
      maskClosable: true,
      okButtonProps: { danger: true },
      okText: '删除',
      onOk: () => removeSheet(sheetId),
      title: '删除批量表格？',
    });
  }

  const columns = useBatchGenerationColumns({
    activeCapability,
    assets,
    getAttempt: attemptForRow,
    globalParams,
    modelOptions,
    onAssetReady: (asset) => setAssets((current) => ({ ...current, [asset.id]: asset })),
    onCopyRow: copyRow,
    onHideTooltip: hideGridTooltip,
    onOpenCanvas: (nextCanvas) => {
      setActiveGridSelect(null);
      setActivePromptEditor(null);
      setActiveGridCanvas(nextCanvas);
    },
    onOpenAssetUpload: openAssetUpload,
    onOpenPrompt: (row, fieldKey, value, mode, anchor) => {
      const cell = anchor.closest('.ag-cell') || anchor;
      const rect = cell.getBoundingClientRect();
      setActiveGridCanvas(null);
      setActiveGridSelect(null);
      if (mode === 'fullscreen') {
        setActivePromptEditor({
          anchor: { height: rect.height, left: rect.left, top: rect.top, width: rect.width },
          fieldKey,
          initialValue: value,
          mode,
          rowId: row.id,
        });
        return;
      }
      setActivePromptEditor((current) => {
        if (current?.rowId === row.id && current.fieldKey === fieldKey) return null;
        return {
          anchor: { height: rect.height, left: rect.left, top: rect.top, width: rect.width },
          fieldKey,
          initialValue: value,
          mode,
          rowId: row.id,
        };
      });
    },
    onOpenSelect: (nextSelect) => {
      setActiveGridCanvas(null);
      setActiveGridSelect(nextSelect);
    },
    onPreviewAssets: (current, items) => setActiveAssetPreview({ current, items }),
    onRemoveRow: (row) => { void removeRow(row); },
    onRunRow: (row) => { void runRows([row.id], 'row'); },
    onShowTooltip: showGridTooltip,
    onUpload: (row, field, files) => uploadUploadedAssets(row, field, files),
    onUpdateRow: updateRowParams,
    rows,
    rowsLength: rows.length,
    uploadingCell,
  });
  const configuredGridWidth = useMemo(() => columns.reduce(
    (total, column) => total + (column.initialWidth ?? column.width ?? 200),
    42,
  ), [columns]);
  const syncGridContainerWidth = useCallback(() => {
    const api = gridRef.current?.api;
    const container = gridContainerRef.current;
    if (!api || !container) return;
    const width = api.getAllDisplayedColumns().reduce((total, column) => total + column.getActualWidth(), 0);
    container.style.width = `${width}px`;
  }, []);
  const rowStats = useMemo(() => {
    const statuses = rows.map(executionStatusForRow);
    return {
      completed: statuses.filter((status) => status === 'completed').length,
      failed: statuses.filter((status) => ['failed', 'partial_failed'].includes(status)).length,
      pending: statuses.filter((status) => status === 'idle').length,
      processing: statuses.filter((status) => ['queued', 'running'].includes(status)).length,
    };
  }, [executionStatusForRow, rows]);
  const hasExecutingRows = rowStats.processing > 0;
  const batchRunnableRows = selectedRows
    .filter((row) => BATCH_RUNNABLE_STATUSES.has(executionStatusForRow(row)));

  const availableGlobalModels = availableModelOptions.filter((model) => model.type === activeCapability?.mediaKind);
  const activeModelOptions = availableGlobalModels
    .map((model) => ({ disabled: model.disabled, label: model.name, value: model.id }));
  const selectedGlobalModel = availableGlobalModels.find((model) => {
    const configId = model.configId || model.id;
    return configId === globalParams.modelConfigId
      && (activeCapability?.mediaKind !== 'video' || !globalParams.videoModelId || model.model === globalParams.videoModelId);
  })
    || (activeCapability?.mediaKind === 'video' && !globalParams.videoModelId
      ? availableGlobalModels.find((model) => model.model === PREFERRED_VIDEO_MODEL_ID)
      : undefined)
    || availableGlobalModels[0];
  const globalImageResolutions = getImageResolutionOptions(selectedGlobalModel);
  const currentAspectRatio = typeof globalParams.aspectRatio === 'string'
    && imageAspectRatioOptions.includes(globalParams.aspectRatio as ImageAspectRatio)
    ? globalParams.aspectRatio as ImageAspectRatio
    : 'auto';
  const currentVideoAspectRatio = typeof globalParams.aspectRatio === 'string'
    && videoAspectRatioOptions.includes(globalParams.aspectRatio as VideoAspectRatio)
    ? globalParams.aspectRatio as VideoAspectRatio
    : '9:16';
  const currentResolution = typeof globalParams.resolution === 'string'
    && globalImageResolutions.includes(globalParams.resolution as ImageResolution)
    ? globalParams.resolution as ImageResolution
    : globalImageResolutions[0] || '2K';
  const currentVideoResolution = typeof globalParams.resolution === 'string'
    && videoResolutionOptions.includes(globalParams.resolution as VideoResolution)
    ? globalParams.resolution as VideoResolution
    : '720P';
  const currentDuration = durationOptions.some((option) => option.value === globalParams.duration)
    ? String(globalParams.duration)
    : '10秒';
  const currentGenerateAudio = globalParams.generateAudio === true;
  const selectedModelConfigId = selectedGlobalModel?.configId || selectedGlobalModel?.id;
  const selectedVideoModelId = selectedGlobalModel?.model;
  const selectedModelMatches = Boolean(
    selectedGlobalModel
      && globalParams.modelConfigId === selectedModelConfigId
      && (activeCapability?.mediaKind !== 'video'
        || !globalParams.videoModelId
        || globalParams.videoModelId === selectedVideoModelId),
  );

  useEffect(() => {
    if (!activeCapability || !selectedGlobalModel) return;
    if (['video.upscale', 'video.dance_remake'].includes(activeCapability.key)) return;
    const isImage = activeCapability.mediaKind === 'image';
    const resolution = isImage && globalImageResolutions.length ? currentResolution : undefined;
    const hasOutputCount = activeCapability.globalFields.some((field) => field.key === 'outputCount');
    const outputCount = typeof globalParams.outputCount === 'number' && globalParams.outputCount >= 1
      ? globalParams.outputCount
      : 1;
    const isCurrent = selectedModelMatches && (isImage ? (
      globalParams.aspectRatio === currentAspectRatio
      && globalParams.resolution === resolution
      && (!hasOutputCount || globalParams.outputCount === outputCount)
    ) : (
      globalParams.aspectRatio === currentVideoAspectRatio
      && globalParams.resolution === currentVideoResolution
      && globalParams.duration === currentDuration
      && globalParams.generateAudio === currentGenerateAudio
    ));
    if (isCurrent) return;
    setGlobalParams((current) => ({
      ...current,
      modelConfigId: selectedModelConfigId,
      ...(isImage ? {
        aspectRatio: currentAspectRatio,
        resolution,
        ...(hasOutputCount ? { outputCount } : {}),
      } : {
        videoModelId: selectedVideoModelId,
        aspectRatio: currentVideoAspectRatio,
        resolution: currentVideoResolution,
        duration: currentDuration,
        generateAudio: currentGenerateAudio,
      }),
    }));
    setGlobalDirty(true);
  }, [
    activeCapability,
    currentAspectRatio,
    currentDuration,
    currentGenerateAudio,
    currentResolution,
    currentVideoAspectRatio,
    currentVideoResolution,
    globalImageResolutions.join('|'),
    globalParams.aspectRatio,
    globalParams.duration,
    globalParams.generateAudio,
    globalParams.modelConfigId,
    globalParams.outputCount,
    globalParams.resolution,
    globalParams.videoModelId,
    selectedModelConfigId,
    selectedModelMatches,
    selectedGlobalModel?.id,
    selectedVideoModelId,
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
          onChange={(modelSelectionId) => {
            const nextModel = availableGlobalModels.find((model) => model.id === modelSelectionId);
            if (!nextModel) return;
            setGlobalParams((current) => ({
              ...current,
              modelConfigId: nextModel.configId || nextModel.id,
              ...(activeCapability?.mediaKind === 'video' ? { videoModelId: nextModel.model } : {}),
            }));
            setGlobalDirty(true);
          }}
          options={activeModelOptions}
          placeholder="选择模型"
          value={selectedGlobalModel?.id}
        />
      );
    }
    if (field.key === 'danceRemakeMode') {
      return (
        <Select
          onChange={update}
          options={[...danceRemakeModeOptions]}
          value={value === 'enhanced' ? 'enhanced' : 'standard'}
        />
      );
    }
    if (field.key === 'videoModelId' && activeCapability?.key === 'video.dance_remake') {
      return (
        <Select
          onChange={update}
          options={videoModelDefinitions.map((option) => ({ label: option.label, value: option.id }))}
          value={typeof value === 'string' ? value : danceRemakeDefaults.videoModelId}
        />
      );
    }
    if (field.key === 'quality' && activeCapability?.key === 'video.dance_remake') {
      return (
        <Select
          onChange={update}
          options={sharedVideoQualityOptions.map((option) => ({ label: option.label, value: option.label }))}
          value={value === '480P' || value === '普清 (480p)' ? '480P' : '720P'}
        />
      );
    }
    if (field.key === 'preserveAudio' && activeCapability?.key === 'video.dance_remake') {
      return <Switch checked={value !== false} onChange={update} size="small" />;
    }
    if (field.key === 'resolution') return null;
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
    if (field.key === 'aspectRatio' && activeCapability?.mediaKind === 'video') {
      return (
        <Popover
          arrow={false}
          classNames={{ root: 'video-output-size-popover' }}
          content={(
            <VideoOutputSizePicker
              aspectRatio={currentVideoAspectRatio}
              onAspectRatioChange={(aspectRatio) => {
                setGlobalParams((current) => ({ ...current, aspectRatio }));
                setGlobalDirty(true);
              }}
              onResolutionChange={(resolution) => {
                setGlobalParams((current) => ({ ...current, resolution }));
                setGlobalDirty(true);
              }}
              resolution={currentVideoResolution}
            />
          )}
          placement="bottomLeft"
          trigger="click"
        >
          <Button className="sheet-global-size-button" size="small" type="text">
            {currentVideoAspectRatio} · {currentVideoResolution}<ChevronDown size={12} />
          </Button>
        </Popover>
      );
    }
    if (field.key === 'aspectRatio') return <Select onChange={update} options={aspectRatioOptions} placeholder="画面比例" value={value as string | undefined} />;
    if (field.key === 'outputCount') return <Select onChange={update} options={outputCountOptions} placeholder="张数" value={value as number | undefined} />;
    if (field.key === 'duration') return <Select onChange={update} options={durationOptions} placeholder="时长" value={value as string | undefined} />;
    if (field.key === 'generateAudio') return <Switch checked={value === true} onChange={update} size="small" />;
    return <Input onChange={(event) => update(event.target.value)} value={String(value || '')} />;
  }

  const titleMenu: MenuProps['items'] = sheets.map((sheet) => ({
    key: sheet.id,
    label: sheet.name,
    onClick: () => { void activateSheet(sheet.id); },
  }));

  return (
    <main
      aria-busy={loading || switchingSheet}
      className={`sheet-workspace${switchingSheet ? ' sheet-workspace--switching' : ''}`}
    >
      <header className="sheet-workspace__header">
        <div className="sheet-workspace__breadcrumb">
          <span className="sheet-workspace__dot" /><span>批量</span><span className="sheet-workspace__slash">/</span>
          <SheetTitleEditor menuItems={titleMenu} onRename={renameSheet} sheet={activeSheet} />
          <span className="sheet-workspace__slash">/</span>
          <span className="sheet-workspace__new-state"><span className="sheet-workspace__state-dot" />{hasExecutingRows ? '执行中' : hasUnsavedChanges ? '未保存' : '已保存'}</span>
        </div>
        <div className="sheet-workspace__header-actions">
          <Button disabled={switchingSheet || !latestRun?.failedCount || retrying} loading={retrying} icon={<RotateCcw size={15} />} onClick={() => void retryFailed()}>重试所有失败</Button>
          <Button disabled={switchingSheet || !batchRunnableRows.length || batchRunning} loading={batchRunning} onClick={() => void runRows(batchRunnableRows.map((row) => row.id), 'batch')} type="primary">
            {selectedRows.length ? `批量执行(${batchRunnableRows.length})` : '批量执行'}
          </Button>
          <Button disabled={switchingSheet || !hasUnsavedChanges} loading={saving} onClick={() => void saveChanges()} type="primary">保存</Button>
        </div>
      </header>

      <Tabs
        activeKey={activeSheetId}
        className="sheet-workspace__tabs"
        items={sheets.map((sheet) => ({
          closable: sheets.length > 1,
          key: sheet.id,
          label: <SheetTabLabel onRename={renameSheet} sheet={sheet} />,
        }))}
        onChange={(sheetId) => { void activateSheet(sheetId); }}
        onEdit={(targetKey, action) => {
          if (action === 'add') {
            const capability = selectedCapability || capabilities[0];
            if (capability) setSuggestedSheetName(generateSheetName(capability.label));
            setCreateModalOpen(true);
          } else if (typeof targetKey === 'string') {
            confirmRemoveSheet(targetKey);
          }
        }}
        type="editable-card"
      />

      <section className="sheet-global-settings" aria-label="全局参数">
        <div className="sheet-global-settings__intro">
          <strong>全局参数</strong>
          <span>应用到所有行，行内可覆盖</span>
        </div>
        <div className="sheet-global-settings__divider" />
        {activeCapability?.globalFields.length ? (
          activeCapability.globalFields
            .filter((field) => field.key !== 'resolution'
              && (activeCapability.key !== 'video.dance_remake'
                || field.key === 'danceRemakeMode'
                || globalParams.danceRemakeMode === 'enhanced'))
            .map((field) => (
              <div className="sheet-global-settings__field" key={field.key}>
                {field.key === 'aspectRatio' && activeCapability.mediaKind === 'video' ? null : (
                  <span>{field.key === 'aspectRatio' && activeCapability.mediaKind === 'image' ? '画面尺寸' : field.label}</span>
                )}
                {renderGlobalField(field)}
              </div>
            ))
        ) : (
          <span className="sheet-global-settings__empty">此功能无全局参数</span>
        )}
      </section>

      <section className="sheet-toolbar" aria-label="表格工具栏">
        <span>{rows.length} / {MAX_ROWS} 行</span><i />
        <CompactButton icon={<Plus />} onClick={() => void addRow()}>新增行</CompactButton>
        <CompactButton disabled={!selectedRows.length || rows.length >= MAX_ROWS} icon={<Copy />} onClick={() => void copySelectedRows()}>复制</CompactButton>
        <CompactButton
          icon={<Columns3 />}
          onClick={() => {
            gridRef.current?.api.resetColumnState();
            requestAnimationFrame(syncGridContainerWidth);
            message.success('已恢复默认列宽');
          }}
        >
          列宽
        </CompactButton>
      </section>

      <div className="sheet-table-area">
        <section
          className={`sheet-grid${gridLayoutReady ? '' : ' sheet-grid--measuring'}`}
          aria-label="批量生成表格"
          ref={gridContainerRef}
          style={{ width: configuredGridWidth }}
        >
          <AgGridReact<BatchRow>
              ref={gridRef}
              animateRows={false}
              columnDefs={columns}
              suppressColumnMoveAnimation
            defaultColDef={{
              resizable: true,
              sortable: false,
                suppressMovable: true,
                suppressHeaderMenuButton: true,
              }}
              fullWidthCellRenderer={() => (
                <div className="batch-generation-grid-add-row">
                  <Button
                    disabled={rows.length >= MAX_ROWS}
                    icon={<Plus size={16} />}
                    onClick={() => void addRow()}
                    type="dashed"
                  >
                    新增一行
                  </Button>
                </div>
              )}
              getRowId={(params) => params.data.id}
              getRowHeight={(params) => params.data?.id === GRID_ADD_ROW_ID ? 44 : undefined}
              headerHeight={42}
              isFullWidthRow={(params) => params.rowNode.data?.id === GRID_ADD_ROW_ID}
              isRowSelectable={(node) => {
                const row = node.data;
                if (!row) return false;
                return row.id !== GRID_ADD_ROW_ID
                  && !['queued', 'running'].includes(row.executionStatus);
              }}
              loading={loading || switchingSheet}
            onBodyScroll={() => {
              setActiveGridCanvas(null);
              setActiveGridSelect(null);
              setActivePromptEditor(null);
              hideGridTooltip();
            }}
            onColumnResized={(event) => {
              if (event.finished) syncGridContainerWidth();
            }}
            onModelUpdated={scheduleGridReveal}
            onNewColumnsLoaded={syncGridContainerWidth}
            onSelectionChanged={(event) => {
              setSelectedRowIds(event.api.getSelectedRows().map((row) => row.id));
            }}
            overlayNoRowsTemplate="暂无表格行"
              rowData={gridRows}
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
        <GridCanvasOverlay
          activeCanvas={activeGridCanvas}
          onAspectRatioChange={(rowId, aspectRatio) => {
            updateRowParams(rowId, 'aspectRatio', aspectRatio);
            setActiveGridCanvas((current) => current?.rowId === rowId ? { ...current, aspectRatio } : current);
          }}
          onResolutionChange={(rowId, resolution) => {
            updateRowParams(rowId, 'resolution', resolution);
            setActiveGridCanvas((current) => current?.rowId === rowId ? { ...current, resolution } : current);
          }}
        />
        <GridSelectOverlay
          activeSelect={activeGridSelect}
          onChange={(rowId, fieldKey, value) => {
            updateRowParams(rowId, fieldKey, value);
            setActiveGridSelect(null);
          }}
        />
        <GridPromptEditorOverlay
          activeEditor={activePromptEditor}
          activeRow={activePromptRow}
          editorRef={promptEditorRef}
          onCancel={() => closePromptEditor(true)}
          onChange={updateRowParams}
          onSave={() => closePromptEditor()}
          options={activePromptOptions}
          value={activePromptValue}
        />
        <GridTooltipOverlay tooltip={activeGridTooltip} />
        <input hidden onChange={handleAssetInputChange} ref={assetInputRef} type="file" />
        {activeAssetPreview ? (
          <AppImage.PreviewGroup
            downloads={activeAssetPreview.items.map((item) => ({ fileName: item.alt, url: item.src }))}
            items={activeAssetPreview.items}
            preview={{
              current: activeAssetPreview.current,
              onChange: (current) => setActiveAssetPreview((preview) => preview ? { ...preview, current } : null),
              onOpenChange: (open, info) => {
                if (!open) {
                  setActiveAssetPreview(null);
                  return;
                }
                setActiveAssetPreview((preview) => preview
                  ? { ...preview, current: info.current ?? preview.current }
                  : null);
              },
              open: true,
            }}
          />
        ) : null}
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
