import type { MentionRichTextareaOption } from '../../../components/MentionRichTextarea';
import type { SelectedMaterials, SelectedMaterialValue } from './types';

export function promptMentionOptions(selectedMaterials: SelectedMaterials, prompt = ''): MentionRichTextareaOption[] {
  return [
    ...getImageMentionOptions(selectedMaterials.image, getReferencedCount(prompt, '图片', 9)),
    ...getVideoMentionOptions(selectedMaterials.video, getReferencedCount(prompt, '视频', 1)),
    ...getAudioMentionOptions(selectedMaterials.audio, getReferencedCount(prompt, '音频', 3)),
  ];
}

function getImageCount(value: SelectedMaterialValue) {
  if (Array.isArray(value)) return Math.min(value.length, 9);
  if (!value) return 0;
  const matched = value.match(/(\d+)\s*张/);
  if (matched) return Math.min(Number(matched[1]), 9);
  return 1;
}

function getImageMentionOptions(value: SelectedMaterialValue, referencedCount: number): MentionRichTextareaOption[] {
  const selectedCount = getImageCount(value);
  const optionCount = Math.max(selectedCount, referencedCount);
  if (Array.isArray(value)) {
    return Array.from({ length: optionCount }, (_, index) => {
      const item = value[index];
      return item ? {
        label: `图片${index + 1}`,
        mimeType: 'image/png',
        name: item.name || `图片${index + 1}`,
        previewUrl: item.url,
        subtitle: '已选参考图',
        token: `@图片${index + 1}`,
      } : emptyMentionOption('图片', 'image/png', index, '点击上传对应的参考图');
    });
  }

  return Array.from({ length: optionCount }, (_, index) => (
    index < selectedCount ? {
      label: `图片${index + 1}`,
      mimeType: 'image/png',
      subtitle: '已选参考图',
      token: `@图片${index + 1}`,
    } : emptyMentionOption('图片', 'image/png', index, '点击上传对应的参考图')
  ));
}

function getVideoMentionOptions(value: SelectedMaterialValue, referencedCount: number): MentionRichTextareaOption[] {
  const selectedCount = Array.isArray(value) ? Math.min(value.length, 1) : value ? 1 : 0;
  return Array.from({ length: Math.max(selectedCount, referencedCount) }, (_, index) => (
    index < selectedCount ? {
      label: `视频${index + 1}`,
      mimeType: 'video/mp4',
      subtitle: getMaterialSubtitle(value, '已选参考视频'),
      token: `@视频${index + 1}`,
    } : emptyMentionOption('视频', 'video/mp4', index, '点击上传对应的参考视频')
  ));
}

function getAudioMentionOptions(value: SelectedMaterialValue, referencedCount: number): MentionRichTextareaOption[] {
  const selectedCount = getAudioCount(value);
  return Array.from({ length: Math.max(selectedCount, referencedCount) }, (_, index) => (
    index < selectedCount ? {
      label: `音频${index + 1}`,
      mimeType: 'audio/wav',
      subtitle: '已选参考音频',
      token: `@音频${index + 1}`,
    } : emptyMentionOption('音频', 'audio/wav', index, '点击上传对应的参考音频')
  ));
}

function emptyMentionOption(
  kind: '图片' | '视频' | '音频',
  mimeType: string,
  index: number,
  subtitle: string,
): MentionRichTextareaOption {
  return {
    isPlaceholder: true,
    label: `${kind}${index + 1}`,
    mimeType,
    subtitle,
    token: `@${kind}${index + 1}`,
  };
}

function getReferencedCount(prompt: string, kind: '图片' | '视频' | '音频', limit: number) {
  let maxIndex = 0;
  for (const match of prompt.matchAll(/@(图片|视频|音频)(\d+)/gu)) {
    if (match[1] !== kind) continue;
    const index = Number(match[2]);
    if (Number.isFinite(index)) {
      maxIndex = Math.max(maxIndex, index);
    }
  }
  return Math.min(maxIndex, limit);
}

function getAudioCount(value: SelectedMaterialValue) {
  if (Array.isArray(value)) return Math.min(value.length, 3);
  if (!value) return 0;
  const matched = value.match(/参考音频\s*(\d+)\s*个/);
  if (matched) return Math.min(Number(matched[1]), 3);
  return 1;
}

function getMaterialSubtitle(value: SelectedMaterialValue, fallback: string) {
  if (Array.isArray(value)) return value[0]?.name ?? fallback;
  return value || fallback;
}
