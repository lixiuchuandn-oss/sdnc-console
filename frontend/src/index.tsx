import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ConfigProvider, App as AntdApp } from 'antd';
import './global.css';
import './global-new.css';

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);

root.render(
  <React.StrictMode>
    <ConfigProvider>
      <AntdApp>
        <App />
      </AntdApp>
    </ConfigProvider>
  </React.StrictMode>
);