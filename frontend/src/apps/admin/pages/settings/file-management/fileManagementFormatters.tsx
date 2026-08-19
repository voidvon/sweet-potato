import {
  AudioOutlined,
  FileImageOutlined,
  FileOutlined,
  FileTextOutlined,
  VideoCameraOutlined,
} from '@ant-design/icons';
import type { ManagedFileMediaType } from '../../../api/file-management';

const dateTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

export const resourceTypeLabels: Record<string, string> = {
  digital_human: '数字人',
  virtual_portrait: '形象素材',
  voice: '音色',
  scene: '场景',
  product: '商品',
  finished_video: '成片',
  real_person: '真人素材',
  other: '其他',
};

export const lifecycleLabels: Record<string, { color: string; label: string }> = {
  temporary: { color: 'gold', label: '临时' },
  retained: { color: 'blue', label: '已引用' },
  permanent: { color: 'green', label: '永久' },
};

export function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** unitIndex;
  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

export function formatDateTime(value: string) {
  return dateTimeFormatter.format(new Date(value));
}

export function mediaIcon(mediaType: ManagedFileMediaType) {
  if (mediaType === 'image') return <FileImageOutlined />;
  if (mediaType === 'video') return <VideoCameraOutlined />;
  if (mediaType === 'audio') return <AudioOutlined />;
  if (mediaType === 'document') return <FileTextOutlined />;
  return <FileOutlined />;
}
