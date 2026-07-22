import { Switch } from 'antd';
import { Plus } from 'lucide-react';
import { useMemo, useRef, type ChangeEvent } from 'react';
import type {
  LocalMaterialFile,
  MaterialKind,
  SelectedMaterials,
  TalkingVideoImageRole,
  ToolOption,
} from '../types';
import { ImageMaterialStack } from './ImageMaterialStack';
import type { MediaSlotItem } from './MediaSlotStack';
import { VideoSourcePanel } from './VideoSourcePanel';
import { WorkspaceSection } from './WorkspaceSection';
import { resolveLocalMaterialUrl } from '../materialUrl';
import './TalkingVideoPanel.scss';

type TalkingVideoPanelProps = {
  deepThink: boolean;
  onDeepThinkChange: (checked: boolean) => void;
  onImageFiles: (role: TalkingVideoImageRole, files: FileList | File[]) => void;
  onImageRemove: (materialId: string) => void;
  onMaterialClear: (kind: MaterialKind) => void;
  onMaterialLocalFiles: (kind: MaterialKind, files: FileList | File[]) => void;
  onMaterialRemoveOne: (kind: MaterialKind, materialId?: string) => void;
  onMaterialReplaceFiles: (kind: MaterialKind, files: LocalMaterialFile[]) => void;
  onVideoUrlSubmit: (input: string) => Promise<boolean>;
  selectedMaterials: SelectedMaterials;
  tool: ToolOption;
};

type TalkingVideoRoleOption = {
  label: string;
  meta: string;
  role: TalkingVideoImageRole;
  single: boolean;
};

const roleOptions: TalkingVideoRoleOption[] = [
  { label: '模特', meta: '限 1 张', role: 'model', single: true },
  { label: '产品', meta: '可选', role: 'product', single: false },
  { label: '背景', meta: '限 1 张', role: 'background', single: true },
  { label: '细节', meta: '可选', role: 'detail', single: false },
];

export function TalkingVideoPanel({
  deepThink,
  onDeepThinkChange,
  onImageFiles,
  onImageRemove,
  onMaterialClear,
  onMaterialLocalFiles,
  onMaterialRemoveOne,
  onMaterialReplaceFiles,
  onVideoUrlSubmit,
  selectedMaterials,
  tool,
}: TalkingVideoPanelProps) {
  const videoMaterial = tool.materials.find((item) => item.key === 'video');
  if (!videoMaterial) return null;

  return (
    <div className="talking-video-panel">
      <VideoSourcePanel
        description="上传本地视频或解析短视频链接"
        localUploadLabel="上传口播参考视频"
        material={videoMaterial}
        onMaterialClear={onMaterialClear}
        onMaterialLocalFiles={onMaterialLocalFiles}
        onMaterialRemoveOne={onMaterialRemoveOne}
        onMaterialReplaceFiles={onMaterialReplaceFiles}
        onUrlSubmit={onVideoUrlSubmit}
        selected={selectedMaterials.video}
        stackUrlInput
      />

      <WorkspaceSection
        className="talking-video-settings"
        description="配置提示词生成方式和画面参考素材。"
        title="创作设置"
      >
        <label className="talking-video-deep-think">
          <Switch checked={deepThink} onChange={onDeepThinkChange} size="small" />
          <span>
            <strong>深度思考</strong>
            <small>加强分镜、口播结构和素材一致性分析</small>
          </span>
        </label>

        <TalkingVideoImageMaterials
          onImageFiles={onImageFiles}
          onImageRemove={onImageRemove}
          selectedMaterials={selectedMaterials}
        />
      </WorkspaceSection>
    </div>
  );
}

export function TalkingVideoImageMaterials({
  description = '',
  headerNote,
  onImageFiles,
  onImageRemove,
  selectedMaterials,
  title = '图片素材',
}: Pick<TalkingVideoPanelProps, 'onImageFiles' | 'onImageRemove' | 'selectedMaterials'> & {
  description?: string;
  headerNote?: string;
  title?: string;
}) {
  const imageFiles = getLocalFiles(selectedMaterials.image);
  const imagesByRole = useMemo(() => new Map(roleOptions.map((option) => [
    option.role,
    imageFiles.filter((file) => file.talkingVideoRole === option.role),
  ])), [imageFiles]);

  return (
    <section className="talking-video-images" aria-labelledby="talking-video-images-title">
      <header>
        <div>
          <strong id="talking-video-images-title">{title}</strong>
          {description ? <span>{description}</span> : null}
        </div>
        {headerNote ? <p>{headerNote}</p> : <em>{imageFiles.length}/9 张</em>}
      </header>
      <div className="talking-video-image-grid">
        {roleOptions.map((option) => (
          <TalkingVideoImageSlot
            files={imagesByRole.get(option.role) || []}
            key={option.role}
            onFiles={(files) => onImageFiles(option.role, files)}
            onRemove={onImageRemove}
            option={option}
            totalCount={imageFiles.length}
          />
        ))}
      </div>
    </section>
  );
}

function TalkingVideoImageSlot({
  files,
  onFiles,
  onRemove,
  option,
  totalCount,
}: {
  files: LocalMaterialFile[];
  onFiles: (files: File[]) => void;
  onRemove: (materialId: string) => void;
  option: TalkingVideoRoleOption;
  totalCount: number;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const canAdd = totalCount < 9 && (!option.single || files.length === 0);
  const items = files.map((file, index) => ({
    background: `url("${resolveLocalMaterialUrl(file)}") center / cover no-repeat`,
    caption: `图·${index + 1}`,
    id: file.id,
    src: resolveLocalMaterialUrl(file),
    title: file.name,
    type: 'image' as const,
  })) satisfies MediaSlotItem[];

  const handleFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const nextFiles = event.target.files ? Array.from(event.target.files) : [];
    if (nextFiles.length) onFiles(nextFiles);
    event.target.value = '';
  };

  return (
    <div className={`talking-video-image-slot${files.length ? ' is-filled' : ''}`}>
      <input
        accept="image/*"
        className="video-task-native-file-input"
        multiple={!option.single}
        onChange={handleFiles}
        ref={inputRef}
        type="file"
      />
      <div className="talking-video-image-slot-main">
        <span className={`talking-video-image-requirement${option.role === 'model' ? ' is-required' : ''}`}>
          {option.role === 'model' ? '必选' : '可选'}
        </span>
        {files.length ? (
          <ImageMaterialStack
            items={items}
            leadingAdd={canAdd ? {
              ariaLabel: `添加${option.label}图片`,
              onClick: () => inputRef.current?.click(),
            } : undefined}
            onRemove={(item) => onRemove(item.id)}
          />
        ) : null}
        {canAdd && !files.length ? (
          <button
            aria-label={`添加${option.label}图片`}
            className="talking-video-image-add"
            onClick={() => inputRef.current?.click()}
            type="button"
          >
            <Plus aria-hidden="true" size={24} />
            <span>{option.label}</span>
          </button>
        ) : null}
      </div>
      <span className={`talking-video-image-slot-meta${files.length ? ' is-filled' : ''}`}>
        {files.length ? `${files.length}${option.single ? '/1' : ''} 张` : option.single ? '限 1 张' : '\u00A0'}
      </span>
    </div>
  );
}

function getLocalFiles(value: SelectedMaterials['image']) {
  return Array.isArray(value) ? value : [];
}
