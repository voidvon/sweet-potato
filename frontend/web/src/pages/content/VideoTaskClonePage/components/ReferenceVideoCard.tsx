import { Play } from 'lucide-react';
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
