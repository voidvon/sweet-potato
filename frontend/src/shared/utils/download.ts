import { API_BASE_URL } from '../api/core/request';
import { getStoredToken } from './session';

export async function downloadUrlAsFile(url: string, fileName: string) {
  const normalizedUrl = String(url || '').trim();
  if (!normalizedUrl) {
    throw new Error('缺少下载地址');
  }

  const headers = new Headers();
  const token = getStoredToken();
  if (token && isApplicationUrl(normalizedUrl)) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  let response: Response;
  try {
    response = await fetch(normalizedUrl, { headers });
  } catch {
    throw new Error('下载请求失败，请稍后重试');
  }
  if (!response.ok) {
    throw new Error(`下载失败（HTTP ${response.status}）`);
  }

  const blob = await response.blob();
  if (!blob.size) {
    throw new Error('下载文件内容为空');
  }

  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = normalizedDownloadFileName(fileName);
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

function isApplicationUrl(url: string) {
  try {
    const target = new URL(url, window.location.href);
    const api = new URL(API_BASE_URL || window.location.origin, window.location.href);
    return target.origin === window.location.origin || target.origin === api.origin;
  } catch {
    return false;
  }
}

function normalizedDownloadFileName(value: string) {
  return String(value || '下载文件')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .trim()
    || '下载文件';
}
