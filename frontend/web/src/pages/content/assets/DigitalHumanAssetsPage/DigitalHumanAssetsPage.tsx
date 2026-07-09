import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Checkbox, Form, Image, Input, Modal, Pagination, Spin, Upload, message } from 'antd';
import type { UploadFile } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { Bot, FolderUp, Plus, RefreshCw, Search } from 'lucide-react';
import { generateDigitalHumanThreeView, generateVirtualPortraitThreeView, syncVirtualPortraitRemoteLibrary, uploadVirtualPortraitAsset } from '../../../../api/content';
import { API_BASE_URL } from '../../../../api/request';
import { AssetLibraryCard, AssetLibraryCreateCard, AssetLibraryPlaceholderCard, AssetLibrarySkeletonCards } from '../../../../components/AssetLibraryCard';
import { isElectronEgg, saveAssetFile } from '../../../../ipc';
import { ContentStudioLayout } from '../../../../layouts/ContentStudioLayout';
import type { ContentAsset, User } from '../../../../types';
import { DetailImageUpload, PendingImageUpload } from '../AssetImageUpload';
import type { ImagePreview } from '../AssetImageUpload';
import { useCardGridPageSize } from '../useCardGridPageSize';
import { useAssetLibrary } from '../useAssetLibrary';
import { withAuthToken } from '../../../../utils/session';
import '../AssetLibraryPages.scss';

type DigitalHumanAssetsPageProps = {
  currentUser: User;
  variant?: 'digital_human' | 'virtual_portrait';
};

type ThreeViewStatusEvent = {
  type: 'digital-human-three-view-status';
  userId: string;
  groupId: string;
  status: 'running' | 'success' | 'failed';
  failureReason?: string;
};

type DigitalHumanCreateMode = 'local' | 'ai';

function fileUrl(asset: ContentAsset) {
  const localMirrorUrl = metadataUrl(asset, 'localMirrorUrl');
  if (asset.resourceType === 'virtual_portrait' && localMirrorUrl) {
    return `${API_BASE_URL}${localMirrorUrl.startsWith('/') ? localMirrorUrl : `/${localMirrorUrl}`}`;
  }
  if (!asset.fileUrl) {
    return '';
  }
  if (/^(blob:|data:|https?:\/\/)/i.test(asset.fileUrl)) {
    return asset.fileUrl;
  }
  return `${API_BASE_URL}${asset.fileUrl.startsWith('/') ? asset.fileUrl : `/${asset.fileUrl}`}`;
}

function metadataUrl(asset: ContentAsset, key: string) {
  const value = asset.metadata?.[key];
  return typeof value === 'string' ? value.trim() : '';
}

function previewUrl(asset: ContentAsset) {
  return fileUrl(asset) || metadataUrl(asset, 'remotePreviewUrl');
}

function formatDate(value: string) {
  return value ? value.slice(0, 10) : '';
}

function isThreeViewResult(asset: ContentAsset) {
  if (asset.metadata?.kind === 'three_view_failure' || asset.metadata?.kind === 'three_view_running') {
    return false;
  }
  return asset.metadata?.kind === 'three_view_result'
    || /三视图|多视图|成品|结果|three[-_ ]?view/i.test(`${asset.name} ${asset.description}`);
}

function isThreeViewFailure(asset: ContentAsset) {
  return asset.metadata?.kind === 'three_view_failure';
}

function isThreeViewRunning(asset: ContentAsset) {
  return asset.metadata?.kind === 'three_view_running';
}

function threeViewFailureReason(asset: ContentAsset | undefined) {
  const reason = asset?.metadata?.failureReason;
  return typeof reason === 'string' && reason.trim() ? reason : asset?.description;
}

function photoPreview(asset?: ContentAsset) {
  return asset?.mimeType.startsWith('image/') ? <img alt={asset.name} src={previewUrl(asset)} /> : <span>👤</span>;
}

function browserDownload(url: string, fileName: string) {
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

async function pickerDownload(url: string, fileName: string): Promise<'saved' | 'canceled' | 'unsupported'> {
  if (!window.showSaveFilePicker) {
    return 'unsupported';
  }
  try {
    const handle = await window.showSaveFilePicker({
      suggestedName: fileName,
      types: [{
        description: '图片文件',
        accept: {
          'image/png': ['.png'],
          'image/jpeg': ['.jpg', '.jpeg'],
          'image/webp': ['.webp'],
        },
      }],
    });
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`下载失败：${response.status}`);
    }
    const writable = await handle.createWritable();
    await writable.write(await response.blob());
    await writable.close();
    return 'saved';
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return 'canceled';
    }
    throw error;
  }
}

