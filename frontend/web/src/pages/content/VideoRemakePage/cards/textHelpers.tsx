import type { MentionRichTextareaOption } from '../../../../components/MentionRichTextarea';
import type { ContentAsset } from '../../../../types';
import { asRecord, fieldText, isRecord, mediaUrl } from '../videoRemakeCardUtils';
import { findSelectedAsset } from './assetPickers';
import type { SeedanceReferenceMention } from './types';

export function compactLines(lines: Array<[string, string | undefined]>) {
  return lines
    .filter(([, value]) => value && value.trim())
    .map(([label, value]) => `${label}：${value}`)
    .join('\n');
}

export function isUnknownPlaceholderText(value: string) {
  return /^(不详|未知|未详|不明确|未明确|无法确定|未提供|暂无|无|N\/A|NA|null|undefined)[。.]?$/iu.test(value.trim());
}

export function isReferencePromptMetaLine(line: string) {
  const match = line.match(/^([^:：]+)\s*[:：]\s*(.*)$/u);
  if (!match) {
    return isUnknownPlaceholderText(line);
  }
  const key = match[1].trim();
  const text = match[2].trim();
  return /^(startSecond|endSecond|start|end|startTime|endTime|time|duration|spokenCue|speckCue|speechCue|narrationCue|cue|keywords?|开始时间|结束时间|开始秒|结束秒|出现时间|时间范围|口播线索|对应口播|语境线索|关键词)$/iu.test(key)
    || isUnknownPlaceholderText(text);
}

export function cleanReferencePromptText(value: unknown) {
  return fieldText(value)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !isReferencePromptMetaLine(line))
    .join('\n')
    .trim();
}

export function isProgressExecutionCompleted(item: Record<string, unknown>) {
  const status = fieldText(item.status || item.state || item.executionStatus).toLowerCase();
  return item.completed === true
    || ['completed', 'success', 'succeeded', 'done', 'finished', '已完成'].includes(status);
}

export function characterDisplayPromptText(item: Record<string, unknown>) {
  const prompt = cleanReferencePromptText(item.characterPrompt);
  const detailLines = [
    ['外观', cleanReferencePromptText(item.appearance)],
    ['动作', cleanReferencePromptText(item.gesture)],
    ['表情', cleanReferencePromptText(item.expression)],
  ]
    .filter(([, text]) => text && !prompt.includes(text))
    .map(([label, text]) => `${label}：${text}`);
  return [...detailLines, prompt].filter(Boolean).join('\n').trim();
}

export function normalizeResolution(value: unknown, detail?: unknown, aspectRatio?: unknown) {
  const text = [fieldText(value), fieldText(detail)].filter(Boolean).join(' ');
  const dimension = text.match(/(\d{3,4})\s*[x×]\s*(\d{3,4})/i);
  if (dimension) {
    const shortSide = Math.min(Number(dimension[1]), Number(dimension[2]));
    if (shortSide <= 480) {
      return '480p';
    }
    if (shortSide <= 720) {
      return '720p';
    }
    return '1080p';
  }
  const numeric = Number((fieldText(value) || fieldText(detail)).match(/\d+/)?.[0] || 0);
  if (!numeric) {
    return '';
  }
  const aspect = fieldText(aspectRatio);
  if (numeric > 1080 && /^(9:16|3:4)$/u.test(aspect)) {
    return numeric <= 1280 ? '720p' : '1080p';
  }
  if (numeric <= 480) {
    return '480p';
  }
  if (numeric <= 720 || numeric <= 1280) {
    return '720p';
  }
  return '1080p';
}

const presetAspectRatios = ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9'] as const;
type PresetAspectRatio = typeof presetAspectRatios[number];

export function nearestPresetAspectRatio(value: unknown) {
  const text = fieldText(value).trim().replace(/\s+/gu, '');
  if (!text) {
    return '';
  }
  if (presetAspectRatios.includes(text as typeof presetAspectRatios[number])) {
    return text;
  }
  const match = text.match(/^(\d+(?:\.\d+)?)[:/](\d+(?:\.\d+)?)$/u);
  if (!match) {
    return text;
  }
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return text;
  }
  const target = width / height;
  let best: PresetAspectRatio = presetAspectRatios[0];
  let smallestDistance = Number.POSITIVE_INFINITY;
  for (const ratio of presetAspectRatios) {
    const [presetWidth, presetHeight] = ratio.split(':').map(Number);
    const distance = Math.abs(target - (presetWidth / presetHeight));
    if (distance < smallestDistance) {
      smallestDistance = distance;
      best = ratio;
    }
  }
  return best;
}

