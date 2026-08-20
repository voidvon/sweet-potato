import { useMemo, useRef, useState } from 'react';
import { Button, Input, Modal, Pagination, Spin, message } from 'antd';
import { Plus, Search, Upload } from 'lucide-react';
import { API_BASE_URL } from '../../../../api/request';
import { AppButton } from '@shared/components/AppButton';
import { AssetLibraryAudioWave, AssetLibraryCard, AssetLibraryCreateCard, AssetLibraryPlaceholderCard, AssetLibrarySkeletonCards } from '../../../../components/AssetLibraryCard';
import { ContentStudioLayout } from '../../../../layouts/ContentStudioLayout';
import type { ContentAsset, ContentAssetGroup, User } from '../../../../types';
import { validateVoiceAudioFiles, voiceAudioMaxFileCount, voiceAudioMaxTotalDurationSeconds } from '../../../../utils/voiceAudioUpload';
import { DetailAudioUpload, PendingAudioUpload } from '../AssetAudioUpload';
import { useCardGridPageSize } from '../useCardGridPageSize';
import { useAssetLibrary } from '../useAssetLibrary';
import { isVoiceSampleAsset } from '../voiceAssetFilters';
import '../AssetLibraryPages.scss';
import { t } from '@shared/i18n';

type VoiceAssetsPageProps = {
  currentUser: User;
};

function formatDate(value: string) {
  return value ? value.slice(0, 10) : '';
}

function assetUrl(asset?: ContentAsset) {
  return asset ? `${API_BASE_URL}${asset.fileUrl}` : '';
}

function sourceLabel(group: ContentAssetGroup) {
  const source = group.metadata?.source;
  if (source === 'ai_clone') {
    return t("AI生成");
  }
  if (source === 'record_clone') {
    return t("录音克隆");
  }
  return t("本地上传");
}

function cloneStatusFor(group: ContentAssetGroup) {
  const clone = group.metadata?.voiceClone as Record<string, unknown> | undefined;
  return typeof clone?.status === 'string' ? clone.status : 'idle';
}

function voiceCardStatus(group: ContentAssetGroup) {
  if (group.metadata?.source === 'local_upload') {
    return t("本地上传");
  }
  const status = cloneStatusFor(group);
  if (status === 'training') {
    return t("生成中");
  }
  if (status === 'failed') {
    return t("生成失败");
  }
  if (status === 'success') {
    return t("AI生成");
  }
  return t("待生成");
}

function formatDuration(asset?: ContentAsset) {
  const duration = asset?.metadata?.duration;
  if (typeof duration === 'number' && Number.isFinite(duration) && duration > 0) {
    return t("{{0}}秒", { "0": Math.round(duration) });
  }
  return '';
}

