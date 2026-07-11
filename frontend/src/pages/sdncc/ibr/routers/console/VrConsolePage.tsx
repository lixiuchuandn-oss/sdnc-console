import React, { useCallback, useEffect, useMemo } from 'react';
import { Spin, Typography } from 'antd';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { VrConsoleTopbar } from './VrConsoleTopbar';
import { VrConsoleSidebar } from './VrConsoleSidebar';
import { VrConsoleMainHeader } from './components/VrConsoleMainHeader';
import { VrConsoleHealthCheckPanel } from './panels/VrConsoleHealthCheckPanel';
import { VrConsoleSetIpPanel } from './panels/VrConsoleSetIpPanel';
import { VrConsoleNicInitPanel } from './panels/VrConsoleNicInitPanel';
import { VrConsoleDashboardPanel } from './panels/VrConsoleDashboardPanel';
import { VrConsoleDeviceInfoPanel } from './panels/VrConsoleDeviceInfoPanel';
import { VrConsoleSshPanel } from './panels/VrConsoleSshPanel';
import { VrConsoleRoutesPanel } from './panels/VrConsoleRoutesPanel';
import { VrConsoleVrrpPanel } from './panels/VrConsoleVrrpPanel';
import { VrConsoleBgpNeighborsPanel } from './panels/VrConsoleBgpNeighborsPanel';
import { VrConsoleSrv6Panel } from './panels/VrConsoleSrv6Panel';
import { VrConsoleAclPanel } from './panels/VrConsoleAclPanel';
import { VrConsoleNatPanel } from './panels/VrConsoleNatPanel';
import { VrConsoleIpsecPanel } from './panels/VrConsoleIpsecPanel';
import {
	parseConsolePanel,
	panelDef,
	type VrConsolePanelId,
} from './lib/consolePanels';
import {
	deviceInfoTabDef,
	isDeviceInfoJsonTab,
	LEGACY_PANEL_TO_DEVICE_TAB,
	parseDeviceInfoTab,
	type VrConsoleDeviceInfoTabId,
} from './lib/deviceInfoTabs';
import {
	healthCheckTabDef,
	LEGACY_PANEL_TO_HEALTH_TAB,
	parseHealthCheckTab,
	type VrConsoleHealthCheckTabId,
} from './lib/healthCheckTabs';
import { useVrConsoleData } from './lib/useVrConsoleData';
import {
	deriveDeviceReachabilityFromCsm,
	deviceReachRootClass,
} from './lib/deviceReachability';
import { VrConsoleDeviceStrip } from './components/VrConsoleDeviceStrip';
import { VrConsoleRecentRail } from './components/VrConsoleRecentRail';
import { touchRecentVr } from './lib/vrConsoleRecent';
import { buildVbrasStripPresentation } from './lib/vbrasStripSummary';
import { buildSystemFooterPresentation } from './lib/systemFooterSummary';
import { VrConsoleSystemFooter } from './components/VrConsoleSystemFooter';

