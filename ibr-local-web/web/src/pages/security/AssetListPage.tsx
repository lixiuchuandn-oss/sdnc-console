import { ReloadOutlined, SyncOutlined } from '@ant-design/icons';
import { Button, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client';
import { PageHeader } from '../../components/PageHeader';
import { PageStack } from '../../components/PageStack';
import { TableBlock } from '../../components/TableBlock';

type AssetRow = {
	id?: string;
	ip?: string;
	name?: string;
	type?: string;
	risk?: string;
	lastSeen?: string;
	ports?: unknown[];
};

export function AssetListPage() {
	const [loading, setLoading] = useState(true);
	const [assets, setAssets] = useState<AssetRow[]>([]);

	const load = useCallback(async () => {
		setLoading(true);
		try {
			const { data } = await api.get<{ assets: AssetRow[] }>('/assets/');
			setAssets(Array.isArray(data.assets) ? data.assets : []);
		} catch (e) {
			message.error(e instanceof Error ? e.message : '加载失败');
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	const syncTower = async () => {
		try {
			const { data } = await api.post<{ count?: number; message?: string }>('/assets/sync', {});
			message.success(data.message ?? `已同步 ${data.count ?? 0} 条资产`);
			await load();
		} catch (e) {
			message.error(e instanceof Error ? e.message : '同步失败');
		}
	};

	const columns: ColumnsType<AssetRow> = [
		{ title: 'IP / 标识', dataIndex: 'ip', key: 'ip', width: 160, render: (_, r) => r.ip ?? r.id },
		{ title: '名称', dataIndex: 'name', key: 'name', ellipsis: true },
		{ title: '类型', dataIndex: 'type', key: 'type', width: 120 },
		{ title: '风险', dataIndex: 'risk', key: 'risk', width: 88 },
		{ title: '最近发现', dataIndex: 'lastSeen', key: 'lastSeen', width: 180 },
		{
			title: '开放端口数',
			key: 'ports',
			width: 110,
			render: (_, r) => (Array.isArray(r.ports) ? r.ports.length : 0),
		},
	];

	return (
		<PageStack>
			<PageHeader title="资产列表" description="查看扫描发现的资产，支持同步到平台。" />
			<TableBlock
				title="资产"
				action={
					<>
						<Button type="primary" icon={<SyncOutlined />} onClick={() => void syncTower()}>
							同步到平台
						</Button>
						<Button icon={<ReloadOutlined />} onClick={() => void load()}>
							刷新
						</Button>
					</>
				}
				loading={loading}
				rowKey={(r, i) => `${String(r.ip ?? r.id ?? 'row')}-${i}`}
				columns={columns}
				dataSource={assets}
				pageSize={10}
				scroll={{ x: 720 }}
			/>
		</PageStack>
	);
}
