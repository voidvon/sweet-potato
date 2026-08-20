import { resolveAssetUrl } from '@shared/api/core/request';
import { t } from '@shared/i18n';

const dateTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

export function formatDateTime(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : dateTimeFormatter.format(date);
}

export function formatFileSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export function formatDiskSpace(bytes: number | null) {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) return '--';
  return `${(bytes / 1024 ** 3).toFixed(2)} G`;
}

export function orphanFilePreviewUrl(relativePath: string) {
  const encodedPath = relativePath.split('/').map((part) => encodeURIComponent(part)).join('/');
  return resolveAssetUrl(`/files/${encodedPath}`);
}

export function assetKindLabel(kind: string) {
  const labels: Record<string, string> = {
    audio_input: t("音频输入"),
    image_input: t("图片输入"),
    video_input: t("视频输入"),
    video_source: t("视频原始文件"),
    video_trimmed: t("视频裁剪文件"),
  };
  return labels[kind] || kind || t("临时素材");
}

export function formatRemaining(expiresAt: string) {
  const remainingMs = new Date(expiresAt).getTime() - Date.now();
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return t("已过期");
  const minutes = Math.ceil(remainingMs / 60_000);
  if (minutes < 60) return t("{{0}} 分钟后", { "0": minutes });
  const hours = Math.ceil(remainingMs / 3_600_000);
  if (hours < 24) return t("{{0}} 小时后", { "0": hours });
  return t("{{0}} 天后", { "0": Math.ceil(hours / 24) });
}
