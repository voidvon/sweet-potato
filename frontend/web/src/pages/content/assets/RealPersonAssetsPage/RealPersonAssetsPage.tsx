import { useMemo, useRef, useState } from 'react';
import { Alert, Button, Image, Input, Modal, Pagination, Tag, Upload, message } from 'antd';
import { BadgeCheck, Clock3, ContactRound, ExternalLink, RefreshCw, Search, ShieldCheck, Trash2, UploadCloud, XCircle } from 'lucide-react';
import {
  createRealPersonValidationSession,
  getRealPersonValidationResult,
  syncRealPersonAsset,
  uploadRealPersonAsset,
  type RealPersonValidationResultResponse,
  type RealPersonValidationSessionResult,
} from '../../../../api/content';
import { API_BASE_URL } from '../../../../api/request';
import { AssetLibraryCard, AssetLibraryCreateCard, AssetLibraryPlaceholderCard, AssetLibrarySkeletonCards } from '../../../../components/AssetLibraryCard';
import { ContentStudioLayout } from '../../../../layouts/ContentStudioLayout';
import type { ContentAsset, ContentAssetGroup, User } from '../../../../types';
import { ImagePreview } from '../AssetImageUpload';
import { useCardGridPageSize } from '../useCardGridPageSize';
import { useAssetLibrary } from '../useAssetLibrary';
import '../AssetLibraryPages.scss';

type RealPersonAssetsPageProps = {
  currentUser: User;
};

type ValidationStatus = 'pending' | 'failed' | 'verified';
type AssetStatus = 'Processing' | 'Active' | 'Failed';

type ValidationSessionView = {
  groupId: string;
  h5Link?: string;
  expiresInSeconds?: number;
  bytedToken?: string;
};

const DEFAULT_VALIDATION_EXPIRES = 120;

function stringMetadata(record: Record<string, unknown> | undefined, key: string) {
  const value = record?.[key];
  return typeof value === 'string' ? value : '';
}

