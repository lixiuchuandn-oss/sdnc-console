import { CheckCircleOutlined, CloseCircleOutlined, ExclamationCircleOutlined } from '@ant-design/icons';
import { Button, Drawer, Input, Space, Spin, Steps, Tag, Typography } from 'antd';
import type { StepsProps } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../../api/client';
import { BlockHeader } from '../../../components/BlockHeader';
import { Card } from '../../../components/Card';
import { ContentBlock } from '../../../components/ContentBlock';
import { PageHeader } from '../../../components/PageHeader';
import { PageStack } from '../../../components/PageStack';

const HEALTH_STEP_REVEAL_MS = 480;

type SelfcheckResp = {
	ok: boolean;
	reasons?: string[];
	checks?: Array<{ name: string; status: 'pass' | 'warning' | 'fail'; detail: string }>;
	raw?: string;
	error?: string;
};

function statusTag(status: 'pass' | 'warning' | 'fail') {
	if (status === 'pass') return <Tag color="green">通过</Tag>;
	if (status === 'warning') return <Tag color="orange">告警</Tag>;
	return <Tag color="red">失败</Tag>;
}

function checksToStepItems(checks: Array<{ name: string; status: 'pass' | 'warning' | 'fail'; detail: string }>): NonNullable<StepsProps['items']> {
	return checks.map((c) => {
		const stepStatus: StepsProps['status'] = c.status === 'fail' ? 'error' : 'finish';
		const icon =
			c.status === 'fail' ? (
				<CloseCircleOutlined />
			) : c.status === 'warning' ? (
				<ExclamationCircleOutlined style={{ color: '#fa8c16' }} />
			) : (
				<CheckCircleOutlined />
			);
		return {
			title: (
				<Space size={8} wrap align="center">
					<span style={{ fontWeight: 600 }}>{c.name}</span>
					{statusTag(c.status)}
				</Space>
			),
			description: <Typography.Text type="secondary">{c.detail}</Typography.Text>,
			status: stepStatus,
			icon,
		};
	});
}

export function HealthPage() {
	const [publicGw, setPublicGw] = useState('');
	const [running, setRunning] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [result, setResult] = useState<SelfcheckResp | null>(null);
	const [rawDrawerOpen, setRawDrawerOpen] = useState(false);
	const [revealedStepCount, setRevealedStepCount] = useState(0);

	const checksLen = Array.isArray(result?.checks) ? result!.checks!.length : 0;

	useEffect(() => {
		const checks = result?.checks;
		const len = Array.isArray(checks) ? checks.length : 0;
		if (!len) {
			setRevealedStepCount(0);
			return;
		}
		setRevealedStepCount(0);
		let cancelled = false;
		const timers: ReturnType<typeof setTimeout>[] = [];
		for (let i = 0; i < len; i++) {
			timers.push(
				setTimeout(() => {
					if (!cancelled) setRevealedStepCount(i + 1);
				}, HEALTH_STEP_REVEAL_MS * (i + 1)),
			);
		}
		return () => {
			cancelled = true;
			timers.forEach(clearTimeout);
		};
	}, [result]);

	const stepItems = useMemo(() => {
		const list = result?.checks;
		if (!Array.isArray(list) || list.length === 0 || revealedStepCount === 0) return [];
		return checksToStepItems(list.slice(0, revealedStepCount));
	}, [result?.checks, revealedStepCount]);

	const run = async () => {
		setRunning(true);
		setError(null);
		setResult(null);
		try {
			const { data } = await api.post<SelfcheckResp>('/selfcheck', { public_gw: publicGw.trim() || undefined });
			setResult(data);
		} catch (e) {
			setError(e instanceof Error ? e.message : '巡检失败');
		} finally {
			setRunning(false);
		}
	};

	return (
		<>
			<PageStack>
				<PageHeader title="健康巡检" description="检查设备运行与网络连通状态。" />

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
								placeholder="可选：公网网关（例如 10.0.0.1）"
								style={{ width: 320 }}
								value={publicGw}
								onChange={(e) => setPublicGw(e.target.value)}
								disabled={running}
							/>
							{result ? (result.ok ? <Tag color="green">整体通过</Tag> : <Tag color="red">存在异常</Tag>) : null}
						</Space>
						{error ? (
							<Typography.Paragraph type="danger" style={{ marginTop: 12, marginBottom: 0 }}>
								{error}
							</Typography.Paragraph>
						) : null}
					</Card>
				</ContentBlock>

				<ContentBlock>
					<BlockHeader title="巡检结果" action={<Button onClick={() => setRawDrawerOpen(true)}>查看原始输出</Button>} />
					<Card variant="padded">
						{result?.reasons && result.reasons.length > 0 ? (
							<Typography.Paragraph type="danger" style={{ marginTop: 0 }}>
								{result.reasons.join('；')}
							</Typography.Paragraph>
						) : null}
						{checksLen > 0 ? (
							<div style={{ marginTop: result?.reasons?.length ? 8 : 0 }}>
								{revealedStepCount === 0 ? (
									<Space align="center">
										<Spin size="small" />
										<Typography.Text type="secondary">正在逐项展示巡检结果…</Typography.Text>
									</Space>
								) : (
									<Steps direction="vertical" size="small" items={stepItems} />
								)}
							</div>
						) : (
							<Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
								点击「开始巡检」获取检查结果。
							</Typography.Paragraph>
						)}
					</Card>
				</ContentBlock>
			</PageStack>

			<Drawer title="原始输出 — vbras CLI" width={720} open={rawDrawerOpen} onClose={() => setRawDrawerOpen(false)} destroyOnClose={false}>
				<Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
					以下为最近一次「开始巡检」返回的原始文本，便于对照步骤结果排障。
				</Typography.Paragraph>
				<pre className="app-code-block app-code-block-full">{result?.raw?.trim() ? result.raw : '（暂无，请先执行巡检）'}</pre>
			</Drawer>
		</>
	);
}
