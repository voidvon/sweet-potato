import { useEffect, useState } from 'react';
import './PendingAssetGrid.scss';

type PendingAssetGridProps = {
  files: File[];
  onAdd: () => void;
  onRemove: (file: File) => void;
};

function PendingAssetTile({ file, onRemove }: Pick<PendingAssetGridProps, 'onRemove'> & { file: File }) {
  const [url, setUrl] = useState('');

  useEffect(() => {
    if (!file.type.startsWith('image/')) {
      setUrl('');
      return undefined;
    }
    const nextUrl = URL.createObjectURL(file);
    setUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [file]);

  return (
    <div className="photo-upload-thumb">
      {url ? <img alt={file.name} src={url} /> : <span className="pending-file-icon">📁</span>}
      <button aria-label={`移除 ${file.name}`} onClick={() => onRemove(file)} type="button">×</button>
      <small title={file.name}>{file.name}</small>
    </div>
  );
}

export function PendingAssetGrid({ files, onAdd, onRemove }: PendingAssetGridProps) {
  return (
    <div className="photo-upload-grid compact">
      {files.map((file) => (
        <PendingAssetTile file={file} key={`${file.name}-${file.size}-${file.lastModified}`} onRemove={onRemove} />
      ))}
      <button className="photo-upload-add" onClick={onAdd} type="button">
        <strong>+</strong>
        <span>Upload</span>
      </button>
    </div>
  );
}
