import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Dropdown, Input, Modal, Pagination, Popconfirm, message } from 'antd';
import type { MenuProps } from 'antd';
import { ListFilter, Plus, Search, Trash2 } from 'lucide-react';
import {
  createContentAssetGroup,
  deleteContentAsset,
  deleteContentAssetGroup,
  listContentAssetGroups,
  listContentAssets,
  updateContentAssetGroup,
  uploadContentAsset,
} from '../../api/content';
import { API_BASE_URL } from '../../api/request';
import { AppImage } from '../../components/AppImage';
import { AppButton } from '@shared/components/AppButton';
import { AppSegmentedTabs } from '../../components/AppSegmentedTabs';
import { AssetLibraryCard, AssetLibraryCreateCard, AssetLibraryPlaceholderCard, AssetLibrarySkeletonCards } from '../../components/AssetLibraryCard';
import { InfiniteScroll } from '../../components/InfiniteScroll';
import type { ContentAsset, ContentAssetGroup, ContentResourceType, User } from '../../types';
import { formatRelativeCalendarDateTime } from '../../utils/dateTime';
import { withAuthToken } from '../../utils/session';
import { ContentStudioLayout } from '../../layouts/ContentStudioLayout';
import { ResultVideoPreviewModal } from './VideoTaskClonePage/components/ResultVideoPreviewModal';
import type { ReferenceMaterialPreviewAsset } from './VideoTaskClonePage/components/MaterialPanel';
import { DetailImageUpload, PendingImageUpload } from './assets/AssetImageUpload';
import type { ImagePreview } from './assets/AssetImageUpload';
import { useCardGridPageSize } from './assets/useCardGridPageSize';
import { WorksAssetCard, WorksAssetEmptyCard, WorksAssetSkeletonCard } from './assets/WorksAssetCard';
import { getVideoWorkSource, stringMetadataValue } from './assets/worksAssetSource';
import './assets/AssetLibraryPages.scss';

type ContentResourceLibraryPageProps = {
  currentUser: User;
  resourceType: ContentResourceType;
  resourceOverride?: Partial<ResourceCopy>;
  singleDefaultGroup?: boolean;
};

type ResourceCopy = {
  breadcrumb: string;
  icon: string;
  defaultGroup: string;
  pageTitle: string;
  pageDescription: string;
  steps: string[];
  addTitle: string;
  addHint: string;
  nameLabel: string;
  namePlaceholder: string;
  uploadTitle: string;
  uploadHint: string;
  createOkText: string;
  emptyGroups: string;
  emptyAssets: string;
  detailUploadText: string;
  detailAddText: string;
  assetUnit: string;
  accept: string;
};

type WorksAssetTab = 'all' | 'image' | 'video';

type WorksAssetDateGroup = {
  key: string;
  label: string;
  assets: ContentAsset[];
};

type WorksFunctionOption = {
  key: string;
  label: string;
  modeKeys: string[];
  modeTitles: string[];
};

const allWorksFunctionOption: WorksFunctionOption = {
  key: 'all',
  label: '全部功能',
  modeKeys: [],
  modeTitles: [],
};

const imageWorksFunctionOptions: WorksFunctionOption[] = [
  { key: 'image:dialog', label: '对话生图', modeKeys: ['dialog'], modeTitles: ['对话生图'] },
  { key: 'image:detail', label: '详情图生成', modeKeys: ['detail'], modeTitles: ['详情图生成'] },
  { key: 'image:outfit', label: '换装', modeKeys: ['outfit'], modeTitles: ['换装'] },
  { key: 'image:model-views', label: '模特三视图', modeKeys: ['model-views'], modeTitles: ['模特三视图'] },
  { key: 'image:pose-reference', label: '姿势参考', modeKeys: ['pose-reference'], modeTitles: ['姿势参考'] },
  { key: 'image:upscale', label: '高清放大', modeKeys: ['upscale'], modeTitles: ['高清放大'] },
  { key: 'image:cutout', label: '图片抠图', modeKeys: ['cutout'], modeTitles: ['图片抠图'] },
  { key: 'image:background', label: '换背景', modeKeys: ['background'], modeTitles: ['换背景'] },
  { key: 'image:scene-extract', label: '场景提取', modeKeys: ['scene-extract'], modeTitles: ['场景提取'] },
  { key: 'image:model-face-swap', label: '模特换脸', modeKeys: ['model-face-swap'], modeTitles: ['模特换脸'] },
  { key: 'image:head-swap', label: '智能换头', modeKeys: ['head-swap'], modeTitles: ['智能换头'] },
  { key: 'image:face-swap', label: '智能换脸', modeKeys: ['face-swap'], modeTitles: ['智能换脸'] },
  { key: 'image:redraw', label: '智能重绘', modeKeys: ['redraw'], modeTitles: ['智能重绘'] },
  { key: 'image:detail-enhance', label: '细节增强', modeKeys: ['detail-enhance'], modeTitles: ['细节增强'] },
  { key: 'image:print-extract', label: '印花提取', modeKeys: ['print-extract'], modeTitles: ['印花提取'] },
  { key: 'image:face-enhance', label: '脸部增强', modeKeys: ['face-enhance'], modeTitles: ['脸部增强'] },
];

const videoWorksFunctionOptions: WorksFunctionOption[] = [
  { key: 'video:all', label: '视频生成', modeKeys: [], modeTitles: [] },
  { key: 'video:creation', label: '视频生成-视频创作', modeKeys: [], modeTitles: [] },
  { key: 'video:talking-video', label: '视频生成-口播视频生成', modeKeys: [], modeTitles: [] },
  { key: 'video:remake', label: '视频生成-爆款复刻', modeKeys: [], modeTitles: [] },
  { key: 'video:upscale', label: '视频生成-高清放大', modeKeys: [], modeTitles: [] },
  { key: 'video:subtitle-removal', label: '视频生成-字幕擦除', modeKeys: [], modeTitles: [] },
  { key: 'video:translation', label: '视频生成-视频翻译', modeKeys: [], modeTitles: [] },
];

const showWorksBatchButton = false;
const finishedAssetsPageSize = 20;

