import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Spin, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { getApiErrorMessage } from '../../../../../../services/api';
import { fetchIbrForwardingSrv6Status } from '../../../../../../services/ibrDeviceOpsApi';
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

type Srv6Row = {
	key: string;
	locator: string;
	prefix: string;
};

function formatCell(value: unknown): string {
	if (value == null || value === '') return '—';
	return String(value);
}

function parseSrv6Rows(cloud: unknown[]): Srv6Row[] {
	return cloud.flatMap((item, index) => {
		if (!item || typeof item !== 'object') return [];
		const o = item as Record<string, unknown>;
		return [
			{
				key: String(index),
				locator: formatCell(o.locator),
				prefix: formatCell(o.prefix),
			},
		];
	});
}

export const VrConsoleSrv6Panel: React.FC<Props> = ({ vrUuid, managementIp }) => {
	const [loading, setLoading] = useState(false);
	const [raw, setRaw] = useState('');
	const [cloud, setCloud] = useState<unknown[]>([]);
	const [rawDrawerOpen, setRawDrawerOpen] = useState(false);
	const [cloudDrawerOpen, setCloudDrawerOpen] = useState(false);

	const load = useCallback(async () => {
		setLoading(true);
		try {
			const data = await fetchIbrForwardingSrv6Status(vrUuid, { skipCache: true });
			if (data.error) throw new Error(data.error);
			setRaw(typeof data.raw === 'string' ? data.raw : '');
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

	const rows = useMemo(() => parseSrv6Rows(cloud), [cloud]);
	const { page, setPage, pageData, total } = useForwardTablePage(rows, FORWARD_TABLE_PAGE_SIZE);
	const cloudText = useMemo(() => JSON.stringify(cloud, null, 2) || '[]', [cloud]);

	const columns = useMemo((): ColumnsType<Srv6Row> => {
		return [
			{ title: 'Locator', dataIndex: 'locator', ellipsis: true },
			{ title: 'Prefix', dataIndex: 'prefix', ellipsis: true },
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
						<h2 className="ibr-console-block-title">SRv6 状态</h2>
						<div className="ibr-console-block-action">
							<Button type="default" loading={loading} onClick={() => void load()}>
								刷新
							</Button>
							<Button type="default" onClick={() => setCloudDrawerOpen(true)}>
								云配置
							</Button>
							<Button type="default" onClick={() => setRawDrawerOpen(true)}>
								设备输出
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
									locale={{ emptyText: forwardTableEmpty('暂无 SRv6 配置') }}
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
				title="云配置"
				open={cloudDrawerOpen}
				onClose={() => setCloudDrawerOpen(false)}
				text={cloudText}
			/>

			<ForwardTextDrawer
				title="设备输出"
				open={rawDrawerOpen}
				onClose={() => setRawDrawerOpen(false)}
				text={raw}
			/>
		</>
	);
};