function numberMetadata(record: Record<string, unknown> | undefined, key: string) {
  const value = record?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function formatDate(value: string) {
  return value ? value.slice(0, 10) : '';
}

function formatDateTime(value: string) {
  return value ? value.slice(0, 16).replace('T', ' ') : '';
}

function fileUrl(asset: ContentAsset) {
  return `${API_BASE_URL}${asset.fileUrl}`;
}

function previewUrl(asset: ContentAsset) {
  return stringMetadata(asset.metadata, 'remotePreviewUrl') || fileUrl(asset);
}

function extractGroup(result: RealPersonValidationResultResponse) {
  return 'group' in result ? result.group : result;
}

function sessionLink(result: RealPersonValidationSessionResult) {
  return result.h5Link || result.H5Link || result.validationUrl || stringMetadata(result.group.metadata, 'h5Link') || stringMetadata(result.group.metadata, 'H5Link');
}

function groupSessionLink(group: ContentAssetGroup, session?: ValidationSessionView) {
  return session?.h5Link
    || stringMetadata(group.metadata, 'h5Link')
    || stringMetadata(group.metadata, 'H5Link')
    || stringMetadata(group.metadata, 'validationUrl');
}

function groupBytedToken(group: ContentAssetGroup, session?: ValidationSessionView) {
  return session?.bytedToken || stringMetadata(group.metadata, 'bytedToken');
}

function validationStatus(group: ContentAssetGroup): ValidationStatus {
  const status = stringMetadata(group.metadata, 'validationStatus');
  if (status === 'verified' || stringMetadata(group.metadata, 'volcGroupId')) {
    return 'verified';
  }
  if (status === 'failed') {
    return 'failed';
  }
  return 'pending';
}

function validationCopy(status: ValidationStatus) {
  if (status === 'verified') {
    return { label: '已认证', color: 'success', icon: <BadgeCheck size={14} /> };
  }
  if (status === 'failed') {
    return { label: '认证失败', color: 'error', icon: <XCircle size={14} /> };
  }
  return { label: '待认证', color: 'warning', icon: <Clock3 size={14} /> };
}

function assetStatus(asset: ContentAsset): AssetStatus {
  const status = stringMetadata(asset.metadata, 'volcStatus');
  if (status === 'Active' || stringMetadata(asset.metadata, 'assetUri')) {
    return 'Active';
  }
  if (status === 'Failed') {
    return 'Failed';
  }
  return 'Processing';
}

function assetStatusCopy(status: AssetStatus) {
  if (status === 'Active') {
    return { label: '可用', color: 'success' };
  }
  if (status === 'Failed') {
    return { label: '入库失败', color: 'error' };
  }
  return { label: '处理中', color: 'processing' };
}

function groupStatusLine(group: ContentAssetGroup, assets: ContentAsset[]) {
  const status = validationStatus(group);
  if (status !== 'verified') {
    return validationCopy(status).label;
  }
  const activeCount = assets.filter((asset) => assetStatus(asset) === 'Active').length;
  const failedCount = assets.filter((asset) => assetStatus(asset) === 'Failed').length;
  if (activeCount) {
    return `${activeCount} 个可用素材`;
  }
  if (failedCount) {
    return '入库失败';
  }
  return assets.length ? '入库处理中' : '已认证';
}

function isImageAsset(asset: ContentAsset) {
  return asset.mimeType.startsWith('image/');
}

export function RealPersonAssetsPage({ currentUser }: RealPersonAssetsPageProps) {
  const gridRef = useRef<HTMLDivElement | null>(null);
  const { pageSize } = useCardGridPageSize({
    containerRef: gridRef,
    extraItems: 1,
  });
  const library = useAssetLibrary({ currentUser, pageSize, resourceType: 'real_person' });
  const [createOpen, setCreateOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [personName, setPersonName] = useState('');
  const [searchKeyword, setSearchKeyword] = useState('');
  const [previewImage, setPreviewImage] = useState<ImagePreview | null>(null);
  const [sessionsByGroupId, setSessionsByGroupId] = useState<Record<string, ValidationSessionView>>({});
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [isCheckingValidation, setIsCheckingValidation] = useState(false);
  const [isUploadingAsset, setIsUploadingAsset] = useState(false);
  const [syncingAssetIds, setSyncingAssetIds] = useState<Set<string>>(() => new Set());
  const hasKeyword = searchKeyword.trim().length > 0;

  const activeValidationStatus = library.activeGroup ? validationStatus(library.activeGroup) : 'pending';
  const activeSession = library.activeGroup ? sessionsByGroupId[library.activeGroup.id] : undefined;
  const activeH5Link = library.activeGroup ? groupSessionLink(library.activeGroup, activeSession) : '';
  const activeBytedToken = library.activeGroup ? groupBytedToken(library.activeGroup, activeSession) : '';
  const isVerified = activeValidationStatus === 'verified';
  const activeAssetStats = useMemo(() => {
    const statusList = library.activeGroupAssets.map(assetStatus);
    return {
      processing: statusList.filter((status) => status === 'Processing').length,
      active: statusList.filter((status) => status === 'Active').length,
      failed: statusList.filter((status) => status === 'Failed').length,
    };
  }, [library.activeGroupAssets]);

  const filteredGroups = useMemo(() => {
    const keyword = searchKeyword.trim().toLowerCase();
    return [...library.groups]
      .filter((group) => {
        if (!keyword) {
          return true;
        }
        return group.name.toLowerCase().includes(keyword)
          || stringMetadata(group.metadata, 'volcGroupId').toLowerCase().includes(keyword);
      })
      .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
  }, [library.groups, searchKeyword]);

  function rememberSession(result: RealPersonValidationSessionResult) {
    setSessionsByGroupId((current) => ({
      ...current,
      [result.group.id]: {
        groupId: result.group.id,
        h5Link: sessionLink(result),
        expiresInSeconds: result.expiresInSeconds || numberMetadata(result.group.metadata, 'expiresInSeconds') || DEFAULT_VALIDATION_EXPIRES,
        bytedToken: result.bytedToken || stringMetadata(result.group.metadata, 'bytedToken'),
      },
    }));
  }

  async function reloadActiveGroup(groupId: string) {
    const [groups] = await Promise.all([
      library.loadGroups(library.groupPage),
      library.loadGroupAssets(groupId),
    ]);
    const nextGroup = groups.find((group) => group.id === groupId);
    if (nextGroup) {
      library.setActiveGroup(nextGroup);
    }
  }

  async function handleCreateValidationSession() {
    if (!personName.trim()) {
      message.warning('请输入真人名称');
      return;
    }
    try {
      setIsCreatingSession(true);
      const result = await createRealPersonValidationSession({
        userId: currentUser.id,
        name: personName.trim(),
      });
      rememberSession(result);
      setPersonName('');
      setCreateOpen(false);
      library.setGroupPage(1);
      await Promise.all([library.loadGroups(1), library.loadGroupAssets(result.group.id)]);
      library.setActiveGroup(result.group);
      setDetailOpen(true);
      message.success('认证会话已创建');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '创建认证会话失败');
    } finally {
      setIsCreatingSession(false);
    }
  }

  async function handleCheckValidationResult() {
    if (!library.activeGroup) {
      return;
    }
    try {
      setIsCheckingValidation(true);
      const result = await getRealPersonValidationResult({
        userId: currentUser.id,
        groupId: library.activeGroup.id,
        bytedToken: activeBytedToken || undefined,
      });
      const nextGroup = extractGroup(result);
      library.setActiveGroup(nextGroup);
      await Promise.all([library.loadGroups(library.groupPage), library.loadGroupAssets(nextGroup.id)]);
      if (validationStatus(nextGroup) === 'verified') {
        message.success('真人认证已通过');
      } else if (validationStatus(nextGroup) === 'failed') {
        message.error('真人认证失败');
      } else {
        message.info('认证结果尚未完成，请稍后刷新');
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : '刷新认证结果失败');
    } finally {
      setIsCheckingValidation(false);
    }
  }

  async function handleUploadAsset(file: File) {
    if (!library.activeGroup) {
      message.warning('请先选择真人档案');
      return;
    }
    if (!isVerified) {
      message.warning('真人认证成功后才能上传同人素材');
      return;
    }
    try {
      setIsUploadingAsset(true);
      await uploadRealPersonAsset(library.activeGroup.id, {
        file,
        userId: currentUser.id,
        name: file.name,
        metadata: {
          source: 'volc_real_person',
        },
      });
      await reloadActiveGroup(library.activeGroup.id);
      message.success('素材已提交入库');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '上传真人素材失败');
    } finally {
      setIsUploadingAsset(false);
    }
  }

  async function handleSyncAsset(asset: ContentAsset) {
    try {
      setSyncingAssetIds((current) => new Set(current).add(asset.id));
      await syncRealPersonAsset(asset.id, { userId: currentUser.id });
      if (library.activeGroup) {
        await reloadActiveGroup(library.activeGroup.id);
      }
      message.success('入库状态已同步');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '同步入库状态失败');
    } finally {
      setSyncingAssetIds((current) => {
        const next = new Set(current);
        next.delete(asset.id);
        return next;
      });
    }
  }

  async function handleSyncAllAssets() {
    if (!library.activeGroup || !library.activeGroupAssets.length) {
      message.warning('当前档案暂无素材');
      return;
    }
    const assetIds = library.activeGroupAssets.map((asset) => asset.id);
    setSyncingAssetIds((current) => new Set([...current, ...assetIds]));
    const results = await Promise.allSettled(library.activeGroupAssets.map((asset) => syncRealPersonAsset(asset.id, { userId: currentUser.id })));
    await reloadActiveGroup(library.activeGroup.id);
    setSyncingAssetIds((current) => {
      const next = new Set(current);
      assetIds.forEach((assetId) => next.delete(assetId));
      return next;
    });
    const failed = results.filter((result) => result.status === 'rejected').length;
    if (failed) {
      message.warning(`${failed} 个素材同步失败`);
    } else {
      message.success('全部入库状态已同步');
    }
  }

  async function handleDeleteGroup() {
    const ok = await library.removeActiveGroup();
    if (ok) {
      setDetailOpen(false);
    }
  }

  async function openDetail(group: ContentAssetGroup) {
    await library.openGroup(group);
    setDetailOpen(true);
  }

  return (
    <ContentStudioLayout>
      <section className="material-page real-person-page voice-board-page">
        <div className="voice-board-toolbar">
          <Input
            allowClear
            className="voice-board-search"
            onChange={(event) => setSearchKeyword(event.target.value)}
            placeholder="搜索真人名称或 Group ID..."
            prefix={<Search size={17} />}
            value={searchKeyword}
          />
          <div className="voice-board-toolbar-spacer" />
          <Button icon={<RefreshCw size={16} />} onClick={() => void library.loadGroups(library.groupPage)}>
            刷新
          </Button>
          <Button icon={<ShieldCheck size={16} />} onClick={() => setCreateOpen(true)} type="primary">
            创建认证
          </Button>
        </div>

        <div className="voice-board-content">
          <div className="real-person-grid voice-board-grid" ref={gridRef}>
            {!library.isLoadingGroups && filteredGroups.length > 0 && (
              <AssetLibraryCreateCard
                description="认证后上传同人素材"
                icon={<ContactRound size={30} />}
                onClick={() => setCreateOpen(true)}
                title="添加真人素材"
              />
            )}

            {library.isLoadingGroups ? <AssetLibrarySkeletonCards count={1} /> : filteredGroups.map((group) => {
              const assets = library.groupAssets(group.id);
              const firstImage = assets.find(isImageAsset);
              const status = validationStatus(group);
              const statusMeta = validationCopy(status);
              return (
                <AssetLibraryCard
                  key={group.id}
                  meta={`${assets.length} 个素材 · 更新于 ${formatDate(group.updatedAt)}`}
                  onClick={() => void openDetail(group)}
                  preview={(
                    <>
                      <Tag className="real-person-card-tag" color={statusMeta.color} icon={statusMeta.icon}>{statusMeta.label}</Tag>
                      {firstImage ? <img alt={firstImage.name} src={previewUrl(firstImage)} /> : <ContactRound size={42} />}
                    </>
                  )}
                  previewClassName={`real-person-card-visual ${status}`}
                  status={groupStatusLine(group, assets)}
                  title={group.name}
                />
              );
            })}

            {!library.isLoadingGroups && !filteredGroups.length && (
              <AssetLibraryPlaceholderCard
                icon={<ContactRound size={30} />}
                title={hasKeyword ? '暂无匹配真人素材' : '暂无真人素材'}
                description={hasKeyword ? '调整搜索条件，或创建新的真人认证档案。' : '创建真人档案并完成 H5 认证后，上传同人素材入库。'}
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
        confirmLoading={isCreatingSession}
        okText="创建认证会话"
        onCancel={() => {
          setCreateOpen(false);
          setPersonName('');
        }}
        onOk={() => void handleCreateValidationSession()}
        open={createOpen}
        title="创建真人认证"
        width={620}
      >
        <div className="real-person-create-form">
          <label>
            <span>真人名称</span>
            <Input onChange={(event) => setPersonName(event.target.value)} placeholder="例如：品牌主播-小林" value={personName} />
          </label>
          <Alert
            message="创建后会生成 H5 认证链接"
            description={`认证链接默认 ${DEFAULT_VALIDATION_EXPIRES} 秒有效。完成认证后回到本页点击“确认认证结果”。`}
            showIcon
            type="info"
          />
        </div>
      </Modal>

      <Modal
        className="real-person-detail-modal"
        footer={null}
        onCancel={() => setDetailOpen(false)}
        open={detailOpen}
        title={library.activeGroup?.name || '真人素材'}
        width={1180}
      >
        {library.activeGroup && (
          <div className="real-person-detail-layout">
            <section className="real-person-profile-panel">
              <div className={`real-person-status-mark ${activeValidationStatus}`}>
                {activeValidationStatus === 'verified' ? <BadgeCheck size={34} /> : activeValidationStatus === 'failed' ? <XCircle size={34} /> : <Clock3 size={34} />}
              </div>
              <div className="real-person-profile-main">
                <div>
                  <Tag color={validationCopy(activeValidationStatus).color}>{validationCopy(activeValidationStatus).label}</Tag>
                  <strong>{library.activeGroup.name}</strong>
                  <span>更新于 {formatDateTime(library.activeGroup.updatedAt)}</span>
                </div>
                <div className="real-person-profile-actions">
                  {activeH5Link && (
                    <Button icon={<ExternalLink size={16} />} onClick={() => window.open(activeH5Link, '_blank', 'noopener,noreferrer')}>
                      打开 H5 认证
                    </Button>
                  )}
                  <Button icon={<RefreshCw size={16} />} loading={isCheckingValidation} onClick={() => void handleCheckValidationResult()} type="primary">
                    确认认证结果
                  </Button>
                  <Button danger icon={<Trash2 size={16} />} loading={library.isDeletingGroup} onClick={() => void handleDeleteGroup()}>
                    删除档案
                  </Button>
                </div>
              </div>
            </section>

            {activeValidationStatus !== 'verified' && (
              <Alert
                message={activeValidationStatus === 'failed' ? '认证失败' : '等待真人认证'}
                description={activeValidationStatus === 'failed'
                  ? stringMetadata(library.activeGroup.metadata, 'failureReason') || '请重新创建认证会话或检查回调结果。'
                  : `请在 ${activeSession?.expiresInSeconds || numberMetadata(library.activeGroup.metadata, 'expiresInSeconds') || DEFAULT_VALIDATION_EXPIRES} 秒有效期内完成 H5 认证。`}
                showIcon
                type={activeValidationStatus === 'failed' ? 'error' : 'warning'}
              />
            )}

            <section className="real-person-summary-grid">
              <article>
                <strong>{activeAssetStats.active}</strong>
                <span>可用</span>
              </article>
              <article>
                <strong>{activeAssetStats.processing}</strong>
                <span>处理中</span>
              </article>
              <article>
                <strong>{activeAssetStats.failed}</strong>
                <span>入库失败</span>
              </article>
              <article>
                <strong>{stringMetadata(library.activeGroup.metadata, 'volcGroupId') || '-'}</strong>
                <span>火山 Group ID</span>
              </article>
            </section>

            <section className="real-person-upload-panel">
              <div className="real-person-upload-copy">
                <strong>上传同人素材</strong>
                <ul>
                  <li>每个 Asset Group 唯一绑定一个真人。</li>
                  <li>多人脸或非同一人素材会入库失败。</li>
                  <li>建议提供全身正面图和人脸特写，提高素材可用率。</li>
                </ul>
              </div>
              <div className="real-person-upload-actions">
                <Upload
                  accept="image/*,video/*"
                  beforeUpload={(file) => {
                    void handleUploadAsset(file as unknown as File);
                    return Upload.LIST_IGNORE;
                  }}
                  disabled={!isVerified || isUploadingAsset}
                  multiple
                  showUploadList={false}
                >
                  <Button disabled={!isVerified} icon={<UploadCloud size={16} />} loading={isUploadingAsset} type="primary">
                    上传素材
                  </Button>
                </Upload>
                <Button disabled={!library.activeGroupAssets.length} icon={<RefreshCw size={16} />} loading={syncingAssetIds.size > 0} onClick={() => void handleSyncAllAssets()}>
                  同步全部
                </Button>
              </div>
            </section>

            <section className="real-person-asset-grid">
              {library.activeGroupAssets.map((asset) => {
                const status = assetStatus(asset);
                const statusMeta = assetStatusCopy(status);
                const assetUri = stringMetadata(asset.metadata, 'assetUri');
                const failureReason = stringMetadata(asset.metadata, 'failureReason');
                return (
                  <article className={`real-person-asset-card ${status.toLowerCase()}`} key={asset.id}>
                    <button
                      className="real-person-asset-preview"
                      disabled={!isImageAsset(asset)}
                      onClick={() => {
                        if (isImageAsset(asset)) {
                          setPreviewImage({ name: asset.name, src: previewUrl(asset) });
                        }
                      }}
                      type="button"
                    >
                      {isImageAsset(asset) ? <img alt={asset.name} src={previewUrl(asset)} /> : <UploadCloud size={34} />}
                    </button>
                    <div className="real-person-asset-body">
                      <div>
                        <strong>{asset.name}</strong>
                        <Tag color={statusMeta.color}>{statusMeta.label}</Tag>
                      </div>
                      <span>{assetUri || stringMetadata(asset.metadata, 'volcAssetId') || '等待生成 asset:// 引用'}</span>
                      {failureReason && <small>{failureReason}</small>}
                    </div>
                    <div className="real-person-asset-actions">
                      <Button loading={syncingAssetIds.has(asset.id)} onClick={() => void handleSyncAsset(asset)} size="small">同步</Button>
                      <Button danger onClick={() => void library.removeAsset(asset.id)} size="small">删除</Button>
                    </div>
                  </article>
                );
              })}

              {!library.activeGroupAssets.length && (
                <div className="real-person-empty-assets">
                  <UploadCloud size={30} />
                  <strong>{isVerified ? '等待上传同人素材' : '认证成功后开放上传'}</strong>
                  <span>素材入库完成并显示“可用”后，可在视频生成流程中引用。</span>
                </div>
              )}
            </section>
          </div>
        )}
      </Modal>

      <Image
        alt={previewImage?.name || '素材预览'}
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
