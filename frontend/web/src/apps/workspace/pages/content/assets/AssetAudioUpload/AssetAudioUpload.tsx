import { useEffect, useState } from 'react';
import { message, Upload } from 'antd';
import type { UploadFile } from 'antd';
import { API_BASE_URL } from '../../../../api/request';
import type { ContentAsset } from '../../../../types';
import { validateVoiceAudioFiles, voiceAudioAccept, voiceAudioFileKey } from '../../../../utils/voiceAudioUpload';
import './AssetAudioUpload.scss';

type PendingAudioUploadProps = {
  files: File[];
  onChange: (files: File[]) => void;
  maxCount?: number;
  helperText?: string;
};

type DetailAudioUploadProps = {
  asset?: ContentAsset;
  displayName?: string;
  isUploading?: boolean;
  onUploadFile: (file: File) => void;
};

function assetUrl(asset: ContentAsset) {
  return `${API_BASE_URL}${asset.fileUrl}`;
}

function usePendingAudioUploadFiles(files: File[]) {
  const [urls, setUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    const nextUrls = Object.fromEntries(files.map((file) => [voiceAudioFileKey(file), URL.createObjectURL(file)]));
    setUrls(nextUrls);
    return () => {
      Object.values(nextUrls).forEach((url) => URL.revokeObjectURL(url));
    };
  }, [files]);

  return files.map<UploadFile>((file) => ({
    name: file.name,
    originFileObj: file as UploadFile['originFileObj'],
    status: 'done',
    uid: `file-${voiceAudioFileKey(file)}`,
    url: urls[voiceAudioFileKey(file)],
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

function audioItem(file: UploadFile, displayName?: string) {
  return (
    <div className="audio-upload-item">
      <div>
        <strong>{displayName || file.name}</strong>
      </div>
      {file.url ? <audio controls src={file.url} /> : null}
    </div>
  );
}

export function PendingAudioUpload({
  files,
  onChange,
  maxCount = 1,
  helperText = '仅支持 wav、mp3，单段 2-15 秒，且不超过 15 MB',
}: PendingAudioUploadProps) {
  const fileList = usePendingAudioUploadFiles(files);
  const uploadKey = fileList.map((file) => file.uid).join('|') || 'empty';

  return (
    <Upload
      accept={voiceAudioAccept}
      beforeUpload={() => false}
      className="audio-upload-antd"
      fileList={fileList}
      itemRender={(_, file) => audioItem(file)}
      key={uploadKey}
      maxCount={maxCount}
      onChange={async ({ fileList: nextFileList }) => {
        try {
          const nextFiles = filesFromUploadList(nextFileList).slice(-maxCount);
          await validateVoiceAudioFiles(nextFiles);
          onChange(nextFiles);
        } catch (error) {
          message.error(error instanceof Error ? error.message : '音频文件校验失败');
        }
      }}
      showUploadList={{ showRemoveIcon: false }}
    >
      <button className="audio-upload-control" type="button">
        <span>上传音频样本</span>
        <small>{helperText}</small>
      </button>
    </Upload>
  );
}

export function DetailAudioUpload({ asset, displayName, isUploading, onUploadFile }: DetailAudioUploadProps) {
  const fileList = asset
    ? [{
      name: asset.name,
      status: 'done' as const,
      uid: `asset-${asset.id}`,
      url: assetUrl(asset),
    }]
    : [];
  const uploadKey = fileList.map((file) => file.uid).join('|') || 'empty';

  return (
    <Upload
      accept={voiceAudioAccept}
      beforeUpload={(file) => {
        void validateVoiceAudioFiles([file as File])
          .then(() => onUploadFile(file as File))
          .catch((error) => {
            message.error(error instanceof Error ? error.message : '音频文件校验失败');
          });
        return Upload.LIST_IGNORE;
      }}
      className="audio-upload-antd"
      disabled={isUploading}
      fileList={fileList}
      itemRender={(_, file) => audioItem(file, displayName)}
      key={uploadKey}
      maxCount={1}
      showUploadList={{ showRemoveIcon: false }}
    >
      <button className="audio-upload-control" type="button">
        <span>{asset ? '覆盖音频样本' : '上传音频样本'}</span>
        <small>仅支持 wav、mp3，单段 2-15 秒，且不超过 15 MB</small>
      </button>
    </Upload>
  );
}
