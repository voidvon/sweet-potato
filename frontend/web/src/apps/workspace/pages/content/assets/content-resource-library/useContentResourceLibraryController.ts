import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { message } from 'antd';
import {
  createContentAssetGroup,
  deleteContentAsset,
  deleteContentAssetGroup,
  listContentAssetGroups,
  listContentAssets,
  updateContentAssetGroup,
  uploadContentAsset,
} from '../../../../api/content';
import { API_BASE_URL } from '../../../../api/request';
import type { ContentAsset, ContentAssetGroup } from '../../../../types';
import type { ImagePreview } from '../AssetImageUpload';
import { useCardGridPageSize } from '../useCardGridPageSize';
import {
  allWorksFunctionOption,
  finishedAssetsPageSize,
  imageWorksFunctionOptions,
  resourceCopy,
  videoWorksFunctionOptions,
} from './resourceLibraryConfig';
import {
  finishedVideoStatus,
  fileUrl,
  groupWorksAssets,
  isCompletedGeneratedWorkAsset,
  matchesWorksAssetTab,
  matchesWorksFunction,
} from './resourceLibraryHelpers';
import type { ContentResourceLibraryPageProps, WorksAssetTab } from './pageTypes';

export function useContentResourceLibraryController({
  currentUser,
  resourceType,
  resourceOverride,
  singleDefaultGroup = false,
}: ContentResourceLibraryPageProps) {
  const copy = useMemo(
    () => ({ ...resourceCopy[resourceType], ...resourceOverride }),
    [resourceOverride, resourceType],
  );
  const createFilesRef = useRef<HTMLInputElement | null>(null);
  const groupFilesRef = useRef<HTMLInputElement | null>(null);
  const singleLibraryFilesRef = useRef<HTMLInputElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const { pageSize: singleLibraryPageSize } = useCardGridPageSize({ containerRef: gridRef, extraItems: 1 });

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
  const loadRequestIdRef = useRef(0);

  const loadData = useCallback(async () => {
    const requestId = ++loadRequestIdRef.current;
    setIsLoadingLibrary(true);
    try {
      const [groupList, assetList] = await Promise.all([
        listContentAssetGroups(currentUser.id, resourceType),
        listContentAssets({ userId: currentUser.id, resourceType }),
      ]);
      if (requestId !== loadRequestIdRef.current) return;
      setGroups(groupList);
      setAssets(resourceType === 'finished_video' ? assetList.filter(isCompletedGeneratedWorkAsset) : assetList);
      setActiveGroup((current) => groupList.find((group) => group.id === current?.id) || null);
    } catch (error) {
      if (requestId !== loadRequestIdRef.current) return;
      message.error(error instanceof Error ? error.message : '素材加载失败');
    } finally {
      if (requestId === loadRequestIdRef.current) setIsLoadingLibrary(false);
    }
  }, [currentUser.id, resourceType]);

  useEffect(() => { void loadData(); }, [loadData]);
  useEffect(() => () => { loadRequestIdRef.current += 1; }, []);

  useEffect(() => {
    if (resourceType !== 'finished_video') return undefined;
    const source = new EventSource(`${API_BASE_URL}/api/content/events`, { withCredentials: true });
    const handleComplete = () => { void loadData(); };
    source.addEventListener('video-generation-complete', handleComplete);
    return () => {
      source.removeEventListener('video-generation-complete', handleComplete);
      source.close();
    };
  }, [currentUser.id, loadData, resourceType]);

  const activeGroupAssets = useMemo(
    () => activeGroup ? assets.filter((asset) => asset.groupId === activeGroup.id) : [],
    [activeGroup, assets],
  );
  const filteredGroups = useMemo(() => {
    const keyword = searchKeyword.trim().toLowerCase();
    return keyword ? groups.filter((group) => group.name.toLowerCase().includes(keyword)) : groups;
  }, [groups, searchKeyword]);
  const filteredAssets = useMemo(() => {
    const keyword = searchKeyword.trim().toLowerCase();
    let nextAssets = assets;
    if (resourceType === 'finished_video') {
      nextAssets = nextAssets
        .filter((asset) => matchesWorksAssetTab(asset, worksAssetTab))
        .filter((asset) => matchesWorksFunction(asset, worksFunctionKey));
    }
    return keyword ? nextAssets.filter((asset) => asset.name.toLowerCase().includes(keyword)) : nextAssets;
  }, [assets, resourceType, searchKeyword, worksAssetTab, worksFunctionKey]);
  const visibleWorksAssets = useMemo(() => [...filteredAssets]
    .sort((left, right) => {
      const leftTime = new Date(left.createdAt).getTime();
      const rightTime = new Date(right.createdAt).getTime();
      return (Number.isNaN(rightTime) ? 0 : rightTime) - (Number.isNaN(leftTime) ? 0 : leftTime);
    })
    .slice(0, visibleWorksCount), [filteredAssets, visibleWorksCount]);
  const visibleWorksAssetGroups = useMemo(() => groupWorksAssets(visibleWorksAssets), [visibleWorksAssets]);
  const hasMoreWorksAssets = visibleWorksAssets.length < filteredAssets.length;

  const defaultGroup = useMemo(() => {
    if (!singleDefaultGroup) return null;
    return groups.find((group) => group.metadata?.systemDefault === true)
      || groups.find((group) => group.metadata?.hiddenFromGroupUi === true)
      || groups.find((group) => group.name === copy.defaultGroup)
      || null;
  }, [copy.defaultGroup, groups, singleDefaultGroup]);
  const singleLibraryCardAssets = useMemo(
    () => singleDefaultGroup ? filteredAssets : [],
    [filteredAssets, singleDefaultGroup],
  );
  const singleLibraryPagedAssets = useMemo(() => {
    const start = (singleLibraryPage - 1) * singleLibraryPageSize;
    return singleLibraryCardAssets.slice(start, start + singleLibraryPageSize);
  }, [singleLibraryCardAssets, singleLibraryPage, singleLibraryPageSize]);
  const singleLibraryDetailAssets = useMemo(
    () => singleDefaultGroup ? assets : activeGroupAssets,
    [activeGroupAssets, assets, singleDefaultGroup],
  );
  const worksFunctionOptions = useMemo(() => {
    const options = worksAssetTab === 'image'
      ? imageWorksFunctionOptions
      : worksAssetTab === 'video' ? videoWorksFunctionOptions : [...imageWorksFunctionOptions, ...videoWorksFunctionOptions];
    return [allWorksFunctionOption, ...options];
  }, [worksAssetTab]);

  useEffect(() => {
    if (!singleDefaultGroup) return;
    const maxPage = Math.max(1, Math.ceil(singleLibraryCardAssets.length / singleLibraryPageSize));
    setSingleLibraryPage((current) => Math.min(current, maxPage));
  }, [singleDefaultGroup, singleLibraryCardAssets.length, singleLibraryPageSize]);
  useEffect(() => {
    setSingleLibraryPage(1);
    setVisibleWorksCount(finishedAssetsPageSize);
  }, [searchKeyword, singleDefaultGroup, worksAssetTab, worksFunctionKey]);
  useEffect(() => {
    if (!worksFunctionOptions.some((option) => option.key === worksFunctionKey)) {
      setWorksFunctionKey(allWorksFunctionOption.key);
    }
  }, [worksFunctionKey, worksFunctionOptions]);

  const assetCountByGroupId = useMemo(() => {
    const map = new Map<string, number>();
    assets.forEach((asset) => map.set(asset.groupId, (map.get(asset.groupId) || 0) + 1));
    return map;
  }, [assets]);
  const groupAssetCount = (groupId: string) => assetCountByGroupId.get(groupId) || 0;
  const groupMeta = (group: ContentAssetGroup) => `${groupAssetCount(group.id)} ${copy.assetUnit} · 更新于 ${group.updatedAt.slice(0, 10)}`;
  const groupStatus = (group: ContentAssetGroup) => {
    const count = groupAssetCount(group.id);
    if (resourceType === 'digital_human') return count ? '已上传照片，待生成三视图' : '待上传本人照片';
    if (resourceType === 'voice') return count ? '已上传样本，待克隆音色' : '待上传音频样本';
    if (resourceType === 'scene') return count ? '图片可用于视频场景' : '待上传场景图片';
    return count ? '素材可用' : '待上传素材';
  };

  function openGroup(group: ContentAssetGroup) {
    setActiveGroup(group);
    setEditingGroupName(group.name);
    setPendingGroupFiles([]);
    setGroupModalOpen(true);
  }
  function openCreateEntry() {
    if (singleDefaultGroup) singleLibraryFilesRef.current?.click();
    else setCreateModalOpen(true);
  }
  async function uploadFilesToGroup(groupId: string | undefined, files: File[]) {
    await Promise.all(files.map((file) => uploadContentAsset({
      file, userId: currentUser.id, groupId, resourceType, name: file.name,
    })));
  }
  const uploadFilesToSingleLibrary = (files: File[]) => uploadFilesToGroup(defaultGroup?.id, files);

  async function handleCreateGroupWithAssets() {
    if (singleDefaultGroup) {
      if (!pendingCreateFiles.length) { message.warning(`请先${copy.uploadTitle}`); return; }
      try {
        setIsUploading(true);
        await uploadFilesToSingleLibrary(pendingCreateFiles);
        setPendingCreateFiles([]);
        setCreateModalOpen(false);
        await loadData();
        message.success('素材已上传');
      } catch (error) { message.error(error instanceof Error ? error.message : '素材上传失败'); }
      finally { setIsUploading(false); }
      return;
    }
    const name = groupName.trim();
    if (!name) { message.warning('请输入分组名称'); return; }
    try {
      setIsUploading(true);
      const group = await createContentAssetGroup({ userId: currentUser.id, resourceType, name });
      if (pendingCreateFiles.length) await uploadFilesToGroup(group.id, pendingCreateFiles);
      setGroupName('');
      setPendingCreateFiles([]);
      setCreateModalOpen(false);
      await loadData();
      openGroup(group);
      message.success('分组已创建');
    } catch (error) { message.error(error instanceof Error ? error.message : '分组创建失败'); }
    finally { setIsUploading(false); }
  }

  async function runUpload(files: File[], groupId?: string) {
    if (!files.length) return;
    try {
      setIsUploading(true);
      await uploadFilesToGroup(groupId, files);
      setPendingGroupFiles([]);
      await loadData();
      message.success('素材已上传');
    } catch (error) { message.error(error instanceof Error ? error.message : '素材上传失败'); }
    finally {
      setIsUploading(false);
      if (groupFilesRef.current) groupFilesRef.current.value = '';
    }
  }
  const handleUploadToSingleLibrary = () => runUpload(pendingGroupFiles, defaultGroup?.id);
  const handleUploadFilesToSingleLibrary = (files: File[]) => runUpload(files, defaultGroup?.id);
  const handleUploadToActiveGroup = () => activeGroup ? runUpload(pendingGroupFiles, activeGroup.id) : Promise.resolve();
  const handleUploadFilesToActiveGroup = (files: File[]) => activeGroup ? runUpload(files, activeGroup.id) : Promise.resolve();

  async function handleRenameGroup() {
    if (!activeGroup || !editingGroupName.trim()) return;
    try {
      const updated = await updateContentAssetGroup(activeGroup.id, { name: editingGroupName.trim() });
      setActiveGroup(updated);
      await loadData();
      message.success('分组名称已更新');
    } catch (error) { message.error(error instanceof Error ? error.message : '分组更新失败'); }
  }
  async function handleDeleteAsset(assetId: string) {
    try { await deleteContentAsset(assetId); await loadData(); message.success('素材已删除'); }
    catch (error) { message.error(error instanceof Error ? error.message : '素材删除失败'); }
  }
  async function handleDeleteGroup() {
    if (!activeGroup) return;
    try {
      setIsDeletingGroup(true);
      await deleteContentAssetGroup(activeGroup.id);
      setGroupModalOpen(false);
      setActiveGroup(null);
      await loadData();
      message.success('分组已删除');
    } catch (error) { message.error(error instanceof Error ? error.message : '分组删除失败'); }
    finally { setIsDeletingGroup(false); }
  }
  async function handleDeleteFinishedAsset(asset: ContentAsset) {
    try { await deleteContentAsset(asset.id); await loadData(); message.success('作品记录已删除'); return true; }
    catch (error) { message.error(error instanceof Error ? error.message : '作品删除失败'); return false; }
  }

  function closePreviewAsset() {
    previewVideoRef.current?.pause();
    if (previewVideoRef.current) previewVideoRef.current.currentTime = 0;
    setPreviewAsset(null);
  }
  function openImagePreview(image: ImagePreview) { setPreviewImage(image); setPreviewImageOpen(true); }
  function openAssetPreview(asset: ContentAsset) {
    if (asset.mimeType.startsWith('image/')) {
      openImagePreview({ name: asset.originalFileName || asset.name, src: fileUrl(asset) });
    } else setPreviewAsset(asset);
  }
  function handleWorksAssetTabChange(tab: WorksAssetTab) {
    setWorksAssetTab(tab);
    setWorksFunctionKey(allWorksFunctionOption.key);
  }

  return {
    activeGroup, assets, closePreviewAsset, copy, createFilesRef, createModalOpen, editingGroupName, filteredAssets,
    filteredGroups, finishedVideoStatus, gridRef, groupFilesRef, groupMeta, groupModalOpen, groupName, groupStatus,
    handleCreateGroupWithAssets, handleDeleteAsset, handleDeleteFinishedAsset, handleDeleteGroup, handleRenameGroup,
    handleUploadFilesToActiveGroup, handleUploadFilesToSingleLibrary, handleUploadToActiveGroup, handleUploadToSingleLibrary,
    groups, handleWorksAssetTabChange, hasMoreWorksAssets, isDeletingGroup, isLoadingLibrary, isUploading, loadMoreWorksAssets: () =>
      setVisibleWorksCount((current) => Math.min(current + finishedAssetsPageSize, filteredAssets.length)),
    openAssetPreview, openCreateEntry, openGroup, openImagePreview, pendingCreateFiles, pendingGroupFiles, previewAsset,
    previewImage, previewImageOpen, previewVideoRef, resetWorksHeaderFilters: () => { setWorksAssetTab('all'); setWorksFunctionKey(allWorksFunctionOption.key); },
    resourceType, searchKeyword, setCreateModalOpen, setEditingGroupName, setGroupModalOpen, setGroupName, setPendingCreateFiles,
    setPendingGroupFiles, setPreviewImage, setPreviewImageOpen, setSearchKeyword, setSingleLibraryPage, setWorksFunctionKey,
    singleDefaultGroup, singleLibraryCardAssets, singleLibraryDetailAssets, singleLibraryFilesRef, singleLibraryPage,
    singleLibraryPagedAssets, singleLibraryPageSize, visibleWorksAssetGroups, visibleWorksAssets, worksAssetTab,
    worksFunctionKey, worksFunctionOptions,
  };
}

export type ContentResourceLibraryController = ReturnType<typeof useContentResourceLibraryController>;
