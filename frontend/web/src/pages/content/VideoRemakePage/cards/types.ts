import type { Dispatch, ReactNode, SetStateAction } from 'react';
import type { VideoRemakeCardMessage, VideoRemakePipUploadResult } from '../../../../api/video-remake';
import type { ContentAsset, ContentAssetGroup } from '../../../../types';
import type { AssetSelectorKind } from '../AssetSelector';

export type CardRendererContext = {
  assets: ContentAsset[];
  groups: ContentAssetGroup[];
  disabled?: boolean;
  syncing?: boolean;
  active?: boolean;
  draft?: unknown;
  onEnsureAssets?: () => Promise<void>;
  onConfirm: (data: unknown) => Promise<void>;
  onCancel: () => Promise<void>;
  onDraftChange?: Dispatch<SetStateAction<unknown>>;
  onEdit: () => Promise<void>;
  onRegenerate?: (instruction?: string) => Promise<void>;
  onRegenerateFinalSegment?: (segmentIndex: number, prompt?: string) => Promise<void>;
  onRegenerateFinalSegments?: (segments: FinalSegmentRegenerationInput[]) => Promise<void>;
  onSyncProgress?: () => Promise<void>;
  onUploadPipImage?: (file: File) => Promise<VideoRemakePipUploadResult>;
  onUploadReferenceImage?: (kind: 'scene' | 'product', file: File) => Promise<ContentAsset>;
  videoAspectRatio?: string;
  videoDurationSeconds?: number;
};

export type CardRendererProps = CardRendererContext & {
  card: VideoRemakeCardMessage;
};

export type AssetSelectorState = {
  kind: AssetSelectorKind;
  title: string;
  selectedAssetId?: string;
  selectedAssetIds?: string[];
  selectedGroupId?: string;
  maxSelection?: number;
  onSelect: (selection: { assetId?: string; assetIds?: string[]; groupId?: string }) => void;
};

export type FinalSegmentQueueItem = {
  mode: 'direct' | 'prompt';
  prompt?: string;
  segmentIndex: number;
};

export type FinalSegmentRegenerationInput = {
  prompt?: string;
  segmentIndex: number;
};

export type SeedanceReferenceMention = {
  assetId?: string;
  fileUrl?: string;
  label: string;
  mimeType?: string;
  name?: string;
  token: string;
};

export type EditableCardProps = CardRendererProps & {
  children: (args: {
    draft: unknown;
    setDraft: Dispatch<SetStateAction<unknown>>;
    setSelector: Dispatch<SetStateAction<AssetSelectorState | null>>;
  }) => ReactNode;
};