const resourceCopy: Record<ContentResourceType, ResourceCopy> = {
  digital_human: {
    breadcrumb: '素材库 / 数字人形象',
    icon: '👤',
    defaultGroup: '数字人项目',
    pageTitle: '数字人形象',
    pageDescription: '上传本人清晰照片，沉淀为可用于视频出镜的数字人项目；项目内可管理训练照片、三视图素材和后续生成结果。',
    steps: ['上传本人照片', '生成人物三视图', '用于视频出镜'],
    addTitle: '新增数字人',
    addHint: '创建人物档案并上传照片',
    nameLabel: '数字人名称',
    namePlaceholder: '例如：创始人口播、客服小陈、导购形象',
    uploadTitle: '上传本人照片',
    uploadHint: '建议上传正脸、半身、不同角度的清晰照片；后续可生成正面/侧面/背面三视图',
    createOkText: '创建数字人项目',
    emptyGroups: '暂无数字人项目，可创建人物档案后上传照片。',
    emptyAssets: '该数字人暂无照片或三视图素材，可以上传本人照片后继续生成。',
    detailUploadText: '上传照片',
    detailAddText: '添加照片',
    assetUnit: '张照片',
    accept: 'image/*',
  },
  virtual_portrait: {
    breadcrumb: '素材库 / 人物素材',
    icon: '🧑',
    defaultGroup: '虚拟人像项目',
    pageTitle: '人物素材',
    pageDescription: '管理可用于视频出镜的人物素材；成品会同步到私域人物素材资产库。',
    steps: ['上传训练照片', '生成三视图成品', '同步私域入库'],
    addTitle: '新增虚拟人像',
    addHint: '创建虚拟人像档案并上传照片',
    nameLabel: '名称',
    namePlaceholder: '例如：品牌代言人、导购形象、知识博主',
    uploadTitle: '上传本人照片',
    uploadHint: '建议上传正脸、半身、不同角度的清晰照片；成品入库成功后可用于视频出镜',
    createOkText: '创建虚拟人像项目',
    emptyGroups: '暂无虚拟人像项目，可创建素材档案后上传照片。',
    emptyAssets: '该虚拟人像暂无照片或三视图素材，可以上传本人照片后继续生成。',
    detailUploadText: '上传照片',
    detailAddText: '添加照片',
    assetUnit: '张照片',
    accept: 'image/*',
  },
  voice: {
    breadcrumb: '素材库 / 人声素材',
    icon: '🎙️',
    defaultGroup: '克隆音库',
    pageTitle: '人声素材',
    pageDescription: '上传一段干净的人声音频，生成可复用的克隆音库；音库后续用于视频口播、试听和批量合成。',
    steps: ['上传人声音频', '生成克隆音色', '用于口播合成'],
    addTitle: '新增音库',
    addHint: '创建音库并上传样本',
    nameLabel: '音库名称',
    namePlaceholder: '例如：老板本人音色、温柔女声、专业讲解音',
    uploadTitle: '上传音频样本',
    uploadHint: '建议上传 30 秒以上、环境安静、单人说话的音频；支持继续补充样本提升稳定性',
    createOkText: '创建克隆音库',
    emptyGroups: '暂无克隆音库，可创建音库后上传声音样本。',
    emptyAssets: '该音库暂无音频样本，可以上传干净人声后继续克隆。',
    detailUploadText: '上传样本',
    detailAddText: '添加样本',
    assetUnit: '段音频',
    accept: 'audio/*',
  },
  scene: {
    breadcrumb: '素材库 / 场景素材',
    icon: '🎬',
    defaultGroup: '场景分组',
    pageTitle: '场景素材',
    pageDescription: '管理可用于视频背景、产品展示和氛围切换的图片素材；按场景分组，方便在视频生成流程中快速选择。',
    steps: ['创建场景分组', '上传图片素材', '视频中选择使用'],
    addTitle: '新增场景分组',
    addHint: '创建分组并上传图片',
    nameLabel: '场景分组名称',
    namePlaceholder: '例如：直播间背景、门店环境、产品展示台',
    uploadTitle: '上传场景图片',
    uploadHint: '建议上传横图或竖图场景图片，可按空间、渠道、活动主题建立分组',
    createOkText: '创建场景分组',
    emptyGroups: '暂无场景分组，可创建分组后管理图片素材。',
    emptyAssets: '该分组暂无场景图片，可以点击“上传图片”添加。',
    detailUploadText: '上传图片',
    detailAddText: '添加图片',
    assetUnit: '张图片',
    accept: 'image/*',
  },
  product: {
    breadcrumb: '素材库 / 产品素材',
    icon: '📦',
    defaultGroup: '产品素材',
    pageTitle: '产品素材',
    pageDescription: '管理产品图片、卖点图和展示素材，供视频制作引用。',
    steps: ['创建产品分组', '上传产品素材', '视频中引用'],
    addTitle: '新增分组',
    addHint: '创建分组并上传素材',
    nameLabel: '分组名称',
    namePlaceholder: '例如：产品套装、主推 SKU、活动素材',
    uploadTitle: '选择素材文件',
    uploadHint: '可先创建空分组，也可同时上传素材',
    createOkText: '创建并上传',
    emptyGroups: '暂无素材分组，可创建分组后上传素材。',
    emptyAssets: '该分组暂无素材，可上传素材后继续完善。',
    detailUploadText: '上传素材',
    detailAddText: '添加素材',
    assetUnit: '个素材',
    accept: 'image/*',
  },
  finished_video: {
    breadcrumb: '作品',
    icon: '📁',
    defaultGroup: '作品',
    pageTitle: '作品',
    pageDescription: '查看和管理已生成成功的图片和视频。',
    steps: ['生成作品', '预览作品', '复用或删除'],
    addTitle: '新增作品',
    addHint: '作品由图片创作和视频生成自动产生',
    nameLabel: '作品名称',
    namePlaceholder: '作品名称',
    uploadTitle: '作品',
    uploadHint: '作品由图片创作和视频生成自动产生',
    createOkText: '确认',
    emptyGroups: '暂无生成成功的作品。',
    emptyAssets: '暂无生成成功的作品。',
    detailUploadText: '上传素材',
    detailAddText: '添加素材',
    assetUnit: '个作品',
    accept: 'video/*',
  },
  other: {
    breadcrumb: '素材库 / 其他素材',
    icon: '📁',
    defaultGroup: '其他素材',
    pageTitle: '其他素材',
    pageDescription: '管理其他可复用内容素材。',
    steps: ['创建分组', '上传素材', '内容中引用'],
    addTitle: '新增分组',
    addHint: '创建分组并上传素材',
    nameLabel: '分组名称',
    namePlaceholder: '例如：活动素材、辅助图片、通用文件',
    uploadTitle: '选择素材文件',
    uploadHint: '可先创建空分组，也可同时上传素材',
    createOkText: '创建并上传',
    emptyGroups: '暂无素材分组，可创建分组后上传素材。',
    emptyAssets: '该分组暂无素材，可上传素材后继续完善。',
    detailUploadText: '上传素材',
    detailAddText: '添加素材',
    assetUnit: '个素材',
    accept: '',
  },
};

