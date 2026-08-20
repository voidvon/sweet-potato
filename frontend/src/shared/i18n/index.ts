import { englishMessages } from './en';

export type AppLocale = 'en-US' | 'zh-CN';

const localeStorageKey = 'ai-marketing-locale';

function normalizeLocale(value: string | null | undefined): AppLocale | null {
  if (!value) return null;
  const normalized = value.toLowerCase();
  if (normalized === 'en' || normalized.startsWith('en-')) return 'en-US';
  if (normalized === 'zh' || normalized.startsWith('zh-')) return 'zh-CN';
  return null;
}

export function getLocale(): AppLocale {
  if (typeof window === 'undefined') return 'zh-CN';
  return normalizeLocale(window.localStorage.getItem(localeStorageKey))
    || normalizeLocale(window.navigator.languages?.[0])
    || normalizeLocale(window.navigator.language)
    || 'zh-CN';
}

export function setLocale(locale: AppLocale) {
  if (typeof window === 'undefined' || locale === getLocale()) return;
  window.localStorage.setItem(localeStorageKey, locale);
  window.location.reload();
}

export function t(source: string, values?: Record<string, string | number | null | undefined>): string {
  const translated = getLocale() === 'en-US' ? englishMessages[source] || source : source;
  if (!values) return translated;
  return Object.entries(values).reduce(
    (result, [key, value]) => result.replaceAll(`{{${key}}}`, value == null ? '' : String(value)),
    translated,
  );
}

export function getAcceptLanguage(): string {
  return getLocale() === 'en-US' ? 'en-US, en;q=0.9' : 'zh-CN, zh;q=0.9';
}