function safeDownloadName(value: string) {
  return value.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim() || '未命名';
}

function localUploadFileList(files: File[]) {
  return files.map<UploadFile>((file) => ({
    uid: `${file.name}-${file.size}-${file.lastModified}`,
    name: file.name,
    status: 'done',
    originFileObj: file as UploadFile['originFileObj'],
  }));
}

function filesFromUploadList(fileList: UploadFile[]) {
  return fileList.reduce<File[]>((files, item) => {
    if (item.originFileObj) {
      files.push(item.originFileObj as File);
    }
    return files;
  }, []);
}

async function downloadAsset(asset: ContentAsset, groupName: string, label = '数字人') {
  const url = fileUrl(asset);
  const extension = asset.originalFileName.includes('.') ? asset.originalFileName.slice(asset.originalFileName.lastIndexOf('.')) : '.png';
  const time = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '');
  const fileName = `${label}三视图-${safeDownloadName(groupName)}-${time}${extension}`;
  if (isElectronEgg) {
    const result = await saveAssetFile({
      fileName,
      sourcePath: asset.filePath,
      url: /^https?:\/\//i.test(url) ? url : undefined,
    });
    if (result.canceled) {
      return;
    }
    if (!result.ok) {
      const pickerResult = await pickerDownload(url, fileName);
      if (pickerResult === 'saved') {
        message.success('文件已保存');
        return;
      }
      if (pickerResult === 'canceled') {
        return;
      }
      browserDownload(url, fileName);
      return;
    }
    message.success('文件已保存');
    return;
  }
  browserDownload(url, fileName);
}

function resultPreview(
  asset: ContentAsset | undefined,
  isGenerating: boolean,
  failureReason: string | undefined,
) {
  if (isGenerating) {
    return (
      <div className="digital-human-result-generating">
        <Spin size="large" />
        <strong>图片生成中</strong>
        <span>模型正在合成三视图，可能需要几十秒到数分钟，您可以关闭弹窗，稍后再查看。</span>
      </div>
    );
  }
  if (failureReason) {
    return (
      <div className="digital-human-result-failed">
        <strong>三视图生成失败</strong>
        <span>{failureReason}</span>
      </div>
    );
  }
  return asset ? (
    <div className="digital-human-result-wrapper">
      <Image
        alt={asset.name}
        className="digital-human-result-image"
        preview={{
          mask: false,
          rootClassName: 'digital-human-preview-root',
          src: previewUrl(asset),
        }}
        src={previewUrl(asset)}
      />
    </div>
  ) : null;
}

