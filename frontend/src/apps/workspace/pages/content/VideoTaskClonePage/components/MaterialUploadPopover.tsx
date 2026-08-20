import type { CSSProperties } from 'react';
import { Upload, X } from 'lucide-react';
import type { MaterialKind, UploadAnchor } from '../types';
import { materialIcon } from './materialIcon';
import { t } from '@shared/i18n';

type MaterialUploadPopoverProps = {
  anchor: UploadAnchor | null;
  item: MaterialKind;
  onClose: () => void;
  onLibraryChoose: (item: MaterialKind) => void;
  onLocalUpload: (item: MaterialKind) => void;
};

export function MaterialUploadPopover({
  anchor,
  item,
  onClose,
  onLibraryChoose,
  onLocalUpload,
}: MaterialUploadPopoverProps) {
  return (
    <div className={`video-task-upload-popover is-${item.key}`} style={getUploadPopoverStyle(anchor)}>
      <div className="video-task-popover-head">
        <strong>{t("选择")}{item.label}</strong>
        <button onClick={onClose} type="button"><X size={16} /></button>
      </div>
      <button className="video-task-upload-action" onClick={() => onLocalUpload(item)} type="button">
        <Upload size={17} />
        {t("本地上传")}
      </button>
      <button className="video-task-upload-action" onClick={() => onLibraryChoose(item)} type="button">
        {materialIcon(item.key)}
        {t("从素材库选择")}
      </button>
    </div>
  );
}

function getUploadPopoverStyle(anchor: UploadAnchor | null) {
  if (!anchor) return undefined;
  return {
    '--upload-popover-left': `${anchor.left}px`,
    '--upload-popover-top': `${anchor.top}px`,
  } as CSSProperties;
}
