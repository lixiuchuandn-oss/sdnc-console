import { ReloadOutlined } from '@ant-design/icons';
import { Alert, Button, Input, Select, Spin, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { isAuthRequiredError } from '../../api/apiError';
import { api } from '../../api/client';import { BlockHeader } from '../../components/BlockHeader';
import { Card } from '../../components/Card';
import { ContentBlock } from '../../components/ContentBlock';
import { DataTable, TableFooter, useDataTablePage } from '../../components/DataTable';
import { PageHeader } from '../../components/PageHeader';
import { PageStack } from '../../components/PageStack';

export type AisocEventRow = {
	tname?: string;
	attack_type?: string;
	risk_level?: string;
	start_time?: string;
	end_time?: string;
	status?: string;
	progress?: string | number;
	md_report?: string;
	report_content?: string;
};

function fmtTime(t: string | undefined): string {
	if (!t) return '';
	return t.replace('T', ' ').replace(/\.\d+Z$/u, '');
}

function formatDuration(r: AisocEventRow): string {
	const s = fmtTime(r.start_time);
	const e = fmtTime(r.end_time);
	if (s && e) return `${s} 至 ${e}`;
	if (s || e) return s || e;
	return '—';
}

function matchRisk(risk: string, filter: string): boolean {
	const r = (risk || '').toLowerCase();
	if (filter === 'high') return r === '高' || r === 'high' || r === 'critical';
	if (filter === 'medium') return r === '中' || r === 'medium';
	if (filter === 'low') return r === '低' || r === 'low';
	return true;
}

function statusTag(status: string | undefined) {
	const s = String(status ?? 'unknown')
		.trim()
		.toLowerCase();
	if (['success', 'completed', 'finish', 'finished'].includes(s)) {
		return <Tag color="success">已完成</Tag>;
	}
	if (['failed', 'error', 'fail'].includes(s)) {
		return <Tag color="error">失败</Tag>;
	}
	return <Tag>{status ?? '—'}</Tag>;
}

type LoadHint = 'login' | 'unavailable' | 'unconfigured' | null;

export function AiThreatIntelPage() {
	const [loading, setLoading] = useState(true);
	const [all, setAll] = useState<AisocEventRow[]>([]);
	const [kw, setKw] = useState('');
	const [risk, setRisk] = useState<string>('');
	const [loadHint, setLoadHint] = useState<LoadHint>(null);

	const load = useCallback(async () => {
		setLoading(true);
		try {
			const { data } = await api.get<unknown>('/aisoc/events');
			setLoadHint(null);
			let list: unknown[] = [];
			if (Array.isArray(data)) list = data;
			else if (data && typeof data === 'object' && 'items' in (data as object)) {
				const it = (data as { items?: unknown }).items;
				if (Array.isArray(it)) list = it;
			}
			setAll(list.filter((x): x is AisocEventRow => x !== null && typeof x === 'object' && !Array.isArray(x)));
		} catch (e) {
			setAll([]);
			if (isAuthRequiredError(e)) {
				setLoadHint('login');
			} else if (e instanceof Error && /未配置|地址不能为空/i.test(e.message)) {
				setLoadHint('unconfigured');
			} else {
				setLoadHint('unavailable');
			}
		} finally {
			setLoading(false);
		}
	}, []);
	useEffect(() => {
		void load();
	}, [load]);

	const filtered = useMemo(() => {
		let rows = all;
		const k = kw.trim().toLowerCase();
		if (k) {
			rows = rows.filter((item) => {
				const name = (item.tname || '').toLowerCase();
				const t = (item.attack_type || '').toLowerCase();
				return name.includes(k) || t.includes(k);
			});
		}
		if (risk) {
			rows = rows.filter((item) => matchRisk(String(item.risk_level ?? ''), risk));
		}
		return rows;
	}, [all, kw, risk]);

	const pageSize = 10;
	const { page, setPage, pageData, total } = useDataTablePage(filtered, pageSize);

	useEffect(() => {
		setPage(1);
	}, [kw, risk, setPage]);

	const columns: ColumnsType<AisocEventRow> = useMemo(
		() => [
			{
				title: '#',
				key: 'i',
				width: 56,
				render: (_: unknown, __: AisocEventRow, i: number) => (page - 1) * pageSize + i + 1,
			},
			{ title: '威胁名称', dataIndex: 'tname', key: 'tname', ellipsis: true, render: (v) => v ?? '—' },
			{ title: '威胁类型', dataIndex: 'attack_type', key: 'attack_type', width: 120, render: (v) => v ?? '—' },
			{ title: '风险等级', dataIndex: 'risk_level', key: 'risk_level', width: 100, render: (v) => v ?? '—' },
			{ title: '攻击持续时间', key: 'duration', width: 300, ellipsis: true, render: (_: unknown, r) => formatDuration(r) },
			{ title: '分析状态', dataIndex: 'status', key: 'status', width: 100, render: (v) => statusTag(String(v)) },
		],
		[page],
	);

	return (
		<PageStack>
			<PageHeader title="AI 威胁情报" description="查看 AI SOC 威胁分析事件。" />

			<ContentBlock>
				<BlockHeader
					title="威胁事件"
					action={
						<>
							<Input allowClear placeholder="搜索威胁名称、类型" value={kw} onChange={(e) => setKw(e.target.value)} style={{ width: 220 }} />
							<Select
								allowClear
								placeholder="风险等级"
								value={risk || undefined}
								onChange={(v) => setRisk(v ?? '')}
								style={{ width: 140 }}
								options={[
									{ value: 'high', label: '高' },
									{ value: 'medium', label: '中' },
									{ value: 'low', label: '低' },
								]}
							/>
							<Button icon={<ReloadOutlined />} onClick={() => void load()}>
								刷新
							</Button>
						</>
					}
				/>
				<Card variant="table">
					<Spin spinning={loading}>
						{loadHint === 'login' ? (
							<Alert
								type="info"
								showIcon
								style={{ marginBottom: 16 }}
								message="请先登录"
								description="登录后可查看威胁分析事件。"
							/>
						) : null}
						{loadHint === 'unconfigured' ? (
							<Alert
								type="info"
								showIcon
								style={{ marginBottom: 16 }}
								message="暂不可用"
								description="请先在「配置服务」中设置 AI SOC 地址。"
							/>
						) : null}
						{loadHint === 'unavailable' ? (
							<Alert
								type="info"
								showIcon
								style={{ marginBottom: 16 }}
								message="暂时无法加载"
								description="请稍后重试或点击刷新。"
							/>
						) : null}
						<DataTable<AisocEventRow>							showPagination={false}
							rowKey={(_r, i) => `aisoc-${i}`}
							columns={columns}
							dataSource={pageData}
							scroll={{ x: 900 }}
							expandable={{
								expandedRowRender: (r) => {
									const text = (r.md_report || r.report_content || '').trim() || '无报告内容';
									return (
										<Typography.Paragraph copyable style={{ margin: 0, fontFamily: 'monospace', fontSize: 12, whiteSpace: 'pre-wrap' }}>
											{text}
										</Typography.Paragraph>
									);
								},
								rowExpandable: (r) => Boolean((r.md_report || r.report_content || '').trim()),
							}}
						/>
					</Spin>
				</Card>
				<TableFooter total={total} page={page} pageSize={pageSize} onChange={setPage} />
			</ContentBlock>
		</PageStack>
	);
}
