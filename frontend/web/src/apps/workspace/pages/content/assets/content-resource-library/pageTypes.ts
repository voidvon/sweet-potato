import type { ContentAsset, ContentResourceType, User } from '../../../../types';

export type ContentResourceLibraryPageProps = {
  currentUser: User;
  resourceType: ContentResourceType;
  resourceOverride?: Partial<ResourceCopy>;
  singleDefaultGroup?: boolean;
};

export type ResourceCopy = {
  breadcrumb: string;
  icon: string;
  defaultGroup: string;
  pageTitle: string;
  pageDescription: string;
  steps: string[];
  addTitle: string;
  addHint: string;
  nameLabel: string;
  namePlaceholder: string;
  uploadTitle: string;
  uploadHint: string;
  createOkText: string;
  emptyGroups: string;
  emptyAssets: string;
  detailUploadText: string;
  detailAddText: string;
  assetUnit: string;
  accept: string;
};

export type WorksAssetTab = 'all' | 'image' | 'video';

export type WorksAssetDateGroup = {
  key: string;
  label: string;
  assets: ContentAsset[];
};

export type WorksFunctionOption = {
  key: string;
  label: string;
  modeKeys: string[];
  modeTitles: string[];
};
