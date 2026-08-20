
import { t } from '@shared/i18n';export const voiceAudioAccept = '.wav,.mp3';
export const voiceAudioAllowedMimeTypes = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/wave', 'audio/x-wav'];
export const voiceAudioMaxFileCount = 3;
export const voiceAudioMinDurationSeconds = 2;
export const voiceAudioMaxDurationSeconds = 15;
export const voiceAudioMaxTotalDurationSeconds = 15;
export const voiceAudioMaxFileSizeBytes = 15 * 1024 * 1024;

export type VoiceAudioFileInfo = {
  file: File;
  duration: number;
};

function normalizeMimeType(value: string) {
  return value.toLowerCase().split(';')[0].trim();
}

function fileExtension(fileName: string) {
  const match = fileName.toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] || '';
}

function isSupportedVoiceAudioFile(file: File) {
  const mimeType = normalizeMimeType(file.type || '');
  const extension = fileExtension(file.name);
  return voiceAudioAllowedMimeTypes.includes(mimeType) || extension === 'wav' || extension === 'mp3';
}

function formatSeconds(seconds: number) {
  const rounded = Math.round(seconds * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export function voiceAudioFileKey(file: File) {
  return `${file.name}-${file.size}-${file.lastModified}`;
}

export async function readAudioDuration(file: File) {
  const objectUrl = URL.createObjectURL(file);
  try {
    const duration = await new Promise<number>((resolve, reject) => {
      const audio = document.createElement('audio');
      const cleanup = () => {
        audio.removeAttribute('src');
        audio.load();
      };
      audio.preload = 'metadata';
      audio.onloadedmetadata = () => {
        const nextDuration = audio.duration;
        cleanup();
        if (!Number.isFinite(nextDuration) || nextDuration <= 0) {
          reject(new Error(t("无法读取音频时长：{{0}}", { "0": file.name })));
          return;
        }
        resolve(nextDuration);
      };
      audio.onerror = () => {
        cleanup();
        reject(new Error(t("无法解析音频文件：{{0}}", { "0": file.name })));
      };
      audio.src = objectUrl;
    });
    return duration;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function validateVoiceAudioFiles(files: File[]) {
  if (!files.length) {
    return [];
  }
  if (files.length > voiceAudioMaxFileCount) {
    throw new Error(t("最多上传 {{0}} 段参考音频", { "0": voiceAudioMaxFileCount }));
  }

  const infos = await Promise.all(files.map(async (file) => {
    if (!isSupportedVoiceAudioFile(file)) {
      throw new Error(t("\"{{0}}\" 格式不支持，仅支持 wav、mp3", { "0": file.name }));
    }
    if (file.size > voiceAudioMaxFileSizeBytes) {
      throw new Error(t("\"{{0}}\" 超过 15 MB", { "0": file.name }));
    }
    const duration = await readAudioDuration(file);
    if (duration < voiceAudioMinDurationSeconds || duration > voiceAudioMaxDurationSeconds) {
      throw new Error(t("\"{{0}}\" 时长为 {{1}} 秒，需在 2 到 15 秒之间", { "0": file.name, "1": formatSeconds(duration) }));
    }
    return { file, duration };
  }));

  const totalDuration = infos.reduce((sum, item) => sum + item.duration, 0);
  if (totalDuration > voiceAudioMaxTotalDurationSeconds) {
    throw new Error(t("参考音频总时长为 {{0}} 秒，不能超过 15 秒", { "0": formatSeconds(totalDuration) }));
  }

  return infos;
}
