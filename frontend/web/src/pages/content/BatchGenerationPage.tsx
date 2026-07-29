import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import {
  AllCommunityModule,
  ModuleRegistry,
  themeQuartz,
} from 'ag-grid-community';
import type { ColDef, ICellRendererParams, ValueSetterParams } from 'ag-grid-community';
import { AgGridReact } from 'ag-grid-react';
import { useSearchParams } from 'react-router-dom';
import { CreditIcon } from '@shared/components/CreditIcon';
import { formatCreditAmount } from '@shared/utils/credits';
import {
  estimateImageGenerationCredits,
  resolveImageGenerationOutputCount,
} from '@shared/utils/imageGenerationCredits';
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
  message,
} from 'antd';
import type { MenuProps } from 'antd';
import {
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  Maximize2,
  Play,
  Plus,
  RotateCcw,
  Scan,
  Trash2,
  UploadCloud,
  X,
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
  BatchExecutionStatus,
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
import { MentionRichTextarea, type MentionRichTextareaOption, type MentionRichTextareaRef } from '../../components/MentionRichTextarea';
import {
  appRealtimeEventNames,
  type AppBatchGenerationRunUpdatedDetail,
} from '../../events/appRealtimeEvents';
import type { ContentAsset } from '../../types';
import './BatchGenerationPage.scss';

const MAX_ROWS = 200;
const MAX_REFERENCE_IMAGE_COUNT = 8;
const LOCAL_ROW_ID_PREFIX = 'local-row:';
const GRID_ADD_ROW_ID = 'grid-control:add-row';
const LAST_ACTIVE_SHEET_STORAGE_KEY = 'batch-generation:last-sheet-id';
const PREFERRED_VIDEO_MODEL_ID = 'doubao-seedance-2-0-260128';

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

type ActivePromptEditor = {
  anchor: { height: number; left: number; top: number; width: number };
  fieldKey: string;
  initialValue: string;
  mode: 'inline' | 'fullscreen';
  rowId: string;
};

type PendingAssetUpload = {
  field: CreativeCapabilityField;
  maxCount: number;
  remainingCount: number;
  row: BatchRow;
};

type ActiveAssetPreview = {
  current: number;
  items: Array<{ alt: string; src: string }>;
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

type GridPromptCellProps = {
  disabled?: boolean;
  options: MentionRichTextareaOption[];
  value: string;
  onFullscreen: (anchor: HTMLElement) => void;
  onOpen: (anchor: HTMLElement) => void;
};

function GridPromptCell({ disabled, options, value, onFullscreen, onOpen }: GridPromptCellProps) {
  const optionByToken = new Map(options.map((option) => [option.token, option]));
  const tokens = [...optionByToken.keys()].sort((left, right) => right.length - left.length);
  const paragraphs = value.split('\n').map((line, lineIndex) => {
    const content: ReactNode[] = [];
    let cursor = 0;

    while (cursor < line.length) {
      const token = tokens.find((item) => line.startsWith(item, cursor));
      if (!token) {
        const nextTokenIndex = tokens
          .map((item) => line.indexOf(item, cursor + 1))
          .filter((index) => index !== -1)
          .sort((left, right) => left - right)[0] ?? line.length;
        content.push(line.slice(cursor, nextTokenIndex));
        cursor = nextTokenIndex;
        continue;
      }

      const option = optionByToken.get(token)!;
      const mentionKind = option.mimeType?.startsWith('video/')
        ? 'video'
        : option.mimeType?.startsWith('audio/') ? 'audio' : 'image';
      content.push(
        <span className="mention-rich-textarea-chip batch-generation-grid-prompt-mention" data-mention-kind={mentionKind} key={`${lineIndex}:${token}:${cursor}`}>
          {mentionKind === 'image' && option.previewUrl ? <img alt="" src={option.previewUrl} /> : null}
          {mentionKind === 'video' ? <span className="mention-rich-textarea-chip-icon">视</span> : null}
          {mentionKind === 'audio' ? <span className="mention-rich-textarea-chip-icon">♪</span> : null}
          <b>{option.label}</b>
        </span>,
      );
      cursor += token.length;
    }

    return <p key={lineIndex}>{content.length ? content : <br />}</p>;
  });

  return (
    <div
      aria-disabled={disabled}
      className={`batch-generation-grid-prompt-cell${disabled ? ' batch-generation-grid-prompt-cell--disabled' : ''}`}
      onPointerDown={(event) => {
        event.stopPropagation();
        if (!disabled) onOpen(event.currentTarget);
      }}
      role="button"
      tabIndex={disabled ? -1 : 0}
      onKeyDown={(event) => {
        if (!disabled && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          onOpen(event.currentTarget);
        }
      }}
    >
      {!disabled ? (
        <button
          aria-label="全屏编辑提示词"
          className="batch-generation-grid-prompt-cell__fullscreen"
          onClick={(event) => {
            event.stopPropagation();
            onFullscreen(event.currentTarget.closest('.batch-generation-grid-prompt-cell') || event.currentTarget);
          }}
          onPointerDown={(event) => event.stopPropagation()}
          type="button"
        >
          <Maximize2 size={12} />
        </button>
      ) : null}
      <div className="batch-generation-grid-prompt-cell__content">
        {value ? paragraphs : <span className="batch-generation-grid-prompt-cell__placeholder">输入提示词，使用 @ 引用素材</span>}
      </div>
    </div>
  );
}

const capabilityColors = [
  '#3f82ef', '#ec4899', '#0ea5e9', '#f43f5e', '#06b6d4', '#f59e0b',
  '#f97316', '#10b981', '#a855f7', '#d946ef', '#e11d48', '#14b8a6',
  '#eab308', '#6366f1', '#7c3aed', '#0284c7', '#db2777', '#ea580c',
];

const statusMeta: Record<BatchExecutionStatus, { label: string; tone: 'done' | 'processing' | 'failed' | 'pending' }> = {
  idle: { label: '待提交', tone: 'pending' },
  queued: { label: '排队中', tone: 'processing' },
  running: { label: '处理中', tone: 'processing' },
  completed: { label: '已完成', tone: 'done' },
  partial_failed: { label: '部分失败', tone: 'failed' },
  failed: { label: '失败', tone: 'failed' },
  canceled: { label: '已取消', tone: 'pending' },
};

const imageResolutionOptions = [
  { label: '1K', value: '1K' },
  { label: '2K', value: '2K' },
  { label: '4K', value: '4K' },
];
const aspectRatioOptions = ['auto', '1:1', '3:4', '4:3', '9:16', '16:9'].map((value) => ({ label: value, value }));
const outputCountOptions = [1, 2, 3, 4].map((value) => ({ label: `${value} 张`, value }));
const durationOptions = [5, 10, 15].map((value) => ({ label: `${value}s`, value: `${value}秒` }));

type AvailableBatchModelOption = BatchGenerationModelOption & {
  configId: string;
  disabled?: boolean;
};

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

function estimatedImageCredits(
  row: BatchRow,
  capability: CreativeCapability | undefined,
  globalParams: Record<string, unknown>,
  modelOptions: BatchGenerationModelOption[],
) {
  if (!capability || capability.mediaKind !== 'image') return undefined;
  const modelConfigId = String(valueAt(row.params, 'modelConfigId') ?? globalParams.modelConfigId ?? '');
  const model = modelOptions.find((option) => option.id === modelConfigId && option.type === 'image');
  if (!model) return undefined;

  const configuredOutputCount = Number(valueAt(row.params, 'outputCount') ?? globalParams.outputCount ?? 1);
  const uploadedImageCount = capability.rowFields.reduce((count, field) => {
    if (field.valueType === 'asset-list') return count + stringArray(valueAt(row.params, field.key)).length;
    if (field.valueType === 'asset') return count + (valueAt(row.params, field.key) ? 1 : 0);
    return count;
  }, 0);
  const outputCount = resolveImageGenerationOutputCount({
    strategy: capability.outputCountStrategy,
    requestedCount: Number.isFinite(configuredOutputCount) ? configuredOutputCount : 1,
    uploadedImageCount,
    referenceGroupImageCount: capability.outputCountGroupKey
      ? stringArray(valueAt(row.params, `referenceGroups.${capability.outputCountGroupKey}`)).length
      : 0,
  });
  return estimateImageGenerationCredits(model.creditsPerRequest, outputCount);
}

function rowAssetIds(rows: BatchRow[], capability?: CreativeCapability) {
  const assetFields = capability?.rowFields.filter((field) => field.valueType === 'asset' || field.valueType === 'asset-list') || [];
  return [...new Set(rows.flatMap((row) => assetFields.flatMap((field) => {
    const value = valueAt(row.params, field.key);
    return field.valueType === 'asset-list' ? stringArray(value) : typeof value === 'string' ? [value] : [];
  })).filter(Boolean))];
}

function promptMentionOptions(
  row: BatchRow,
  capability: CreativeCapability | undefined,
  assets: Record<string, ContentAsset>,
): MentionRichTextareaOption[] {
  let imageIndex = 1;
  let videoIndex = 1;
  let audioIndex = 1;

  return (capability?.rowFields || []).flatMap((field) => {
    if (field.valueType !== 'asset' && field.valueType !== 'asset-list') return [];
    const value = valueAt(row.params, field.key);
    const ids = field.valueType === 'asset-list'
      ? stringArray(value)
      : typeof value === 'string' && value ? [value] : [];

    return ids.map((id) => {
      const asset = assets[id];
      const mimeType = asset?.mimeType || (assetAccept(field) === 'video/*'
        ? 'video/*'
        : assetAccept(field) === 'audio/*' ? 'audio/*' : 'image/*');
      const isVideo = mimeType.startsWith('video/');
      const isAudio = mimeType.startsWith('audio/');
      const label = isVideo
        ? `视频${videoIndex++}`
        : isAudio ? `音频${audioIndex++}` : `图${imageIndex++}`;
      return {
        attachmentId: id,
        label,
        mimeType,
        name: asset?.name || asset?.originalFileName || label,
        previewUrl: isAudio ? '' : resolveAssetUrl(asset?.fileUrl),
        subtitle: field.label,
        token: `@${label}`,
      } satisfies MentionRichTextareaOption;
    });
  });
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
  availableModels: AvailableBatchModelOption[],
) {
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
  const initialUrlSheetIdRef = useRef(urlSheetId);
  const initialDataLoadedRef = useRef(false);
  const pendingLocationSheetIdRef = useRef<string | null>(null);
  const activeSheetIdRef = useRef('');
  const sheetLoadRequestRef = useRef(0);
  const sheetSwitchFrameRef = useRef<number | null>(null);
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
  const [switchingSheetRequest, setSwitchingSheetRequest] = useState<{ requestId: number; sheetId: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [uploadingCell, setUploadingCell] = useState('');
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [selectedCapabilityKey, setSelectedCapabilityKey] = useState('');
  const [newSheetName, setNewSheetName] = useState('');
  const [suggestedSheetName, setSuggestedSheetName] = useState('');
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
    return true;
  }, [capabilities, loadAssetsById, loadAttemptAssets, loadLatestRun]);

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

  useEffect(() => () => {
    if (sheetSwitchFrameRef.current !== null) cancelAnimationFrame(sheetSwitchFrameRef.current);
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
      void loadAttemptAssets(run.attempts);
      if (['completed', 'partial_failed', 'failed', 'canceled'].includes(run.status)) {
        setRunning(false);
        void loadSheet(run.sheetId);
      }
    };
    window.addEventListener(appRealtimeEventNames.batchGenerationRunUpdated, handleRun);
    return () => window.removeEventListener(appRealtimeEventNames.batchGenerationRunUpdated, handleRun);
  }, [loadAttemptAssets, loadSheet]);

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

  function closePromptEditor(revert = false) {
    if (revert && activePromptEditor && activePromptRow) {
      updateRowParams(activePromptRow.id, activePromptEditor.fieldKey, activePromptEditor.initialValue);
    }
    setActivePromptEditor(null);
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

  function renderAssetField(field: CreativeCapabilityField, row: BatchRow) {
    const storedValue = valueAt(row.params, field.key);
    const ids = field.valueType === 'asset-list'
      ? stringArray(storedValue)
      : typeof storedValue === 'string' && storedValue ? [storedValue] : [];
    const isImageField = assetAccept(field) === 'image/*';
    const maxCount = field.valueType === 'asset-list' ? MAX_REFERENCE_IMAGE_COUNT : 1;
    const uploadDisabled = ['queued', 'running'].includes(row.executionStatus);
    const isUploading = uploadingCell === `${row.id}:${field.key}`;
    if (isImageField) {
      const canUpload = ids.length < maxCount;
      const previewItems = ids.flatMap((id, index) => {
        const asset = assets[id];
        const src = resolveAssetUrl(asset?.fileUrl);
        return src ? [{
          alt: asset?.name || asset?.originalFileName || `${assetLabel(field)} ${index + 1}`,
          id,
          src,
        }] : [];
      });
      return (
        <div className="batch-generation-grid-assets">
          {ids.map((id, index) => {
            const asset = assets[id];
            const src = resolveAssetUrl(asset?.fileUrl);
            const alt = asset?.name || asset?.originalFileName || `${assetLabel(field)} ${index + 1}`;
            return (
              <div className="batch-generation-grid-asset" key={id}>
                {src ? (
                  <button
                    aria-label={`预览${alt}`}
                    className="batch-generation-grid-asset__preview"
                    onClick={(event) => {
                      event.stopPropagation();
                      setActiveAssetPreview({
                        current: Math.max(0, previewItems.findIndex((item) => item.id === id)),
                        items: previewItems.map((item) => ({ alt: item.alt, src: item.src })),
                      });
                    }}
                    onPointerDown={(event) => event.stopPropagation()}
                    type="button"
                  >
                    <img alt={alt} className="batch-generation-grid-asset__image" height={40} loading="lazy" src={src} width={40} />
                  </button>
                ) : <span className="batch-generation-grid-asset__placeholder"><UploadCloud size={15} /></span>}
                {!uploadDisabled ? (
                  <button
                    aria-label={`移除${alt}`}
                    className="batch-generation-grid-asset__remove"
                    onClick={(event) => {
                      event.stopPropagation();
                      const nextIds = ids.filter((assetId) => assetId !== id);
                      updateRowParams(row.id, field.key, field.valueType === 'asset-list' ? nextIds : undefined);
                    }}
                    onPointerDown={(event) => event.stopPropagation()}
                    type="button"
                  >
                    <X size={10} strokeWidth={2.4} />
                  </button>
                ) : null}
              </div>
            );
          })}
          {canUpload ? (
            <div className="batch-generation-grid-asset-upload">
              <button
                aria-label={`添加${field.label}`}
                className="batch-generation-grid-asset-add"
                disabled={uploadDisabled || isUploading}
                onClick={() => openAssetUpload(row, field, ids.length, maxCount)}
                onPointerDown={(event) => event.stopPropagation()}
                type="button"
              >
                {isUploading
                  ? <span className="batch-generation-grid-asset-add__spinner" />
                  : <Plus size={18} />}
              </button>
              {ids.length ? <span className="batch-generation-grid-asset-upload__count">{ids.length}/{maxCount}</span> : null}
            </div>
          ) : null}
        </div>
      );
    }
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
        {ids.length < maxCount ? (
          <Button
            aria-label={`添加${field.label}`}
            disabled={uploadDisabled || isUploading}
            icon={<UploadCloud size={15} />}
            loading={isUploading}
            onClick={() => openAssetUpload(row, field, ids.length, maxCount)}
            size="small"
            type="dashed"
          >
            添加
          </Button>
        ) : null}
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
      const isPrompt = field.key === 'prompt';
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
        cellEditor: isPrompt ? undefined
          : field.valueType === 'number' ? 'agNumberCellEditor'
            : field.valueType === 'string' ? 'agLargeTextCellEditor'
              : undefined,
        cellEditorParams: field.valueType === 'string' && !isPrompt
          ? { cols: 50, maxLength: 10000, rows: 6 }
          : undefined,
        cellEditorPopup: !isPrompt && !selectOptions.length && field.valueType === 'string',
        cellRenderer: isPrompt
          ? (params: ICellRendererParams<BatchRow>) => params.data ? (
            <GridPromptCell
              disabled={['queued', 'running'].includes(params.data.executionStatus)}
              onFullscreen={(anchor) => {
                const cell = anchor.closest('.ag-cell') || anchor;
                const rect = cell.getBoundingClientRect();
                setActiveGridSelect(null);
                setActivePromptEditor({
                  anchor: { height: rect.height, left: rect.left, top: rect.top, width: rect.width },
                  fieldKey: field.key,
                  initialValue: String(effectiveValue(params.data!) ?? ''),
                  mode: 'fullscreen',
                  rowId: params.data!.id,
                });
              }}
              onOpen={(anchor) => {
                const cell = anchor.closest('.ag-cell') || anchor;
                const rect = cell.getBoundingClientRect();
                setActiveGridSelect(null);
                setActivePromptEditor((current) => {
                  if (current?.rowId === params.data!.id && current.fieldKey === field.key) return null;
                  return {
                    anchor: { height: rect.height, left: rect.left, top: rect.top, width: rect.width },
                    fieldKey: field.key,
                    initialValue: String(effectiveValue(params.data!) ?? ''),
                    mode: 'inline',
                    rowId: params.data!.id,
                  };
                });
              }}
              options={promptMentionOptions(params.data, activeCapability, assets)}
              value={String(effectiveValue(params.data) ?? '')}
            />
          ) : null
          : isAsset
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
          && !isPrompt
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
        headerClass: 'batch-generation-grid-index-header',
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
        cellClass: 'batch-generation-grid-status-cell',
        cellRenderer: (params: ICellRendererParams<BatchRow>) => {
          if (!params.data) return null;
          const status = attemptForRow(params.data.id)?.status || params.data.executionStatus;
          const meta = statusMeta[status];
          return (
            <span className={`sheet-task-stats__${meta.tone}`}>
              <span className="sheet-task-stats__dot" />
              {meta.label}
            </span>
          );
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
        cellClass: 'batch-generation-grid-credits-cell',
        cellRenderer: (params: ICellRendererParams<BatchRow, number>) => {
          const value = formatCreditAmount(params.value ?? 0);
          return (
            <span aria-label={`预计消耗 ${value} 积分`} className="batch-generation-grid-credit-value">
              <CreditIcon />
              {value}
            </span>
          );
        },
        colId: 'credits',
        editable: false,
        headerName: '消耗积分',
        minWidth: 96,
        valueGetter: (params) => params.data
          ? estimatedImageCredits(params.data, activeCapability, globalParams, modelOptions)
            ?? attemptForRow(params.data.id)?.estimatedCredits
            ?? 0
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
          <span className="sheet-workspace__dot" /><span>表格</span><span className="sheet-workspace__slash">/</span>
          <Dropdown menu={{ items: titleMenu }} trigger={['click']}>
            <button className="sheet-workspace__title-button" type="button"><strong>{activeSheet?.name || '批量生成'}</strong><ChevronDown size={18} /></button>
          </Dropdown>
          <span className="sheet-workspace__slash">/</span>
          <span className="sheet-workspace__new-state"><span className="sheet-workspace__state-dot" />{running ? '执行中' : hasUnsavedChanges ? '未保存' : '已保存'}</span>
        </div>
        <div className="sheet-workspace__header-actions">
          <Button disabled={switchingSheet || !latestRun?.failedCount || running} icon={<RotateCcw size={15} />} onClick={() => void retryFailed()}>重试所有失败</Button>
          <Button disabled={switchingSheet || !rows.length || running} loading={running} onClick={() => void runRows(selectedRowIds.length ? selectedRowIds : undefined)} type="primary">批量执行</Button>
          <Button disabled={switchingSheet || !hasUnsavedChanges} icon={<Check size={16} />} loading={saving} onClick={() => void saveChanges()} type="primary">保存</Button>
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
        onChange={(sheetId) => { void activateSheet(sheetId); }}
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
          .filter((field) => field.key !== 'resolution')
          .map((field) => (
            <div className="sheet-global-settings__field" key={field.key}>
              {field.key === 'aspectRatio' && activeCapability?.mediaKind === 'video' ? null : (
                <span>{field.key === 'aspectRatio' && activeCapability?.mediaKind === 'image' ? '画面尺寸' : field.label}</span>
              )}
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
              isRowSelectable={(node) => node.data?.id !== GRID_ADD_ROW_ID}
              loading={loading || switchingSheet}
            onBodyScroll={() => {
              setActiveGridSelect(null);
              setActivePromptEditor(null);
              hideGridTooltip();
            }}
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
        <div
          aria-hidden={!activePromptEditor || !activePromptRow}
          className={`batch-generation-grid-prompt-editor${activePromptEditor?.mode === 'fullscreen' ? ' batch-generation-grid-prompt-editor--fullscreen' : ''}${activePromptEditor && activePromptRow ? '' : ' batch-generation-grid-prompt-editor--hidden'}`}
          role={activePromptEditor?.mode === 'fullscreen' ? 'dialog' : undefined}
          style={activePromptEditor && activePromptRow ? {
            height: activePromptEditor.mode === 'fullscreen' ? 380 : undefined,
            left: activePromptEditor.mode === 'fullscreen'
              ? Math.max(12, Math.min(activePromptEditor.anchor.left + 8, window.innerWidth - 532))
              : activePromptEditor.anchor.left,
            top: activePromptEditor.mode === 'fullscreen'
              ? Math.max(12, Math.min(activePromptEditor.anchor.top + 8, window.innerHeight - 392))
              : activePromptEditor.anchor.top,
            width: activePromptEditor.mode === 'fullscreen' ? 520 : activePromptEditor.anchor.width,
          } : undefined}
        >
          {activePromptEditor?.mode === 'fullscreen' ? (
            <header className="batch-generation-grid-prompt-editor__header">
              <div>
                <strong>编辑提示词</strong>
                <span><kbd>Ctrl / Cmd + Enter</kbd> 保存</span>
                <span><kbd>Esc</kbd> 取消</span>
              </div>
              <button aria-label="取消编辑" onClick={() => closePromptEditor(true)} type="button"><X size={18} /></button>
            </header>
          ) : null}
          <div className="batch-generation-grid-prompt-editor__body">
            <MentionRichTextarea
              editorClassName="batch-generation-grid-prompt-editor__content"
              emptyText="暂无可引用素材"
              enableHardBreak
              menuTitle="可引用素材"
              minHeight={activePromptEditor?.mode === 'fullscreen' ? 0 : activePromptEditor?.anchor.height ?? 0}
              minRows={1}
              onChange={(value) => {
                if (activePromptRow && activePromptEditor) {
                  updateRowParams(activePromptRow.id, activePromptEditor.fieldKey, value);
                }
              }}
              options={activePromptOptions}
              placeholder="输入提示词，使用 @ 引用素材"
              ref={promptEditorRef}
              suggestionContainer="body"
              value={activePromptValue}
            />
          </div>
          {activePromptEditor?.mode === 'fullscreen' ? (
            <footer className="batch-generation-grid-prompt-editor__footer">
              <span>{activePromptValue.length} 字</span>
              <div>
                <Button onClick={() => closePromptEditor(true)}>取消</Button>
                <Button onClick={() => closePromptEditor()} type="primary">保存</Button>
              </div>
            </footer>
          ) : null}
        </div>
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
