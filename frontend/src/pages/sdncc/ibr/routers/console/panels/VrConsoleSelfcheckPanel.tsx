import React, { useMemo, useState } from 'react';
import { FileTextOutlined } from '@ant-design/icons';
import { Button, Space, Spin, Tag, Typography } from 'antd';
import { getApiErrorMessage } from '../../../../../../services/api';
import {
	fetchIbrDeviceSelfcheck,
	type IbrDeviceSelfcheckResult,
} from '../../../../../../services/ibrDeviceOpsApi';
import { VrConsoleNoDevicePanel } from './VrConsoleNoDevicePanel';

type Props = {
	vrUuid: string;
	managementIp: string;
	/** 嵌入健康巡检 Tab 时不包外层 panel */
	embedded?: boolean;
};

type CheckStatus = 'pass' | 'warning' | 'fail';

function statusTag(status: CheckStatus) {
	if (status === 'pass') return <Tag color="green">通过</Tag>;
	if (status === 'warning') return <Tag color="orange">告警</Tag>;
	return <Tag color="red">失败</Tag>;
}

function statusDotClass(status: CheckStatus): string {
	if (status === 'pass') return ' is-ok';
	if (status === 'warning') return ' is-soft-warn';
	return ' is-warn';
}

function summarizeChecks(checks: Array<{ status: CheckStatus }> | undefined) {
	if (!Array.isArray(checks)) return null;
	return {
		pass: checks.filter((c) => c.status === 'pass').length,
		warning: checks.filter((c) => c.status === 'warning').length,
		fail: checks.filter((c) => c.status === 'fail').length,
	};
}

export const VrConsoleSelfcheckPanel: React.FC<Props> = ({
	vrUuid,
	managementIp,
	embedded = false,
}) => {
	const [running, setRunning] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [result, setResult] = useState<IbrDeviceSelfcheckResult | null>(null);
	const [rawOpen, setRawOpen] = useState(false);

	const checks = useMemo(
		() => (Array.isArray(result?.checks) ? result!.checks! : []),
		[result],
	);
	const summary = useMemo(() => summarizeChecks(checks), [checks]);

	const run = async () => {
		setRunning(true);
		setError(null);
		setResult(null);
		setRawOpen(false);
		try {
			const data = await fetchIbrDeviceSelfcheck(vrUuid);
			setResult(data);
		} catch (e) {
			setError(getApiErrorMessage(e, '巡检失败'));
		} finally {
			setRunning(false);
		}
	};

	if (!managementIp) {
		return <VrConsoleNoDevicePanel />;
	}

	const overallTag =
		result && !running ? (
			result.ok ? (
				<Tag color="green">整体通过</Tag>
			) : (
				<Tag color="red">存在异常</Tag>
			)
		) : null;

	const body = (
		<div className="ibr-console-ops-section">
			<div className="ibr-console-ops-section-head">
				<Typography.Text className="ibr-console-ops-section-title">检查项</Typography.Text>
				<Space wrap align="center">
					{overallTag}
					{result?.raw ? (
						<Button
							type="text"
							className="ibr-console-ops-text-btn"
							icon={<FileTextOutlined />}
							onClick={() => setRawOpen((v) => !v)}
						>
							{rawOpen ? '收起输出' : '原始输出'}
						</Button>
					) : null}
					<Button type="primary" onClick={() => void run()} loading={running}>
						{result ? '重新巡检' : '开始巡检'}
					</Button>
				</Space>
			</div>
			<div className="ibr-console-ops-card">
				{running ? (
					<div className="ibr-console-ops-loading-inline">
						<Spin size="small" />
						<span>正在执行 show version / interface / plugin / error…</span>
					</div>
				) : null}

				{error ? (
					<Typography.Paragraph type="danger" className="ibr-console-ops-error">
						{error}
					</Typography.Paragraph>
				) : null}

				{!running && result?.reasons && result.reasons.length > 0 ? (
					<Typography.Paragraph type="danger" className="ibr-console-ops-error">
						{result.reasons.join('；')}
					</Typography.Paragraph>
				) : null}

				{!running && summary ? (
					<div className="ibr-console-stat-row">
						<span className="ibr-console-stat-chip is-pass">通过 {summary.pass}</span>
						<span className="ibr-console-stat-chip is-warn">告警 {summary.warning}</span>
						<span className="ibr-console-stat-chip is-fail">失败 {summary.fail}</span>
					</div>
				) : null}

				{!running && checks.length > 0 ? (
					<div className="ibr-console-selfcheck-list">
						{checks.map((c) => (
							<div key={c.name} className="ibr-console-selfcheck-row">
								<div className="ibr-console-selfcheck-row-main">
									<span
										className={`ibr-console-dash-health-dot${statusDotClass(c.status)}`}
										aria-hidden
									/>
									<span className="ibr-console-selfcheck-name">{c.name}</span>
									{statusTag(c.status)}
								</div>
								<span className="ibr-console-selfcheck-detail">{c.detail}</span>
							</div>
						))}
					</div>
				) : null}

				{rawOpen && result?.raw ? (
					<pre className="ibr-console-ops-pre ibr-console-ops-pre--inline">{result.raw}</pre>
				) : null}

				{!running && !result && !error ? (
					<Typography.Paragraph className="ibr-console-ops-empty">
						点击「开始巡检」拉取 vbras CLI 自检结果。
					</Typography.Paragraph>
				) : null}
			</div>
		</div>
	);

	if (embedded) {
		return body;
	}

	return (
		<div className="ibr-console-ops-panel ibr-console-ops-panel--selfcheck">
			<div className="ibr-console-ops-section">{body}</div>
		</div>
	);
};
