import { useEffect, useMemo, useRef, useState } from 'react'
import { Form, message } from 'antd'
import {
  generateDigitalHumanThreeView,
  generateVirtualPortraitThreeView,
  syncVirtualPortraitRemoteLibrary,
  uploadVirtualPortraitAsset,
} from '../../../../api/content'
import { API_BASE_URL } from '../../../../api/request'
import type { ContentAsset, User } from '../../../../types'
import type { ImagePreview } from '../AssetImageUpload'
import { useAssetLibrary } from '../useAssetLibrary'
import { useCardGridPageSize } from '../useCardGridPageSize'
import {
  downloadAsset,
  isThreeViewFailure,
  isThreeViewResult,
  isThreeViewRunning,
  localUploadFileList,
  threeViewFailureReason,
} from './digitalHumanHelpers'

export type DigitalHumanAssetsPageProps = {
  currentUser: User
  variant?: 'digital_human' | 'virtual_portrait'
}

export type DigitalHumanCreateMode = 'local' | 'ai'

type ThreeViewStatusEvent = {
  type: 'digital-human-three-view-status'
  userId: string
  groupId: string
  status: 'running' | 'success' | 'failed'
  failureReason?: string
}

export function useDigitalHumanAssetsController({
  currentUser,
  variant = 'digital_human',
}: DigitalHumanAssetsPageProps) {
  const isVirtualPortrait = variant === 'virtual_portrait'
  const label = isVirtualPortrait ? '虚拟人像' : '数字人'
  const [createForm] = Form.useForm<{ name: string }>()
  const gridRef = useRef<HTMLDivElement | null>(null)
  const { pageSize } = useCardGridPageSize({
    containerRef: gridRef,
    extraItems: 1,
  })
  const library = useAssetLibrary({
    currentUser,
    pageSize,
    resourceType: isVirtualPortrait ? 'virtual_portrait' : 'digital_human',
  })
  const libraryRef = useRef(library)
  const localReplaceInputRef = useRef<HTMLInputElement | null>(null)
  const [choiceOpen, setChoiceOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [createMode, setCreateMode] = useState<DigitalHumanCreateMode>('ai')
  const [detailOpen, setDetailOpen] = useState(false)
  const [avatarName, setAvatarName] = useState('')
  const [editingName, setEditingName] = useState('')
  const [pendingCreateFiles, setPendingCreateFiles] = useState<File[]>([])
  const [previewImage, setPreviewImage] = useState<ImagePreview | null>(null)
  const [searchKeyword, setSearchKeyword] = useState('')
  const [agreementChecked, setAgreementChecked] = useState(true)
  const [generatingThreeViewGroupIds, setGeneratingThreeViewGroupIds] =
    useState<Set<string>>(() => new Set())
  const [threeViewFailureReasons, setThreeViewFailureReasons] = useState<
    Record<string, string>
  >({})
  const [isSyncingRemoteLibrary, setIsSyncingRemoteLibrary] = useState(false)

  const createUploadFileList = useMemo(
    () => localUploadFileList(pendingCreateFiles),
    [pendingCreateFiles],
  )
  const activeThreeViewResults =
    library.activeGroupAssets.filter(isThreeViewResult)
  const activeThreeViewResult = activeThreeViewResults[0]
  const activeThreeViewFailure =
    library.activeGroupAssets.find(isThreeViewFailure)
  const activeThreeViewRunning =
    library.activeGroupAssets.find(isThreeViewRunning)
  const activeTrainingPhotos = library.activeGroupAssets.filter(
    (asset) =>
      !isThreeViewResult(asset) &&
      !isThreeViewFailure(asset) &&
      !isThreeViewRunning(asset),
  )
  const isLocalUploadGroup =
    library.activeGroup?.metadata?.source === 'local_upload'
  const editableAssets = isLocalUploadGroup
    ? activeThreeViewResults
    : activeTrainingPhotos
  const hasTrainingPhotos = activeTrainingPhotos.length > 0
  const activeGroupId = library.activeGroup?.id
  const isActiveGroupGenerating = Boolean(
    activeGroupId &&
    (generatingThreeViewGroupIds.has(activeGroupId) || activeThreeViewRunning),
  )
  const activeGroupFailureReason = activeGroupId
    ? threeViewFailureReasons[activeGroupId] ||
      threeViewFailureReason(activeThreeViewFailure)
    : undefined
  const filteredGroups = useMemo(() => {
    const keyword = searchKeyword.trim().toLowerCase()
    return keyword
      ? library.groups.filter((group) =>
          group.name.toLowerCase().includes(keyword),
        )
      : library.groups
  }, [library.groups, searchKeyword])

  useEffect(() => {
    libraryRef.current = library
  }, [library.loadGroups, library.loadGroupAssets, library.groupPage])

  useEffect(() => {
    const source = new EventSource(
      `${API_BASE_URL}/api/content/events`, { withCredentials: true },
    )
    function handleStatus(event: MessageEvent<string>) {
      let data: ThreeViewStatusEvent
      try {
        data = JSON.parse(event.data) as ThreeViewStatusEvent
      } catch {
        return
      }
      if (data.userId !== currentUser.id) return
      if (data.status === 'running') {
        setGeneratingThreeViewGroupIds((current) =>
          new Set(current).add(data.groupId),
        )
        setThreeViewFailureReasons((current) => {
          const next = { ...current }
          delete next[data.groupId]
          return next
        })
        return
      }
      setGeneratingThreeViewGroupIds((current) => {
        const next = new Set(current)
        next.delete(data.groupId)
        return next
      })
      if (data.status === 'failed') {
        setThreeViewFailureReasons((current) => ({
          ...current,
          [data.groupId]:
            data.failureReason || '三视图生成失败，请检查模型配置',
        }))
      } else {
        setThreeViewFailureReasons((current) => {
          const next = { ...current }
          delete next[data.groupId]
          return next
        })
      }
      void libraryRef.current.loadGroupAssets(data.groupId)
      void libraryRef.current.loadGroups(libraryRef.current.groupPage)
    }
    source.addEventListener('digital-human-three-view-status', handleStatus)
    return () => {
      source.removeEventListener(
        'digital-human-three-view-status',
        handleStatus,
      )
      source.close()
    }
  }, [currentUser.id])

  function resetCreateForm() {
    setAvatarName('')
    setPendingCreateFiles([])
    setAgreementChecked(true)
    createForm.resetFields()
  }
  function openCreateChoice() {
    resetCreateForm()
    setChoiceOpen(true)
  }
  function openCreateModal(mode: DigitalHumanCreateMode) {
    setChoiceOpen(false)
    resetCreateForm()
    setCreateMode(mode)
    setCreateOpen(true)
  }
  function closeCreateModal() {
    setCreateOpen(false)
    resetCreateForm()
  }

  async function handleCreate(nameOverride?: string) {
    const nextAvatarName = (nameOverride ?? avatarName).trim()
    if (!nextAvatarName) {
      message.warning(`请输入${label}名称`)
      return
    }
    if (createMode === 'ai' && !agreementChecked) {
      message.warning('请先阅读并同意使用协议')
      return
    }
    if (!pendingCreateFiles.length) {
      message.warning(
        createMode === 'local' ? `请先上传${label}图片` : '请先上传训练照片',
      )
      return
    }
    const isLocalUpload = createMode === 'local'
    const group = await library.createGroupWithAssets(
      nextAvatarName,
      pendingCreateFiles,
      {
        groupMetadata: {
          source: isLocalUpload ? 'local_upload' : 'ai_generate',
        },
        assetMetadata: {
          source: isLocalUpload ? 'local_upload' : 'ai_generate',
          kind: isLocalUpload ? 'three_view_result' : 'training_photo',
        },
        uploadFileToGroup:
          isVirtualPortrait && isLocalUpload
            ? (groupId, file, metadata) =>
                uploadVirtualPortraitAsset(groupId, {
                  file,
                  userId: currentUser.id,
                  name: file.name,
                  metadata,
                })
            : undefined,
      },
    )
    if (group) {
      resetCreateForm()
      setCreateOpen(false)
      setEditingName(group.name)
      setDetailOpen(true)
      if (!isLocalUpload) await generateThreeViewForGroup(group.id)
    }
  }

  async function generateThreeViewForGroup(groupId: string) {
    try {
      setGeneratingThreeViewGroupIds((current) => new Set(current).add(groupId))
      setThreeViewFailureReasons((current) => {
        const next = { ...current }
        delete next[groupId]
        return next
      })
      await (
        isVirtualPortrait
          ? generateVirtualPortraitThreeView
          : generateDigitalHumanThreeView
      )(groupId, { userId: currentUser.id })
      await Promise.all([
        library.loadGroupAssets(groupId),
        library.loadGroups(library.groupPage),
      ])
      setDetailOpen(true)
    } catch (error) {
      const failureReason =
        error instanceof Error
          ? error.message
          : '三视图生成失败，请检查模型配置'
      await Promise.all([
        library.loadGroupAssets(groupId),
        library.loadGroups(library.groupPage),
      ])
      setThreeViewFailureReasons((current) => ({
        ...current,
        [groupId]: failureReason,
      }))
    } finally {
      setGeneratingThreeViewGroupIds((current) => {
        const next = new Set(current)
        next.delete(groupId)
        return next
      })
    }
  }

  async function handleGenerateThreeView() {
    if (!library.activeGroup) {
      message.warning(`请先选择${label}项目`)
      return
    }
    if (!hasTrainingPhotos) {
      message.warning('请先上传本人照片')
      return
    }
    await generateThreeViewForGroup(library.activeGroup.id)
  }
  async function handleDeleteProject() {
    if (await library.removeActiveGroup()) setDetailOpen(false)
  }
  async function handleDownloadThreeView(asset: ContentAsset) {
    try {
      await downloadAsset(asset, library.activeGroup?.name || asset.name, label)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '下载失败')
    }
  }
  async function handleReplaceLocalDigitalHuman(file: File) {
    const ok = await library.replaceActiveGroupAssets(
      [file],
      { source: 'local_upload', kind: 'three_view_result' },
      isVirtualPortrait
        ? (groupId, uploadFile, metadata) =>
            uploadVirtualPortraitAsset(groupId, {
              file: uploadFile,
              userId: currentUser.id,
              name: uploadFile.name,
              metadata,
            })
        : undefined,
    )
    if (ok && library.activeGroup)
      await library.loadGroupAssets(library.activeGroup.id)
  }
  async function openDetail(groupId: string) {
    const group = library.groups.find((item) => item.id === groupId)
    if (!group) return
    await library.openGroup(group)
    setEditingName(group.name)
    setDetailOpen(true)
  }
  async function handleSyncRemoteLibrary() {
    if (!isVirtualPortrait || currentUser.role !== 'admin') return
    try {
      setIsSyncingRemoteLibrary(true)
      const result = await syncVirtualPortraitRemoteLibrary({
        userId: currentUser.id,
        includeAssets: true,
        pageSize: 100,
      })
      await library.loadGroups(library.groupPage)
      if (library.activeGroup)
        await library.loadGroupAssets(library.activeGroup.id)
      if (result.failedGroups > 0) {
        message.warning(
          `云端同步完成：${result.createdGroups} 个新增，${result.updatedGroups} 个更新，${result.failedGroups} 个失败`,
        )
        return
      }
      message.success(
        `云端同步完成：${result.totalRemoteGroups} 个分组已检查，${result.createdGroups} 个新增`,
      )
    } catch (error) {
      message.error(error instanceof Error ? error.message : '云端同步失败')
    } finally {
      setIsSyncingRemoteLibrary(false)
    }
  }

  return {
    activeGroupFailureReason,
    activeThreeViewResult,
    agreementChecked,
    avatarName,
    choiceOpen,
    closeCreateModal,
    createForm,
    createMode,
    createOpen,
    createUploadFileList,
    currentUser,
    detailOpen,
    editableAssets,
    editingName,
    filteredGroups,
    generatingThreeViewGroupIds,
    gridRef,
    handleCreate,
    handleDeleteProject,
    handleDownloadThreeView,
    handleGenerateThreeView,
    handleReplaceLocalDigitalHuman,
    handleSyncRemoteLibrary,
    hasTrainingPhotos,
    isActiveGroupGenerating,
    isLocalUploadGroup,
    isSyncingRemoteLibrary,
    isVirtualPortrait,
    label,
    library,
    localReplaceInputRef,
    openCreateChoice,
    openCreateModal,
    openDetail,
    pendingCreateFiles,
    previewImage,
    searchKeyword,
    setAgreementChecked,
    setAvatarName,
    setChoiceOpen,
    setCreateOpen,
    setDetailOpen,
    setEditingName,
    setPendingCreateFiles,
    setPreviewImage,
    setSearchKeyword,
  }
}

export type DigitalHumanAssetsController = ReturnType<
  typeof useDigitalHumanAssetsController
>
