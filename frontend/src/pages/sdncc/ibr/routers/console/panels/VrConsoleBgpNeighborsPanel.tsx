import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Select, Space, Spin, Tag, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { getApiErrorMessage } from '../../../../../../services/api';
import {
	fetchIbrForwardingBgpSummary,
	type IbrBgpNeighborRow,
} from '../../../../../../services/ibrDeviceOpsApi';
import {
	ConsoleForwardTable,
	FORWARD_TABLE_PAGE_SIZE,
	ForwardTableFooter,
	ForwardTextDrawer,
	forwardTableEmpty,
	useForwardTablePage,
} from '../lib/forwardPanelUi';
import { normalizeBgpSummaryNeighbors } from '../lib/parseBgpSummary';
import { VrConsoleNoDevicePanel } from './VrConsoleNoDevicePanel';

type Props = {
	vrUuid: string;
	managementIp: string;
};

function afiLabel(afi?: string): string {
	switch (String(afi || '')) {
		case 'ipv4-unicast':
			return 'IPv4 Unicast';
		case 'ipv4-vpn':
			return 'IPv4 VPN';
		case 'ipv6-unicast':
			return 'IPv6 Unicast';
		case 'ipv6-vpn':
			return 'IPv6 VPN';
		default:
			return afi || '—';
	}
}

function stateTag(state?: string) {
	const s = String(state || '').trim();
	if (!s) return '—';
	if (/^established$/i.test(s)) return <Tag color="success">Established</Tag>;
	if (/idle|active|connect|opensent|openconfirm/i.test(s)) return <Tag color="warning">{s}</Tag>;
	return <Tag>{s}</Tag>;
}

export const VrConsoleBgpNeighborsPanel: React.FC<Props> = ({ vrUuid, managementIp }) => {
	const [loading, setLoading] = useState(false);
	const [raw, setRaw] = useState('');
	const [neighbors, setNeighbors] = useState<IbrBgpNeighborRow[]>([]);
	const [cloud, setCloud] = useState<unknown[]>([]);
	const [rawDrawerOpen, setRawDrawerOpen] = useState(false);
	const [cloudDrawerOpen, setCloudDrawerOpen] = useState(false);
	const [vrfFilter, setVrfFilter] = useState<string | undefined>();
	const [afiFilter, setAfiFilter] = useState<string | undefined>();

	const load = useCallback(async () => {
		setLoading(true);
		try {
			const data = await fetchIbrForwardingBgpSummary(vrUuid, { skipCache: true });
			if (data.error) throw new Error(data.error);
			const rawText = typeof data.raw === 'string' ? data.raw : '';
			setRaw(rawText);
			setNeighbors(normalizeBgpSummaryNeighbors(rawText, data.neighbors));
			setCloud(Array.isArray(data.cloud) ? data.cloud : []);
		} catch (e) {
			message.error(getApiErrorMessage(e, '加载失败'));
		} finally {
			setLoading(false);
		}
	}, [vrUuid]);

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

	const { page, setPage, pageData, total } = useForwardTablePage(filtered, FORWARD_TABLE_PAGE_SIZE);

	const cloudText = useMemo(() => JSON.stringify(cloud, null, 2) || '[]', [cloud]);

	const columns = useMemo((): ColumnsType<IbrBgpNeighborRow> => {
		return [
			{
				title: 'VRF',
				dataIndex: 'vrf',
				fixed: 'left',
				render: (v?: string) =>
					v ? <Tag color={v === 'default' ? 'blue' : 'purple'}>{v}</Tag> : '—',
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
		];
	}, []);

	if (!managementIp) {
		return <VrConsoleNoDevicePanel />;
	}

	return (
		<>
			<div className="ibr-console-ops-panel">
				<div className="ibr-console-content-block">
					<div className="ibr-console-block-header">
						<h2 className="ibr-console-block-title">BGP 邻居</h2>
						<div className="ibr-console-block-action">
							<Space wrap size={8}>
								<Select
									allowClear
									placeholder="VRF"
									style={{ width: 140 }}
									options={vrfOptions}
									value={vrfFilter}
									onChange={(v) => {
										setVrfFilter(v);
										setPage(1);
									}}
								/>
								<Select
									allowClear
									placeholder="地址族"
									style={{ width: 150 }}
									options={afiOptions}
									value={afiFilter}
									onChange={(v) => {
										setAfiFilter(v);
										setPage(1);
									}}
								/>
								<Button type="default" onClick={() => void load()}>
									刷新
								</Button>
								<Button type="default" onClick={() => setCloudDrawerOpen(true)}>
									云配置
								</Button>
								<Button type="default" onClick={() => setRawDrawerOpen(true)}>
									原始输出
								</Button>
							</Space>
						</div>
					</div>
					<div className="ibr-console-ops-card ibr-console-ops-card--table-pad">
						<div className="ibr-console-data-table-wrap">
							<Spin spinning={loading}>
								<ConsoleForwardTable
									showHeader
									rowKey={(r) => r.id || `${r.vrf}|${r.afi}|${r.neighbor}`}
									columns={columns}
									dataSource={pageData}
									scroll={{ x: true }}
									locale={{ emptyText: forwardTableEmpty('暂无 BGP 邻居') }}
								/>
							</Spin>
						</div>
					</div>
					<ForwardTableFooter
						total={total}
						page={page}
						pageSize={FORWARD_TABLE_PAGE_SIZE}
						onChange={setPage}
					/>
				</div>
			</div>

			<ForwardTextDrawer
				title="云配置 BGP"
				open={cloudDrawerOpen}
				onClose={() => setCloudDrawerOpen(false)}
				text={cloudText}
			/>

			<ForwardTextDrawer
				title="show bgp summary 原始输出"
				open={rawDrawerOpen}
				onClose={() => setRawDrawerOpen(false)}
				text={raw}
			/>
		</>
	);
};
