import { Languages } from 'lucide-react';
import { Dropdown, Tooltip } from 'antd';
import type { MenuProps } from 'antd';
import { getLocale, setLocale, t, type AppLocale } from '../i18n';
import './LanguageSwitcher.scss';

type LanguageSwitcherProps = {
  className?: string;
};

export function LanguageSwitcher({ className = '' }: LanguageSwitcherProps) {
  const locale = getLocale();
  const items: MenuProps['items'] = [
    { key: 'zh-CN', label: t("简体中文") },
    { key: 'en-US', label: 'English' },
  ];

  return (
    <Dropdown
      menu={{
        items,
        onClick: ({ key }) => setLocale(key as AppLocale),
        selectable: true,
        selectedKeys: [locale],
      }}
      placement="bottomRight"
      trigger={['click']}
    >
      <Tooltip title={t('切换语言')}>
        <button
          aria-label={t('切换语言')}
          className={`language-switcher ${className}`.trim()}
          type="button"
        >
          <Languages aria-hidden="true" size={17} />
          <span>{locale === 'en-US' ? 'EN' : t("中")}</span>
        </button>
      </Tooltip>
    </Dropdown>
  );
}