function formatFileSize(value?: number) {
  if (!value || value <= 0) {
    return t("未知");
  }
  if (value < 1024 * 1024) {
    return `${Math.max(1, Math.round(value / 1024))} KB`;
  }
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function formatDateTime(value: string) {
  if (!value) {
    return '';
  }
  return value.slice(0, 16).replace('T', ' ');
}

export function VoiceAssetsPage({ currentUser }: VoiceAssetsPageProps) {
  const gridRef = useRef<HTMLDivElement | null>(null);
  const { pageSize } = useCardGridPageSize({
    containerRef: gridRef,
    extraItems: 1,
  });
  const library = useAssetLibrary({ currentUser, pageSize, resourceType: 'voice' });
  const [localOpen, setLocalOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [nameEditOpen, setNameEditOpen] = useState(false);
  const [voiceName, setVoiceName] = useState('');
  const [editingName, setEditingName] = useState('');
  const [pendingCreateFiles, setPendingCreateFiles] = useState<File[]>([]);
  const [cloningGroupIds, setCloningGroupIds] = useState<Set<string>>(() => new Set());
  const [searchKeyword, setSearchKeyword] = useState('');
  const voiceSampleAssets = library.activeGroupAssets.filter(isVoiceSampleAsset);
  const clonePreviewAsset = library.activeGroupAssets.find((asset) => asset.metadata?.kind === 'voice_clone_preview');
  const hasVoiceSamples = voiceSampleAssets.length > 0;
  const activeVoiceSample = voiceSampleAssets[0];
  const voiceClone = library.activeGroup?.metadata?.voiceClone as Record<string, unknown> | undefined;
  const cloneStatus = typeof voiceClone?.status === 'string' ? voiceClone.status : 'idle';
  const failureReason = typeof voiceClone?.failureReason === 'string' ? voiceClone.failureReason : '';
  const clonePanel = clonePanelCopy();
  const activeGroupId = library.activeGroup?.id;
  const isActiveVoiceCloning = Boolean(activeGroupId && cloningGroupIds.has(activeGroupId));
  const isVoiceCloneTraining = cloneStatus === 'training' || isActiveVoiceCloning;
  const hasKeyword = searchKeyword.trim().length > 0;

  const filteredGroups = useMemo(() => {
    const keyword = searchKeyword.trim().toLowerCase();
    return [...library.groups]
      .filter((group) => {
        const matchesKeyword = !keyword
          || group.name.toLowerCase().includes(keyword)
          || group.description.toLowerCase().includes(keyword)
          || sourceLabel(group).toLowerCase().includes(keyword);
        return matchesKeyword;
      })
      .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
  }, [library.groups, searchKeyword]);

  function resetCreateForm() {
    setVoiceName('');
    setPendingCreateFiles([]);
  }

  async function applyPendingCreateFiles(files: File[]) {
    try {
      const validated = await validateVoiceAudioFiles(files);
      setPendingCreateFiles(validated.map((item) => item.file));
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("音频文件校验失败"));
    }
  }

  function markCloning(groupId: string, isCloning: boolean) {
    setCloningGroupIds((current) => {
      const next = new Set(current);
      if (isCloning) {
        next.add(groupId);
      } else {
        next.delete(groupId);
      }
      return next;
    });
  }

  function openCreateModal() {
    resetCreateForm();
    setLocalOpen(true);
  }

  async function handleCreateLocal() {
    if (!pendingCreateFiles.length) {
      message.warning(t("请先上传音频文件"));
      return;
    }
    const group = await library.createGroupWithAssets(voiceName, pendingCreateFiles, {
      groupMetadata: { source: 'local_upload' },
      assetMetadata: { source: 'local_upload', kind: 'voice_source' },
    });
    if (group) {
      resetCreateForm();
      setLocalOpen(false);
      setEditingName(group.name);
      setDetailOpen(true);
    }
  }

  async function handleDeleteVoiceLibrary() {
    const ok = await library.removeActiveGroup();
    if (ok) {
      setDetailOpen(false);
    }
  }

  async function handleReplaceVoiceSample(file: File) {
    const groupId = library.activeGroup?.id;
    if (!groupId) {
      return;
    }
    const ok = await library.replaceActiveGroupAssets([file]);
    if (!ok) {
      return;
    }
    const updatedAssets = await library.loadGroupAssets(groupId);
    const firstSample = updatedAssets.find(isVoiceSampleAsset);
    if (!firstSample || library.activeGroup?.metadata?.source === 'local_upload') {
      return;
    }
    try {
      markCloning(groupId, true);
      await library.cloneActiveVoiceGroup(firstSample.id);
    } finally {
      markCloning(groupId, false);
    }
  }

  async function handleRenameVoiceLibrary() {
    if (!library.activeGroup) {
      return;
    }
    const updated = await library.renameGroup(library.activeGroup!.id, editingName);
    if (updated) {
      setNameEditOpen(false);
    }
  }

  function clonePanelCopy() {
    if (!hasVoiceSamples) {
      return {
        className: 'idle',
        title: t("等待上传音频样本"),
        description: t("上传一段干净人声后即可开始克隆音色。"),
        button: t("开始克隆音色"),
      };
    }
    if (library.activeGroup?.metadata?.source === 'local_upload') {
      return {
        className: 'success',
        title: t("本地音频已可用"),
        description: t("该素材会直接作为声音素材使用，不会触发 AI 克隆。"),
        button: t("重新生成"),
      };
    }
    if (cloneStatus === 'success') {
      return {
        className: 'success',
        title: t("克隆音色已可用"),
        description: clonePreviewAsset ? t("音色已生成，可试听默认文案效果。") : t("该音库已完成克隆，可在口播合成中选择使用。"),
        button: t("重新克隆音色"),
      };
    }
    if (cloneStatus === 'training') {
      return {
        className: 'running',
        title: t("正在生成中"),
        description: t("已向声音克隆服务提交样本，请稍后查看生成结果。"),
        button: t("重新提交"),
      };
    }
    if (cloneStatus === 'failed') {
      return {
        className: 'failed',
        title: t("声音克隆失败"),
        description: failureReason || t("请检查音频模型配置和样本质量后重试。"),
        button: t("重新克隆音色"),
      };
    }
    return {
      className: 'idle',
      title: t("音频样本已上传，等待克隆音色"),
      description: t("点击开始克隆后，系统会调用已配置的声音克隆服务生成可复用音色。"),
      button: t("开始克隆音色"),
    };
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

      <section className="material-page voice-assets-page voice-board-page">
        <div className="voice-board-toolbar">
          <Input
            allowClear
            className="voice-board-search"
            onChange={(event) => setSearchKeyword(event.target.value)}
            placeholder={t("搜索素材名称...")}
            prefix={<Search size={17} />}
            size="large"
            value={searchKeyword}
          />
          <div className="voice-board-toolbar-spacer" />
          <AppButton icon={<Plus size={16} />} onClick={() => openCreateModal()} tone="brand" type="primary">
            {t("本地上传")}
          </AppButton>
        </div>

        <div className="voice-board-content">
          <div className="voice-library-grid voice-board-grid" ref={gridRef}>
            {!library.isLoadingGroups && (
              <AssetLibraryCreateCard
                description={t("本地上传声音素材")}
                icon={<Plus size={30} />}
                onClick={() => openCreateModal()}
                title={t("添加声音素材")}
              />
            )}
            {library.isLoadingGroups ? <AssetLibrarySkeletonCards count={1} /> : filteredGroups.map((group) => {
              const samples = library.groupAssets(group.id).filter(isVoiceSampleAsset);
              const sample = samples[0];
              const status = cloneStatusFor(group);
              const statusText = voiceCardStatus(group);
              const duration = formatDuration(sample);
              const isAiGenerated = group.metadata?.source !== 'local_upload';
              return (
                <AssetLibraryCard
                  audioSrc={sample ? assetUrl(sample) : undefined}
                  audioTitle={group.name}
                  clickArea={sample ? 'body' : 'card'}
                  key={group.id}
                  meta={t("更新于 {{0}}{{1}}", { "0": formatDate(group.updatedAt), "1": duration ? ` · ${duration}` : '' })}
                  onClick={() => void openDetail(group.id)}
                  preview={(
                    <>
                      {isAiGenerated && <span className={`voice-card-badge ${status}`}>{statusText}</span>}
                    </>
                  )}
                  previewClassName="voice-card-visual"
                  status={statusText}
                  title={group.name}
                />
              );
            })}
            {!library.isLoadingGroups && !filteredGroups.length && (
              <AssetLibraryPlaceholderCard
                icon={<Upload size={30} />}
                title={t("暂无匹配声音素材")}
                description={t("调整搜索条件，或添加一段新的声音样本。")}
              />
            )}
          </div>
        </div>

        <div className="voice-board-pagination">
          <span>{t("共")} {library.groupTotal} {t("条")}</span>
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
        className="asset-library-themed-modal"
        confirmLoading={library.isUploading}
        okText={t("提交")}
        onCancel={() => {
          setLocalOpen(false);
          resetCreateForm();
        }}
        onOk={() => void handleCreateLocal()}
        open={localOpen}
        title={t("本地上传声音")}
        width={720}
      >
        <div className="material-modal-form voice-create-form">
          <label>
            <span>{t("音频名称")}</span>
            <Input onChange={(event) => setVoiceName(event.target.value)} placeholder={t("例如：沉稳男声-标准版")} value={voiceName} />
          </label>
          <div className="voice-upload-tip">{t("支持 wav、mp3；单段 2-15 秒，最多 3 段，总时长不超过")} {voiceAudioMaxTotalDurationSeconds} {t("秒，单个文件不超过 15 MB。")}</div>
          <PendingAudioUpload
            files={pendingCreateFiles}
            helperText={t("支持 wav、mp3；最多 {{0}} 段，总时长不超过 {{1}} 秒", { "0": voiceAudioMaxFileCount, "1": voiceAudioMaxTotalDurationSeconds })}
            maxCount={voiceAudioMaxFileCount}
            onChange={(files) => void applyPendingCreateFiles(files)}
          />
        </div>
      </Modal>

      <Modal
        className="asset-library-themed-modal voice-detail-modal"
        footer={null}
        onCancel={() => setDetailOpen(false)}
        open={detailOpen}
        title={library.activeGroup?.name || t("声音素材")}
        width={1180}
      >
        {library.activeGroup && (
          <div className="voice-detail-layout">
            <div className="voice-detail-preview">
              <div className={`voice-detail-wave ${isVoiceCloneTraining ? 'training' : ''}`}>
                <AssetLibraryAudioWave className="voice-detail-waveform" />
                {isVoiceCloneTraining && (
                  <div className="voice-detail-generating">
                    <Spin size="small" />
                    <strong>{t("正在生成中")}</strong>
                    <span>{t("声音克隆服务正在处理样本，生成完成后可试听效果。")}</span>
                  </div>
                )}
              </div>
              <div className="voice-detail-audio-stack">
                {library.activeGroup.metadata?.source === 'local_upload' && activeVoiceSample ? (
                  <div className="voice-preview-player">
                    {/* <strong>原音频</strong> */}
                    <audio controls src={assetUrl(activeVoiceSample)} />
                  </div>
                ) : clonePreviewAsset && cloneStatus === 'success' ? (
                  <div className="voice-preview-player">
                    <strong>{t("克隆试听")}</strong>
                    <audio controls src={assetUrl(clonePreviewAsset)} />
                  </div>
                ) : null}
                {library.activeGroup.metadata?.source !== 'local_upload' && (
                  <DetailAudioUpload
                    asset={activeVoiceSample}
                    displayName={t("样本音频")}
                    isUploading={library.isUploading}
                    onUploadFile={(file) => void handleReplaceVoiceSample(file)}
                  />
                )}
              </div>
            </div>

            <div className="voice-detail-info">
              <section>
                <h3>{t("基本信息")}</h3>
                <div className="voice-detail-row">
                  <span>{t("素材名称")}</span>
                  <div className="voice-detail-name-display">
                    <strong>{library.activeGroup.name}</strong>
                    <Button onClick={() => {
                      setEditingName(library.activeGroup!.name);
                      setNameEditOpen(true);
                    }} type="link">{t("编辑")}</Button>
                  </div>
                </div>
                <div className="voice-detail-row">
                  <span>{t("来源")}</span>
                  <strong>{sourceLabel(library.activeGroup)}</strong>
                </div>
                <div className="voice-detail-row">
                  <span>{t("生成状态")}</span>
                  <strong>{clonePanel.title}</strong>
                </div>
              </section>

              <section>
                <h3>{t("详细信息")}</h3>
                <div className="voice-detail-row">
                  <span>{t("音频时长")}</span>
                  <strong>{formatDuration(activeVoiceSample) || t("未知")}</strong>
                </div>
                <div className="voice-detail-row">
                  <span>{t("文件大小")}</span>
                  <strong>{formatFileSize(activeVoiceSample?.fileSize)}</strong>
                </div>
                <div className="voice-detail-row">
                  <span>{t("创建时间")}</span>
                  <strong>{formatDateTime(library.activeGroup.createdAt)}</strong>
                </div>
              </section>

              <div className="voice-detail-footer-actions">
                <Button danger loading={library.isDeletingGroup} onClick={() => void handleDeleteVoiceLibrary()}>{t("删除素材")}</Button>
              </div>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        className="asset-library-themed-modal voice-name-edit-modal"
        okText={t("保存")}
        onCancel={() => setNameEditOpen(false)}
        onOk={() => void handleRenameVoiceLibrary()}
        open={nameEditOpen}
        title={t("编辑素材名称")}
        width={420}
      >
        <Input onChange={(event) => setEditingName(event.target.value)} value={editingName} />
      </Modal>
    </ContentStudioLayout>
  );
}
