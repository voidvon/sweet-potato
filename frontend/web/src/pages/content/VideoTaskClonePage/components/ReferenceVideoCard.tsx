import { Modal } from 'antd';
import { Play, X } from 'lucide-react';
import { useRef } from 'react';

export type ConfirmedReferenceVideo = {
  duration: number;
  end: number;
  fileUrl: string;
  name: string;
  start: number;
  storedFileName: string;
  videoUrl: string;
};

type ReferenceVideoCardProps = {
  video: ConfirmedReferenceVideo;
  onPreview: () => void;
  onRemove: () => void;
  onReplace: () => void;
};

type ReferenceVideoPreviewModalProps = {
  onClose: () => void;
  video: ConfirmedReferenceVideo;
};

export function ReferenceVideoCard({ video, onPreview, onRemove, onReplace }: ReferenceVideoCardProps) {
  const previewRef = useRef<HTMLVideoElement | null>(null);

  const seekThumbnail = () => {
    if (previewRef.current) previewRef.current.currentTime = video.start;
  };

  return (
    <div className="video-task-reference-card">
      <button className="video-task-reference-thumb" onClick={onPreview} type="button">
        <video
          ref={previewRef}
          muted
          onLoadedMetadata={seekThumbnail}
          playsInline
          preload="metadata"
          src={video.videoUrl}
        />
        <span className="video-task-reference-play">
          <Play size={26} fill="currentColor" />
        </span>
      </button>
      <div className="video-task-reference-info">
        <strong title={video.name}>{video.name}</strong>
        <span>识别时会自动拆解这条视频的结构</span>
        <div className="video-task-reference-actions">
          <button onClick={onPreview} type="button">预览</button>
          <button onClick={onReplace} type="button">换一条</button>
          <button className="is-danger" onClick={onRemove} type="button">移除</button>
        </div>
      </div>
    </div>
  );
}

export function ReferenceVideoPreviewModal({ onClose, video }: ReferenceVideoPreviewModalProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const syncStart = () => {
    const element = videoRef.current;
    if (!element) return;
    element.currentTime = video.start;
    void element.play();
  };

  const loopSelection = () => {
    const element = videoRef.current;
    if (!element) return;
    if (element.currentTime < video.start || element.currentTime >= video.end) {
      element.currentTime = video.start;
      if (!element.paused) void element.play();
    }
  };

  return (
    <Modal
      centered
      className="video-task-reference-preview-modal"
      closable={false}
      footer={null}
      mask={{ closable: true }}
      onCancel={onClose}
      open
      title={null}
      width={760}
    >
      <div className="video-task-reference-preview">
        <button aria-label="关闭预览" className="video-task-reference-preview__close" onClick={onClose} type="button">
          <X size={18} />
        </button>
        <video
          ref={videoRef}
          autoPlay
          controls
          controlsList="nodownload noremoteplayback"
          onLoadedMetadata={syncStart}
          onTimeUpdate={loopSelection}
          playsInline
          src={video.videoUrl}
        />
      </div>
    </Modal>
  );
}
