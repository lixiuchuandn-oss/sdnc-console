import React from 'react';
import { VrConsoleJsonViewer } from '../components/VrConsoleJsonViewer';
import { IbrConsoleSegmented } from '../components/IbrConsoleSegmented';
import {
	DEVICE_INFO_TABS,
	type VrConsoleDeviceInfoTabId,
} from '../lib/deviceInfoTabs';
import { VrConsoleAgentStatusPanel } from './VrConsoleAgentStatusPanel';
import { VrConsoleLogsPanel } from './VrConsoleLogsPanel';

type Props = {
	vrUuid: string;
	managementIp: string;
	activeTab: VrConsoleDeviceInfoTabId;
	onTabChange: (tab: VrConsoleDeviceInfoTabId) => void;
	getJsonText: (tab: VrConsoleDeviceInfoTabId) => string;
	jsonLoading: boolean;
};

export const VrConsoleDeviceInfoPanel: React.FC<Props> = ({
	vrUuid,
	managementIp,
	activeTab,
	onTabChange,
	getJsonText,
	jsonLoading,
}) => {
	const activeDef = DEVICE_INFO_TABS.find((t) => t.id === activeTab) ?? DEVICE_INFO_TABS[0]!;

	return (
		<div className="ibr-console-ops-panel ibr-console-ops-panel--fill ibr-console-ops-panel--device-info">
			<IbrConsoleSegmented
				tabs={DEVICE_INFO_TABS.map((t) => ({ id: t.id, label: t.label }))}
				activeTab={activeTab}
				onChange={onTabChange}
				ariaLabel="设备信息视图"
				wrap
			/>
			<div className="ibr-console-ops-section ibr-console-ops-section--fill">
				{activeDef.kind === 'agent' ? (
					<VrConsoleAgentStatusPanel
						vrUuid={vrUuid}
						managementIp={managementIp}
						embedded
					/>
				) : activeDef.kind === 'logs' ? (
					<VrConsoleLogsPanel vrUuid={vrUuid} managementIp={managementIp} embedded />
				) : (
					<div className="ibr-console-ops-card ibr-console-ops-card--fill ibr-console-ops-card--json">
						<VrConsoleJsonViewer loading={jsonLoading} text={getJsonText(activeTab)} />
					</div>
				)}
			</div>
		</div>
	);
};
