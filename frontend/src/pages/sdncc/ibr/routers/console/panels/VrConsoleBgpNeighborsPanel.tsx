import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Spin, message } from 'antd';
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
import { VrConsoleNoDevicePanel } from './VrConsoleNoDevicePanel';

type Props = {
	vrUuid: string;
	managementIp: string;
};

export const VrConsoleBgpNeighborsPanel: React.FC<Props> = ({ vrUuid, managementIp }) => {
	const [loading, setLoading] = useState(false);
	const [raw, setRaw] = useState('');
	const [neighbors, setNeighbors] = useState<IbrBgpNeighborRow[]>([]);
	const [cloud, setCloud] = useState<unknown[]>([]);
	const [rawDrawerOpen, setRawDrawerOpen] = useState(false);
	const [cloudDrawerOpen, setCloudDrawerOpen] = useState(false);

	const load = useCallback(async () => {
		setLoading(true);
		try {
			const data = await fetchIbrForwardingBgpSummary(vrUuid, { skipCache: true });
			if (data.error) throw new Error(data.error);
			setRaw(typeof data.raw === 'string' ? data.raw : '');
			setNeighbors(Array.isArray(data.neighbors) ? data.neighbors : []);
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

	const { page, setPage, pageData, total } = useForwardTablePage(neighbors, FORWARD_TABLE_PAGE_SIZE);

	const cloudText = useMemo(() => JSON.stringify(cloud, null, 2) || '[]', [cloud]);

	const columns = useMemo((): ColumnsType<IbrBgpNeighborRow> => {
		return [
			{ title: '邻居', dataIndex: 'neighbor', ellipsis: true },
			{ title: 'AS', dataIndex: 'as', width: 100 },
			{ title: 'Up/Down', dataIndex: 'up_down', width: 120 },
			{ title: '状态', dataIndex: 'state', ellipsis: true },
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
							<Button type="default" onClick={() => void load()}>
								刷新
							</Button>
							<Button type="default" onClick={() => setCloudDrawerOpen(true)}>
								云配置
							</Button>
							<Button type="default" onClick={() => setRawDrawerOpen(true)}>
								原始输出
							</Button>
						</div>
					</div>
					<div className="ibr-console-ops-card ibr-console-ops-card--table-pad">
						<div className="ibr-console-data-table-wrap">
							<Spin spinning={loading}>
								<ConsoleForwardTable
									showHeader
									rowKey={(r) => r.neighbor}
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
				title="原始输出"
				open={rawDrawerOpen}
				onClose={() => setRawDrawerOpen(false)}
				text={raw}
			/>
		</>
	);
};
