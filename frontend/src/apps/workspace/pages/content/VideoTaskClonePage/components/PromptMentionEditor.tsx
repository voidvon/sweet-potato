import { useMemo, useRef } from 'react';
import type { ChangeEvent } from 'react';
import { MentionRichTextarea, type MentionRichTextareaOption } from '../../../../components/MentionRichTextarea';
import { promptMentionOptions } from '../promptMentionOptions';
import type { MaterialKey, SelectedMaterials } from '../types';

type PromptMentionEditorProps = {
  minRows: number;
  onChange: (prompt: string) => void;
  onPlaceholderFiles: (kind: MaterialKey, files: File[]) => void;
  placeholder: string;
  prompt: string;
  selectedMaterials: SelectedMaterials;
  suggestionContainer: string | HTMLElement;
};

export function PromptMentionEditor({
  minRows,
  onChange,
  onPlaceholderFiles,
  placeholder,
  prompt,
  selectedMaterials,
  suggestionContainer,
}: PromptMentionEditorProps) {
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const audioInputRef = useRef<HTMLInputElement | null>(null);
  const mentionTokenSignature = prompt.match(/@(图片|视频|音频)\d+/gu)?.join('|') ?? '';
  const options = useMemo(
    () => promptMentionOptions(selectedMaterials, mentionTokenSignature),
    [mentionTokenSignature, selectedMaterials],
  );

  const openPlaceholderUpload = (option: MentionRichTextareaOption) => {
    const kind = mentionMaterialKind(option);
    if (kind === 'image') imageInputRef.current?.click();
    if (kind === 'video') videoInputRef.current?.click();
    if (kind === 'audio') audioInputRef.current?.click();
  };

  const handleFileChange = (kind: MaterialKey) => (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.currentTarget.files ? Array.from(event.currentTarget.files) : [];
    event.currentTarget.value = '';
    if (files.length > 0) {
      onPlaceholderFiles(kind, files);
    }
  };

  return (
    <>
      <MentionRichTextarea
        minRows={minRows}
        onChange={onChange}
        onPlaceholderClick={openPlaceholderUpload}
        options={options}
        placeholder={placeholder}
        suggestionContainer={suggestionContainer}
        value={prompt}
      />
      <input
        accept="image/*"
        className="video-task-native-file-input"
        multiple
        onChange={handleFileChange('image')}
        ref={imageInputRef}
        type="file"
      />
      <input
        accept="video/*"
        className="video-task-native-file-input"
        onChange={handleFileChange('video')}
        ref={videoInputRef}
        type="file"
      />
      <input
        accept=".mp3,.wav,audio/mpeg,audio/wav,audio/x-wav"
        className="video-task-native-file-input"
        multiple
        onChange={handleFileChange('audio')}
        ref={audioInputRef}
        type="file"
      />
    </>
  );
}

function mentionMaterialKind(option: MentionRichTextareaOption): MaterialKey {
  if (option.mimeType?.startsWith('video/') || option.token.startsWith('@视频')) {
    return 'video';
  }
  if (option.mimeType?.startsWith('audio/') || option.token.startsWith('@音频')) {
    return 'audio';
  }
  return 'image';
}
