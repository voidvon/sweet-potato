import React from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import 'antd/dist/reset.css';
import App from './App';
import './styles.scss';

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
    <ConfigProvider locale={zhCN} modal={{ centered: true }}>
      <App />
    </ConfigProvider>
  </React.StrictMode>,
);
