import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const MAX_CREATE_VIDEO_SOURCE_DURATION_SECONDS = 15;

type VideoDurationSource = {
  filePath: string;
  name?: string;
  originalFileName?: string;
};

export async function assertCreateVideoSourceDuration(asset: VideoDurationSource) {
  if (!asset.filePath || !existsSync(asset.filePath)) {
    throw new Error('源视频尚未保存到本地，无法校验视频时长');
  }

  let duration: number;
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      asset.filePath,
    ], { timeout: 15000 });
    duration = Number(String(stdout || '').trim());
  } catch {
    throw new Error('无法读取源视频时长，请确认视频文件有效且服务已安装 ffprobe');
  }

  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error('无法读取源视频时长，请确认视频文件有效');
  }
  if (duration > MAX_CREATE_VIDEO_SOURCE_DURATION_SECONDS) {
    const name = asset.name || asset.originalFileName || '所选视频';
    throw new Error(`${name}时长超过 15 秒，请先剪辑后再提交`);
  }
  return duration;
}

export async function assertCreateVideoSourcesDuration(assets: VideoDurationSource[]) {
  const uniqueAssets = Array.from(new Map(
    assets.map((asset) => [asset.filePath, asset]),
  ).values());
  await Promise.all(uniqueAssets.map(assertCreateVideoSourceDuration));
}
