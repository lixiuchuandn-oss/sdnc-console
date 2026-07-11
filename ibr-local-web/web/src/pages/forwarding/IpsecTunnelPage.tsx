import { Button, Drawer, Space, Tag, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client';
import { PageHeader } from '../../components/PageHeader';
import { PageStack } from '../../components/PageStack';
import { TableBlock } from '../../components/TableBlock';
import { IpsecTunnelConfigPanel } from './IpsecTunnelConfigPanel';

type ChildSa = { name: string; status: string; in_bytes: number; in_packets: number; out_bytes: number; out_packets: number };
type SasConn = {
	name: string;
	status: string;
	local: string;
	remote: string;
	uptime: string;
	children: ChildSa[];
	source?: string;
	raw_lines?: string[];
};

function SaStatusTab() {
	const [loading, setLoading] = useState(false);
	const [sas, setSas] = useState<SasConn[]>([]);
	const [raw, setRaw] = useState('');
	const [rawDrawerOpen, setRawDrawerOpen] = useState(false);

	const loadSas = useCallback(async () => {
		setLoading(true);
		try {
			const { data } = await api.get<{ sas: SasConn[]; raw: string }>('/forwarding/ipsec/sas');
			setSas(data.sas ?? []);
			setRaw(data.raw ?? '');
		} catch (e) {
			message.error(e instanceof Error ? e.message : '加载失败');
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void loadSas();
	}, [loadSas]);

	const statusColor = (s: string) => {
		if (s === 'ESTABLISHED') return 'green';
		if (s === 'REKEYING') return 'processing';
		if (s === 'CONNECTING') return 'orange';
		if (s === 'Disconnected') return 'red';
		return 'default';
	};

	const columns: ColumnsType<SasConn> = [
		{ title: '名称 / ID', dataIndex: 'name', width: 140 },
		{
			title: '状态',
			dataIndex: 'status',
			width: 130,
			render: (s: string) => <Tag color={statusColor(s)}>{s}</Tag>,
		},
		{
			title: '来源',
			dataIndex: 'source',
			width: 90,
			render: (v: string) => (v === '云平台' ? v : v || '本地'),
		},
		{ title: '本端', dataIndex: 'local', ellipsis: true },
		{ title: '对端', dataIndex: 'remote', ellipsis: true },
		{ title: '运行时间', dataIndex: 'uptime', width: 120 },
		{
			title: '操作',
			key: 'op',
			width: 180,
			render: (_: unknown, row: SasConn) => (
				<Space size="small">
					<Button
						size="small"
						type="primary"
						onClick={async () => {
							try {
								await api.post('/forwarding/ipsec/connect', { ipsec_id: row.name });
								message.success('已发起连接');
								void loadSas();
							} catch (e) {
								message.error(e instanceof Error ? e.message : '失败');
							}
						}}
					>
						连接
					</Button>
					<Button
						size="small"
						danger
						onClick={async () => {
							try {
								await api.post('/forwarding/ipsec/disconnect', { ipsec_id: row.name });
								message.success('已断开');
								void loadSas();
							} catch (e) {
								message.error(e instanceof Error ? e.message : '失败');
							}
						}}
					>
						断开
					</Button>
				</Space>
			),
		},
	];

	return (
		<>
			<TableBlock
				title="SA 状态"
				action={
					<>
						<Button onClick={() => void loadSas()}>刷新 SA</Button>
						<Button onClick={() => setRawDrawerOpen(true)}>查看输出</Button>
					</>
				}
				loading={loading}
				rowKey="name"
				columns={columns}
				dataSource={sas}
				paginated={false}
				scroll={{ x: true }}
				expandable={{
					expandedRowRender: (row) => <pre className="app-code-block app-code-block-inset">{(row.raw_lines ?? []).join('\n')}</pre>,
				}}
			/>
			<Drawer title="原始输出 — ipsec_show_sas_list" width={720} open={rawDrawerOpen} onClose={() => setRawDrawerOpen(false)}>
				<pre className="app-code-block app-code-block-full">{raw.trim() || '（暂无）'}</pre>
			</Drawer>
		</>
	);
}

export function IpsecTunnelPage() {
	return (
		<PageStack>
			<PageHeader
				title="IPsec 隧道"
				description="查看隧道连接状态，创建和管理 IPsec 隧道配置。"
			/>
			<SaStatusTab />
			<IpsecTunnelConfigPanel />
		</PageStack>
	);
}
