import type { MentionRichTextareaOption } from '../../../components/MentionRichTextarea';
import type { SelectedMaterials, SelectedMaterialValue } from './types';

export function promptMentionOptions(selectedMaterials: SelectedMaterials): MentionRichTextareaOption[] {
  return [
    ...Array.from({ length: getImageCount(selectedMaterials.image) }, (_, index) => ({
      label: `图片${index + 1}`,
      mimeType: 'image/png',
      subtitle: '已选参考图',
      token: `@图片${index + 1}`,
    })),
    ...Array.from({ length: selectedMaterials.video ? 1 : 0 }, (_, index) => ({
      label: `视频${index + 1}`,
      mimeType: 'video/mp4',
      subtitle: getMaterialSubtitle(selectedMaterials.video, '已选参考视频'),
      token: `@视频${index + 1}`,
    })),
    ...Array.from({ length: getAudioCount(selectedMaterials.audio) }, (_, index) => ({
      label: `音频${index + 1}`,
      mimeType: 'audio/wav',
      subtitle: '已选参考音频',
      token: `@音频${index + 1}`,
    })),
  ];
}

function getImageCount(value: SelectedMaterialValue) {
  if (Array.isArray(value)) return Math.min(value.length, 9);
  if (!value) return 0;
  const matched = value.match(/(\d+)\s*张/);
  if (matched) return Math.min(Number(matched[1]), 9);
  return 1;
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
