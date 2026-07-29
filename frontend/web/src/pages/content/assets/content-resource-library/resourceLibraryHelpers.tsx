import type { ContentAsset } from '../../../../types';
import { API_BASE_URL } from '../../../../api/request';
import type { ReferenceMaterialPreviewAsset } from '../../VideoTaskClonePage/components/MaterialPanel';
import { getVideoWorkSource, stringMetadataValue } from '../worksAssetSource';
import {
  allWorksFunctionOption,
  imageWorksFunctionOptions,
  videoWorksFunctionOptions,
} from './resourceLibraryConfig';
import type { WorksAssetDateGroup, WorksAssetTab, WorksFunctionOption } from './pageTypes';

export function fileUrl(asset: ContentAsset) {
  if (!asset.fileUrl) return '';
  if (/^https?:\/\//i.test(asset.fileUrl)) return asset.fileUrl;
  return `${API_BASE_URL}${asset.fileUrl}`;
}

function assetMetadataUrl(asset: ContentAsset, key: string) {
  const value = asset.metadata?.[key];
  if (typeof value !== 'string' || !value.trim()) return '';
  const url = value.trim();
  return /^https?:\/\//i.test(url) ? url : `${API_BASE_URL}${url}`;
}

export function formatDate(value: string) {
  return value ? value.slice(0, 10) : '';
}

function startOfLocalDate(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

export function worksAssetDateGroup(asset: ContentAsset, now = new Date()) {
  const date = new Date(asset.createdAt);
  if (Number.isNaN(date.getTime())) return { key: 'unknown', label: '日期未知' };

  const dateStart = startOfLocalDate(date);
  const todayStart = startOfLocalDate(now);
  const dayDiff = Math.round((todayStart.getTime() - dateStart.getTime()) / (24 * 60 * 60 * 1000));
  const dateText = `${date.getMonth() + 1}月${date.getDate()}日`;

  if (dayDiff === 0) return { key: dateStart.toISOString(), label: `今天・${dateText}` };
  if (dayDiff === 1) return { key: dateStart.toISOString(), label: `昨天・${dateText}` };
  if (date.getFullYear() === now.getFullYear()) return { key: dateStart.toISOString(), label: dateText };
  return { key: dateStart.toISOString(), label: `${date.getFullYear()}年${dateText}` };
}

export function previewFor(asset: ContentAsset, fallbackIcon: string) {
  if (asset.mimeType.startsWith('image/')) return <img alt={asset.name} src={fileUrl(asset)} />;
  if (asset.mimeType.startsWith('video/')) return <video muted src={fileUrl(asset)} />;
  return <span>{fallbackIcon}</span>;
}

export function assetAudioSrc(asset?: ContentAsset) {
  return asset?.mimeType.startsWith('audio/') ? fileUrl(asset) || undefined : undefined;
}

export function productGroupPreview(groupAssets: ContentAsset[], fallbackIcon: string) {
  if (!groupAssets.length) return <span>{fallbackIcon}</span>;
  const previewAssets = groupAssets.slice(0, 3);
  return (
    <div className={`scene-cover-grid product-cover-grid count-${previewAssets.length}`}>
      {previewAssets.map((asset) => <div key={asset.id}>{previewFor(asset, fallbackIcon)}</div>)}
    </div>
  );
}

function isGeneratedWorkAsset(asset: ContentAsset) {
  return asset.resourceType === 'finished_video'
    && ['video_model', 'video_enhancement', 'video_subtitle_removal', 'video_translation', 'image_model']
      .includes(String(asset.metadata?.generatedBy));
}

export function matchesWorksAssetTab(asset: ContentAsset, tab: WorksAssetTab) {
  return tab === 'all' || asset.mimeType.startsWith(`${tab}/`);
}

function worksFunctionOptionOf(asset: ContentAsset): WorksFunctionOption | null {
  const generatedBy = stringMetadataValue(asset, 'generatedBy');
  if (!['image_model', 'video_model', 'video_enhancement', 'video_subtitle_removal', 'video_translation'].includes(generatedBy)) {
    return null;
  }
  const mode = stringMetadataValue(asset, 'mode') || (generatedBy === 'image_model' ? 'image_generation' : 'video_generation');
  const modeTitle = stringMetadataValue(asset, 'modeTitle');
  if (generatedBy === 'image_model') {
    return imageWorksFunctionOptions.find((option) => option.modeKeys.includes(mode) || option.modeTitles.includes(modeTitle)) || null;
  }
  const source = getVideoWorkSource(asset);
  if (source === 'video_creation') return videoWorksFunctionOptions[1];
  if (source === 'talking_video') return videoWorksFunctionOptions[2];
  if (source === 'video_remake') return videoWorksFunctionOptions[3];
  if (source === 'video_upscale') return videoWorksFunctionOptions[4];
  if (source === 'subtitle_removal') return videoWorksFunctionOptions[5];
  if (source === 'video_translation') return videoWorksFunctionOptions[6];
  return videoWorksFunctionOptions[0];
}

export function matchesWorksFunction(asset: ContentAsset, functionKey: string) {
  if (functionKey === allWorksFunctionOption.key) return true;
  const sourceByKey: Record<string, ReturnType<typeof getVideoWorkSource>> = {
    'video:creation': 'video_creation',
    'video:talking-video': 'talking_video',
    'video:remake': 'video_remake',
    'video:upscale': 'video_upscale',
    'video:subtitle-removal': 'subtitle_removal',
    'video:translation': 'video_translation',
  };
  if (functionKey === 'video:all') return getVideoWorkSource(asset) !== null;
  if (functionKey in sourceByKey) return getVideoWorkSource(asset) === sourceByKey[functionKey];

  const option = imageWorksFunctionOptions.find((item) => item.key === functionKey);
  if (!option) return worksFunctionOptionOf(asset)?.key === functionKey;
  return stringMetadataValue(asset, 'generatedBy') === 'image_model'
    && (option.modeKeys.includes(stringMetadataValue(asset, 'mode'))
      || option.modeTitles.includes(stringMetadataValue(asset, 'modeTitle')));
}

export function finishedVideoStatus(asset: ContentAsset) {
  if (asset.mimeType.startsWith('image/')) return asset.fileUrl ? 'completed' : 'generating';
  const status = typeof asset.metadata?.generationStatus === 'string' ? asset.metadata.generationStatus : '';
  if (status === 'generating' || status === 'queued' || !asset.fileUrl) return 'generating';
  if (status === 'failed') return 'failed';
  return 'completed';
}

export function isCompletedGeneratedWorkAsset(asset: ContentAsset) {
  return isGeneratedWorkAsset(asset) && finishedVideoStatus(asset) === 'completed';
}

export function groupWorksAssets(assets: ContentAsset[]): WorksAssetDateGroup[] {
  const groupsByDate = new Map<string, WorksAssetDateGroup>();
  assets.forEach((asset) => {
    const dateGroup = worksAssetDateGroup(asset);
    const existingGroup = groupsByDate.get(dateGroup.key);
    if (existingGroup) existingGroup.assets.push(asset);
    else groupsByDate.set(dateGroup.key, { ...dateGroup, assets: [asset] });
  });
  return Array.from(groupsByDate.values());
}

export function toResultVideoPreview(asset: ContentAsset) {
  return {
    completedAt: metadataDate(asset, 'completedAt') || metadataDate(asset, 'generatedAt') || asset.updatedAt,
    createdAt: asset.createdAt,
    duration: 0,
    name: asset.name,
    posterUrl: assetMetadataUrl(asset, 'coverUrl'),
    referenceAssetIds: materialReferenceAssetIds(asset.metadata.materialContext),
    referenceAssets: materialReferenceAssets(asset.metadata.materialContext),
    taskId: stringMetadataValue(asset, 'videoTaskId'),
    videoUrl: fileUrl(asset),
  };
}

function metadataDate(asset: ContentAsset, key: string) {
  const value = asset.metadata?.[key];
  return typeof value === 'string' ? value : '';
}

function materialReferenceAssetIds(value: unknown) {
  if (!isMetadataRecord(value)) return [];
  const references = isMetadataRecord(value.references) ? value.references : {};
  const ids = [
    value.sourceAssetId,
    ...materialReferenceRecords(references.images).map((item) => item.id),
    ...materialReferenceRecords(references.videos).map((item) => item.id),
    ...materialReferenceRecords(references.audios).map((item) => item.id),
  ];
  return Array.from(new Set(ids.filter((item): item is string => typeof item === 'string' && item.length > 0)));
}

function materialReferenceAssets(value: unknown): ReferenceMaterialPreviewAsset[] {
  if (!isMetadataRecord(value)) return [];
  const references = isMetadataRecord(value.references) ? value.references : {};
  return [references.images, references.videos, references.audios]
    .flatMap(materialReferenceRecords)
    .filter((item) => typeof item.id === 'string' && typeof item.fileUrl === 'string' && typeof item.mimeType === 'string')
    .map((item) => ({
      id: String(item.id),
      fileUrl: String(item.fileUrl),
      metadata: isMetadataRecord(item.metadata) ? item.metadata : {},
      mimeType: String(item.mimeType),
      name: typeof item.name === 'string' ? item.name : '',
      originalFileName: typeof item.originalFileName === 'string' ? item.originalFileName : '',
    }));
}

function materialReferenceRecords(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter(isMetadataRecord) : [];
}

function isMetadataRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
