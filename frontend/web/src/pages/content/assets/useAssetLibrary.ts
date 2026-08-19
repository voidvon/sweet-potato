import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { message } from 'antd';
import {
  createContentAssetGroup,
  deleteContentAsset,
  deleteContentAssetGroup,
  listContentAssetGroupsPage,
  listContentAssets,
  startVoiceClone,
  updateContentAssetGroup,
  uploadContentAsset,
} from '../../../api/content';
import type { ContentAsset, ContentAssetGroup, ContentAssetResourceType, User } from '../../../types';

type UseAssetLibraryInput = {
  currentUser: User;
  resourceType: ContentAssetResourceType;
  pageSize?: number;
};

type UploadFileToGroup = (groupId: string, file: File, metadata: Record<string, unknown>) => Promise<unknown>;

const DEFAULT_GROUP_PAGE_SIZE = 10;

export function useAssetLibrary({ currentUser, resourceType, pageSize = DEFAULT_GROUP_PAGE_SIZE }: UseAssetLibraryInput) {
  const [groups, setGroups] = useState<ContentAssetGroup[]>([]);
  const [assetsByGroupId, setAssetsByGroupId] = useState<Record<string, ContentAsset[]>>({});
  const [activeGroup, setActiveGroup] = useState<ContentAssetGroup | null>(null);
  const [groupPage, setGroupPage] = useState(1);
  const [groupTotal, setGroupTotal] = useState(0);
  const [isLoadingGroups, setIsLoadingGroups] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isDeletingGroup, setIsDeletingGroup] = useState(false);
  const scopeRef = useRef('');
  const groupsRequestIdRef = useRef(0);

  const loadGroups = useCallback(async (page = groupPage) => {
    const requestId = groupsRequestIdRef.current + 1;
    groupsRequestIdRef.current = requestId;
    setIsLoadingGroups(true);
    try {
      const result = await listContentAssetGroupsPage({
        userId: currentUser.id,
        resourceType,
        page,
        pageSize,
      });
      setGroups(result.items);
      setGroupTotal(result.total);
      setActiveGroup((current) => {
        if (!current) {
          return null;
        }
        return result.items.find((group) => group.id === current.id) || current;
      });
      return result.items;
    } catch (error) {
      message.error(error instanceof Error ? error.message : '素材加载失败');
      return [];
    } finally {
      if (groupsRequestIdRef.current === requestId) {
        setIsLoadingGroups(false);
      }
    }
  }, [currentUser.id, pageSize, resourceType, groupPage]);

  const loadGroupAssets = useCallback(async (groupId: string) => {
    const groupAssets = await listContentAssets({ userId: currentUser.id, groupId });
    setAssetsByGroupId((current) => ({ ...current, [groupId]: groupAssets }));
    return groupAssets;
  }, [currentUser.id]);

  const loadData = useCallback(async () => {
    const currentGroupId = activeGroup?.id;
    const promises: Promise<unknown>[] = [loadGroups(groupPage)];
    if (currentGroupId) {
      promises.push(loadGroupAssets(currentGroupId).catch((error) => {
        message.error(error instanceof Error ? error.message : '素材加载失败');
      }));
    }
    await Promise.all(promises);
  }, [activeGroup?.id, groupPage, loadGroups, loadGroupAssets]);

  useEffect(() => {
    const scope = `${currentUser.id}:${resourceType}`;
    if (scopeRef.current !== scope) {
      scopeRef.current = scope;
      setAssetsByGroupId({});
      setActiveGroup(null);
      if (groupPage !== 1) {
        setGroupPage(1);
        return;
      }
    }
    void loadGroups(groupPage);
  }, [currentUser.id, resourceType, groupPage, loadGroups]);

  const activeGroupAssets = useMemo(
    () => (activeGroup ? assetsByGroupId[activeGroup.id] || [] : []),
    [activeGroup, assetsByGroupId],
  );

  const groupAssets = useCallback((groupId: string) => {
    const loadedAssets = assetsByGroupId[groupId];
    if (loadedAssets) {
      return loadedAssets;
    }
    return groups.find((group) => group.id === groupId)?.coverAssets || [];
  }, [assetsByGroupId, groups]);

  const openGroup = useCallback(async (group: ContentAssetGroup) => {
    setActiveGroup(group);
    try {
      await loadGroupAssets(group.id);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '素材加载失败');
    }
  }, [loadGroupAssets]);

  const uploadFilesToGroup = useCallback(async (groupId: string, files: File[], metadata: Record<string, unknown> = {}, uploadFileToGroup?: UploadFileToGroup) => {
    await Promise.all(files.map((file) => (
      uploadFileToGroup
        ? uploadFileToGroup(groupId, file, metadata)
        : uploadContentAsset({
          file,
          userId: currentUser.id,
          groupId,
          resourceType,
          name: file.name,
          metadata,
        })
    )));
  }, [currentUser.id, resourceType]);

  const createGroupWithAssets = useCallback(async (
    name: string,
    files: File[],
    options: { description?: string; groupMetadata?: Record<string, unknown>; assetMetadata?: Record<string, unknown>; uploadFileToGroup?: UploadFileToGroup } = {},
  ) => {
    if (!name.trim()) {
      message.warning('请输入名称');
      return null;
    }
    try {
      setIsUploading(true);
      const group = await createContentAssetGroup({
        userId: currentUser.id,
        resourceType,
        name: name.trim(),
        description: options.description,
        metadata: options.groupMetadata,
      });
      if (files.length) {
        await uploadFilesToGroup(group.id, files, options.assetMetadata, options.uploadFileToGroup);
      }
      setGroupPage(1);
      await Promise.all([loadGroups(1), loadGroupAssets(group.id)]);
      setActiveGroup(group);
      message.success('创建成功');
      return group;
    } catch (error) {
      message.error(error instanceof Error ? error.message : '创建失败');
      return null;
    } finally {
      setIsUploading(false);
    }
  }, [currentUser.id, resourceType, uploadFilesToGroup, loadGroups, loadGroupAssets]);

  const renameGroup = useCallback(async (id: string, name: string) => {
    if (!name.trim()) {
      message.warning('请输入名称');
      return null;
    }
    try {
      const updated = await updateContentAssetGroup(id, { name: name.trim() });
      setActiveGroup(updated);
      await loadGroups(groupPage);
      message.success('名称已更新');
      return updated;
    } catch (error) {
      message.error(error instanceof Error ? error.message : '更新失败');
      return null;
    }
  }, [groupPage, loadGroups]);

  const uploadToActiveGroup = useCallback(async (files: File[], metadata: Record<string, unknown> = {}, uploadFileToGroup?: UploadFileToGroup) => {
    if (!activeGroup || !files.length) {
      return false;
    }
    try {
      setIsUploading(true);
      await uploadFilesToGroup(activeGroup.id, files, metadata, uploadFileToGroup);
      await Promise.all([loadGroupAssets(activeGroup.id), loadGroups(groupPage)]);
      message.success('上传成功');
      return true;
    } catch (error) {
      message.error(error instanceof Error ? error.message : '上传失败');
      return false;
    } finally {
      setIsUploading(false);
    }
  }, [activeGroup, groupPage, loadGroups, loadGroupAssets, uploadFilesToGroup]);

  const replaceActiveGroupAssets = useCallback(async (files: File[], metadata: Record<string, unknown> = {}, uploadFileToGroup?: UploadFileToGroup) => {
    if (!activeGroup || !files.length) {
      return false;
    }
    try {
      setIsUploading(true);
      await Promise.all(activeGroupAssets.map((asset) => deleteContentAsset(asset.id)));
      await uploadFilesToGroup(activeGroup.id, files, metadata, uploadFileToGroup);
      await Promise.all([loadGroupAssets(activeGroup.id), loadGroups(groupPage)]);
      message.success('上传成功');
      return true;
    } catch (error) {
      message.error(error instanceof Error ? error.message : '上传失败');
      return false;
    } finally {
      setIsUploading(false);
    }
  }, [activeGroup, activeGroupAssets, groupPage, loadGroups, loadGroupAssets, uploadFilesToGroup]);

  const removeAsset = useCallback(async (assetId: string) => {
    try {
      const groupId = activeGroup?.id;
      await deleteContentAsset(assetId);
      const promises: Promise<unknown>[] = [loadGroups(groupPage)];
      if (groupId) {
        promises.push(loadGroupAssets(groupId));
      }
      await Promise.all(promises);
      message.success('素材已删除');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '素材删除失败');
    }
  }, [activeGroup?.id, groupPage, loadGroups, loadGroupAssets]);

  const removeActiveGroup = useCallback(async () => {
    if (!activeGroup) {
      return false;
    }
    try {
      setIsDeletingGroup(true);
      await deleteContentAssetGroup(activeGroup.id);
      setActiveGroup(null);
      setAssetsByGroupId((current) => {
        const next = { ...current };
        delete next[activeGroup.id];
        return next;
      });
      await loadGroups(groupPage);
      message.success('删除成功');
      return true;
    } catch (error) {
      message.error(error instanceof Error ? error.message : '删除失败');
      return false;
    } finally {
      setIsDeletingGroup(false);
    }
  }, [activeGroup, groupPage, loadGroups]);

  const cloneActiveVoiceGroup = useCallback(async (sampleAssetId?: string) => {
    if (!activeGroup) {
      return null;
    }
    try {
      const updated = await startVoiceClone(activeGroup.id, {
        userId: currentUser.id,
        sampleAssetId,
      });
      setActiveGroup(updated);
      await Promise.all([loadGroups(groupPage), loadGroupAssets(updated.id)]);
      const clone = updated.metadata?.voiceClone as Record<string, unknown> | undefined;
      if (clone?.status === 'failed') {
        message.error(typeof clone.failureReason === 'string' ? clone.failureReason : '声音克隆失败');
      } else {
        message.success(clone?.status === 'success' ? '声音克隆完成' : '声音克隆已提交');
      }
      return updated;
    } catch (error) {
      message.error(error instanceof Error ? error.message : '声音克隆失败');
      return null;
    }
  }, [activeGroup, currentUser.id, groupPage, loadGroups, loadGroupAssets]);

  const cloneVoiceGroup = useCallback(async (groupId: string, sampleAssetId?: string) => {
    try {
      const updated = await startVoiceClone(groupId, {
        userId: currentUser.id,
        sampleAssetId,
      });
      setActiveGroup((current) => (current?.id === updated.id ? updated : current));
      await Promise.all([loadGroups(groupPage), loadGroupAssets(updated.id)]);
      return updated;
    } catch (error) {
      message.error(error instanceof Error ? error.message : '声音克隆失败');
      return null;
    }
  }, [currentUser.id, groupPage, loadGroups, loadGroupAssets]);

  return {
    activeGroup,
    activeGroupAssets,
    assets: Object.values(assetsByGroupId).flat(),
    cloneActiveVoiceGroup,
    cloneVoiceGroup,
    createGroupWithAssets,
    groupPage,
    groupPageSize: pageSize,
    groupTotal,
    groupAssets,
    groups,
    isLoadingGroups,
    isDeletingGroup,
    isUploading,
    loadGroupAssets,
    loadGroups,
    loadData,
    openGroup,
    removeActiveGroup,
    removeAsset,
    replaceActiveGroupAssets,
    renameGroup,
    setActiveGroup,
    setGroupPage,
    uploadToActiveGroup,
  };
}
