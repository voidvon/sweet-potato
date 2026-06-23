export type CreatorOpsPlatform = 'xingtu' | 'buyin';

export type CreatorOpsPlatformConfig = {
  key: CreatorOpsPlatform;
  site: string;
  title: string;
  platformName: string;
  storageKey: string;
  selectedAccountKey: string;
  profilePrefix: string;
  loginAdapter: string;
  openProfileAdapter: string;
  searchAdapter: string;
  headerDescription: string;
  supportsSearchModes: boolean;
  supportsFilters: boolean;
};

export const CREATOR_OPS_PLATFORM_CONFIG: Record<CreatorOpsPlatform, CreatorOpsPlatformConfig> = {
  xingtu: {
    key: 'xingtu',
    site: 'xingtu',
    title: '星图达人',
    platformName: '星图',
    storageKey: 'xingtu_creator_accounts',
    selectedAccountKey: 'xingtu_creator_selected_profile_id',
    profilePrefix: 'xingtu',
    loginAdapter: 'xingtu-login',
    openProfileAdapter: 'xingtu-open-profile',
    searchAdapter: 'xingtu-search-creators',
    headerDescription: '管理巨量星图自动化账号 Profile。',
    supportsSearchModes: true,
    supportsFilters: true,
  },
  buyin: {
    key: 'buyin',
    site: 'buyin',
    title: '精选联盟',
    platformName: '精选联盟',
    storageKey: 'buyin_creator_accounts',
    selectedAccountKey: 'buyin_creator_selected_profile_id',
    profilePrefix: 'buyin',
    loginAdapter: 'buyin-login',
    openProfileAdapter: 'buyin-open-profile',
    searchAdapter: 'buyin-search-creators',
    headerDescription: '管理精选联盟自动化账号 Profile。',
    supportsSearchModes: false,
    supportsFilters: true,
  },
};
