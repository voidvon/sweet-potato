import type { SendChatPayload } from '../../types';

const selectedXingtuProfileStorageKey = 'xingtu_creator_selected_profile_id';

export type ChatCapabilityConfig = {
  id: string;
  label: string;
  mention: string;
  description?: string;
  keywords?: string[];
  pattern: RegExp;
  requestedCapability: NonNullable<SendChatPayload['requestedCapabilities']>[number];
  resolveContext?: () => SendChatPayload['capabilityContext'];
};

function getSelectedXingtuProfileId() {
  try {
    return window.localStorage.getItem(selectedXingtuProfileStorageKey) || '';
  } catch {
    return '';
  }
}

export const chatCapabilities: ChatCapabilityConfig[] = [
  {
    id: 'xingtu_creator_search',
    label: '星图达人',
    mention: '@星图达人',
    description: '调用星图达人搜索能力，适合找达人、筛选达人和生成搜索草稿。',
    keywords: ['星图', '达人', '搜索'],
    pattern: /(?:@|＠)星图达人/,
    requestedCapability: 'xingtu_creator_search',
    resolveContext: () => ({
      xingtuProfileId: getSelectedXingtuProfileId() || null,
    }),
  },
];

export const chatCapabilityChips = chatCapabilities.map((item) => item.mention);
export const chatCapabilityOptions = chatCapabilities.map((item) => ({
  id: item.id,
  label: item.label,
  mention: item.mention,
  description: item.description,
  keywords: item.keywords || [],
}));

export function resolveChatCapabilityPayload(content: string): Pick<SendChatPayload, 'capabilityContext' | 'requestedCapabilities'> {
  const matched = chatCapabilities.filter((item) => item.pattern.test(content));
  if (!matched.length) {
    return {};
  }

  return {
    capabilityContext: matched.reduce<SendChatPayload['capabilityContext']>((context, item) => ({
      ...(context || {}),
      ...(item.resolveContext?.() || {}),
    }), undefined),
    requestedCapabilities: matched.map((item) => item.requestedCapability),
  };
}
