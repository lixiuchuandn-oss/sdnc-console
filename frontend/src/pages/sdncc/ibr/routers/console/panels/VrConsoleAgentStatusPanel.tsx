import React, { useCallback, useEffect, useState } from 'react';
import { ReloadOutlined } from '@ant-design/icons';
import { Button, Spin, Tag, Typography } from 'antd';
import { getApiErrorMessage } from '../../../../../../services/api';
import {
	fetchIbrDeviceAgentStatus,
	type IbrDeviceAgentStatus,
} from '../../../../../../services/ibrDeviceOpsApi';
import { VrConsoleNoDevicePanel } from './VrConsoleNoDevicePanel';

type Props = {
	vrUuid: string;
	managementIp: string;
	/** 嵌入设备信息 Tab 时收紧外边距 */
	embedded?: boolean;
};

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<div className="ibr-console-info-row">
			<span className="ibr-console-info-label">{label}</span>
			<span className="ibr-console-info-value">{children}</span>
		</div>
	);
}

function jsonBlock(value: unknown, emptyText: string) {
	const text =
		value == null
			? emptyText
			: typeof value === 'string'
				? value
				: JSON.stringify(value, null, 2);
	return (
		<pre className="ibr-console-ops-pre ibr-console-ops-pre--scroll ibr-console-ops-pre--agent-json">{text}</pre>
	);
}

export const VrConsoleAgentStatusPanel: React.FC<Props> = ({
	vrUuid,
	managementIp,
	embedded = false,
}) => {
	const [loading, setLoading] = useState(true);
	const [refreshing, setRefreshing] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [status, setStatus] = useState<IbrDeviceAgentStatus | null>(null);

	const load = useCallback(async () => {
		setRefreshing(true);
		setError(null);
		try {
			const data = await fetchIbrDeviceAgentStatus(vrUuid, { skipCache: true });
			setStatus(data);
		} catch (e) {
			setError(getApiErrorMessage(e, '加载失败'));
		} finally {
			setLoading(false);
			setRefreshing(false);
		}
	}, [vrUuid]);

	useEffect(() => {
		setLoading(true);
		void load();
	}, [load]);

	if (!managementIp) {
		return <VrConsoleNoDevicePanel />;
	}

	const files = status?.download_files ?? [];

	const rootClass = embedded
		? 'ibr-console-device-info-agent'
		: 'ibr-console-ops-panel ibr-console-ops-panel--agent';

	return (
		<div className={rootClass}>
			<div className="ibr-console-ops-section">
				<div className="ibr-console-ops-section-head">
					<Typography.Text className="ibr-console-ops-section-title">注册与目录</Typography.Text>
					<Button
						type="text"
						className="ibr-console-ops-text-btn"
						icon={<ReloadOutlined spin={refreshing} />}
						onClick={() => void load()}
						disabled={refreshing}
					>
						刷新
					</Button>
				</div>
				<div className="ibr-console-ops-card">
					<Spin spinning={loading && !status}>
						{error && !status ? (
							<Typography.Paragraph type="danger" className="ibr-console-ops-error">
								{error}
							</Typography.Paragraph>
						) : null}
						<InfoRow label="Agent 目录">{status?.agent_base ?? '—'}</InfoRow>
						<InfoRow label="Download 目录">{status?.download_dir ?? '—'}</InfoRow>
						<InfoRow label="注册完成">
							{status?.registration_finish ? <Tag color="green">是</Tag> : <Tag>否</Tag>}
						</InfoRow>
						<InfoRow label="Download 文件数">{files.length}</InfoRow>
						<InfoRow label="Download 文件">{files.length ? files.join(', ') : '—'}</InfoRow>
					</Spin>
					{error && status ? (
						<Typography.Paragraph type="warning" className="ibr-console-ops-hint">
							刷新失败：{error}
						</Typography.Paragraph>
					) : null}
				</div>
			</div>

			<div className="ibr-console-ops-section">
				<div className="ibr-console-ops-section-head">
					<Typography.Text className="ibr-console-ops-section-title">vr_conf</Typography.Text>
				</div>
				<div className="ibr-console-ops-card">
					{jsonBlock(status?.vr_conf ?? null, '—')}
				</div>
			</div>

			<div className="ibr-console-ops-section">
				<div className="ibr-console-ops-section-head">
					<Typography.Text className="ibr-console-ops-section-title">NetJSON 快照</Typography.Text>
				</div>
				<div className="ibr-console-ops-card">
					{jsonBlock(status?.netjson ?? null, '（无 conf.json）')}
				</div>
			</div>
		</div>
	);
};
