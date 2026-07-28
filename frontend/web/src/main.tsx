import React from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import 'antd/dist/reset.css';
import App from './App';
import './styles.scss';

function resolveCssColor(token: string) {
  const probe = document.createElement('span');
  probe.style.color = `var(${token})`;
  probe.style.display = 'none';
  document.body.appendChild(probe);
  const color = getComputedStyle(probe).color;
  probe.remove();
  return color;
}

const themeColors = {
  brand: resolveCssColor('--color-brand'),
  brandActive: resolveCssColor('--color-brand-active'),
  brandBorder: resolveCssColor('--color-brand-border'),
  brandHover: resolveCssColor('--color-brand-hover'),
  brandSoft: resolveCssColor('--color-brand-soft'),
  brandSoftStrong: resolveCssColor('--color-brand-soft-strong'),
  controlBorder: resolveCssColor('--color-control-border'),
  danger: resolveCssColor('--color-danger'),
  neutral100: resolveCssColor('--color-neutral-100'),
  neutral500: resolveCssColor('--color-neutral-500'),
  neutral900: resolveCssColor('--color-neutral-900'),
  onBrand: resolveCssColor('--color-on-brand'),
  success: resolveCssColor('--color-success'),
  surfaceSubtle: resolveCssColor('--color-surface-subtle'),
  tabsActive: resolveCssColor('--color-tabs-active'),
  tabsHover: resolveCssColor('--color-tabs-hover'),
  tabsInk: resolveCssColor('--color-tabs-ink'),
  tabsSelected: resolveCssColor('--color-tabs-selected'),
  warning: resolveCssColor('--color-warning'),
};

const loadingElement = document.getElementById('loadingPage');
if (loadingElement) {
  loadingElement.remove();
}

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element not found');
}

createRoot(rootElement).render(
  <React.StrictMode>
    <ConfigProvider
      button={{ autoInsertSpace: false }}
      locale={zhCN}
      modal={{
        cancelButtonProps: { size: 'large' },
        centered: true,
        okButtonProps: { size: 'large' },
      }}
      theme={{
        components: {
          Button: {
            contentFontSizeLG: 13,
            controlHeightLG: 38,
            primaryColor: themeColors.onBrand,
          },
          Input: {
            borderRadius: 16,
            borderRadiusLG: 16,
            borderRadiusSM: 16,
            colorBorder: themeColors.neutral100,
            inputFontSizeLG: 13,
          },
          Menu: {
            darkItemColor: themeColors.neutral500,
            darkItemHoverBg: themeColors.brandSoft,
            darkItemSelectedBg: themeColors.brandSoftStrong,
            darkItemSelectedColor: themeColors.brandActive,
            itemHoverBg: themeColors.brandSoft,
            itemSelectedBg: themeColors.brandSoftStrong,
            itemSelectedColor: themeColors.brandActive,
          },
          Modal: {
            borderRadiusLG: 22,
          },
          Select: {
            borderRadius: 14,
            borderRadiusLG: 14,
            borderRadiusSM: 14,
            colorBorder: themeColors.controlBorder,
            fontSizeLG: 13,
          },
          Table: {
            cellPaddingBlock: 13,
            cellPaddingBlockMD: 13,
            cellPaddingBlockSM: 13,
          },
          Tabs: {
            inkBarColor: themeColors.tabsInk,
            itemActiveColor: themeColors.tabsActive,
            itemHoverColor: themeColors.tabsHover,
            itemSelectedColor: themeColors.tabsSelected,
          },
        },
        token: {
          colorBgLayout: themeColors.surfaceSubtle,
          colorError: themeColors.danger,
          colorInfo: themeColors.brand,
          colorPrimary: themeColors.brand,
          colorPrimaryActive: themeColors.brandActive,
          colorPrimaryHover: themeColors.brandHover,
          colorSuccess: themeColors.success,
          colorText: themeColors.neutral900,
          colorTextSecondary: themeColors.neutral500,
          colorWarning: themeColors.warning,
          controlItemBgActive: themeColors.brandSoftStrong,
          controlItemBgActiveHover: themeColors.brandBorder,
          controlItemBgHover: themeColors.brandSoft,
        },
      }}
    >
      <App />
    </ConfigProvider>
  </React.StrictMode>,
);
