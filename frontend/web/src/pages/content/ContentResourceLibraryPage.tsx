import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Image, Input, Modal, Pagination, Popconfirm, message } from 'antd';
import { Clapperboard, LoaderCircle, Plus, Search, Trash2 } from 'lucide-react';
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
import { AssetLibraryCard, AssetLibraryCreateCard, AssetLibraryPlaceholderCard, AssetLibrarySkeletonCards } from '../../components/AssetLibraryCard';
import type { ContentAsset, ContentAssetGroup, ContentResourceType, User } from '../../types';
import { withAuthToken } from '../../utils/session';
import { ContentStudioLayout } from '../../layouts/ContentStudioLayout';
import { DetailImageUpload, PendingImageUpload } from './assets/AssetImageUpload';
import type { ImagePreview } from './assets/AssetImageUpload';
import { useCardGridPageSize } from './assets/useCardGridPageSize';
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
    breadcrumb: '素材库 / 成片素材',
    icon: '🎥',
    defaultGroup: '成片素材',
    pageTitle: '成片素材',
    pageDescription: '查看和管理已生成成功的视频。',
    steps: ['生成视频', '预览成片', '复用或删除'],
    addTitle: '新增成片',
    addHint: '成片由视频生成任务自动产生',
    nameLabel: '成片名称',
    namePlaceholder: '成片名称',
    uploadTitle: '成片素材',
    uploadHint: '成片由视频生成任务自动产生',
    createOkText: '确认',
    emptyGroups: '暂无生成成功的视频。',
    emptyAssets: '暂无生成成功的视频。',
    detailUploadText: '上传素材',
    detailAddText: '添加素材',
    assetUnit: '个视频',
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

