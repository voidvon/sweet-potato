import { Modal } from 'antd';
import { FileVideo, Trash2, X } from 'lucide-react';
import { useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { deleteReferenceVideo, trimReferenceVideo } from '../../../../api/content';
import { resolveAssetUrl } from '../../../../api/request';
import type { MaterialKind, PromptPanel as PromptPanelKind, SelectedMaterials } from '../types';
import { MaterialSlot } from './MaterialSlot';
import { ReferenceVideoCard, ReferenceVideoPreviewModal, type ConfirmedReferenceVideo } from './ReferenceVideoCard';
import { TrimReferenceVideoModal, type TrimSelection } from './TrimReferenceVideoModal';

type PromptPlanningModalProps = {
  kind: PromptPanelKind;
  onClose: () => void;
  onExampleFill: () => void;
};

const modalCopy: Record<PromptPanelKind, { title: string; subtitle: string; action: string }> = {
  marketing: {
    title: '爆款策划',
    subtitle: '上传商品图，AI 帮你策划这条电商视频的脚本',
    action: '开始识别 · 2积分',
  },
  reverse: {
    title: '反推提示词',
    subtitle: '上传参考视频，AI 反推出镜头、主体动作、风格和节奏',
    action: '开始反推 · 2积分',
  },
  write: {
    title: '一键策划',
    subtitle: '根据左侧参考素材，生成可直接填入的视频提示词',
    action: '生成策划 · 1积分',
  },
};

const steps = ['商品素材', '确认信息', '视频设定', '挑选脚本'];
const marketingImageMaterial: MaterialKind = { key: 'image', label: '商品图', hint: '最多 9 张', meta: '可选' };
const marketingVideoMaterial: MaterialKind = { key: 'video', label: '参考视频', hint: '限 1 个', meta: '可选' };

export function PromptPlanningModal({ kind, onClose, onExampleFill }: PromptPlanningModalProps) {
  const copy = modalCopy[kind];
  const [selectedMaterials, setSelectedMaterials] = useState<SelectedMaterials>({ image: '商品图 1 张' });
  const [isVideoDragging, setIsVideoDragging] = useState(false);
  const [previewVideo, setPreviewVideo] = useState<ConfirmedReferenceVideo | null>(null);
  const [referenceVideo, setReferenceVideo] = useState<ConfirmedReferenceVideo | null>(null);
  const [videoTrimFile, setVideoTrimFile] = useState<File | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);

  const openLocalUpload = (item: MaterialKind) => {
    if (item.key === 'video') {
      videoInputRef.current?.click();
      return;
    }
    imageInputRef.current?.click();
  };

  const fillMaterial = (item: MaterialKind) => {
    setSelectedMaterials((current) => {
      if (item.key === 'image') {
        return { ...current, image: `商品图 ${Math.min(getMaterialCount(current.image) + 1, 9)} 张` };
      }
      return { ...current, video: '参考视频 01' };
    });
  };

  const handleImageChoose = () => {
    fillMaterial(marketingImageMaterial);
    if (imageInputRef.current) imageInputRef.current.value = '';
  };

  const openVideoTrim = (file: File) => {
    setVideoTrimFile(file);
    setIsVideoDragging(false);
    if (videoInputRef.current) videoInputRef.current.value = '';
  };

  const handleVideoDrop = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const file = Array.from(event.dataTransfer.files).find((item) => item.type.startsWith('video/'));
    if (file) openVideoTrim(file);
  };

  const handleVideoChoose = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    if (file) openVideoTrim(file);
  };

  const useTrimmedVideo = async (selection: TrimSelection) => {
    const previousReferenceVideo = referenceVideo;
    const result = await trimReferenceVideo({
      end: selection.end,
      file: selection.file,
      start: selection.start,
    });
    const nextReferenceVideo = {
      duration: result.duration,
      end: result.end,
      fileUrl: result.fileUrl,
      name: result.originalFileName || result.name || getVideoDisplayName(selection.file),
      start: result.start,
      storedFileName: result.storedFileName,
      videoUrl: resolveAssetUrl(result.fileUrl),
    };
    setReferenceVideo(nextReferenceVideo);
    setSelectedMaterials((current) => ({ ...current, video: nextReferenceVideo.name }));
    setVideoTrimFile(null);
    if (previousReferenceVideo) {
      void deleteServerReferenceVideo(previousReferenceVideo);
    }
  };

  const removeReferenceVideo = () => {
    if (referenceVideo) {
      void deleteServerReferenceVideo(referenceVideo);
    }
    setReferenceVideo(null);
    setPreviewVideo(null);
    setSelectedMaterials((current) => {
      const next = { ...current };
      delete next.video;
      return next;
    });
  };

  const removeOneMaterial = (item: MaterialKind) => {
    setSelectedMaterials((current) => {
      if (item.key === 'image') {
        const count = getMaterialCount(current.image);
        if (count <= 1) {
          const next = { ...current };
          delete next.image;
          return next;
        }
        return { ...current, image: `商品图 ${count - 1} 张` };
      }
      const next = { ...current };
      delete next[item.key];
      return next;
    });
  };

  const clearMaterial = (item: MaterialKind) => {
    setSelectedMaterials((current) => {
      const next = { ...current };
      delete next[item.key];
      return next;
    });
  };

  const clearAll = () => {
    if (referenceVideo) {
      void deleteServerReferenceVideo(referenceVideo);
    }
    setReferenceVideo(null);
    setPreviewVideo(null);
    setSelectedMaterials({});
  };

  const closePlanningModal = () => {
    if (referenceVideo) {
      void deleteServerReferenceVideo(referenceVideo);
    }
    onClose();
  };

  return (
    <Modal
      centered
      className="video-task-epa-modal"
      closable={false}
      footer={null}
      mask={{ closable: true }}
      onCancel={closePlanningModal}
      open
      rootClassName="video-task-epa-modal-root"
      style={{ padding: 0 }}
      styles={{ body: { padding: 0 } }}
      title={null}
      width={1040}
    >
      <section
        aria-labelledby="video-task-epa-title"
        className="video-task-epa-panel"
        role="dialog"
      >
        <header className="video-task-epa-head">
          <div className="video-task-epa-head-text">
            <strong id="video-task-epa-title">{copy.title}</strong>
            <span>{copy.subtitle}</span>
          </div>
          <button aria-label="关闭" className="video-task-epa-close" onClick={closePlanningModal} type="button">
            <X size={18} />
          </button>
        </header>

        <div className="video-task-epa-body">
          <nav className="video-task-epa-rail" aria-label="策划步骤">
            {steps.map((step, index) => (
              <button className={index === 0 ? 'is-active' : ''} key={step} type="button">
                <span>{index + 1}</span>
                {step}
              </button>
            ))}
          </nav>

          <div className="video-task-epa-content">
            <main className="video-task-epa-main">
              <section className="video-task-epa-field">
                <span className="video-task-epa-label">
                  商品素材
                  <em>1-9 张</em>
                </span>
                <div className="video-task-epa-material-host video-task-material-card">
                  <MaterialSlot
                    item={marketingImageMaterial}
                    onClear={clearMaterial}
                    onLocalUpload={openLocalUpload}
                    onOpen={() => undefined}
                    onRemoveOne={removeOneMaterial}
                    openMode="local"
                    selected={selectedMaterials.image}
                  />
                </div>
              </section>

              <section className="video-task-epa-field">
                <span className="video-task-epa-label">
                  参考视频
                  <em>选填 · 1 条 · AI 拆解节奏/镜头/结构，脚本照爆款复刻</em>
                </span>
                {referenceVideo ? (
                  <ReferenceVideoCard
                    onPreview={() => setPreviewVideo(referenceVideo)}
                    onRemove={removeReferenceVideo}
                    onReplace={() => openLocalUpload(marketingVideoMaterial)}
                    video={referenceVideo}
                  />
                ) : (
                  <button
                    className={`video-task-epa-video-drop${isVideoDragging ? ' is-dragging' : ''}`}
                    onDragLeave={() => setIsVideoDragging(false)}
                    onDragOver={(event) => {
                      event.preventDefault();
                      setIsVideoDragging(true);
                    }}
                    onDrop={handleVideoDrop}
                    onClick={() => openLocalUpload(marketingVideoMaterial)}
                    type="button"
                  >
                    <FileVideo size={26} />
                    <strong>点击上传参考视频</strong>
                    <span>或拖入 · mp4/mov · 让脚本对齐这条视频的爆款结构</span>
                  </button>
                )}
              </section>

              <section className="video-task-epa-field is-product-name">
                <label className="video-task-epa-label" htmlFor="video-task-product-name">
                  想介绍的商品
                  <em>选填 · 多主体时帮 AI 聚焦</em>
                </label>
                <input id="video-task-product-name" placeholder="如 连衣裙、保温杯" type="text" />
              </section>
            </main>

            <footer className="video-task-epa-footer">
              <button className="video-task-epa-clear" onClick={clearAll} type="button">
                <Trash2 size={15} />
                清除
              </button>
              <span className="video-task-epa-footer-spacer" />
              <button className="video-task-epa-btn video-task-epa-btn-ghost" onClick={closePlanningModal} type="button">
                取消
              </button>
              <button className="video-task-epa-btn video-task-epa-btn-accent" onClick={onExampleFill} type="button">
                {copy.action}
              </button>
            </footer>
          </div>
        </div>

        <input
          ref={imageInputRef}
          accept="image/*"
          className="video-task-epa-native-input"
          multiple
          onChange={handleImageChoose}
          type="file"
        />
        <input
          ref={videoInputRef}
          accept="video/mp4,video/quicktime,video/*"
          className="video-task-epa-native-input"
          onChange={handleVideoChoose}
          type="file"
        />
      </section>

      {videoTrimFile && (
        <TrimReferenceVideoModal
          file={videoTrimFile}
          onCancel={() => setVideoTrimFile(null)}
          onConfirm={useTrimmedVideo}
        />
      )}

      {previewVideo && (
        <ReferenceVideoPreviewModal
          onClose={() => setPreviewVideo(null)}
          video={previewVideo}
        />
      )}
    </Modal>
  );
}

function getMaterialCount(value: string | undefined) {
  if (!value) return 0;
  const matched = value.match(/(\d+)\s*张/);
  return matched ? Number(matched[1]) : 1;
}

function getVideoDisplayName(file: File) {
  if (file.name) return file.name;
  return `generated-video-${crypto.randomUUID()}.mp4`;
}

async function deleteServerReferenceVideo(video: ConfirmedReferenceVideo) {
  try {
    await deleteReferenceVideo({
      fileUrl: video.fileUrl,
      storedFileName: video.storedFileName,
    });
  } catch {
    // 删除是资源清理动作，失败不打断当前表单交互。
  }
}
