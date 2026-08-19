import { useEffect, useState } from 'react';
import { Upload } from 'antd';
import type { UploadFile } from 'antd';
import { API_BASE_URL } from '../../../../api/request';
import type { ContentAsset } from '../../../../types';
import './AssetImageUpload.scss';

export type ImagePreview = {
  name: string;
  src: string;
};

type PendingImageUploadProps = {
  files: File[];
  maxCount?: number;
  onChange: (files: File[]) => void;
  onPreviewFile?: (preview: ImagePreview) => void;
};

type DetailImageUploadProps = {
  assets: ContentAsset[];
  isUploading?: boolean;
  onPreviewImage: (preview: ImagePreview) => void;
  onRemoveAsset: (asset: ContentAsset) => void;
  onUploadFiles: (files: File[]) => void;
};

function assetImageUrl(asset: ContentAsset) {
  return `${API_BASE_URL}${asset.fileUrl}`;
}

function fileKey(file: File) {
  return `${file.name}-${file.size}-${file.lastModified}`;
}

function usePendingImageUploadFiles(files: File[]) {
  const [urls, setUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    const nextUrls = Object.fromEntries(files.map((file) => [fileKey(file), URL.createObjectURL(file)]));
    setUrls(nextUrls);
    return () => {
      Object.values(nextUrls).forEach((url) => URL.revokeObjectURL(url));
    };
  }, [files]);

  return files.map<UploadFile>((file) => ({
    name: file.name,
    originFileObj: file as UploadFile['originFileObj'],
    status: 'done',
    thumbUrl: urls[fileKey(file)],
    uid: `file-${fileKey(file)}`,
    url: urls[fileKey(file)],
  }));
}

function filesFromUploadList(fileList: UploadFile[]) {
  return fileList.reduce<File[]>((files, item) => {
    if (item.originFileObj) {
      files.push(item.originFileObj as unknown as File);
    }
    return files;
  }, []);
}

export function PendingImageUpload({ files, maxCount, onChange, onPreviewFile }: PendingImageUploadProps) {
  const fileList = usePendingImageUploadFiles(files);
  const uploadKey = fileList.map((file) => file.uid).join('|') || 'empty';

  return (
    <Upload
      accept="image/*"
      beforeUpload={() => false}
      className="photo-upload-antd"
      fileList={fileList}
      key={uploadKey}
      listType="picture-card"
      multiple
      maxCount={maxCount}
      onChange={({ fileList: nextFileList }) => {
        const nextFiles = filesFromUploadList(nextFileList);
        onChange(typeof maxCount === 'number' ? nextFiles.slice(-maxCount) : nextFiles);
      }}
      onPreview={(file) => {
        if (file.url || file.thumbUrl) {
          onPreviewFile?.({ name: file.name, src: file.url || file.thumbUrl || '' });
        }
      }}
    >
      Upload
    </Upload>
  );
}

export function DetailImageUpload({
  assets,
  isUploading,
  onPreviewImage,
  onRemoveAsset,
  onUploadFiles,
}: DetailImageUploadProps) {
  const assetFileList = assets.map<UploadFile>((asset) => ({
    name: asset.name,
    status: 'done',
    uid: `asset-${asset.id}`,
    url: assetImageUrl(asset),
  }));
  const assetByUid = new Map(assets.map((asset) => [`asset-${asset.id}`, asset]));
  const uploadKey = assetFileList.map((file) => file.uid).join('|') || 'empty';

  return (
    <Upload
      accept="image/*"
      beforeUpload={(file) => {
        onUploadFiles([file as unknown as File]);
        return Upload.LIST_IGNORE;
      }}
      className="photo-upload-antd detail-photo-upload"
      disabled={isUploading}
      fileList={assetFileList}
      key={uploadKey}
      listType="picture-card"
      multiple
      onPreview={(file) => {
        const asset = assetByUid.get(file.uid);
        if (asset) {
          onPreviewImage({ name: asset.name, src: assetImageUrl(asset) });
        }
      }}
      onRemove={(file) => {
        const asset = assetByUid.get(file.uid);
        if (asset) {
          onRemoveAsset(asset);
          return false;
        }
        return true;
      }}
    >
      Upload
    </Upload>
  );
}
