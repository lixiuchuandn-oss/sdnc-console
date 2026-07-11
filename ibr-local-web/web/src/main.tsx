import 'antd/dist/reset.css';
import { ConfigProvider, theme } from 'antd';
import type { ConfigProviderProps } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';

type AppThemeConfig = NonNullable<ConfigProviderProps['theme']>;

ReactDOM.createRoot(document.getElementById('root')!).render(
	<React.StrictMode>
		<ConfigProvider
			locale={zhCN}
			theme={{
				algorithm: theme.defaultAlgorithm,
				token: {
					colorPrimary: '#111111',
					borderRadius: 8,
					colorBgLayout: '#f7f7f8',
					colorBorderSecondary: '#e8e8ea',
					fontFamily:
						'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
				},
				components: {
					Modal: {
						footerMarginTop: 0,
						bodyPadding: '10px 0 0 0',
					} as unknown as NonNullable<AppThemeConfig['components']>['Modal'],
				},
			}}
		>
			<BrowserRouter>
				<App />
			</BrowserRouter>
		</ConfigProvider>
	</React.StrictMode>,
);
