import React from 'react';
import { IbrConsoleSegmented } from '../components/IbrConsoleSegmented';
import {
	HEALTH_CHECK_TABS,
	type VrConsoleHealthCheckTabId,
} from '../lib/healthCheckTabs';
import { VrConsoleSelfcheckPanel } from './VrConsoleSelfcheckPanel';
import { VrConsolePingPanel } from './VrConsolePingPanel';

type Props = {
	vrUuid: string;
	managementIp: string;
	activeTab: VrConsoleHealthCheckTabId;
	onTabChange: (tab: VrConsoleHealthCheckTabId) => void;
};

export const VrConsoleHealthCheckPanel: React.FC<Props> = ({
	vrUuid,
	managementIp,
	activeTab,
	onTabChange,
}) => {
	return (
		<div className="ibr-console-ops-panel ibr-console-ops-panel--health-check">
			<IbrConsoleSegmented
				tabs={HEALTH_CHECK_TABS.map((t) => ({ id: t.id, label: t.label }))}
				activeTab={activeTab}
				onChange={onTabChange}
				ariaLabel="健康巡检视图"
			/>
			<div className="ibr-console-health-tab-content">
				{activeTab === 'cli' ? (
					<VrConsoleSelfcheckPanel vrUuid={vrUuid} managementIp={managementIp} embedded />
				) : (
					<VrConsolePingPanel vrUuid={vrUuid} managementIp={managementIp} embedded />
				)}
			</div>
		</div>
	);
};
