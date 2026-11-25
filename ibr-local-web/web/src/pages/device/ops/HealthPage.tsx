import { Button, Drawer, Input, Space, Tag, Typography } from 'antd';
import { useState } from 'react';
import { api } from '../../../api/client';
import { BlockHeader } from '../../../components/BlockHeader';
import { Card } from '../../../components/Card';
import { ContentBlock } from '../../../components/ContentBlock';
import { PageHeader } from '../../../components/PageHeader';
import { PageStack } from '../../../components/PageStack';

type ConnectivityPingResp = {
	ok: boolean;
	target?: string;
	raw?: string;
	command?: string;
	error?: string;
	stats?: { sent: number | null; received: number | null; packetLoss: string | null };
};

type PingResult = {
	ok: boolean;
	target: string;
	raw: string;
	command?: string;
	error?: string;
	stats?: ConnectivityPingResp['stats'];
};

function formatPingSummary(ping: PingResult): string {
	const sent = ping.stats?.sent;
	const received = ping.stats?.received;
	const loss = ping.stats?.packetLoss;
	if (sent != null && received != null) {
		return loss ? `发送 ${sent}，收到 ${received}，丢包 ${loss}` : `发送 ${sent}，收到 ${received}`;
	}
	if (ping.ok) return '探测通';
	return ping.error || '未收到回复';
}

export function HealthPage() {
	const [publicGw, setPublicGw] = useState('');
	const [running, setRunning] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [pingResult, setPingResult] = useState<PingResult | null>(null);
	const [rawDrawerOpen, setRawDrawerOpen] = useState(false);

	const run = async () => {
		const gw = publicGw.trim();
		if (!gw) {
			setError('请先填写探测目标 IPv4');
			return;
		}
		setRunning(true);
		setError(null);
		setPingResult(null);
		try {
			let ping: ConnectivityPingResp;
			try {
				const res = await api.post<ConnectivityPingResp>('/connectivity/ping', { target: gw, repeat: 3 });
				ping = res.data;
			} catch (e) {
				ping = {
					ok: false,
					target: gw,
					error: e instanceof Error ? e.message : 'clish do ping 失败',
					raw: '',
				};
			}
			setPingResult({
				ok: Boolean(ping.ok),
				target: gw,
				raw: String(ping.raw ?? '').trim(),
				command: ping.command,
				error: ping.error,
				stats: ping.stats,
			});
		} catch (e) {
			setError(e instanceof Error ? e.message : '巡检失败');
		} finally {
			setRunning(false);
		}
	};

	return (
		<>
			<PageStack>
				<PageHeader title="健康巡检" description="探测目标可达性（clish do ping / Linux ping）。" />

				<ContentBlock>
					<BlockHeader
						title="巡检参数"
						action={
							<Button type="primary" onClick={run} loading={running}>
								开始巡检
							</Button>
						}
					/>
					<Card variant="padded">
						<Space wrap>
							<Input
								placeholder="探测目标 IPv4（例如 34.1.1.3）"
								style={{ width: 320 }}
								value={publicGw}
								onChange={(e) => setPublicGw(e.target.value)}
								onPressEnter={() => {
									if (!running) void run();
								}}
								disabled={running}
								allowClear
							/>
							{pingResult ? (pingResult.ok ? <Tag color="green">探测通</Tag> : <Tag color="red">探测失败</Tag>) : null}
						</Space>
						{error ? (
							<Typography.Paragraph type="danger" style={{ marginTop: 12, marginBottom: 0 }}>
								{error}
							</Typography.Paragraph>
						) : null}
					</Card>
				</ContentBlock>

				<ContentBlock>
					<BlockHeader
						title="巡检结果"
						action={<Button onClick={() => setRawDrawerOpen(true)}>查看原始输出</Button>}
					/>
					<Card variant="padded">
						{pingResult ? (
							<>
								<Typography.Paragraph
									type={pingResult.ok ? undefined : 'danger'}
									style={{ marginTop: 0, marginBottom: 8 }}
								>
									{pingResult.target}：{formatPingSummary(pingResult)}
								</Typography.Paragraph>
								{pingResult.raw ? (
									<pre className="app-code-block app-code-block-full" style={{ marginBottom: 0 }}>
										{pingResult.raw}
									</pre>
								) : (
									<Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
										{pingResult.error || '无 ping 回显'}
									</Typography.Paragraph>
								)}
							</>
						) : (
							<Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
								填写探测目标后按回车或点「开始巡检」。
							</Typography.Paragraph>
						)}
					</Card>
				</ContentBlock>
			</PageStack>

			<Drawer title="原始输出 — clish do ping" width={720} open={rawDrawerOpen} onClose={() => setRawDrawerOpen(false)} destroyOnClose={false}>
				<Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
					最近一次探测的命令与完整回显。
				</Typography.Paragraph>
				<pre className="app-code-block app-code-block-full">
					{pingResult
						? [pingResult.command, pingResult.raw, pingResult.error].filter(Boolean).join('\n\n') || '（暂无）'
						: '（暂无，请先执行巡检）'}
				</pre>
			</Drawer>
		</>
	);
}
