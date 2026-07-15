import React, { useMemo, useState } from 'react';
import { Button, Input, InputNumber, Space, Tag, Typography, message } from 'antd';
import { CopyOutlined } from '@ant-design/icons';
import {
	fetchIbrDevicePing,
	type IbrDevicePingResult,
} from '../../../../../../services/ibrDeviceOpsApi';
import { getApiErrorMessage } from '../../../../../../services/api';
import { VrConsoleNoDevicePanel } from './VrConsoleNoDevicePanel';

const QUICK_TARGETS = [
	{ label: '114 DNS', value: '114.114.114.114' },
	{ label: '阿里 DNS', value: '223.5.5.5' },
	{ label: 'Google', value: '8.8.8.8' },
];

type Props = {
	vrUuid: string;
	managementIp: string;
	/** 嵌入健康巡检 Tab 时不包外层 panel */
	embedded?: boolean;
};

export const VrConsolePingPanel: React.FC<Props> = ({
	vrUuid,
	managementIp,
	embedded = false,
}) => {
	const [target, setTarget] = useState('');
	const [repeat, setRepeat] = useState(4);
	const [running, setRunning] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [result, setResult] = useState<IbrDevicePingResult | null>(null);

	const mgmtHost = useMemo(() => managementIp.split('/')[0]?.trim() ?? '', [managementIp]);

	const run = async () => {
		const ip = target.trim();
		if (!ip) {
			setError('请输入目标 IPv4 地址');
			return;
		}
		setRunning(true);
		setError(null);
		setResult(null);
		try {
			const data = await fetchIbrDevicePing(vrUuid, { target: ip, repeat });
			setResult(data);
		} catch (e) {
			setError(getApiErrorMessage(e, '探测失败'));
		} finally {
			setRunning(false);
		}
	};

	const copyRaw = async () => {
		if (!result?.raw) return;
		try {
			await navigator.clipboard.writeText(result.raw);
			message.success('已复制输出');
		} catch {
			message.error('复制失败');
		}
	};

	if (!managementIp) {
		return <VrConsoleNoDevicePanel />;
	}

	const formSection = (
		<div className="ibr-console-ops-section">
			<div className="ibr-console-ops-section-head">
				<Typography.Text className="ibr-console-ops-section-title">探测参数</Typography.Text>
				<Button type="primary" onClick={() => void run()} loading={running}>
					开始 Ping
				</Button>
			</div>
			<div className="ibr-console-ops-card">
				<Space wrap align="start">
					<Input
						className="ibr-console-ops-input"
						placeholder="目标 IPv4（例如 8.8.8.8）"
						style={{ width: 220 }}
						value={target}
						onChange={(e) => setTarget(e.target.value)}
						onPressEnter={() => void run()}
						disabled={running}
					/>
					<InputNumber
						className="ibr-console-ops-input-number"
						min={1}
						max={10}
						value={repeat}
						onChange={(v) => setRepeat(typeof v === 'number' ? v : 4)}
						disabled={running}
						addonBefore="次数"
					/>
					{result ? (
						result.ok ? (
							<Tag color="green">可达</Tag>
						) : (
							<Tag color="red">不可达</Tag>
						)
					) : null}
				</Space>
				<div className="ibr-console-quick-tags">
					<span className="ibr-console-quick-tags-label">快捷目标</span>
					{QUICK_TARGETS.map((t) => (
						<button
							key={t.value}
							type="button"
							className="ibr-console-quick-tag"
							disabled={running}
							onClick={() => setTarget(t.value)}
						>
							{t.label}
						</button>
					))}
					{mgmtHost ? (
						<button
							type="button"
							className="ibr-console-quick-tag"
							disabled={running}
							onClick={() => setTarget(mgmtHost)}
						>
							本机管理口
						</button>
					) : null}
				</div>
				{!embedded ? (
					<Typography.Paragraph className="ibr-console-ops-hint">
						经设备 local-web 执行 clish{' '}
						<code>do ping &lt;target&gt;</code>（konfd.socket），非整机操作系统 ping。
					</Typography.Paragraph>
				) : null}
				{error ? (
					<Typography.Paragraph type="danger" className="ibr-console-ops-error">
						{error}
					</Typography.Paragraph>
				) : null}
			</div>
		</div>
	);

	const resultSection =
		result ? (
			<div className="ibr-console-ops-section">
				<div className="ibr-console-ops-section-head">
					<Typography.Text className="ibr-console-ops-section-title">探测结果</Typography.Text>
					<Button icon={<CopyOutlined />} onClick={() => void copyRaw()} disabled={!result.raw}>
						复制输出
					</Button>
				</div>
				<div className="ibr-console-ops-card">
					<div className="ibr-console-stat-row">
						<span className="ibr-console-stat-chip">
							命令 <code>{result.command}</code>
						</span>
						{result.stats ? (
							<>
								<span className="ibr-console-stat-chip is-pass">
									收包 {result.stats.received ?? '—'} / {result.stats.sent ?? '—'}
								</span>
								{result.stats.packetLoss ? (
									<span className="ibr-console-stat-chip is-warn">丢包 {result.stats.packetLoss}</span>
								) : null}
							</>
						) : null}
					</div>
					{result.error ? (
						<Typography.Paragraph type="danger" className="ibr-console-ops-error">
							{result.error}
						</Typography.Paragraph>
					) : null}
					<pre className="ibr-console-ops-pre ibr-console-ops-pre--scroll">
						{result.raw?.trim() || '（无输出）'}
					</pre>
				</div>
			</div>
		) : null;

	if (embedded) {
		return (
			<>
				{formSection}
				{resultSection}
			</>
		);
	}

	return (
		<div className="ibr-console-ops-panel">
			{formSection}
			{resultSection}
		</div>
	);
};
