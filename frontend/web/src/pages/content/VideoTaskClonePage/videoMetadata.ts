import { resolveAssetUrl } from '../../../api/request';

export function readVideoDuration(file: File) {
  return new Promise<number | undefined>((resolve) => {
    const video = document.createElement('video');
    const objectUrl = URL.createObjectURL(file);
    const cleanup = () => {
      video.removeAttribute('src');
      URL.revokeObjectURL(objectUrl);
    };

    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      const duration = Number.isFinite(video.duration) ? video.duration : undefined;
      cleanup();
      resolve(duration);
    };
    video.onerror = () => {
      cleanup();
      resolve(undefined);
    };
    video.src = objectUrl;
  });
}

export function shouldTrimReferenceVideo(duration: number | undefined) {
  return !Number.isFinite(duration) || !duration || duration > 15;
}

export async function downloadTrimmedVideo(fileUrl: string, originalFileName: string) {
  let response: Response;
  try {
    response = await fetch(resolveAssetUrl(fileUrl), { cache: 'no-store' });
  } catch {
    throw new Error('裁剪结果读取失败，请重试');
  }
  if (!response.ok) {
    throw new Error('裁剪结果读取失败，请重试');
  }
  const blob = await response.blob();
  return new File([blob], trimmedVideoFileName(originalFileName), {
    lastModified: Date.now(),
    type: blob.type || 'video/mp4',
  });
}

function trimmedVideoFileName(originalFileName: string) {
  const baseName = originalFileName.replace(/\.[^./\\]+$/, '') || 'reference-video';
  return `${baseName}-trimmed.mp4`;
}
