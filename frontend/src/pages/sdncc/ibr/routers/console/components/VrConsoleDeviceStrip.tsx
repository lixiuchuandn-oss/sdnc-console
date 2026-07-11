import React from 'react';
import { Tooltip } from 'antd';
import type { DeviceReachability, DeviceReachState } from '../lib/deviceReachability';
import type { VbrasStripPresentation } from '../lib/vbrasStripSummary';

type Props = {
	reach: DeviceReachability;
	vbras?: VbrasStripPresentation | null;
};

function stripClass(state: DeviceReachState): string {
	return `ibr-console-device-strip is-${state}`;
}

function dotClass(state: DeviceReachState): string {
	return `ibr-console-device-dot is-${state}`;
}

export const VrConsoleDeviceStrip: React.FC<Props> = ({ reach, vbras }) => {
	if (reach.state === 'no_mgmt') {
		return (
			<div className={stripClass('no_mgmt')}>
				<span className={dotClass('no_mgmt')} aria-hidden />
				<span className="ibr-console-device-strip-label">设备未接入</span>
			</div>
		);
	}

	return (
		<div className={stripClass(reach.state)}>
			<span className={dotClass(reach.state)} aria-hidden />
			<span className="ibr-console-device-strip-label">{reach.label}</span>
			{vbras ? (
				<>
					<span className="ibr-console-device-strip-sep" aria-hidden />
					<Tooltip title={<span style={{ whiteSpace: 'pre-line' }}>{vbras.tooltip}</span>}>
						<span className="ibr-console-device-strip-meta ibr-console-device-strip-vbras">
							{vbras.line}
						</span>
					</Tooltip>
				</>
			) : null}
		</div>
	);
};
