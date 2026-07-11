import React, { useCallback, useEffect, useState } from 'react';
import { Tooltip } from 'antd';
import { CloseOutlined, DesktopOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { buildIbrConsoleUrl } from '../../../lib/ibrLocalWebUrl';
import type { VrConsolePanelId } from '../lib/consolePanels';
import type { VrConsoleDeviceInfoTabId } from '../lib/deviceInfoTabs';
import type { VrConsoleHealthCheckTabId } from '../lib/healthCheckTabs';
import {
	managementHostIp,
	readRecentVrs,
	removeRecentVr,
	subscribeRecentVrs,
	type VrConsoleRecentEntry,
} from '../lib/vrConsoleRecent';

type Props = {
	currentUuid: string;
	activePanel: VrConsolePanelId;
	deviceInfoTab?: VrConsoleDeviceInfoTabId;
	healthCheckTab?: VrConsoleHealthCheckTabId;
	collapsed?: boolean;
};

function shortUuid(uuid: string): string {
	const id = String(uuid || '').trim();
	if (id.length <= 10) return id;
	return `${id.slice(0, 8)}…`;
}

function roleLabel(role?: string): string {
	return String(role || '').trim();
}

export const VrConsoleRecentList: React.FC<Props> = ({
	currentUuid,
	activePanel,
	deviceInfoTab,
	healthCheckTab,
	collapsed = false,
}) => {
	const navigate = useNavigate();
	const [items, setItems] = useState<VrConsoleRecentEntry[]>(() => readRecentVrs());

	useEffect(() => {
		setItems(readRecentVrs());
		return subscribeRecentVrs(() => setItems(readRecentVrs()));
	}, []);

	const switchTo = useCallback(
		(uuid: string) => {
			const id = String(uuid || '').trim();
			if (!id || id === currentUuid) return;
			const path = buildIbrConsoleUrl(
				id,
				activePanel,
				activePanel === 'ops-device-info'
					? deviceInfoTab
					: activePanel === 'ops-selfcheck'
						? healthCheckTab
						: undefined,
			);
			if (path) navigate(path);
		},
		[activePanel, currentUuid, navigate, deviceInfoTab, healthCheckTab],
	);

	const removeItem = useCallback((uuid: string, event: React.MouseEvent) => {
		event.preventDefault();
		event.stopPropagation();
		removeRecentVr(uuid);
	}, []);

	if (items.length === 0) return null;

	return (
		<nav
			className={`ibr-console-recent-scroll${collapsed ? ' is-collapsed' : ''}`}
			aria-label="历史访问列表"
		>
			<ul className="ibr-console-recent-list">
				{items.map((item) => {
					const active = item.uuid === currentUuid;
					const ip = managementHostIp(item.managementIp);
					const hostLine = ip || shortUuid(item.uuid);
					const role = roleLabel(item.role);
					const tooltip = ip
						? `${item.name} · ${ip}${role ? ` · ${item.role}` : ''}`
						: `${item.name} · ${shortUuid(item.uuid)}`;

					if (collapsed) {
						return (
							<li key={item.uuid} className="ibr-console-recent-list__item">
								<div className={`ibr-console-recent-node${active ? ' is-active' : ''}`}>
									<Tooltip title={tooltip} placement="right">
										<button
											type="button"
											className="ibr-console-recent-node__main"
											onClick={() => switchTo(item.uuid)}
											disabled={active}
											aria-current={active ? 'page' : undefined}
											aria-label={tooltip}
										>
											<span className="ibr-console-recent-node__ring" aria-hidden />
											<DesktopOutlined className="ibr-console-recent-node__icon" aria-hidden />
											{active ? <span className="ibr-console-recent-node__pulse" aria-hidden /> : null}
										</button>
									</Tooltip>
									<Tooltip title="从历史访问移除" placement="right">
										<button
											type="button"
											className="ibr-console-recent-node__remove"
											onClick={(e) => removeItem(item.uuid, e)}
											aria-label={`移除 ${item.name}`}
										>
											<CloseOutlined aria-hidden />
										</button>
									</Tooltip>
								</div>
							</li>
						);
					}

					return (
						<li key={item.uuid} className="ibr-console-recent-list__item">
							<div className={`ibr-console-recent-card${active ? ' is-active' : ''}`}>
								<button
									type="button"
									className="ibr-console-recent-card__main"
									onClick={() => switchTo(item.uuid)}
									disabled={active}
									aria-current={active ? 'page' : undefined}
									aria-label={tooltip}
								>
									<span className="ibr-console-recent-card__glow" aria-hidden />
									<span className="ibr-console-recent-card__rail" aria-hidden />
									<span className="ibr-console-recent-card__body">
										<span className="ibr-console-recent-card__head">
											<span
												className={`ibr-console-recent-card__beacon${active ? ' is-live' : ''}`}
												aria-hidden
											/>
											<span className="ibr-console-recent-card__name">{item.name}</span>
										</span>
										<span className="ibr-console-recent-card__meta">
											<span className="ibr-console-recent-card__prompt" aria-hidden>
												&gt;
											</span>
											{role ? (
												<span className="ibr-console-recent-card__role">{role}</span>
											) : null}
											<span className="ibr-console-recent-card__host">{hostLine}</span>
										</span>
									</span>
								</button>
								<Tooltip title="从历史访问移除">
									<button
										type="button"
										className="ibr-console-recent-card__remove"
										onClick={(e) => removeItem(item.uuid, e)}
										aria-label={`移除 ${item.name}`}
									>
										<CloseOutlined aria-hidden />
									</button>
								</Tooltip>
							</div>
						</li>
					);
				})}
			</ul>
		</nav>
	);
};
