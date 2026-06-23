import { useMemo, useRef, useState } from 'react';
import { Button, Image, Input, Modal, Pagination } from 'antd';
import { Plus, Search } from 'lucide-react';
import { API_BASE_URL } from '../../../../api/request';
import { AssetLibraryCard, AssetLibraryCreateCard, AssetLibraryPlaceholderCard, AssetLibrarySkeletonCards } from '../../../../components/AssetLibraryCard';
import { ContentStudioLayout } from '../../../../layouts/ContentStudioLayout';
import type { ContentAsset, User } from '../../../../types';
import { DetailImageUpload, PendingImageUpload } from '../AssetImageUpload';
import type { ImagePreview } from '../AssetImageUpload';
import { useCardGridPageSize } from '../useCardGridPageSize';
import { useAssetLibrary } from '../useAssetLibrary';
import '../AssetLibraryPages.scss';

type SceneAssetsPageProps = {
  currentUser: User;
};

function fileUrl(asset: ContentAsset) {
  return `${API_BASE_URL}${asset.fileUrl}`;
}

function formatDate(value: string) {
  return value ? value.slice(0, 10) : '';
}

function imagePreview(asset?: ContentAsset) {
  return asset ? <img alt={asset.name} src={fileUrl(asset)} /> : <span>🎬</span>;
}

export function SceneAssetsPage({ currentUser }: SceneAssetsPageProps) {
  const gridRef = useRef<HTMLDivElement | null>(null);
  const { pageSize } = useCardGridPageSize({
    containerRef: gridRef,
    extraItems: 1,
  });
  const library = useAssetLibrary({ currentUser, pageSize, resourceType: 'scene' });
  const [createOpen, setCreateOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [editingName, setEditingName] = useState('');
  const [pendingCreateFiles, setPendingCreateFiles] = useState<File[]>([]);
  const [previewImage, setPreviewImage] = useState<ImagePreview | null>(null);
  const [searchKeyword, setSearchKeyword] = useState('');
  const hasKeyword = searchKeyword.trim().length > 0;
  const filteredGroups = useMemo(() => {
    const keyword = searchKeyword.trim().toLowerCase();
    if (!keyword) {
      return library.groups;
    }
    return library.groups.filter((group) => group.name.toLowerCase().includes(keyword));
  }, [library.groups, searchKeyword]);

  async function handleCreate() {
    const group = await library.createGroupWithAssets(groupName, pendingCreateFiles);
    if (group) {
      setGroupName('');
      setPendingCreateFiles([]);
      setCreateOpen(false);
      setEditingName(group.name);
      setDetailOpen(true);
    }
  }

  async function handleDeleteGroup() {
    const ok = await library.removeActiveGroup();
    if (ok) {
      setDetailOpen(false);
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

  return (
    <ContentStudioLayout>

      <section className="material-page scene-assets-page voice-board-page">
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
          <Button icon={<Plus size={16} />} onClick={() => setCreateOpen(true)} type="primary">
            新增场景分组
          </Button>
        </div>

        <div className="voice-board-content">
          <div className="scene-group-grid voice-board-grid" ref={gridRef}>
            {!library.isLoadingGroups && (
              <AssetLibraryCreateCard
                description="创建分组并上传图片"
                icon={<Plus size={30} />}
                onClick={() => setCreateOpen(true)}
                title="新增场景分组"
              />
            )}

            {library.isLoadingGroups ? <AssetLibrarySkeletonCards count={1} /> : filteredGroups.map((group) => {
              const images = library.groupAssets(group.id);
              const assetCount = group.assetCount ?? images.length;
              return (
                <AssetLibraryCard
                  key={group.id}
                  meta={`${assetCount} 张图片 · 更新于 ${formatDate(group.updatedAt)}`}
                  onClick={() => void openDetail(group.id)}
                  preview={(
                    <div className="scene-cover-grid">
                      <div>{imagePreview(images[0])}</div>
                      <div>{imagePreview(images[1])}</div>
                      <div>{imagePreview(images[2])}</div>
                    </div>
                  )}
                  status={assetCount ? '图片可用于视频场景' : '待上传场景图片'}
                  title={group.name}
                />
              );
            })}
            {!library.isLoadingGroups && !filteredGroups.length && (
              <AssetLibraryPlaceholderCard
                icon={<Search size={30} />}
                title={hasKeyword ? '暂无匹配场景素材' : '暂无场景素材'}
                description={hasKeyword ? '调整搜索条件，或新增一个场景分组。' : '创建分组并上传图片后，会展示在这里。'}
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
        confirmLoading={library.isUploading}
        okText="创建场景分组"
        onCancel={() => setCreateOpen(false)}
        onOk={() => void handleCreate()}
        open={createOpen}
        title="新增场景分组"
        width={1020}
      >
        <div className="material-modal-form">
          <label>
            <span>场景分组名称</span>
            <Input onChange={(event) => setGroupName(event.target.value)} placeholder="例如：直播间背景、门店环境、产品展示台" value={groupName} />
          </label>
          <PendingImageUpload
            files={pendingCreateFiles}
            onChange={setPendingCreateFiles}
            onPreviewFile={setPreviewImage}
          />
        </div>
      </Modal>

      <Modal footer={null} onCancel={() => setDetailOpen(false)} open={detailOpen} title={library.activeGroup?.name || '场景分组'} width={1020}>
        {library.activeGroup && (
          <div className="asset-detail-workspace">
            <div className="material-group-editor">
              <Input onChange={(event) => setEditingName(event.target.value)} value={editingName} />
              <Button onClick={() => void library.renameGroup(library.activeGroup!.id, editingName)} type="primary">保存名称</Button>
              <Button danger loading={library.isDeletingGroup} onClick={() => void handleDeleteGroup()}>删除场景</Button>
            </div>
            <div className="scene-management-summary">
              <strong>{library.activeGroupAssets.length} 张场景图片</strong>
              <span>用于视频背景、商品展示或场景切换。可以继续补充图片，也可以删除不再使用的素材。</span>
            </div>
            <DetailImageUpload
              assets={library.activeGroupAssets}
              isUploading={library.isUploading}
              onPreviewImage={setPreviewImage}
              onRemoveAsset={(asset) => void library.removeAsset(asset.id)}
              onUploadFiles={(files) => void library.uploadToActiveGroup(files)}
            />
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
