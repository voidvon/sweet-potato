import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ContentAsset } from '../content.types.js';

const execFileAsync = promisify(execFile);
const supportedAspectRatios = ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9'] as const;

function positiveNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function closestSupportedAspectRatio(width: number, height: number) {
  const value = width / height;
  return supportedAspectRatios.reduce((closest, candidate) => {
    const [candidateWidth, candidateHeight] = candidate.split(':').map(Number);
    const [closestWidth, closestHeight] = closest.split(':').map(Number);
    return Math.abs(value - candidateWidth / candidateHeight) < Math.abs(value - closestWidth / closestHeight)
      ? candidate
      : closest;
  });
}

export async function resolveSourceVideoAspectRatio(asset: ContentAsset) {
  const metadataWidth = positiveNumber(asset.metadata?.width ?? asset.metadata?.videoWidth);
  const metadataHeight = positiveNumber(asset.metadata?.height ?? asset.metadata?.videoHeight);
  if (metadataWidth && metadataHeight) {
    return closestSupportedAspectRatio(metadataWidth, metadataHeight);
  }
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height',
      '-of', 'json',
      asset.filePath,
    ], { timeout: 15000 });
    const parsed = JSON.parse(String(stdout || '{}')) as { streams?: Array<{ width?: number; height?: number }> };
    const width = positiveNumber(parsed.streams?.[0]?.width);
    const height = positiveNumber(parsed.streams?.[0]?.height);
    if (width && height) {
      return closestSupportedAspectRatio(width, height);
    }
  } catch {
    // The caller reports one stable domain error for missing ffprobe and invalid video files.
  }
  throw new Error('无法读取源视频比例，请确认视频文件有效且服务已安装 ffprobe');
}
