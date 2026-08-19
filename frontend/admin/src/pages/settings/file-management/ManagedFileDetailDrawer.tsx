import { Descriptions, Drawer, Typography } from 'antd';
import { resolveAssetUrl } from '@shared/api/core/request';
import type { ManagedFile } from '../../../api/file-management';
import { formatBytes, formatDateTime, resourceTypeLabels } from './fileManagementFormatters';

type ManagedFileDetailDrawerProps = {
  file: ManagedFile | null;
  onClose: () => void;
};

export function ManagedFileDetailDrawer({ file, onClose }: ManagedFileDetailDrawerProps) {
  return (
    <Drawer onClose={onClose} open={Boolean(file)} title="文件详情" width={720}>
      {file ? (
        <Descriptions bordered column={1} size="small">
          <Descriptions.Item label="文件名">{file.originalFileName || file.name}</Descriptions.Item>
          <Descriptions.Item label="文件 ID"><Typography.Text copyable>{file.id}</Typography.Text></Descriptions.Item>
          <Descriptions.Item label="存储位置">{file.storageProvider === 'tos' ? 'TOS 对象存储' : '本地存储'}</Descriptions.Item>
          {file.storageBucket ? <Descriptions.Item label="存储桶">{file.storageBucket}</Descriptions.Item> : null}
          <Descriptions.Item label="存储 Key"><Typography.Text copyable>{file.storageKey || '-'}</Typography.Text></Descriptions.Item>
          <Descriptions.Item label="文件类型">{file.mimeType || '未知'}</Descriptions.Item>
          <Descriptions.Item label="文件大小">{formatBytes(file.fileSize)}</Descriptions.Item>
          <Descriptions.Item label="业务来源">{resourceTypeLabels[file.resourceType] || file.resourceType}</Descriptions.Item>
          <Descriptions.Item label="所属用户">{file.username || '-'}</Descriptions.Item>
          <Descriptions.Item label="引用数量">{file.referenceCount}</Descriptions.Item>
          <Descriptions.Item label="上传时间">{formatDateTime(file.createdAt)}</Descriptions.Item>
          <Descriptions.Item label="文件地址">
            <Typography.Text copyable ellipsis>{resolveAssetUrl(file.fileUrl)}</Typography.Text>
          </Descriptions.Item>
        </Descriptions>
      ) : null}
    </Drawer>
  );
}
