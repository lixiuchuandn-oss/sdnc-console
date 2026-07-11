import React, { useCallback, useState } from 'react';
import { Button, Typography, message } from 'antd';
import { getApiErrorMessage } from '../../../../../../services/api';
import { fetchIbrForwardingRunningConfig } from '../../../../../../services/ibrDeviceOpsApi';
import { ForwardTextDrawer } from '../lib/forwardPanelUi';
import type { VrConsolePanelDef } from '../lib/consolePanels';

type Props = {
	panel: VrConsolePanelDef;
	vrUuid: string;
	managementIp: string;
};

export const VrConsoleMainHeader: React.FC<Props> = ({ panel, vrUuid, managementIp }) => {
	const [runningConfigLoading, setRunningConfigLoading] = useState(false);
	const [runningConfigOpen, setRunningConfigOpen] = useState(false);
	const [runningConfigText, setRunningConfigText] = useState('');

	const openRunningConfig = useCallback(async () => {
		if (!vrUuid || !managementIp) return;
		setRunningConfigLoading(true);
		try {
			const data = await fetchIbrForwardingRunningConfig(vrUuid, { skipCache: true });
			if (data.error) throw new Error(data.error);
			setRunningConfigText(typeof data.raw === 'string' ? data.raw : '');
			setRunningConfigOpen(true);
		} catch (e) {
			message.error(getApiErrorMessage(e, '加载 running-config 失败'));
		} finally {
			setRunningConfigLoading(false);
		}
	}, [managementIp, vrUuid]);

	return (
		<>
			<div className="ibr-console-main-header">
				<div className="ibr-console-main-header-left">
					<Typography.Text className="ibr-console-main-title">{panel.label}</Typography.Text>
					{panel.description ? (
						<Typography.Text className="ibr-console-main-desc" ellipsis={{ tooltip: panel.description }}>
							{panel.description}
						</Typography.Text>
					) : null}
				</div>
				<div className="ibr-console-main-header-right">
					{managementIp ? (
						<Button
							type="default"
							size="small"
							className="ibr-console-main-running-config-btn"
							loading={runningConfigLoading}
							onClick={() => void openRunningConfig()}
						>
							完整 running-config
						</Button>
					) : null}
					{!panel.ready ? <span className="ibr-console-main-hint">即将开放</span> : null}
				</div>
			</div>

			<ForwardTextDrawer
				title="完整 running-config"
				open={runningConfigOpen}
				onClose={() => setRunningConfigOpen(false)}
				text={runningConfigText}
			/>
		</>
	);
};
