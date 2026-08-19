import { Modal } from 'antd';
import { useState } from 'react';
import type { ConfirmedReferenceVideo } from './ReferenceVideoCard';
import { VideoPreviewPlayer } from './VideoPreviewPlayer';
import './ReferenceVideoPreviewModal.scss';

type ReferenceVideoPreviewModalProps = {
  onClose: () => void;
  video: ConfirmedReferenceVideo;
};

export function ReferenceVideoPreviewModal({ onClose, video }: ReferenceVideoPreviewModalProps) {
  const [open, setOpen] = useState(true);

  return (
    <Modal
      centered
      className="vc-create__preview-modal"
      afterOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
      footer={null}
      mask={{ closable: true }}
      onCancel={() => setOpen(false)}
      open={open}
      title={null}
      width={1500}
      zIndex={13000}
    >
      <div className="vc-create__preview-shell">
        <div className="vc-create__preview-video-frame">
          <VideoPreviewPlayer
            duration={video.duration || Math.max(0, video.end - video.start) || 15}
            loopAtEnd
            name={video.name}
            variant="reference"
            videoUrl={video.videoUrl}
          />
        </div>
      </div>
    </Modal>
  );
}
