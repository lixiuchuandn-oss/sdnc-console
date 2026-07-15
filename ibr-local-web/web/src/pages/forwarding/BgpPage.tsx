import { Button, Drawer, Select, Space, Tag, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../api/client';
import { PageHeader } from '../../components/PageHeader';
import { PageStack } from '../../components/PageStack';
import { TableBlock } from '../../components/TableBlock';
import {
	afiLabel,
	normalizeBgpSummaryNeighbors,
	type BgpNeighborRow,
} from '../../lib/parseBgpSummary';

function stateTag(state?: string) {
	const s = String(state || '').trim();
	if (!s) return '—';
	if (/^established$/i.test(s)) return <Tag color="success">Established</Tag>;
	if (/idle|active|connect|opensent|openconfirm/i.test(s)) return <Tag color="warning">{s}</Tag>;
	return <Tag>{s}</Tag>;
}

export function BgpPage() {
	const [loading, setLoading] = useState(false);
	const [raw, setRaw] = useState('');
	const [neighbors, setNeighbors] = useState<BgpNeighborRow[]>([]);
	const [cloud, setCloud] = useState<unknown[]>([]);
	const [vrfFilter, setVrfFilter] = useState<string | undefined>();
	const [afiFilter, setAfiFilter] = useState<string | undefined>();
	const [cloudDrawerOpen, setCloudDrawerOpen] = useState(false);
	const [rawDrawerOpen, setRawDrawerOpen] = useState(false);

	const load = useCallback(async () => {
		setLoading(true);
		try {
			const { data } = await api.get<{ raw: string; neighbors: BgpNeighborRow[]; cloud: unknown[] }>(
				'/forwarding/bgp/summary',
			);
			const rawText = data.raw ?? '';
			setRaw(rawText);
			setNeighbors(normalizeBgpSummaryNeighbors(rawText, data.neighbors));
			setCloud(Array.isArray(data.cloud) ? data.cloud : []);
		} catch (e) {
			message.error(e instanceof Error ? e.message : '加载失败');
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	const vrfOptions = useMemo(() => {
		const set = new Set<string>();
		for (const n of neighbors) {
			if (n.vrf) set.add(n.vrf);
		}
		return [...set].sort().map((v) => ({ label: v, value: v }));
	}, [neighbors]);

	const afiOptions = useMemo(() => {
		const set = new Set<string>();
		for (const n of neighbors) {
			if (n.afi) set.add(n.afi);
		}
		return [...set].map((a) => ({ label: afiLabel(a), value: a }));
	}, [neighbors]);

	const filtered = useMemo(() => {
		return neighbors.filter((n) => {
			if (vrfFilter && n.vrf !== vrfFilter) return false;
			if (afiFilter && n.afi !== afiFilter) return false;
			return true;
		});
	}, [neighbors, vrfFilter, afiFilter]);

	const columns: ColumnsType<BgpNeighborRow> = useMemo(
		() => [
			{
				title: 'VRF',
				dataIndex: 'vrf',
				fixed: 'left',
				render: (v?: string) => (v ? <Tag color={v === 'default' ? 'blue' : 'purple'}>{v}</Tag> : '—'),
			},
			{
				title: '地址族',
				dataIndex: 'afi',
				render: (a?: string) => afiLabel(a),
			},
			{ title: '邻居', dataIndex: 'neighbor', fixed: 'left', ellipsis: true },
			{ title: 'AS', dataIndex: 'as', width: 90 },
			{ title: 'Up/Down', dataIndex: 'up_down', width: 110 },
			{
				title: '状态',
				dataIndex: 'state',
				width: 130,
				render: (s?: string) => stateTag(s),
			},
			{ title: '收前缀', dataIndex: 'pfx_rcd', width: 90, render: (v?: string) => v || '—' },
			{ title: '发前缀', dataIndex: 'pfx_snt', width: 90, render: (v?: string) => v || '—' },
		],
		[],
	);

	const cloudText = useMemo(() => JSON.stringify(cloud, null, 2) || '[]', [cloud]);

	return (
		<>
			<PageStack>
				<PageHeader
					title="BGP 邻居"
					description="来自 show bgp summary：按 VRF / 地址族分段展示（公网 default、私网 VRF、VPN）。"
				/>

				<TableBlock
					title="BGP 邻居"
					action={
						<Space wrap size={8}>
							<Select
								allowClear
								placeholder="VRF"
								style={{ width: 140 }}
								options={vrfOptions}
								value={vrfFilter}
								onChange={(v) => setVrfFilter(v)}
							/>
							<Select
								allowClear
								placeholder="地址族"
								style={{ width: 150 }}
								options={afiOptions}
								value={afiFilter}
								onChange={(v) => setAfiFilter(v)}
							/>
							<Button onClick={() => void load()}>刷新</Button>
							<Button onClick={() => setCloudDrawerOpen(true)}>云配置</Button>
							<Button onClick={() => setRawDrawerOpen(true)}>原始输出</Button>
						</Space>
					}
					loading={loading}
					rowKey={(r) => r.id || `${r.vrf}|${r.afi}|${r.neighbor}`}
					columns={columns}
					dataSource={filtered}
					paginated
					pageSize={10}
					scroll={{ x: true }}
					locale={{ emptyText: '暂无 BGP 邻居' }}
				/>
			</PageStack>

			<Drawer
				title="云配置 BGP"
				width={720}
				open={cloudDrawerOpen}
				onClose={() => setCloudDrawerOpen(false)}
				destroyOnClose={false}
			>
				<pre className="app-code-block app-code-block-full">{cloudText}</pre>
			</Drawer>

			<Drawer
				title="show bgp summary 原始输出"
				width={720}
				open={rawDrawerOpen}
				onClose={() => setRawDrawerOpen(false)}
				destroyOnClose={false}
			>
				<pre className="app-code-block app-code-block-full">{raw.trim() || '（暂无）'}</pre>
			</Drawer>
		</>
	);
}
