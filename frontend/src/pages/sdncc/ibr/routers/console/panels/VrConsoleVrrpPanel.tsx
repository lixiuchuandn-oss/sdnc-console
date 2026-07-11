import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Spin, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { getApiErrorMessage } from '../../../../../../services/api';
import { fetchIbrForwardingVrrp } from '../../../../../../services/ibrDeviceOpsApi';
import {
	ConsoleForwardTable,
	FORWARD_TABLE_PAGE_SIZE,
	ForwardTableFooter,
	ForwardTextDrawer,
	forwardTableEmpty,
	useForwardTablePage,
} from '../lib/forwardPanelUi';
import { VrConsoleNoDevicePanel } from './VrConsoleNoDevicePanel';

type Props = {
	vrUuid: string;
	managementIp: string;
};

type VrrpCloudRow = {
	key: string;
	group_id: string;
	vrrp_instance: string;
	track_gateway: string;
};

function formatCell(value: unknown): string {
	if (value == null || value === '') return '—';
	if (Array.isArray(value)) return value.length ? value.join(', ') : '—';
	return String(value);
}

function parseCloudRows(cloud: unknown[]): VrrpCloudRow[] {
	return cloud.flatMap((item, index) => {
		if (!item || typeof item !== 'object') return [];
		const o = item as Record<string, unknown>;
		return [
			{
				key: String(index),
				group_id: formatCell(o.group_id),
				vrrp_instance: formatCell(o.vrrp_instance),
				track_gateway: formatCell(o.track_gateway),
			},
		];
	});
}

export const VrConsoleVrrpPanel: React.FC<Props> = ({ vrUuid, managementIp }) => {
	const [loading, setLoading] = useState(false);
	const [cloud, setCloud] = useState<unknown[]>([]);
	const [cloudDrawerOpen, setCloudDrawerOpen] = useState(false);

	const load = useCallback(async () => {
		setLoading(true);
		try {
			const data = await fetchIbrForwardingVrrp(vrUuid, { skipCache: true });
			if (data.error) throw new Error(data.error);
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

	const rows = useMemo(() => parseCloudRows(cloud), [cloud]);
	const { page, setPage, pageData, total } = useForwardTablePage(rows, FORWARD_TABLE_PAGE_SIZE);
	const cloudText = useMemo(() => JSON.stringify(cloud, null, 2) || '[]', [cloud]);

	const columns = useMemo((): ColumnsType<VrrpCloudRow> => {
		return [
			{ title: 'Group ID', dataIndex: 'group_id', ellipsis: true },
			{ title: 'VRRP 实例', dataIndex: 'vrrp_instance', ellipsis: true },
			{ title: 'Track 网关', dataIndex: 'track_gateway', ellipsis: true },
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
						<h2 className="ibr-console-block-title">云配置 VRRP</h2>
						<div className="ibr-console-block-action">
							<Button type="default" loading={loading} onClick={() => void load()}>
								刷新
							</Button>
							<Button type="default" onClick={() => setCloudDrawerOpen(true)}>
								云配置 JSON
							</Button>
						</div>
					</div>
					<div className="ibr-console-ops-card ibr-console-ops-card--table-pad">
						<div className="ibr-console-data-table-wrap">
							<Spin spinning={loading}>
								<ConsoleForwardTable
									showHeader
									rowKey="key"
									columns={columns}
									dataSource={pageData}
									scroll={{ x: true }}
									locale={{ emptyText: forwardTableEmpty('暂无云配置 VRRP') }}
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
				title="云配置 JSON"
				open={cloudDrawerOpen}
				onClose={() => setCloudDrawerOpen(false)}
				text={cloudText}
			/>
		</>
	);
};
