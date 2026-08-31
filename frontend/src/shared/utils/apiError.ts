import { message } from 'antd';
import { t } from '../i18n';

export function getApiErrorMessage(error: unknown, fallback = t('服务请求失败')) {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  return fallback;
}

/**
 * Displays API failures consistently and returns the same text for local
 * error-state persistence. The stable key prevents repeated polling failures
 * from stacking multiple identical toast messages.
 */
export function showApiError(error: unknown, fallback?: string) {
  const content = getApiErrorMessage(error, fallback);
  void message.error({ content, key: 'app-api-error', duration: 5 });
  return content;
}