export function SummaryBlock({ lines, emptyText = '暂无内容，等待生成。' }: { lines: string; emptyText?: string }) {
  return <div className="remake-summary">{lines.trim() || emptyText}</div>;
}

export function promptSection(text: string, heading: string) {
  const pattern = new RegExp(`#\\s*${heading}\\s*\\n([\\s\\S]*?)(?=\\n#\\s|$)`, 'u');
  return text.match(pattern)?.[1]?.trim() || '';
}

export function promptStoryboardLines(mainPrompt: string) {
  const section = promptSection(mainPrompt, '本段画面') || promptSection(mainPrompt, '当前分镜');
  return section
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
}

export function removeDuplicatedPipPromptSection(text: string) {
  return text
    .replace(/\n{2,}#\s*画中画\s*\n[\s\S]*?(?=\n{2,}#\s|$)/gu, '')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

export function editableSeedancePromptText(text: string) {
  return removeDuplicatedPipPromptSection(text);
}

export function sanitizePipPreviewText(text: string) {
  return text
    .replace(/；?因文本未提供具体像素坐标，?x、y、width、height\s*暂填\s*0。?/gu, '')
    .replace(/位置：\s*未明确（文本未提供具体位置）/gu, '')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

export function hasVisiblePipText(text: string) {
  const value = sanitizePipPreviewText(text);
  return Boolean(value && !/^无画中画[。.]?$/u.test(value));
}

export function totalDurationText(segments: Record<string, unknown>[]) {
  const total = segments.reduce((sum, segment) => sum + (Number(segment.duration) || 0), 0);
  return total ? `${Number(total.toFixed(1))}s` : '待确认';
}

export function maxSegmentDurationText(segments: Record<string, unknown>[]) {
  const configured = Number(segments.find((segment) => Number(segment.maxDuration))?.maxDuration || 15);
  return `≤ ${configured}s`;
}

export function formatShotTime(shot: Record<string, unknown>) {
  const start = fieldText(shot.startTime);
  const end = fieldText(shot.endTime);
  const duration = fieldText(shot.duration);
  if (start || end) {
    return `${start || 0}s - ${end || duration || 0}s`;
  }
  return duration ? `${duration}s` : '';
}
export function resolveAudioCharacterLabel(item: Record<string, unknown>, index: number) {
  const characterLabel = fieldText(item.characterLabel);
  if (characterLabel) {
    return characterLabel;
  }
  const rawLabel = fieldText(item.label);
  if (rawLabel && !['content', 'text', 'item', 'items'].includes(rawLabel.toLowerCase())) {
    return rawLabel.replace(/\s*声音$/u, '') || rawLabel;
  }
  return `人物 ${index + 1}`;
}

export function seedanceReferenceMentions(prompt: Record<string, unknown>, assets: ContentAsset[]): SeedanceReferenceMention[] {
  const rawReferenceMentions = prompt.referenceMentions;
  const explicitItems = Array.isArray(rawReferenceMentions) ? rawReferenceMentions : [];
  const explicit = explicitItems
    .map((item): SeedanceReferenceMention | null => {
      if (!isRecord(item)) {
        return null;
      }
      const label = fieldText(item.label);
      const token = fieldText(item.token) || (label ? `@${label}` : '');
      if (!label || !token) {
        return null;
      }
      const asset = findSelectedAsset(assets, item.assetId);
      return {
        assetId: fieldText(item.assetId),
        fileUrl: fieldText(item.fileUrl) || asset?.fileUrl || '',
        label,
        mimeType: fieldText(item.mimeType) || asset?.mimeType || '',
        name: fieldText(item.name) || asset?.name || asset?.originalFileName || label,
        token,
      };
    })
    .filter((item): item is SeedanceReferenceMention => Boolean(item));
  if (Array.isArray(rawReferenceMentions)) {
    return explicit;
  }
  const images = assets.filter((asset) => asset.mimeType.startsWith('image/'));
  const videos = assets.filter((asset) => asset.mimeType.startsWith('video/'));
  const audios = assets.filter((asset) => asset.mimeType.startsWith('audio/'));
  return [
    ...images.map((asset, index) => ({
      assetId: asset.id,
      fileUrl: asset.fileUrl,
      label: `图片${index + 1}`,
      mimeType: asset.mimeType,
      name: asset.name || asset.originalFileName || `图片${index + 1}`,
      token: `@图片${index + 1}`,
    })),
    ...videos.map((asset, index) => ({
      assetId: asset.id,
      fileUrl: asset.fileUrl,
      label: `视频${index + 1}`,
      mimeType: asset.mimeType,
      name: asset.name || asset.originalFileName || `视频${index + 1}`,
      token: `@视频${index + 1}`,
    })),
    ...audios.map((asset, index) => ({
      assetId: asset.id,
      fileUrl: asset.fileUrl,
      label: `音频${index + 1}`,
      mimeType: asset.mimeType,
      name: asset.name || asset.originalFileName || `音频${index + 1}`,
      token: `@音频${index + 1}`,
    })),
  ];
}

export function renderSeedancePromptWithReferences(text: string, mentions: SeedanceReferenceMention[]) {
  const parts = text.split(/(@(?:图片|视频|音频)\d+)/gu);
  return parts.map((part, index) => {
    const match = part.match(/^@((?:图片|视频|音频)\d+)$/u);
    if (!match) {
      return <span key={`${index}-${part}`}>{part}</span>;
    }
    const mention = mentions.find((item) => item.token === part || item.label === match[1]);
    const previewUrl = mention?.fileUrl ? mediaUrl(mention.fileUrl) : '';
    return (
      <span className="remake-seedance-reference-chip" contentEditable={false} data-seedance-token={part} key={`${index}-${part}`}>
        {mention?.mimeType?.startsWith('image/') && previewUrl ? <img alt={match[1]} src={previewUrl} /> : null}
        {mention?.mimeType?.startsWith('audio/') ? <span className="remake-seedance-reference-chip-icon">♪</span> : null}
        {mention?.mimeType?.startsWith('video/') ? <span className="remake-seedance-reference-chip-icon">视</span> : null}
        <b>{match[1]}</b>
      </span>
    );
  });
}

export function seedanceMentionOptions(mentions: SeedanceReferenceMention[]): MentionRichTextareaOption[] {
  return mentions.map((mention) => ({
    label: mention.label,
    mimeType: mention.mimeType,
    previewUrl: mention.mimeType?.startsWith('image/') && mention.fileUrl ? mediaUrl(mention.fileUrl) : '',
    subtitle: mention.name,
    token: mention.token,
  }));
}
export function SeedancePromptPreview({ mentions, text }: { mentions: SeedanceReferenceMention[]; text: string }) {
  const value = text.trim();
  if (!value) {
    return <p className="remake-seedance-empty">暂无提示词内容</p>;
  }
  return (
    <div className="remake-seedance-prompt-preview">
      <p>{renderSeedancePromptWithReferences(value, mentions)}</p>
    </div>
  );
}

export function PromptPreview({ title, text }: { title: string; text: string }) {
  const value = text.trim();
  if (!value) {
    return null;
  }
  return (
    <div className="remake-prompt-preview">
      <b>{title}</b>
      <p>{value}</p>
    </div>
  );
}

export function promptTextValue(value: unknown): string {
  if (typeof value === 'string') {
    return editableSeedancePromptText(value.trim());
  }
  if (Array.isArray(value)) {
    return editableSeedancePromptText(value.map(promptTextValue).filter(Boolean).join('\n\n'));
  }
  const record = asRecord(value);
  if (!Object.keys(record).length) {
    return '';
  }
  const directKeys = ['mainPrompt', 'seedancePrompt', 'promptText', 'text', 'content', 'systemPrompt'];
  for (const key of directKeys) {
    const text = promptTextValue(record[key]);
    if (text) {
      return editableSeedancePromptText(text);
    }
  }
  const nestedKeys = ['prompt', 'data', 'value'];
  for (const key of nestedKeys) {
    const text = promptTextValue(record[key]);
    if (text) {
      return editableSeedancePromptText(text);
    }
  }
  return '';
}
