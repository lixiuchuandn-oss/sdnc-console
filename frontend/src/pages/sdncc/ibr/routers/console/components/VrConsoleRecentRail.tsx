import React, { useCallback, useEffect, useState } from 'react';
import { Tooltip } from 'antd';
import { HistoryOutlined, LeftOutlined, RightOutlined } from '@ant-design/icons';
import type { VrConsolePanelId } from '../lib/consolePanels';
import { readRecentVrs, subscribeRecentVrs } from '../lib/vrConsoleRecent';
import { VrConsoleRecentList } from './VrConsoleRecentList';

const COLLAPSE_STORAGE_KEY = 'sdnc.ibr-console.recent-rail-collapsed';

function readRailCollapsed(): boolean {
	if (typeof window === 'undefined') return true;
	try {
		const raw = window.localStorage.getItem(COLLAPSE_STORAGE_KEY);
		if (raw === '0') return false;
		return true;
	} catch {
		return true;
	}
}

function persistRailCollapsed(collapsed: boolean): void {
	if (typeof window === 'undefined') return;
	try {
		window.localStorage.setItem(COLLAPSE_STORAGE_KEY, collapsed ? '1' : '0');
	} catch {
		/* ignore */
	}
}

type Props = {
	currentUuid: string;
	activePanel: VrConsolePanelId;
	deviceInfoTab?: import('../lib/deviceInfoTabs').VrConsoleDeviceInfoTabId;
	healthCheckTab?: import('../lib/healthCheckTabs').VrConsoleHealthCheckTabId;
};

/** IBR 运维控制台 · 左侧历史访问栏（可折叠） */
export const VrConsoleRecentRail: React.FC<Props> = (props) => {
	const [visible, setVisible] = useState(() => readRecentVrs().length > 0);
	const [collapsed, setCollapsed] = useState(readRailCollapsed);
	const [count, setCount] = useState(() => readRecentVrs().length);

	useEffect(() => {
		const sync = () => {
			const list = readRecentVrs();
			setCount(list.length);
			setVisible(list.length > 0);
		};
		sync();
		return subscribeRecentVrs(sync);
	}, []);

	const toggleCollapsed = useCallback(() => {
		setCollapsed((prev) => {
			const next = !prev;
			persistRailCollapsed(next);
			return next;
		});
	}, []);

	if (!visible) return null;

	return (
		<aside
			className={`ibr-console-recent-rail${collapsed ? ' is-collapsed' : ''}`}
			aria-label="历史访问"
		>
			<div className="ibr-console-recent-rail__head">
				{!collapsed ? (
					<div className="ibr-console-recent-rail__brand">
						<HistoryOutlined className="ibr-console-recent-rail__brand-icon" aria-hidden />
						<span className="ibr-console-recent-rail__title">
							<span className="ibr-console-recent-rail__title-mark">//</span>
							历史访问
						</span>
						{count > 0 ? (
							<span className="ibr-console-recent-rail__count" aria-label={`${count} 条记录`}>
								{count}
							</span>
						) : null}
					</div>
				) : null}
				<div className="ibr-console-recent-rail__toggle-wrap">
					<Tooltip title={collapsed ? '展开历史访问' : '折叠历史访问'} placement="right">
						<button
							type="button"
							className="ibr-console-recent-rail__toggle"
							onClick={toggleCollapsed}
							aria-expanded={!collapsed}
							aria-label={collapsed ? '展开历史访问' : '折叠历史访问'}
						>
							{collapsed ? <RightOutlined /> : <LeftOutlined />}
						</button>
					</Tooltip>
				</div>
			</div>
			<VrConsoleRecentList {...props} collapsed={collapsed} />
		</aside>
	);
};