function fileUrl(asset: ContentAsset) {
  if (!asset.fileUrl) {
    return '';
  }
  if (/^https?:\/\//i.test(asset.fileUrl)) {
    return asset.fileUrl;
  }
  return `${API_BASE_URL}${asset.fileUrl}`;
}

function assetMetadataUrl(asset: ContentAsset, key: string) {
  const value = asset.metadata?.[key];
  if (typeof value !== 'string' || !value.trim()) {
    return '';
  }
  const url = value.trim();
  return /^https?:\/\//i.test(url) ? url : `${API_BASE_URL}${url}`;
}

function formatDate(value: string) {
  return value ? value.slice(0, 10) : '';
}

function startOfLocalDate(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function worksAssetDateGroup(asset: ContentAsset, now = new Date()) {
  const date = new Date(asset.createdAt);
  if (Number.isNaN(date.getTime())) {
    return { key: 'unknown', label: '日期未知' };
  }

  const dateStart = startOfLocalDate(date);
  const todayStart = startOfLocalDate(now);
  const dayDiff = Math.round((todayStart.getTime() - dateStart.getTime()) / (24 * 60 * 60 * 1000));
  const dateText = `${date.getMonth() + 1}月${date.getDate()}日`;

  if (dayDiff === 0) {
    return { key: dateStart.toISOString(), label: `今天・${dateText}` };
  }
  if (dayDiff === 1) {
    return { key: dateStart.toISOString(), label: `昨天・${dateText}` };
  }
  if (date.getFullYear() === now.getFullYear()) {
    return { key: dateStart.toISOString(), label: dateText };
  }
  return { key: dateStart.toISOString(), label: `${date.getFullYear()}年${dateText}` };
}

function previewFor(asset: ContentAsset, fallbackIcon: string) {
  if (asset.mimeType.startsWith('image/')) {
    return <img alt={asset.name} src={fileUrl(asset)} />;
  }
  if (asset.mimeType.startsWith('video/')) {
    return <video muted src={fileUrl(asset)} />;
  }
  return <span>{fallbackIcon}</span>;
}

function assetAudioSrc(asset?: ContentAsset) {
  if (!asset || !asset.mimeType.startsWith('audio/')) {
    return undefined;
  }
  return fileUrl(asset) || undefined;
}

function productGroupPreview(groupAssets: ContentAsset[], fallbackIcon: string) {
  if (!groupAssets.length) {
    return <span>{fallbackIcon}</span>;
  }
  const previewAssets = groupAssets.slice(0, 3);
  return (
    <div className={`scene-cover-grid product-cover-grid count-${previewAssets.length}`}>
      {previewAssets.map((asset) => (
        <div key={asset.id}>{previewFor(asset, fallbackIcon)}</div>
      ))}
    </div>
  );
}

function isGeneratedWorkAsset(asset: ContentAsset) {
  return asset.resourceType === 'finished_video'
    && (asset.metadata?.generatedBy === 'video_model'
      || asset.metadata?.generatedBy === 'video_enhancement'
      || asset.metadata?.generatedBy === 'video_subtitle_removal'
      || asset.metadata?.generatedBy === 'video_translation'
      || asset.metadata?.generatedBy === 'image_model');
}

function matchesWorksAssetTab(asset: ContentAsset, tab: WorksAssetTab) {
  if (tab === 'all') {
    return true;
  }
  return asset.mimeType.startsWith(`${tab}/`);
}

function worksFunctionOptionOf(asset: ContentAsset): WorksFunctionOption | null {
  const generatedBy = stringMetadataValue(asset, 'generatedBy');
  if (generatedBy !== 'image_model'
    && generatedBy !== 'video_model'
    && generatedBy !== 'video_enhancement'
    && generatedBy !== 'video_subtitle_removal'
    && generatedBy !== 'video_translation') {
    return null;
  }
  const mode = stringMetadataValue(asset, 'mode') || (generatedBy === 'image_model' ? 'image_generation' : 'video_generation');
  const modeTitle = stringMetadataValue(asset, 'modeTitle');
  if (generatedBy === 'image_model') {
    return imageWorksFunctionOptions.find((option) => option.modeKeys.includes(mode) || option.modeTitles.includes(modeTitle))
      || null;
  }
  const source = getVideoWorkSource(asset);
  if (source === 'video_creation') {
    return videoWorksFunctionOptions[1];
  }
  if (source === 'talking_video') {
    return videoWorksFunctionOptions[2];
  }
  if (source === 'video_remake') {
    return videoWorksFunctionOptions[3];
  }
  if (source === 'video_upscale') {
    return videoWorksFunctionOptions[4];
  }
  if (source === 'subtitle_removal') {
    return videoWorksFunctionOptions[5];
  }
  if (source === 'video_translation') {
    return videoWorksFunctionOptions[6];
  }
  return videoWorksFunctionOptions[0];
}

function matchesWorksFunction(asset: ContentAsset, functionKey: string) {
  if (functionKey === allWorksFunctionOption.key) {
    return true;
  }
  if (functionKey === 'video:all') {
    return getVideoWorkSource(asset) !== null;
  }
  if (functionKey === 'video:creation') {
    return getVideoWorkSource(asset) === 'video_creation';
  }
  if (functionKey === 'video:talking-video') {
    return getVideoWorkSource(asset) === 'talking_video';
  }
  if (functionKey === 'video:remake') {
    return getVideoWorkSource(asset) === 'video_remake';
  }
  if (functionKey === 'video:upscale') {
    return getVideoWorkSource(asset) === 'video_upscale';
  }
  if (functionKey === 'video:subtitle-removal') {
    return getVideoWorkSource(asset) === 'subtitle_removal';
  }
  if (functionKey === 'video:translation') {
    return getVideoWorkSource(asset) === 'video_translation';
  }
  const option = imageWorksFunctionOptions.find((item) => item.key === functionKey);
  if (!option) {
    return worksFunctionOptionOf(asset)?.key === functionKey;
  }
  return stringMetadataValue(asset, 'generatedBy') === 'image_model'
    && (
      option.modeKeys.includes(stringMetadataValue(asset, 'mode'))
      || option.modeTitles.includes(stringMetadataValue(asset, 'modeTitle'))
    );
}

function finishedVideoStatus(asset: ContentAsset) {
  if (asset.mimeType.startsWith('image/')) {
    return asset.fileUrl ? 'completed' : 'generating';
  }
  const status = typeof asset.metadata?.generationStatus === 'string' ? asset.metadata.generationStatus : '';
  if (status === 'generating' || status === 'queued' || !asset.fileUrl) {
    return 'generating';
  }
  if (status === 'failed') {
    return 'failed';
  }
  return 'completed';
}

function isCompletedGeneratedWorkAsset(asset: ContentAsset) {
  return isGeneratedWorkAsset(asset) && finishedVideoStatus(asset) === 'completed';
}

function PendingAssetTile({ file, onRemove }: { file: File; onRemove: (file: File) => void }) {
  const [url, setUrl] = useState('');

  useEffect(() => {
    if (!file.type.startsWith('image/')) {
      setUrl('');
      return undefined;
    }
    const nextUrl = URL.createObjectURL(file);
    setUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [file]);

  return (
    <div className="photo-upload-thumb">
      {url ? <img alt={file.name} src={url} /> : <span className="pending-file-icon">📁</span>}
      <button aria-label={`移除 ${file.name}`} onClick={() => onRemove(file)} type="button">×</button>
      <small title={file.name}>{file.name}</small>
    </div>
  );
}

function PendingAssetGrid({ files, onAdd, onRemove }: { files: File[]; onAdd: () => void; onRemove: (file: File) => void }) {
  return (
    <div className="photo-upload-grid compact">
      {files.map((file) => (
        <PendingAssetTile file={file} key={`${file.name}-${file.size}-${file.lastModified}`} onRemove={onRemove} />
      ))}
      <button className="photo-upload-add" onClick={onAdd} type="button">
        <strong>+</strong>
        <span>Upload</span>
      </button>
    </div>
  );
}

export function ContentResourceLibraryPage({
  currentUser,
  resourceType,
  resourceOverride,
  singleDefaultGroup = false,
}: ContentResourceLibraryPageProps) {
  const copy = { ...resourceCopy[resourceType], ...resourceOverride };
  const createFilesRef = useRef<HTMLInputElement | null>(null);
  const groupFilesRef = useRef<HTMLInputElement | null>(null);
  const singleLibraryFilesRef = useRef<HTMLInputElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const { pageSize: singleLibraryPageSize } = useCardGridPageSize({
    containerRef: gridRef,
    extraItems: 1,
  });
  const [groups, setGroups] = useState<ContentAssetGroup[]>([]);
  const [assets, setAssets] = useState<ContentAsset[]>([]);
  const [activeGroup, setActiveGroup] = useState<ContentAssetGroup | null>(null);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [pendingCreateFiles, setPendingCreateFiles] = useState<File[]>([]);
  const [pendingGroupFiles, setPendingGroupFiles] = useState<File[]>([]);
  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [editingGroupName, setEditingGroupName] = useState('');
  const [previewAsset, setPreviewAsset] = useState<ContentAsset | null>(null);
  const [previewImage, setPreviewImage] = useState<ImagePreview | null>(null);
  const [previewImageOpen, setPreviewImageOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isDeletingGroup, setIsDeletingGroup] = useState(false);
  const [isLoadingLibrary, setIsLoadingLibrary] = useState(false);
  const [singleLibraryPage, setSingleLibraryPage] = useState(1);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [worksAssetTab, setWorksAssetTab] = useState<WorksAssetTab>('all');
  const [worksFunctionKey, setWorksFunctionKey] = useState(allWorksFunctionOption.key);
  const [visibleWorksCount, setVisibleWorksCount] = useState(finishedAssetsPageSize);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const hasKeyword = searchKeyword.trim().length > 0;

  const loadData = useCallback(async () => {
    setIsLoadingLibrary(true);
    try {
      const [groupList, assetList] = await Promise.all([
        listContentAssetGroups(currentUser.id, resourceType),
        listContentAssets({ userId: currentUser.id, resourceType }),
      ]);
      setGroups(groupList);
      setAssets(resourceType === 'finished_video' ? assetList.filter(isCompletedGeneratedWorkAsset) : assetList);
      setActiveGroup((current) => groupList.find((group) => group.id === current?.id) || null);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '素材加载失败');
    } finally {
      setIsLoadingLibrary(false);
    }
  }, [currentUser.id, resourceType]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    if (resourceType !== 'finished_video') {
      return undefined;
    }
    const source = new EventSource(withAuthToken(`${API_BASE_URL}/api/content/events`));
    const handleVideoGenerationComplete = () => {
      void loadData();
    };
    source.addEventListener('viral-video-analysis-complete', handleVideoGenerationComplete);
    return () => {
      source.removeEventListener('viral-video-analysis-complete', handleVideoGenerationComplete);
      source.close();
    };
  }, [currentUser.id, loadData, resourceType]);

  const activeGroupAssets = useMemo(
    () => (activeGroup ? assets.filter((asset) => asset.groupId === activeGroup.id) : []),
    [activeGroup, assets],
  );
  const filteredGroups = useMemo(() => {
    const keyword = searchKeyword.trim().toLowerCase();
    if (!keyword) {
      return groups;
    }
    return groups.filter((group) => group.name.toLowerCase().includes(keyword));
  }, [groups, searchKeyword]);
  const filteredAssets = useMemo(() => {
    const keyword = searchKeyword.trim().toLowerCase();
    let nextAssets = assets;
    if (resourceType === 'finished_video') {
      nextAssets = nextAssets
        .filter((asset) => matchesWorksAssetTab(asset, worksAssetTab))
        .filter((asset) => matchesWorksFunction(asset, worksFunctionKey));
    }
    if (!keyword) {
      return nextAssets;
    }
    return nextAssets.filter((asset) => asset.name.toLowerCase().includes(keyword));
  }, [assets, resourceType, searchKeyword, worksAssetTab, worksFunctionKey]);
  const visibleWorksAssets = useMemo(() => [...filteredAssets]
    .sort((left, right) => {
      const leftTime = new Date(left.createdAt).getTime();
      const rightTime = new Date(right.createdAt).getTime();
      return (Number.isNaN(rightTime) ? 0 : rightTime) - (Number.isNaN(leftTime) ? 0 : leftTime);
    })
    .slice(0, visibleWorksCount),
    [filteredAssets, visibleWorksCount],
  );
  const visibleWorksAssetGroups = useMemo<WorksAssetDateGroup[]>(() => {
    const groupsByDate = new Map<string, WorksAssetDateGroup>();

    visibleWorksAssets.forEach((asset) => {
      const dateGroup = worksAssetDateGroup(asset);
      const existingGroup = groupsByDate.get(dateGroup.key);
      if (existingGroup) {
        existingGroup.assets.push(asset);
        return;
      }
      groupsByDate.set(dateGroup.key, { ...dateGroup, assets: [asset] });
    });

    return Array.from(groupsByDate.values());
  }, [visibleWorksAssets]);
  const hasMoreWorksAssets = visibleWorksAssets.length < filteredAssets.length;

  const loadMoreWorksAssets = useCallback(() => {
    setVisibleWorksCount((current) => Math.min(current + finishedAssetsPageSize, filteredAssets.length));
  }, [filteredAssets.length]);

  const defaultGroup = useMemo(() => {
    if (!singleDefaultGroup) {
      return null;
    }
    return groups.find((group) => group.metadata?.systemDefault === true)
      || groups.find((group) => group.metadata?.hiddenFromGroupUi === true)
      || groups.find((group) => group.name === copy.defaultGroup)
      || null;
  }, [copy.defaultGroup, groups, singleDefaultGroup]);

  const singleLibraryCardAssets = useMemo(
    () => (singleDefaultGroup ? filteredAssets : []),
    [filteredAssets, singleDefaultGroup],
  );
  const singleLibraryPagedAssets = useMemo(() => {
    const start = (singleLibraryPage - 1) * singleLibraryPageSize;
    return singleLibraryCardAssets.slice(start, start + singleLibraryPageSize);
  }, [singleLibraryCardAssets, singleLibraryPage, singleLibraryPageSize]);
  const singleLibraryDetailAssets = useMemo(
    () => (singleDefaultGroup ? assets : activeGroupAssets),
    [activeGroupAssets, assets, singleDefaultGroup],
  );
  const worksFunctionOptions = useMemo(() => {
    const options = worksAssetTab === 'image'
      ? imageWorksFunctionOptions
      : worksAssetTab === 'video'
        ? videoWorksFunctionOptions
        : [...imageWorksFunctionOptions, ...videoWorksFunctionOptions];
    return [
      allWorksFunctionOption,
      ...options,
    ];
  }, [worksAssetTab]);

  useEffect(() => {
    if (!singleDefaultGroup) {
      return;
    }
    const maxPage = Math.max(1, Math.ceil(singleLibraryCardAssets.length / singleLibraryPageSize));
    setSingleLibraryPage((current) => Math.min(current, maxPage));
  }, [singleDefaultGroup, singleLibraryCardAssets.length, singleLibraryPageSize]);

  useEffect(() => {
    setSingleLibraryPage(1);
    setVisibleWorksCount(finishedAssetsPageSize);
  }, [searchKeyword, singleDefaultGroup, worksAssetTab, worksFunctionKey]);

  useEffect(() => {
    if (worksFunctionOptions.some((option) => option.key === worksFunctionKey)) {
      return;
    }
    setWorksFunctionKey(allWorksFunctionOption.key);
  }, [worksFunctionKey, worksFunctionOptions]);
  const assetCountByGroupId = useMemo(() => {
    const map = new Map<string, number>();
    for (const asset of assets) {
      map.set(asset.groupId, (map.get(asset.groupId) || 0) + 1);
    }
    return map;
  }, [assets]);

  function groupAssetCount(groupId: string) {
    return assetCountByGroupId.get(groupId) || 0;
  }

  function groupMeta(group: ContentAssetGroup) {
    return `${groupAssetCount(group.id)} ${copy.assetUnit} · 更新于 ${formatDate(group.updatedAt)}`;
  }

  function groupStatus(group: ContentAssetGroup) {
    const count = groupAssetCount(group.id);
    if (resourceType === 'digital_human') {
      return count ? '已上传照片，待生成三视图' : '待上传本人照片';
    }
    if (resourceType === 'voice') {
      return count ? '已上传样本，待克隆音色' : '待上传音频样本';
    }
    if (resourceType === 'scene') {
      return count ? '图片可用于视频场景' : '待上传场景图片';
    }
    return count ? '素材可用' : '待上传素材';
  }

  function openGroup(group: ContentAssetGroup) {
    setActiveGroup(group);
    setEditingGroupName(group.name);
    setPendingGroupFiles([]);
    setGroupModalOpen(true);
  }

  function openCreateEntry() {
    if (singleDefaultGroup) {
      singleLibraryFilesRef.current?.click();
      return;
    }
    setCreateModalOpen(true);
  }

  async function uploadFilesToGroup(groupId: string, files: File[]) {
    await Promise.all(files.map((file) => uploadContentAsset({
      file,
      userId: currentUser.id,
      groupId,
      resourceType,
      name: file.name,
    })));
  }

  async function uploadFilesToSingleLibrary(files: File[]) {
    await Promise.all(files.map((file) => uploadContentAsset({
      file,
      userId: currentUser.id,
      groupId: defaultGroup?.id,
      resourceType,
      name: file.name,
    })));
  }

  async function handleCreateGroupWithAssets() {
    if (singleDefaultGroup) {
      if (!pendingCreateFiles.length) {
        message.warning(`请先${copy.uploadTitle}`);
        return;
      }
      try {
        setIsUploading(true);
        await uploadFilesToSingleLibrary(pendingCreateFiles);
        setPendingCreateFiles([]);
        setCreateModalOpen(false);
        await loadData();
        message.success('素材已上传');
      } catch (error) {
        message.error(error instanceof Error ? error.message : '素材上传失败');
      } finally {
        setIsUploading(false);
      }
      return;
    }
    const name = groupName.trim();
    if (!name) {
      message.warning('请输入分组名称');
      return;
    }
    try {
      setIsUploading(true);
      const group = await createContentAssetGroup({
        userId: currentUser.id,
        resourceType,
        name,
      });
      if (pendingCreateFiles.length) {
        await uploadFilesToGroup(group.id, pendingCreateFiles);
      }
      setGroupName('');
      setPendingCreateFiles([]);
      setCreateModalOpen(false);
      await loadData();
      openGroup(group);
      message.success('分组已创建');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '分组创建失败');
    } finally {
      setIsUploading(false);
    }
  }

  async function handleUploadToSingleLibrary() {
    if (!pendingGroupFiles.length) {
      return;
    }
    try {
      setIsUploading(true);
      await uploadFilesToSingleLibrary(pendingGroupFiles);
      setPendingGroupFiles([]);
      await loadData();
      message.success('素材已上传');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '素材上传失败');
    } finally {
      setIsUploading(false);
      if (groupFilesRef.current) {
        groupFilesRef.current.value = '';
      }
    }
  }

  async function handleUploadFilesToSingleLibrary(files: File[]) {
    if (!files.length) {
      return;
    }
    try {
      setIsUploading(true);
      await uploadFilesToSingleLibrary(files);
      await loadData();
      message.success('素材已上传');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '素材上传失败');
    } finally {
      setIsUploading(false);
    }
  }

  async function handleRenameGroup() {
    if (!activeGroup || !editingGroupName.trim()) {
      return;
    }
    try {
      const updated = await updateContentAssetGroup(activeGroup.id, { name: editingGroupName.trim() });
      setActiveGroup(updated);
      await loadData();
      message.success('分组名称已更新');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '分组更新失败');
    }
  }

  async function handleUploadToActiveGroup() {
    if (!activeGroup || !pendingGroupFiles.length) {
      return;
    }
    try {
      setIsUploading(true);
      await uploadFilesToGroup(activeGroup.id, pendingGroupFiles);
      setPendingGroupFiles([]);
      await loadData();
      message.success('素材已上传');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '素材上传失败');
    } finally {
      setIsUploading(false);
      if (groupFilesRef.current) {
        groupFilesRef.current.value = '';
      }
    }
  }

  async function handleUploadFilesToActiveGroup(files: File[]) {
    if (!activeGroup || !files.length) {
      return;
    }
    try {
      setIsUploading(true);
      await uploadFilesToGroup(activeGroup.id, files);
      await loadData();
      message.success('素材已上传');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '素材上传失败');
    } finally {
      setIsUploading(false);
    }
  }

  async function handleDeleteAsset(assetId: string) {
    try {
      await deleteContentAsset(assetId);
      await loadData();
      message.success('素材已删除');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '素材删除失败');
    }
  }

  async function handleDeleteGroup() {
    if (!activeGroup) {
      return;
    }
    try {
      setIsDeletingGroup(true);
      await deleteContentAssetGroup(activeGroup.id);
      setGroupModalOpen(false);
      setActiveGroup(null);
      await loadData();
      message.success('分组已删除');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '分组删除失败');
    } finally {
      setIsDeletingGroup(false);
    }
  }

  async function handleDeleteFinishedAsset(asset: ContentAsset) {
    try {
      await deleteContentAsset(asset.id);
      await loadData();
      message.success('作品记录已删除');
      return true;
    } catch (error) {
      message.error(error instanceof Error ? error.message : '作品删除失败');
      return false;
    }
  }

  function closePreviewAsset() {
    if (previewVideoRef.current) {
      previewVideoRef.current.pause();
      previewVideoRef.current.currentTime = 0;
    }
    setPreviewAsset(null);
  }

  function openAssetPreview(asset: ContentAsset) {
    if (asset.mimeType.startsWith('image/')) {
      openImagePreview({
        name: asset.originalFileName || asset.name,
        src: fileUrl(asset),
      });
      return;
    }
    setPreviewAsset(asset);
  }

  function openImagePreview(image: ImagePreview) {
    setPreviewImage(image);
    setPreviewImageOpen(true);
  }

  function resetWorksHeaderFilters() {
    setWorksAssetTab('all');
    setWorksFunctionKey(allWorksFunctionOption.key);
  }

  function handleWorksAssetTabChange(tab: WorksAssetTab) {
    setWorksAssetTab(tab);
    setWorksFunctionKey(allWorksFunctionOption.key);
  }

  const worksFunctionMenuItems: MenuProps['items'] = worksFunctionOptions.map((option) => ({
    key: option.key,
    label: option.label,
  }));
  const selectedWorksFunctionLabel = worksFunctionOptions.find((option) => option.key === worksFunctionKey)?.label
    || allWorksFunctionOption.label;
  const worksEmptyTitle = worksAssetTab === 'image'
    ? '暂无图片作品'
    : worksAssetTab === 'video'
      ? '暂无视频作品'
      : '暂无作品';
  const worksEmptyDescription = worksAssetTab === 'image'
    ? '生成后自动同步。'
    : worksAssetTab === 'video'
      ? '生成后自动同步。'
      : '作品生成后自动同步。';

  if (resourceType === 'finished_video') {
    return (
      <>
        <section className="material-page voice-board-page works-assets-page">
          <div className="works-assets-shell">
            <header className="works-assets-header">
              <div className="works-assets-title-row">
                <h1>作品</h1>
                <span>已加载 {visibleWorksAssets.length} / {filteredAssets.length} 个结果</span>
              </div>
              <div className="works-assets-control-row">
                <AppSegmentedTabs
                  ariaLabel="作品类型"
                  itemMinWidth={60}
                  onChange={handleWorksAssetTabChange}
                  options={[
                    { value: 'all', label: '全部' },
                    { value: 'image', label: '图片' },
                    { value: 'video', label: '视频' },
                  ]}
                  size="large"
                  value={worksAssetTab}
                />
                <Dropdown
                  menu={{
                    items: worksFunctionMenuItems,
                    onClick: ({ key }) => setWorksFunctionKey(String(key)),
                    selectable: true,
                    selectedKeys: [worksFunctionKey],
                  }}
                  overlayClassName="works-function-menu"
                  placement="bottomLeft"
                  trigger={['click']}
                >
                  <Button className="works-function-button" icon={<ListFilter size={14} />} size="large">
                    {selectedWorksFunctionLabel}
                  </Button>
                </Dropdown>
                <Button className="works-reset-button" onClick={resetWorksHeaderFilters} size="large" type="text">重置</Button>
                <div className="works-assets-toolbar-spacer" />
                {showWorksBatchButton && (
                  <Button className="works-batch-button" size="large">批量管理</Button>
                )}
              </div>
            </header>
            <InfiniteScroll
              className="voice-board-content"
              dataLength={visibleWorksAssets.length}
              disabled={isLoadingLibrary}
              endText="已加载全部作品"
              hasMore={hasMoreWorksAssets}
              onLoadMore={loadMoreWorksAssets}
            >
              {isLoadingLibrary ? (
                <div className="material-grid voice-board-grid">
                  <WorksAssetSkeletonCard />
                </div>
              ) : visibleWorksAssetGroups.map((group) => (
                <section className="works-assets-date-group" key={group.key}>
                  <div className="works-assets-date-heading">
                    <h2>{group.label}</h2>
                    <span>{group.assets.length} 个作品</span>
                  </div>
                  <div className="material-grid voice-board-grid">
                    {group.assets.map((asset) => (
                      <WorksAssetCard
                        key={asset.id}
                        asset={asset}
                        onDelete={() => void handleDeleteFinishedAsset(asset)}
                        onOpen={finishedVideoStatus(asset) === 'completed' && fileUrl(asset) ? () => openAssetPreview(asset) : undefined}
                      />
                    ))}
                  </div>
                </section>
              ))}
              {!isLoadingLibrary && !filteredAssets.length && (
                <div className="material-grid voice-board-grid">
                  <WorksAssetEmptyCard
                    title={hasKeyword ? '暂无匹配作品' : worksEmptyTitle}
                    description={hasKeyword ? '调整搜索条件，或先生成一个作品。' : worksEmptyDescription}
                  />
                </div>
              )}
            </InfiniteScroll>
          </div>
        </section>
        {previewAsset?.mimeType.startsWith('video/') && (
          <ResultVideoPreviewModal
            onClose={closePreviewAsset}
            onDelete={() => handleDeleteFinishedAsset(previewAsset)}
            video={toResultVideoPreview(previewAsset)}
          />
        )}
        <AppImage
          alt={previewImage?.name || '图片预览'}
          preview={{
            open: previewImageOpen,
            onOpenChange: setPreviewImageOpen,
            afterOpenChange: (open) => {
              if (!open) {
                setPreviewImage(null);
              }
            },
          }}
          src={previewImage?.src}
          style={{ display: 'none' }}
        />
      </>
    );
  }

  return (
    <ContentStudioLayout>

      <section className="material-page voice-board-page">
        <div className="voice-board-toolbar">
          <Input
            allowClear
            className="voice-board-search"
            onChange={(event) => setSearchKeyword(event.target.value)}
            placeholder="搜索素材名称..."
            prefix={<Search size={17} />}
            size="large"
            value={searchKeyword}
          />
          <div className="voice-board-toolbar-spacer" />
          <AppButton icon={<Plus size={16} />} loading={singleDefaultGroup && isUploading} onClick={openCreateEntry} tone="brand" type="primary">
            {copy.addTitle}
          </AppButton>
          {singleDefaultGroup && (
            <input
              accept={copy.accept}
              hidden
              multiple
              onChange={(event) => {
                const files = Array.from(event.target.files || []);
                event.target.value = '';
                void handleUploadFilesToSingleLibrary(files);
              }}
              ref={singleLibraryFilesRef}
              type="file"
            />
          )}
        </div>

        <div className="voice-board-content">
          <div className={`material-grid voice-board-grid${singleDefaultGroup ? ' single-library-asset-grid' : ''}`} ref={gridRef}>
            {!isLoadingLibrary && (
              <AssetLibraryCreateCard
                description={copy.addHint}
                icon={<Plus size={30} />}
                onClick={openCreateEntry}
                title={copy.addTitle}
              />
            )}

            {isLoadingLibrary ? <AssetLibrarySkeletonCards count={1} /> : singleDefaultGroup ? (
              singleLibraryPagedAssets.map((asset) => (
                <article className="material-card single-library-asset-card" key={asset.id}>
                  <button className="material-preview" onClick={() => openAssetPreview(asset)} type="button">
                    {previewFor(asset, copy.icon)}
                  </button>
                  <div className="material-info">
                    <div className="material-name" title={asset.name}>{asset.name}</div>
                    <div className="material-meta">上传于 {formatDate(asset.createdAt)}</div>
                    <Popconfirm
                      cancelButtonProps={{ className: 'asset-library-popconfirm-cancel' }}
                      cancelText="取消"
                      okButtonProps={{ className: 'asset-library-popconfirm-confirm' }}
                      okText="删除"
                      onConfirm={() => void handleDeleteAsset(asset.id)}
                      overlayClassName="asset-library-themed-popconfirm"
                      title="确认删除这个素材吗？"
                    >
                      <Button danger icon={<Trash2 size={14} />} size="small" type="text">删除</Button>
                    </Popconfirm>
                  </div>
                </article>
              ))
            ) : filteredGroups.map((group) => {
              const groupAssetsForPreview = assets.filter((asset) => asset.groupId === group.id);
              const cover = groupAssetsForPreview[0];
              return (
                <AssetLibraryCard
                  audioSrc={assetAudioSrc(cover)}
                  audioTitle={group.name}
                  key={group.id}
                  meta={groupMeta(group)}
                  onClick={() => openGroup(group)}
                  preview={resourceType === 'product'
                    ? productGroupPreview(groupAssetsForPreview, copy.icon)
                    : cover ? previewFor(cover, copy.icon) : copy.icon}
                  previewClassName={resourceType === 'product' ? undefined : 'material-preview'}
                  status={groupStatus(group)}
                  title={group.name}
                />
              );
            })}
            {!isLoadingLibrary && ((singleDefaultGroup && !singleLibraryCardAssets.length) || (!singleDefaultGroup && !filteredGroups.length)) && (
              <AssetLibraryPlaceholderCard
                icon={<Search size={30} />}
                title={hasKeyword ? `暂无匹配${copy.pageTitle}` : `暂无${copy.pageTitle}`}
                description={hasKeyword ? '调整搜索条件，或上传新的素材。' : copy.emptyGroups}
              />
            )}
          </div>
        </div>

        <div className="voice-board-pagination">
          <span>共 {singleDefaultGroup ? singleLibraryCardAssets.length : groups.length} 条</span>
          {singleDefaultGroup && (
            <Pagination
              current={singleLibraryPage}
              onChange={setSingleLibraryPage}
              pageSize={singleLibraryPageSize}
              showSizeChanger={false}
              total={singleLibraryCardAssets.length}
            />
          )}
        </div>
      </section>

      <Modal
        className="asset-library-themed-modal"
        confirmLoading={isUploading}
        okText={copy.createOkText}
        onCancel={() => setCreateModalOpen(false)}
        onOk={() => void handleCreateGroupWithAssets()}
        open={createModalOpen}
        title={copy.addTitle}
      >
        <div className="material-modal-form">
          {!singleDefaultGroup ? (
            <label>
              <span>{copy.nameLabel}</span>
              <Input onChange={(event) => setGroupName(event.target.value)} onPressEnter={() => void handleCreateGroupWithAssets()} placeholder={copy.namePlaceholder} value={groupName} />
            </label>
          ) : null}
          {resourceType === 'product' || singleDefaultGroup ? (
            <PendingImageUpload files={pendingCreateFiles} onChange={setPendingCreateFiles} onPreviewFile={openImagePreview} />
          ) : (
            <>
              <PendingAssetGrid
                files={pendingCreateFiles}
                onAdd={() => createFilesRef.current?.click()}
                onRemove={(file) => setPendingCreateFiles((files) => files.filter((item) => item !== file))}
              />
              <input accept={copy.accept} hidden multiple onChange={(event) => setPendingCreateFiles(Array.from(event.target.files || []))} ref={createFilesRef} type="file" />
            </>
          )}
        </div>
      </Modal>

      <Modal
        className="asset-library-themed-modal"
        footer={null}
        onCancel={() => setGroupModalOpen(false)}
        open={groupModalOpen}
        title={singleDefaultGroup ? copy.pageTitle : activeGroup?.name || '素材分组'}
        width={980}
      >
        {(singleDefaultGroup || activeGroup) && (
          <div className="material-group-detail">
            {!singleDefaultGroup ? (
              <div className="material-group-editor">
                <Input onChange={(event) => setEditingGroupName(event.target.value)} value={editingGroupName} />
                <Button onClick={() => void handleRenameGroup()} type="primary">保存名称</Button>
                {resourceType !== 'product' && (
                  <>
                    <Button onClick={() => groupFilesRef.current?.click()}>{copy.detailUploadText}</Button>
                    <Button disabled={!pendingGroupFiles.length} loading={isUploading} onClick={() => void handleUploadToActiveGroup()} type="primary">
                      {copy.detailAddText} {pendingGroupFiles.length || ''}
                    </Button>
                  </>
                )}
                <Button danger loading={isDeletingGroup} onClick={() => void handleDeleteGroup()}>删除{copy.defaultGroup}</Button>
                {resourceType !== 'product' && (
                  <input accept={copy.accept} hidden multiple onChange={(event) => setPendingGroupFiles(Array.from(event.target.files || []))} ref={groupFilesRef} type="file" />
                )}
              </div>
            ) : resourceType !== 'product' ? (
              <div className="material-group-editor">
                <Button onClick={() => groupFilesRef.current?.click()}>{copy.detailUploadText}</Button>
                <Button disabled={!pendingGroupFiles.length} loading={isUploading} onClick={() => void handleUploadToSingleLibrary()} type="primary">
                  {copy.detailAddText} {pendingGroupFiles.length || ''}
                </Button>
                <input accept={copy.accept} hidden multiple onChange={(event) => setPendingGroupFiles(Array.from(event.target.files || []))} ref={groupFilesRef} type="file" />
              </div>
            ) : null}
            {resourceType === 'product' ? (
              <DetailImageUpload
                assets={singleLibraryDetailAssets}
                isUploading={isUploading}
                onPreviewImage={openImagePreview}
                onRemoveAsset={(asset) => void handleDeleteAsset(asset.id)}
                onUploadFiles={(files) => void (singleDefaultGroup ? handleUploadFilesToSingleLibrary(files) : handleUploadFilesToActiveGroup(files))}
              />
            ) : pendingGroupFiles.length ? (
              <PendingAssetGrid
                files={pendingGroupFiles}
                onAdd={() => groupFilesRef.current?.click()}
                onRemove={(file) => setPendingGroupFiles((files) => files.filter((item) => item !== file))}
              />
            ) : null}
            {resourceType !== 'product' && (
              <div className="material-grid material-grid-compact">
                {singleDefaultGroup ? (
                  <div className="scene-management-summary">
                    <strong>{singleLibraryDetailAssets.length} {copy.assetUnit}</strong>
                    <span>{copy.pageDescription}</span>
                  </div>
                ) : null}
                {singleLibraryDetailAssets.length ? singleLibraryDetailAssets.map((asset) => (
                  <article className="material-card" key={asset.id}>
                    <button className="material-preview" onClick={() => openAssetPreview(asset)} type="button">{previewFor(asset, copy.icon)}</button>
                    <div className="material-info">
                      <div className="material-name">{asset.name}</div>
                      <div className="material-meta">上传于 {formatDate(asset.createdAt)}</div>
                      <Button danger onClick={() => void handleDeleteAsset(asset.id)} size="small">删除素材</Button>
                    </div>
                  </article>
                )) : <div className="material-empty-inline">{copy.emptyAssets}</div>}
              </div>
            )}
          </div>
        )}
      </Modal>

      <Modal className="asset-library-themed-modal" footer={null} onCancel={closePreviewAsset} open={Boolean(previewAsset)} title={previewAsset?.name || '素材预览'} width={760}>
        {previewAsset && (
          <div className="asset-detail">
            {previewAsset.mimeType.startsWith('video/') && <video controls ref={previewVideoRef} src={fileUrl(previewAsset)} />}
            {previewAsset.mimeType.startsWith('audio/') && <audio controls src={fileUrl(previewAsset)} />}
            <p><strong>文件名：</strong>{previewAsset.originalFileName}</p>
            <p><strong>类型：</strong>{previewAsset.mimeType}</p>
          </div>
        )}
      </Modal>

      <AppImage
        alt={previewImage?.name || '图片预览'}
        preview={{
          open: previewImageOpen,
          onOpenChange: setPreviewImageOpen,
          afterOpenChange: (open) => {
            if (!open) {
              setPreviewImage(null);
            }
          },
        }}
        src={previewImage?.src}
        style={{ display: 'none' }}
      />
    </ContentStudioLayout>
  );
}