export function DigitalHumanAssetsPage({ currentUser, variant = 'digital_human' }: DigitalHumanAssetsPageProps) {
  const isVirtualPortrait = variant === 'virtual_portrait';
  const label = isVirtualPortrait ? '虚拟人像' : '数字人';
  const [createForm] = Form.useForm<{ name: string }>();
  const gridRef = useRef<HTMLDivElement | null>(null);
  const { pageSize } = useCardGridPageSize({
    containerRef: gridRef,
    extraItems: 1,
  });
  const library = useAssetLibrary({ currentUser, pageSize, resourceType: isVirtualPortrait ? 'virtual_portrait' : 'digital_human' });
  const libraryRef = useRef(library);
  const localReplaceInputRef = useRef<HTMLInputElement | null>(null);
  const [choiceOpen, setChoiceOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createMode, setCreateMode] = useState<DigitalHumanCreateMode>('ai');
  const [detailOpen, setDetailOpen] = useState(false);
  const [avatarName, setAvatarName] = useState('');
  const [editingName, setEditingName] = useState('');
  const [pendingCreateFiles, setPendingCreateFiles] = useState<File[]>([]);
  const [previewImage, setPreviewImage] = useState<ImagePreview | null>(null);
  const [searchKeyword, setSearchKeyword] = useState('');
  const hasKeyword = searchKeyword.trim().length > 0;
  const [agreementChecked, setAgreementChecked] = useState(true);
  const [generatingThreeViewGroupIds, setGeneratingThreeViewGroupIds] = useState<Set<string>>(() => new Set());
  const [threeViewFailureReasons, setThreeViewFailureReasons] = useState<Record<string, string>>({});
  const [isSyncingRemoteLibrary, setIsSyncingRemoteLibrary] = useState(false);
  const createUploadFileList = useMemo(() => localUploadFileList(pendingCreateFiles), [pendingCreateFiles]);
  const activeThreeViewResults = library.activeGroupAssets.filter(isThreeViewResult);
  const activeThreeViewResult = activeThreeViewResults[0];
  const activeThreeViewFailure = library.activeGroupAssets.find(isThreeViewFailure);
  const activeThreeViewRunning = library.activeGroupAssets.find(isThreeViewRunning);
  const activeTrainingPhotos = library.activeGroupAssets.filter((asset) => !isThreeViewResult(asset) && !isThreeViewFailure(asset) && !isThreeViewRunning(asset));
  const isLocalUploadGroup = library.activeGroup?.metadata?.source === 'local_upload';
  const editableAssets = isLocalUploadGroup ? activeThreeViewResults : activeTrainingPhotos;
  const hasTrainingPhotos = activeTrainingPhotos.length > 0;
  const activeGroupId = library.activeGroup?.id;
  const isActiveGroupGenerating = Boolean(activeGroupId && (generatingThreeViewGroupIds.has(activeGroupId) || activeThreeViewRunning));
  const activeGroupFailureReason = activeGroupId
    ? threeViewFailureReasons[activeGroupId] || threeViewFailureReason(activeThreeViewFailure)
    : undefined;
  const filteredGroups = useMemo(() => {
    const keyword = searchKeyword.trim().toLowerCase();
    if (!keyword) {
      return library.groups;
    }
    return library.groups.filter((group) => group.name.toLowerCase().includes(keyword));
  }, [library.groups, searchKeyword]);

  useEffect(() => {
    libraryRef.current = library;
  }, [library.loadGroups, library.loadGroupAssets, library.groupPage]);

  useEffect(() => {
    const source = new EventSource(withAuthToken(`${API_BASE_URL}/api/content/events`));
    function handleStatus(event: MessageEvent<string>) {
      let data: ThreeViewStatusEvent;
      try {
        data = JSON.parse(event.data) as ThreeViewStatusEvent;
      } catch {
        return;
      }
      if (data.userId !== currentUser.id) {
        return;
      }
      if (data.status === 'running') {
        setGeneratingThreeViewGroupIds((current) => new Set(current).add(data.groupId));
        setThreeViewFailureReasons((current) => {
          const next = { ...current };
          delete next[data.groupId];
          return next;
        });
        return;
      }
      setGeneratingThreeViewGroupIds((current) => {
        const next = new Set(current);
        next.delete(data.groupId);
        return next;
      });
      if (data.status === 'failed') {
        setThreeViewFailureReasons((current) => ({
          ...current,
          [data.groupId]: data.failureReason || '三视图生成失败，请检查模型配置',
        }));
      } else {
        setThreeViewFailureReasons((current) => {
          const next = { ...current };
          delete next[data.groupId];
          return next;
        });
      }
      void libraryRef.current.loadGroupAssets(data.groupId);
      void libraryRef.current.loadGroups(libraryRef.current.groupPage);
    }
    source.addEventListener('digital-human-three-view-status', handleStatus);
    return () => {
      source.removeEventListener('digital-human-three-view-status', handleStatus);
      source.close();
    };
  }, [currentUser.id]);

  function resetCreateForm() {
    setAvatarName('');
    setPendingCreateFiles([]);
    setAgreementChecked(true);
    createForm.resetFields();
  }

  function openCreateChoice() {
    resetCreateForm();
    setChoiceOpen(true);
  }

  function openCreateModal(mode: DigitalHumanCreateMode) {
    setChoiceOpen(false);
    resetCreateForm();
    setCreateMode(mode);
    setCreateOpen(true);
  }

  async function handleCreate(nameOverride?: string) {
    const nextAvatarName = (nameOverride ?? avatarName).trim();
    if (!nextAvatarName) {
      message.warning(`请输入${label}名称`);
      return;
    }
    if (createMode === 'ai' && !agreementChecked) {
      message.warning('请先阅读并同意使用协议');
      return;
    }
    if (!pendingCreateFiles.length) {
      message.warning(createMode === 'local' ? `请先上传${label}图片` : '请先上传训练照片');
      return;
    }
    const isLocalUpload = createMode === 'local';
    const group = await library.createGroupWithAssets(nextAvatarName, pendingCreateFiles, {
      groupMetadata: { source: isLocalUpload ? 'local_upload' : 'ai_generate' },
      assetMetadata: {
        source: isLocalUpload ? 'local_upload' : 'ai_generate',
        kind: isLocalUpload ? 'three_view_result' : 'training_photo',
      },
      uploadFileToGroup: isVirtualPortrait && isLocalUpload
        ? (groupId, file, metadata) => uploadVirtualPortraitAsset(groupId, {
          file,
          userId: currentUser.id,
          name: file.name,
          metadata,
        })
        : undefined,
    });
    if (group) {
      resetCreateForm();
      setCreateOpen(false);
      setEditingName(group.name);
      setDetailOpen(true);
      if (!isLocalUpload) {
        await generateThreeViewForGroup(group.id);
      }
    }
  }

  async function handleDeleteProject() {
    const ok = await library.removeActiveGroup();
    if (ok) {
      setDetailOpen(false);
    }
  }

  async function generateThreeViewForGroup(groupId: string) {
    try {
      setGeneratingThreeViewGroupIds((current) => new Set(current).add(groupId));
      setThreeViewFailureReasons((current) => {
        const next = { ...current };
        delete next[groupId];
        return next;
      });
      await (isVirtualPortrait ? generateVirtualPortraitThreeView : generateDigitalHumanThreeView)(groupId, { userId: currentUser.id });
      await Promise.all([library.loadGroupAssets(groupId), library.loadGroups(library.groupPage)]);
      setDetailOpen(true);
    } catch (error) {
      const failureReason = error instanceof Error ? error.message : '三视图生成失败，请检查模型配置';
      await Promise.all([library.loadGroupAssets(groupId), library.loadGroups(library.groupPage)]);
      setThreeViewFailureReasons((current) => ({
        ...current,
        [groupId]: failureReason,
      }));
    } finally {
      setGeneratingThreeViewGroupIds((current) => {
        const next = new Set(current);
        next.delete(groupId);
        return next;
      });
    }
  }

  async function handleGenerateThreeView() {
    if (!library.activeGroup) {
      message.warning(`请先选择${label}项目`);
      return;
    }
    if (!hasTrainingPhotos) {
      message.warning('请先上传本人照片');
      return;
    }
    await generateThreeViewForGroup(library.activeGroup.id);
  }

  async function handleDownloadThreeView(asset: ContentAsset) {
    try {
      await downloadAsset(asset, library.activeGroup?.name || asset.name, label);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '下载失败');
    }
  }

  async function handleReplaceLocalDigitalHuman(file: File) {
    const ok = await library.replaceActiveGroupAssets([file], {
      source: 'local_upload',
      kind: 'three_view_result',
    }, isVirtualPortrait
      ? (groupId, uploadFile, metadata) => uploadVirtualPortraitAsset(groupId, {
        file: uploadFile,
        userId: currentUser.id,
        name: uploadFile.name,
        metadata,
      })
      : undefined);
    if (ok && library.activeGroup) {
      await library.loadGroupAssets(library.activeGroup.id);
    }
  }

  async function openDetail(groupId: string) {
    const group = library.groups.find((item) => item.id === groupId);
    if (!group) {
      return;
    }
    await library.openGroup(group);
    setEditingName(group.name);
    setDetailOpen(true);
  }

  async function handleSyncRemoteLibrary() {
    if (!isVirtualPortrait || currentUser.role !== 'admin') {
      return;
    }
    try {
      setIsSyncingRemoteLibrary(true);
      const result = await syncVirtualPortraitRemoteLibrary({
        userId: currentUser.id,
        includeAssets: true,
        pageSize: 100,
      });
      await library.loadGroups(library.groupPage);
      if (library.activeGroup) {
        await library.loadGroupAssets(library.activeGroup.id);
      }
      if (result.failedGroups > 0) {
        message.warning(`云端同步完成：${result.createdGroups} 个新增，${result.updatedGroups} 个更新，${result.failedGroups} 个失败`);
        return;
      }
      message.success(`云端同步完成：${result.totalRemoteGroups} 个分组已检查，${result.createdGroups} 个新增`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '云端同步失败');
    } finally {
      setIsSyncingRemoteLibrary(false);
    }
  }

  return (
    <ContentStudioLayout>

      <section className="material-page digital-human-page voice-board-page">
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
          {isVirtualPortrait && currentUser.role === 'admin' ? (
            <Button
              icon={<RefreshCw size={16} />}
              loading={isSyncingRemoteLibrary}
              onClick={() => void handleSyncRemoteLibrary()}
            >
              从云端同步
            </Button>
          ) : null}
          {/* <Button icon={<Bot size={16} />} onClick={() => openCreateModal('ai')} type="primary">
            AI生成
          </Button> */}
          <Button icon={<Plus size={16} />} onClick={() => openCreateModal('local')} type="primary">
            本地上传
          </Button>
        </div>

        <div className="voice-board-content">
          <div className="digital-human-grid voice-board-grid" ref={gridRef}>
            {!library.isLoadingGroups && (
              <AssetLibraryCreateCard
                description={isVirtualPortrait ? '本地上传' : '本地上传或AI生成'}
                icon={<Plus size={30} />}
                onClick={isVirtualPortrait ? () => openCreateModal('local') : openCreateChoice}
                title={`添加${label}素材`}
              />
            )}

            {library.isLoadingGroups ? <AssetLibrarySkeletonCards count={1} /> : filteredGroups.map((group) => {
              const assets = library.groupAssets(group.id);
              const result = assets.find(isThreeViewResult);
              const failure = assets.find(isThreeViewFailure);
              const running = assets.find(isThreeViewRunning);
              const photos = assets.filter((asset) => !isThreeViewResult(asset) && !isThreeViewFailure(asset) && !isThreeViewRunning(asset));
              const isGenerating = generatingThreeViewGroupIds.has(group.id) || Boolean(running);
              const assetCount = group.assetCount ?? assets.length;
              const isLocalUpload = group.metadata?.source === 'local_upload';
              return (
                <AssetLibraryCard
                  onClick={() => void openDetail(group.id)}
                  key={group.id}
                  meta={`${!isLocalUpload && assetCount ? `${assetCount} 个素材 · ` : ''}更新于 ${formatDate(group.updatedAt)}`}
                  preview={photoPreview(result || photos[0])}
                  previewClassName="digital-human-cover"
                  status={isLocalUpload ? '本地上传' : isGenerating ? '三视图生成中' : failure ? '三视图生成失败' : result ? 'AI生成' : assetCount ? '待训练合成三视图' : '待上传本人照片'}
                  title={group.name}
                />
              );
            })}
            {!library.isLoadingGroups && !filteredGroups.length && (
              <AssetLibraryPlaceholderCard
                icon={<Search size={30} />}
                title={hasKeyword ? `暂无匹配${label}素材` : `暂无${label}素材`}
                description={hasKeyword ? `调整搜索条件，或新增一个${label}。` : `上传${label}图片后，会展示在这里。`}
              />
            )}
          </div>
        </div>

        <div className="voice-board-pagination">
          <span>共 {library.groupTotal} 条</span>
          <Pagination
            current={library.groupPage}
            onChange={library.setGroupPage}
            pageSize={library.groupPageSize}
            showSizeChanger={false}
            total={library.groupTotal}
          />
        </div>
      </section>

      <Modal
        footer={null}
        onCancel={() => setChoiceOpen(false)}
        open={choiceOpen}
        title={`添加${label}素材`}
        width={760}
      >
        <div className="voice-create-choice-grid">
          <button onClick={() => openCreateModal('local')} type="button">
            <FolderUp size={58} />
            <strong>本地上传</strong>
            <span>上传已有{label}图片</span>
          </button>
          <button onClick={() => openCreateModal('ai')} type="button">
            <Bot size={58} />
            <strong>AI生成</strong>
            <span>上传训练照片生成三视图</span>
          </button>
        </div>
      </Modal>

      <Modal
        centered
        footer={createMode === 'local' ? [
          <Button key="cancel" onClick={() => {
            setCreateOpen(false);
            resetCreateForm();
          }}
          >
            取消
          </Button>,
          <Button
            key="submit"
            form="digital-human-local-create-form"
            htmlType="submit"
            loading={library.isUploading}
            type="primary"
          >
            提交素材
          </Button>,
        ] : null}
        onCancel={() => {
          setCreateOpen(false);
          resetCreateForm();
        }}
        open={createOpen}
        title={createMode === 'local' ? `本地上传${label}` : `AI生成${label}`}
        width={createMode === 'local' ? 760 : 1180}
      >
        {createMode === 'local' ? (
          <Form
            id="digital-human-local-create-form"
            form={createForm}
            labelCol={{ flex: '88px' }}
            layout="horizontal"
            onFinish={(values) => void handleCreate(values.name)}
            wrapperCol={{ flex: 1 }}
          >
            <Form.Item
              label="人像名称"
              name="name"
              rules={[{ required: true, whitespace: true, message: `请输入${label}名称` }]}
            >
              <Input
                onChange={(event) => setAvatarName(event.target.value)}
                placeholder={`请输入${label}名称`}
                value={avatarName}
              />
            </Form.Item>
            <Form.Item
              help={!pendingCreateFiles.length ? `请先上传${label}图片` : undefined}
              label="人像图片"
              required
              style={{ marginBottom: 0 }}
              validateStatus={!pendingCreateFiles.length ? 'error' : undefined}
            >
              <Upload
                accept="image/*"
                beforeUpload={() => false}
                fileList={createUploadFileList}
                listType="picture-card"
                maxCount={1}
                onChange={({ fileList }) => {
                  setPendingCreateFiles(filesFromUploadList(fileList).slice(-1));
                }}
                onPreview={async (file) => {
                  const sourceFile = file.originFileObj as File | undefined;
                  if (!sourceFile) {
                    return;
                  }
                  const src = URL.createObjectURL(sourceFile);
                  setPreviewImage({ name: file.name, src });
                }}
              >
                {pendingCreateFiles.length >= 1 ? null : (
                  <button style={{ all: 'unset', cursor: 'pointer', textAlign: 'center' }} type="button">
                    <PlusOutlined />
                    <div style={{ marginTop: 8 }}>上传</div>
                  </button>
                )}
              </Upload>
            </Form.Item>
          </Form>
        ) : (
          <div className="digital-human-create-modal">
            <div className="digital-human-create-left">
              <label className="digital-human-name-row">
                <span>{label}名称：</span>
                <Input onChange={(event) => setAvatarName(event.target.value)} placeholder={`请输入${label}名称`} value={avatarName} />
              </label>

              <PendingImageUpload
                files={pendingCreateFiles}
                onChange={setPendingCreateFiles}
                onPreviewFile={setPreviewImage}
              />

              <Checkbox checked={agreementChecked} onChange={(event) => setAgreementChecked(event.target.checked)}>
                我已阅读并同意 <a>《使用协议》</a>
              </Checkbox>

              <Button
                className="digital-human-submit"
                disabled={!agreementChecked}
                loading={library.isUploading}
                onClick={() => void handleCreate()}
                type="primary"
              >
                提交照片训练
              </Button>
            </div>

            <div className="digital-human-create-rules">
              <section>
                <h3>照片要求：</h3>
                <ul>
                  <li>建议上传全身正面、侧面、背面照片，以及头部正面和侧面近景</li>
                  <li>照片格式：JPG、PNG、WEBP</li>
                  <li>画面清晰，光线均匀，主体完整无遮挡</li>
                  <li>单张照片建议小于 20MB</li>
                </ul>
              </section>
              <section>
                <h3>免责声明：</h3>
                <ul>
                  <li>请确认您上传的照片已获得本人或团队授权</li>
                  <li>请勿上传涉黄、涉赌、涉毒、政治敏感或其他违法违规内容</li>
                  <li>因违规上传或使用导致的法律责任由使用者自行承担</li>
                </ul>
              </section>
              <section className="digital-human-bad-examples">
                <h3>拍摄不佳示例</h3>
                <div>
                  {['表情干扰', '五官遮挡', '拍摄比例', '衣着不整', '动作干扰', '多重人脸'].map((item) => (
                    <span key={item}>
                      <i>🙂</i>
                      <small>{item}</small>
                    </span>
                  ))}
                </div>
              </section>
            </div>
          </div>
        )}
      </Modal>

      <Modal footer={null} onCancel={() => setDetailOpen(false)} open={detailOpen} title={library.activeGroup?.name || '数字人项目'} width={1020}>
        {library.activeGroup && (
          <div className="asset-detail-workspace">
            {!isLocalUploadGroup && (
              <div className="material-group-editor">
                <Input onChange={(event) => setEditingName(event.target.value)} value={editingName} />
                <Button onClick={() => void library.renameGroup(library.activeGroup!.id, editingName)} type="primary">保存名称</Button>
                <Button danger loading={library.isDeletingGroup} onClick={() => void handleDeleteProject()}>删除{label}</Button>
              </div>
            )}
            {isLocalUploadGroup ? (
              <div className="digital-human-local-detail">
                <div className="digital-human-local-header">
                  <div>
                    <span>因为是<strong>本地上传素材</strong>，该图片会直接作为视频出镜素材使用。</span>
                    {isVirtualPortrait ? <small>素材会同步入库到火山私域人物素材资产库。</small> : null}
                  </div>
                  <div className="digital-human-local-actions">
                    <Button loading={library.isUploading} onClick={() => localReplaceInputRef.current?.click()}>替换图片</Button>
                    {activeThreeViewResult && (
                      <Button onClick={() => void handleDownloadThreeView(activeThreeViewResult)}>下载结果</Button>
                    )}
                    <Button danger loading={library.isDeletingGroup} onClick={() => void handleDeleteProject()}>删除{label}</Button>
                  </div>
                </div>
                <div className="digital-human-local-preview">
                  {activeThreeViewResult ? (
                    <Image
                      alt={activeThreeViewResult.name}
                      preview={{
                        mask: false,
                        rootClassName: 'digital-human-preview-root',
                        src: previewUrl(activeThreeViewResult),
                      }}
                      src={previewUrl(activeThreeViewResult)}
                    />
                  ) : (
                    <div className="digital-human-result-placeholder">
                      <span>等待上传素材</span>
                    </div>
                  )}
                </div>
                <input
                  accept="image/*"
                  hidden
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) {
                      void handleReplaceLocalDigitalHuman(file);
                    }
                    event.target.value = '';
                  }}
                  ref={localReplaceInputRef}
                  type="file"
                />
              </div>
            ) : (
              <>
                <div className="digital-human-result-panel">
                  <div className="digital-human-result-header">
                    <div className="digital-human-result-heading">
                      <strong>三视图合成结果</strong>
                      <span>由训练照片合并生成一张标准多视图图，包含全身正/侧/背和头部多角度。</span>
                    </div>
                    <div className="digital-human-result-header-actions">
                      <Button
                        disabled={!hasTrainingPhotos || isActiveGroupGenerating}
                        loading={isActiveGroupGenerating}
                        onClick={() => void handleGenerateThreeView()}
                        type="primary"
                      >
                        重新生成三视图
                      </Button>
                      {activeThreeViewResult && !isActiveGroupGenerating && !activeGroupFailureReason && (
                        <Button onClick={() => void handleDownloadThreeView(activeThreeViewResult)}>下载结果</Button>
                      )}
                    </div>
                  </div>
                  <div className="digital-human-result-canvas">
                    {resultPreview(
                      activeThreeViewResult,
                      isActiveGroupGenerating,
                      activeGroupFailureReason,
                    )}
                  </div>
                </div>
                <div className="asset-workflow-action">
                  <div>
                    <strong>{hasTrainingPhotos ? '训练照片已准备' : '等待训练照片'}</strong>
                    <span>请尽量提供全身、半身、脸部近景和不同角度照片，三视图结果会由模型训练合成，不是简单拼接上传图片。</span>
                  </div>
                </div>
                <DetailImageUpload
                  assets={editableAssets}
                  isUploading={library.isUploading}
                  onPreviewImage={setPreviewImage}
                  onRemoveAsset={(asset) => void library.removeAsset(asset.id)}
                  onUploadFiles={(files) => void library.uploadToActiveGroup(files, {
                    source: 'ai_generate',
                    kind: 'training_photo',
                  })}
                />
              </>
            )}
          </div>
        )}
      </Modal>

      <Image
        alt={previewImage?.name || '照片预览'}
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