const VrConsolePage: React.FC = () => {
	const { uuid: routeUuid } = useParams<{ uuid: string }>();
	const vrUuid = String(routeUuid || '').trim();
	const navigate = useNavigate();
	const [searchParams, setSearchParams] = useSearchParams();

	const rawPanel = searchParams.get('panel');
	const activePanel = parseConsolePanel(rawPanel);
	const deviceInfoTab = parseDeviceInfoTab(searchParams.get('tab'));
	const healthCheckTab = parseHealthCheckTab(searchParams.get('tab'));
	const panel = panelDef(activePanel);

	const headerPanel = useMemo(() => {
		if (activePanel === 'ops-device-info') {
			const tab = deviceInfoTabDef(deviceInfoTab);
			return {
				...panel,
				label: tab.label,
				description: tab.description,
				sourceLabel: tab.sourceLabel,
			};
		}
		if (activePanel === 'ops-selfcheck') {
			const tab = healthCheckTabDef(healthCheckTab);
			return {
				...panel,
				label: tab.label,
				description: tab.description,
				sourceLabel: tab.sourceLabel,
			};
		}
		return panel;
	}, [activePanel, deviceInfoTab, healthCheckTab, panel]);

	const { loading, refreshing, metadata, summary, deviceStatus, deviceStatusLoading, getJsonText, jsonLoading, refresh } =
		useVrConsoleData(vrUuid, activePanel, deviceInfoTab);

	const reach = useMemo(
		() =>
			deriveDeviceReachabilityFromCsm({
				statusKey: summary.statusKey,
				statusLabel: summary.statusLabel,
				managementIp: summary.management_ip,
				loading: loading && !metadata,
			}),
		[summary.statusKey, summary.statusLabel, summary.management_ip, loading, metadata],
	);

	const vbrasStrip = useMemo(
		() =>
			buildVbrasStripPresentation(deviceStatus, {
				loading: deviceStatusLoading && reach.state !== 'no_mgmt',
			}),
		[deviceStatus, deviceStatusLoading, reach.state],
	);

	const systemFooter = useMemo(
		() =>
			reach.state === 'no_mgmt'
				? null
				: buildSystemFooterPresentation(deviceStatus, {
						loading: deviceStatusLoading,
					}),
		[deviceStatus, deviceStatusLoading, reach.state],
	);

	const rootClass = deviceReachRootClass(reach.state);

	const setDeviceInfoTab = useCallback(
		(tab: VrConsoleDeviceInfoTabId) => {
			setSearchParams((prev) => {
				const next = new URLSearchParams(prev);
				next.set('panel', 'ops-device-info');
				next.set('tab', tab);
				return next;
			});
		},
		[setSearchParams],
	);

	const setHealthCheckTab = useCallback(
		(tab: VrConsoleHealthCheckTabId) => {
			setSearchParams((prev) => {
				const next = new URLSearchParams(prev);
				next.set('panel', 'ops-selfcheck');
				next.set('tab', tab);
				return next;
			});
		},
		[setSearchParams],
	);

	const setPanel = useCallback(
		(id: VrConsolePanelId) => {
			setSearchParams((prev) => {
				const next = new URLSearchParams(prev);
				next.set('panel', id);
				if (id === 'ops-device-info') {
					if (!next.get('tab')) {
						next.set('tab', deviceInfoTab);
					}
				} else if (id === 'ops-selfcheck') {
					const rawTab = next.get('tab');
					if (!rawTab || !['cli', 'ping'].includes(rawTab)) {
						next.set('tab', healthCheckTab);
					}
				} else {
					next.delete('tab');
				}
				return next;
			});
		},
		[setSearchParams, deviceInfoTab, healthCheckTab],
	);

	useEffect(() => {
		const raw = String(rawPanel || '').trim();
		const deviceLegacy = LEGACY_PANEL_TO_DEVICE_TAB[raw];
		if (deviceLegacy) {
			setSearchParams(
				(prev) => {
					if (prev.get('panel') === 'ops-device-info') return prev;
					const next = new URLSearchParams(prev);
					next.set('panel', 'ops-device-info');
					next.set('tab', deviceLegacy);
					return next;
				},
				{ replace: true },
			);
			return;
		}
		const healthLegacy = LEGACY_PANEL_TO_HEALTH_TAB[raw];
		if (healthLegacy) {
			setSearchParams(
				(prev) => {
					if (prev.get('panel') === 'ops-selfcheck' && prev.get('tab') === healthLegacy) {
						return prev;
					}
					const next = new URLSearchParams(prev);
					next.set('panel', 'ops-selfcheck');
					next.set('tab', healthLegacy);
					return next;
				},
				{ replace: true },
			);
		}
	}, [rawPanel, setSearchParams]);

	const handleBack = useCallback(() => {
		if (window.opener && !window.opener.closed) {
			window.close();
			return;
		}
		navigate('/admin/interconnect/vr');
	}, [navigate]);

	useEffect(() => {
		document.body.classList.add('ibr-console-standalone-body');
		return () => {
			document.body.classList.remove('ibr-console-standalone-body');
		};
	}, []);

	useEffect(() => {
		const prev = document.title;
		const reachSuffix =
			reach.state === 'running'
				? ' · 运行中'
				: reach.state === 'unreachable'
					? ' · 离线'
					: reach.state === 'degraded'
						? ' · 告警'
						: '';
		document.title =
			summary.name && summary.name !== '—'
				? `IBR 控制台 · ${summary.name}${reachSuffix}`
				: 'IBR 运维控制台';
		return () => {
			document.title = prev;
		};
	}, [summary.name, reach.state]);

	useEffect(() => {
		if (!vrUuid || loading) return;
		if (!summary.uuid || summary.uuid === '—') return;
		touchRecentVr({
			uuid: summary.uuid,
			name: summary.name,
			managementIp: summary.management_ip,
			role: summary.role,
		});
	}, [
		vrUuid,
		loading,
		summary.uuid,
		summary.name,
		summary.management_ip,
		summary.role,
	]);

	const mainContent = useMemo(() => {
		if (!vrUuid) {
			return (
				<div className="ibr-console-placeholder">
					<Typography.Text className="ibr-console-placeholder-desc">缺少 IBR UUID</Typography.Text>
				</div>
			);
		}
		if (loading && !metadata && activePanel === 'ops-device-info' && isDeviceInfoJsonTab(deviceInfoTab)) {
			return (
				<div className="ibr-console-json-loading">
					<Spin tip="加载中…" />
				</div>
			);
		}
		if (activePanel === 'ops-dashboard') {
			return (
				<VrConsoleDashboardPanel
					vrUuid={vrUuid}
					managementIp={summary.management_ip}
					onGoPanel={setPanel}
					onGoDeviceInfoTab={setDeviceInfoTab}
				/>
			);
		}
		if (activePanel === 'ops-device-info') {
			return (
				<VrConsoleDeviceInfoPanel
					vrUuid={vrUuid}
					managementIp={summary.management_ip}
					activeTab={deviceInfoTab}
					onTabChange={setDeviceInfoTab}
					getJsonText={getJsonText}
					jsonLoading={jsonLoading}
				/>
			);
		}
		if (activePanel === 'ops-selfcheck') {
			return (
				<VrConsoleHealthCheckPanel
					vrUuid={vrUuid}
					managementIp={summary.management_ip}
					activeTab={healthCheckTab}
					onTabChange={setHealthCheckTab}
				/>
			);
		}
		if (activePanel === 'ops-set-ip') {
			return <VrConsoleSetIpPanel vrUuid={vrUuid} managementIp={summary.management_ip} />;
		}
		if (activePanel === 'ops-nic-init') {
			return <VrConsoleNicInitPanel vrUuid={vrUuid} managementIp={summary.management_ip} />;
		}
		if (activePanel === 'fwd-vrrp') {
			return (
				<VrConsoleVrrpPanel vrUuid={vrUuid} managementIp={summary.management_ip} />
			);
		}
		if (activePanel === 'fwd-routes') {
			return (
				<VrConsoleRoutesPanel vrUuid={vrUuid} managementIp={summary.management_ip} />
			);
		}
		if (activePanel === 'fwd-bgp') {
			return (
				<VrConsoleBgpNeighborsPanel vrUuid={vrUuid} managementIp={summary.management_ip} />
			);
		}
		if (activePanel === 'fwd-srv6') {
			return (
				<VrConsoleSrv6Panel vrUuid={vrUuid} managementIp={summary.management_ip} />
			);
		}
		if (activePanel === 'fwd-acl') {
			return (
				<VrConsoleAclPanel vrUuid={vrUuid} managementIp={summary.management_ip} />
			);
		}
		if (activePanel === 'fwd-nat') {
			return (
				<VrConsoleNatPanel vrUuid={vrUuid} managementIp={summary.management_ip} />
			);
		}
		if (activePanel === 'fwd-ipsec') {
			return (
				<VrConsoleIpsecPanel vrUuid={vrUuid} managementIp={summary.management_ip} />
			);
		}
		if (activePanel === 'ssh') {
			return (
				<VrConsoleSshPanel managementIp={summary.management_ip} vrName={summary.name} />
			);
		}
		return null;
	}, [
		vrUuid,
		loading,
		metadata,
		activePanel,
		getJsonText,
		jsonLoading,
		deviceInfoTab,
		healthCheckTab,
		setDeviceInfoTab,
		setHealthCheckTab,
		summary.management_ip,
		summary.name,
		setPanel,
	]);

	if (!vrUuid) {
		return (
			<div className="ibr-console-root ibr-console-root--standalone">
				<div className="ibr-console-placeholder">
					<Typography.Text className="ibr-console-placeholder-desc">无效的 IBR 实例地址</Typography.Text>
				</div>
			</div>
		);
	}

	return (
		<div className={`ibr-console-root ibr-console-root--standalone ${rootClass}`.trim()}>
			<VrConsoleTopbar
				name={summary.name}
				uuid={summary.uuid}
				role={summary.role}
				managementIp={summary.management_ip}
				version={summary.version}
				refreshing={refreshing}
				onBack={handleBack}
				onRefresh={() => void refresh()}
			/>
			<VrConsoleDeviceStrip reach={reach} vbras={vbrasStrip} />
			<div className="ibr-console-body">
				<VrConsoleRecentRail
					currentUuid={vrUuid}
					activePanel={activePanel}
					deviceInfoTab={activePanel === 'ops-device-info' ? deviceInfoTab : undefined}
					healthCheckTab={activePanel === 'ops-selfcheck' ? healthCheckTab : undefined}
				/>
				<VrConsoleSidebar
					activePanel={activePanel}
					managementIp={summary.management_ip}
					onSelect={setPanel}
				/>
				<main className="ibr-console-main">
					<VrConsoleMainHeader
						panel={headerPanel}
						vrUuid={vrUuid}
						managementIp={summary.management_ip}
					/>
					<div className="ibr-console-main-content">{mainContent}</div>
				</main>
			</div>
			<VrConsoleSystemFooter presentation={systemFooter} />
		</div>
	);
};

export default VrConsolePage;
