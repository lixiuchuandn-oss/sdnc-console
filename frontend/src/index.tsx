import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ConfigProvider, App as AntdApp } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import './global-new.css';
import { clearChunkAutoReloadFlag } from './utils/chunkLoadError';

clearChunkAutoReloadFlag();

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);

root.render(
  <React.StrictMode>
    <ConfigProvider locale={zhCN}>
      <AntdApp>
        <App />
      </AntdApp>
    </ConfigProvider>
  </React.StrictMode>
);