function formatDate(value: string) {
  return value ? value.slice(0, 10) : '';
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

function isGeneratedFinishedVideoAsset(asset: ContentAsset) {
  return asset.resourceType === 'finished_video' && asset.metadata?.generatedBy === 'video_model';
}

function finishedVideoStatus(asset: ContentAsset) {
  const status = typeof asset.metadata?.generationStatus === 'string' ? asset.metadata.generationStatus : '';
  if (status === 'generating' || status === 'queued' || !asset.fileUrl) {
    return 'generating';
  }
  if (status === 'failed') {
    return 'failed';
  }
  return 'completed';
}

function finishedVideoStatusText(asset: ContentAsset) {
  const status = finishedVideoStatus(asset);
  if (status === 'failed') {
    return '生成失败';
  }
  if (status === 'generating') {
    return '正在生成中';
  }
  return '已生成';
}

function finishedVideoDescription(asset: ContentAsset) {
  const status = finishedVideoStatus(asset);
  if (status === 'failed') {
    return '请回到任务重新生成';
  }
  if (status === 'generating') {
    return '成片完成后会自动更新';
  }
  return '';
}

function finishedVideoMeta(asset: ContentAsset, onDelete: () => void) {
  const status = finishedVideoStatus(asset);
  const label = status === 'completed' ? `生成于 ${formatDate(asset.updatedAt)}` : `更新于 ${formatDate(asset.updatedAt)}`;
  return (
    <div className="finished-video-card-meta">
      <span>{label}</span>
      <div onClick={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()}>
        <Popconfirm
          cancelText="取消"
          okText="删除"
          onConfirm={onDelete}
          title="确认删除这个成片吗？"
        >
          <Button
            aria-label={`删除 ${asset.name}`}
            danger
            icon={<Trash2 size={14} />}
            size="small"
            type="text"
          />
        </Popconfirm>
      </div>
    </div>
  );
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
  const [isUploading, setIsUploading] = useState(false);
  const [isDeletingGroup, setIsDeletingGroup] = useState(false);
  const [isLoadingLibrary, setIsLoadingLibrary] = useState(false);
  const [singleLibraryPage, setSingleLibraryPage] = useState(1);
  const [searchKeyword, setSearchKeyword] = useState('');
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
      setAssets(resourceType === 'finished_video' ? assetList.filter(isGeneratedFinishedVideoAsset) : assetList);
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
    if (!keyword) {
      return assets;
    }
    return assets.filter((asset) => asset.name.toLowerCase().includes(keyword));
  }, [assets, searchKeyword]);

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

  useEffect(() => {
    if (!singleDefaultGroup) {
      return;
    }
    const maxPage = Math.max(1, Math.ceil(singleLibraryCardAssets.length / singleLibraryPageSize));
    setSingleLibraryPage((current) => Math.min(current, maxPage));
  }, [singleDefaultGroup, singleLibraryCardAssets.length, singleLibraryPageSize]);

  useEffect(() => {
    setSingleLibraryPage(1);
  }, [searchKeyword, singleDefaultGroup]);
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
      message.success('成片记录已删除');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '成片删除失败');
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
      setPreviewImage({
        name: asset.name,
        src: fileUrl(asset),
      });
      return;
    }
    setPreviewAsset(asset);
  }

  if (resourceType === 'finished_video') {
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
              value={searchKeyword}
            />
            <div className="voice-board-toolbar-spacer" />
          </div>
          <div className="voice-board-content">
            <div className="material-grid voice-board-grid">
              {isLoadingLibrary ? <AssetLibrarySkeletonCards count={1} /> : filteredAssets.map((asset) => {
                const status = finishedVideoStatus(asset);
                const url = fileUrl(asset);
                return (
                  <AssetLibraryCard
                    className={`finished-video-card finished-video-card--${status}`}
                    key={asset.id}
                    description={finishedVideoDescription(asset)}
                    meta={finishedVideoMeta(asset, () => void handleDeleteFinishedAsset(asset))}
                    metaClassName="finished-video-card-meta-wrap"
                    onClick={status === 'completed' && url ? () => setPreviewAsset(asset) : undefined}
                    preview={status === 'completed' && url ? (
                      <div className="finished-video-card-preview">
                        <video muted preload="metadata" src={url} />
                      </div>
                    ) : (
                      <div className="finished-video-card-placeholder">
                        {status === 'failed' ? <Clapperboard size={28} /> : <LoaderCircle size={28} />}
                      </div>
                    )}
                    status={finishedVideoStatusText(asset)}
                    title={asset.name}
                  />
                );
              })}
              {!isLoadingLibrary && !filteredAssets.length && (
                <AssetLibraryPlaceholderCard
                  icon={<Search size={30} />}
                  title={hasKeyword ? '暂无匹配成片' : '暂无成片素材'}
                  description={hasKeyword ? '调整搜索条件，或先生成一个视频。' : '生成完成的视频会自动同步到这里。'}
                />
              )}
            </div>
          </div>
          <div className="voice-board-pagination">
            <span>共 {assets.length} 条</span>
          </div>
        </section>
        <Modal
          footer={null}
          onCancel={closePreviewAsset}
          open={Boolean(previewAsset)}
          title={previewAsset?.name || '成片预览'}
          width={960}
        >
          {previewAsset && (
            <div className="asset-detail asset-detail--video">
              <video autoPlay controls preload="metadata" ref={previewVideoRef} src={fileUrl(previewAsset)} />
              <p><strong>文件名：</strong>{previewAsset.originalFileName}</p>
              <p><strong>类型：</strong>{previewAsset.mimeType}</p>
            </div>
          )}
        </Modal>
      </ContentStudioLayout>
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
            value={searchKeyword}
          />
          <div className="voice-board-toolbar-spacer" />
          <Button icon={<Plus size={16} />} loading={singleDefaultGroup && isUploading} onClick={openCreateEntry} type="primary">
            {copy.addTitle}
          </Button>
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
                      cancelText="取消"
                      okText="删除"
                      onConfirm={() => void handleDeleteAsset(asset.id)}
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
            <PendingImageUpload files={pendingCreateFiles} onChange={setPendingCreateFiles} onPreviewFile={setPreviewImage} />
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
                onPreviewImage={setPreviewImage}
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

      <Modal footer={null} onCancel={closePreviewAsset} open={Boolean(previewAsset)} title={previewAsset?.name || '素材预览'} width={760}>
        {previewAsset && (
          <div className="asset-detail">
            {previewAsset.mimeType.startsWith('video/') && <video controls ref={previewVideoRef} src={fileUrl(previewAsset)} />}
            {previewAsset.mimeType.startsWith('audio/') && <audio controls src={fileUrl(previewAsset)} />}
            <p><strong>文件名：</strong>{previewAsset.originalFileName}</p>
            <p><strong>类型：</strong>{previewAsset.mimeType}</p>
          </div>
        )}
      </Modal>

      <Image
        alt={previewImage?.name || '图片预览'}
        preview={{
          visible: Boolean(previewImage),
          onVisibleChange: (visible) => {
            if (!visible) {
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