function toResultVideoPreview(asset: ContentAsset) {
  const videoUrl = fileUrl(asset);
  return {
    completedAt: metadataDate(asset, 'completedAt') || metadataDate(asset, 'generatedAt') || asset.updatedAt,
    createdAt: asset.createdAt,
    duration: 0,
    name: asset.name,
    posterUrl: assetMetadataUrl(asset, 'coverUrl'),
    referenceAssetIds: materialReferenceAssetIds(asset.metadata.materialContext),
    referenceAssets: materialReferenceAssets(asset.metadata.materialContext),
    taskId: stringMetadataValue(asset, 'videoTaskId'),
    videoUrl,
  };
}

function metadataDate(asset: ContentAsset, key: string) {
  const value = asset.metadata?.[key];
  return typeof value === 'string' ? value : '';
}

function materialReferenceAssetIds(value: unknown) {
  if (!isMetadataRecord(value)) return [];
  const references = isMetadataRecord(value.references) ? value.references : {};
  const ids = [
    value.sourceAssetId,
    ...materialReferenceRecords(references.images).map((item) => item.id),
    ...materialReferenceRecords(references.videos).map((item) => item.id),
    ...materialReferenceRecords(references.audios).map((item) => item.id),
  ];
  return Array.from(new Set(ids.filter((item): item is string => typeof item === 'string' && item.length > 0)));
}

function materialReferenceAssets(value: unknown): ReferenceMaterialPreviewAsset[] {
  if (!isMetadataRecord(value)) return [];
  const references = isMetadataRecord(value.references) ? value.references : {};
  return [references.images, references.videos, references.audios]
    .flatMap(materialReferenceRecords)
    .filter((item) => typeof item.id === 'string' && typeof item.fileUrl === 'string' && typeof item.mimeType === 'string')
    .map((item) => ({
      id: String(item.id),
      fileUrl: String(item.fileUrl),
      metadata: isMetadataRecord(item.metadata) ? item.metadata : {},
      mimeType: String(item.mimeType),
      name: typeof item.name === 'string' ? item.name : '',
      originalFileName: typeof item.originalFileName === 'string' ? item.originalFileName : '',
    }));
}

function materialReferenceRecords(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter(isMetadataRecord) : [];
}

function isMetadataRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
