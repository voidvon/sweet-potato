import { fieldText } from '../videoRemakeCardUtils';

export type SegmentStatusMeta = { label: string; tone: 'done' | 'running' | 'failed' | 'muted' };
export type SegmentStatusOptions = {
  generationMode: 'parallel' | 'queued_extend';
  hasCompletedFinalVideo: boolean;
  isSegmentRegenerationCard: boolean;
  regeneratedSegmentIndex: number;
};

export function segmentStatusMeta(segment: Record<string, unknown>, fallbackIndex: number | undefined, options: SegmentStatusOptions): SegmentStatusMeta {
  const index = Number(segment.segmentIndex || segment.index || fallbackIndex || 0);
  const value = fieldText(segment.status);
  if (options.isSegmentRegenerationCard && options.regeneratedSegmentIndex > 0) {
    if (index !== options.regeneratedSegmentIndex) return { label: '已完成', tone: 'done' };
    if (value === 'failed') return { label: '生成失败', tone: 'failed' };
    if (value === 'completed' || fieldText(segment.regeneratedAt)) return { label: '重生成完成', tone: 'done' };
    return { label: '重生成中', tone: 'running' };
  }
  if (value === 'completed') return { label: '已完成', tone: 'done' };
  if (value === 'failed') return { label: '生成失败', tone: 'failed' };
  if (value === 'skipped') return { label: '已跳过', tone: 'muted' };
  if (value === 'waiting' || (options.generationMode === 'queued_extend' && index > 1 && (!value || value === 'pending'))) return { label: '等待中', tone: 'muted' };
  if (options.hasCompletedFinalVideo) return { label: '已完成', tone: 'done' };
  return { label: '生成中', tone: 'running' };
}

export function isSegmentGenerating(segment: Record<string, unknown>, fallbackIndex: number | undefined, options: SegmentStatusOptions) {
  if (options.hasCompletedFinalVideo && !options.isSegmentRegenerationCard) return false;
  const label = segmentStatusMeta(segment, fallbackIndex, options).label;
  const value = fieldText(segment.status);
  const index = Number(segment.segmentIndex || segment.index || fallbackIndex || 0);
  if (options.generationMode === 'queued_extend' && index > 1 && (!value || value === 'pending' || value === 'waiting')) return false;
  return /生成中/u.test(label) || ['pending', 'generating', 'regenerating', 'running', 'submitted', 'processing'].includes(value);
}

export function segmentTime(segment: Record<string, unknown>) {
  const start = fieldText(segment.startSecond || segment.startTime);
  const end = fieldText(segment.endSecond || segment.endTime);
  const seconds = fieldText(segment.seconds || segment.durationSecond || segment.duration);
  if (start || end) return `${start || 0}-${end || seconds || 0}s`;
  return seconds ? `${seconds}s` : '';
}

export function segmentVideo(segment: Record<string, unknown>) {
  return fieldText(segment.videoUrl || segment.fileUrl || segment.url);
}
