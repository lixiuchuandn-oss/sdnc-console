import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Spin, Typography, message } from 'antd';
import { fetchIbrDeviceLogs } from '../../../../../../services/ibrDeviceOpsApi';
import { VrConsoleNoDevicePanel } from './VrConsoleNoDevicePanel';

type Props = {
	vrUuid: string;
	managementIp: string;
	/** 嵌入设备信息 Tab 时收紧外边距 */
	embedded?: boolean;
};

function formatTime(d: Date): string {
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export const VrConsoleLogsPanel: React.FC<Props> = ({ vrUuid, managementIp, embedded = false }) => {
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [text, setText] = useState('');
	const [loadedAt, setLoadedAt] = useState<string | null>(null);
	const preRef = useRef<HTMLPreElement>(null);

	const lineCount = text ? text.split('\n').length : 0;

	const load = useCallback(async () => {
		if (!managementIp) {
			setLoading(false);
			return;
		}
		setLoading(true);
		setError(null);
		try {
			const s = await fetchIbrDeviceLogs(vrUuid);
			setText(s);
			setLoadedAt(formatTime(new Date()));
		} catch (e) {
			setError(e instanceof Error ? e.message : '加载失败');
			setText('');
			setLoadedAt(null);
		} finally {
			setLoading(false);
		}
	}, [vrUuid, managementIp]);

	useEffect(() => {
		void load();
	}, [load]);

	useEffect(() => {
		if (!loading && preRef.current && text) {
			preRef.current.scrollTop = preRef.current.scrollHeight;
		}
	}, [loading, text]);

	const copy = async () => {
		try {
			await navigator.clipboard.writeText(text || '');
			message.success('已复制');
		} catch {
			message.error('复制失败');
		}
	};

	if (!managementIp) {
		return <VrConsoleNoDevicePanel />;
	}

	const rootClass = embedded
		? 'ibr-console-device-info-logs'
		: 'ibr-console-ops-panel ibr-console-ops-panel--fill';

	return (
		<div className={rootClass}>
			<div className="ibr-console-ops-section ibr-console-ops-section--fill">
				<div className="ibr-console-ops-section-head">
					<div>
						<Typography.Text className="ibr-console-ops-section-title">VBRAS 日志</Typography.Text>
						{loadedAt ? (
							<Typography.Text className="ibr-console-ops-meta">
								{lineCount} 行 · 更新于 {loadedAt}
							</Typography.Text>
						) : null}
					</div>
					<div className="ibr-console-ops-actions">
						<Button onClick={() => void load()} loading={loading}>
							刷新
						</Button>
						<Button onClick={() => void copy()} disabled={!text || loading}>
							复制
						</Button>
					</div>
				</div>
				<div className="ibr-console-ops-card ibr-console-ops-card--fill">
					{error ? (
						<Typography.Paragraph type="danger" className="ibr-console-ops-error">
							{error}
						</Typography.Paragraph>
					) : null}
					{loading && !text ? (
						<div className="ibr-console-ops-loading">
							<Spin tip="拉取 journal 日志…" />
						</div>
					) : (
						<pre ref={preRef} className="ibr-console-ops-pre ibr-console-ops-pre--scroll ibr-console-ops-pre--fill">
							{text?.trim() ? text : '（暂无日志输出）'}
						</pre>
					)}
				</div>
			</div>
		</div>
	);
};
